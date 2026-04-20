"use strict";

const MAX_DIFF_BYTES = 1024 * 1024;

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

async function main() {
  const rawDiff = await readStdin();
  const normalizedDiff = normalizeLineEndings(rawDiff);

  if (normalizedDiff.length === 0) {
    process.stdout.write(
      "Git Gandalf Review\nNo staged changes detected. Skipping analysis.\n"
    );
    process.exit(0);
  }

  process.stdout.write("Git Gandalf Review\n(no analysis yet)\n");
  process.exit(0);
}

main().catch((error) => {
  if (error && typeof error.message === "string") {
    process.stderr.write(`Git Gandalf Review\n${error.message}\n`);
  } else {
    process.stderr.write("Git Gandalf Review\nUnable to read staged diff from STDIN.\n");
  }
  process.exit(1);
});
