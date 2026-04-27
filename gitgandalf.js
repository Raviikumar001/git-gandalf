"use strict";

const MAX_DIFF_BYTES = 1024 * 1024;
const LLM_TIMEOUT_MS = 30000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-2.0-flash";

function readStdin() {
  if (process.stdin.isTTY) {
    return Promise.resolve("");
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    process.stdin.on("data", (chunk) => {
      const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += bufferChunk.length;

      if (totalBytes > MAX_DIFF_BYTES) {
        process.stdin.destroy();
        const error = new Error(
          `Diff is too large to process safely (${totalBytes} bytes > ${MAX_DIFF_BYTES} bytes).`
        );
        error.code = "DIFF_TOO_LARGE";
        reject(error);
        return;
      }

      chunks.push(bufferChunk);
    });

    process.stdin.on("end", () => {
      try {
        const diff = Buffer.concat(chunks).toString("utf8");
        resolve(diff);
      } catch (error) {
        const wrapped = new Error("Unable to read staged diff from STDIN.");
        wrapped.code = "DIFF_UNREADABLE";
        wrapped.cause = error;
        reject(wrapped);
      }
    });

    process.stdin.on("error", reject);
  });
}

function normalizeLineEndings(text) {
  return text.replace(/\r\n?/g, "\n");
}

function extractDiffMetadata(diff) {
  const lines = diff.split("\n");
  const files = new Set();
  let linesAdded = 0;
  let linesRemoved = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("diff --git")) {
      const match = line.match(/b\/(.+)$/);
      if (match) {
        files.add(match[1]);
      }
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      linesAdded++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      linesRemoved++;
    }
  }

  return {
    files_changed: files.size,
    files: Array.from(files).sort(),
    lines_added: linesAdded,
    lines_removed: linesRemoved,
  };
}

function normalizeJudgment(rawOutput) {
  let parsed;
  try {
    parsed = JSON.parse(rawOutput);
  } catch (error) {
    throw new Error("LLM output is not valid JSON");
  }

  const risk = parsed.risk?.toUpperCase();
  if (!["LOW", "MEDIUM", "HIGH"].includes(risk)) {
    throw new Error(`Invalid risk value: ${parsed.risk}`);
  }

  const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
  if (!issues.every((issue) => typeof issue === "string")) {
    throw new Error("All issues must be strings");
  }

  const summary = typeof parsed.summary === "string" ? parsed.summary : "";
  if (!summary) {
    throw new Error("Summary is required and must be a non-empty string");
  }

  return { risk, issues, summary };
}

function decidePolicy(judgment) {
  const riskToPolicyMap = {
    LOW: "ALLOW",
    MEDIUM: "WARN",
    HIGH: "BLOCK",
  };

  return riskToPolicyMap[judgment.risk];
}

function renderReview(judgment, decision) {
  let output = "🧙 Git Gandalf Review\n\n";
  output += `Risk: ${judgment.risk}\n\n`;

  if (judgment.issues.length > 0) {
    output += "Issues:\n";
    for (const issue of judgment.issues) {
      output += `- ${issue}\n`;
    }
    output += "\n";
  }

  output += `${judgment.summary}\n\n`;

  const decisionLine =
    decision === "BLOCK"
      ? `🚫 Decision: BLOCK (commit rejected)`
      : decision === "WARN"
        ? `⚠️  Decision: WARN (allow, but review concerns)`
        : `✅ Decision: ALLOW (proceed safely)`;

  output += decisionLine + "\n";
  return output;
}

function buildJudgePrompt(metadata, rawDiff) {
  return `You are a senior engineer reviewing a staged commit. Analyze the diff strictly and output valid JSON only.

Diff metadata:
- Files changed: ${metadata.files_changed}
- Files: ${metadata.files.join(", ")}
- Lines added: ${metadata.lines_added}
- Lines removed: ${metadata.lines_removed}

Raw diff:
\`\`\`
${rawDiff}
\`\`\`

Evaluate the risk of this commit. Output ONLY valid JSON with this exact schema:
{
  "risk": "LOW" or "MEDIUM" or "HIGH",
  "issues": ["issue1", "issue2"],
  "summary": "Brief explanation"
}

Risk levels:
- LOW: Safe changes, no concerns
- MEDIUM: Has some concern but acceptable
- HIGH: Serious issue that should block the commit

Output ONLY JSON, no other text.`;
}

async function callGeminiLLM(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY environment variable is required");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1024,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `Gemini API error ${response.status}: ${error.error?.message || "unknown"}`
      );
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      throw new Error("No response from Gemini");
    }

    return content;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("LLM request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function getExitCodeForDecision(decision) {
  return decision === "BLOCK" ? 1 : 0;
}

function handleFailureMode(error) {
  const isLLMNotRunning = error.message.includes("not running");
  const isLLMTimeout = error.message.includes("timed out");
  const isMalformed = error.message.includes("JSON") || error.message.includes("Invalid");

  if (isLLMNotRunning || isLLMTimeout) {
    return {
      judgment: {
        risk: "MEDIUM",
        issues: [],
        summary: `LLM unavailable: ${error.message}. Commit allowed with caution.`,
      },
      decision: "WARN",
    };
  }

  if (isMalformed) {
    return {
      judgment: {
        risk: "HIGH",
        issues: ["LLM returned malformed judgment"],
        summary: `Cannot trust LLM output: ${error.message}`,
      },
      decision: "BLOCK",
    };
  }

  return {
    judgment: {
      risk: "HIGH",
      issues: ["Internal error during review"],
      summary: `Unexpected error: ${error.message || "unknown failure"}`,
    },
    decision: "BLOCK",
  };
}

async function main() {
  const rawDiff = await readStdin();
  const normalizedDiff = normalizeLineEndings(rawDiff);

  if (normalizedDiff.length === 0) {
    process.stdout.write(
      "Git Gandalf Review\nNo staged changes detected. Skipping analysis.\n"
    );
    process.exit(0);
  }

  const metadata = extractDiffMetadata(normalizedDiff);
  const prompt = buildJudgePrompt(metadata, normalizedDiff);

  let judgment;
  let decision;

  try {
    const llmOutput = await callGeminiLLM(prompt);
    judgment = normalizeJudgment(llmOutput);
    decision = decidePolicy(judgment);
  } catch (error) {
    const failureResult = handleFailureMode(error);
    judgment = failureResult.judgment;
    decision = failureResult.decision;
  }

  const review = renderReview(judgment, decision);
  process.stdout.write(review);
  const exitCode = getExitCodeForDecision(decision);
  process.exit(exitCode);
}

main().catch((error) => {
  if (error && typeof error.message === "string") {
    process.stderr.write(`Git Gandalf Review\n${error.message}\n`);
  } else {
    process.stderr.write("Git Gandalf Review\nUnable to read staged diff from STDIN.\n");
  }
  process.exit(1);
});
