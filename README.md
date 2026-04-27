# Git Gandalf

Local LLM–powered pre-commit code reviewer. Your tech lead says: "You Shall Not Commit" (hopefully not too often 🧙).

## Setup (5 minutes)

### Requirements

- Node.js 18.0 or later
- A local LLM running on localhost:1234 (default)
  - [LM Studio](https://lmstudio.ai/) (recommended)
  - Or any OpenAI-compatible API

### Installation

1. Clone or download this repository
2. Create the pre-commit hook:
   ```bash
   mkdir -p .git/hooks
   cat > .git/hooks/pre-commit << 'EOF'
   #!/bin/sh
   DIFF=$(git diff --cached)
   if [ -z "$DIFF" ]; then
       exit 0
   fi
   echo "$DIFF" | node gitgandalf.js
   exit $?
   EOF
   ```

3. Make it executable:
   ```bash
   chmod +x .git/hooks/pre-commit
   ```

4. Start your local LLM on localhost:1234 (or set `GANDALF_LLM_URL` environment variable)

## Usage

Just commit normally. The hook runs automatically:

```bash
git add .
git commit -m "your message"
```

### Bypass the hook

If needed, skip Git Gandalf for a commit:

```bash
git commit --no-verify -m "bypass gandalf"
```

## How it works

1. Hook extracts staged diff and pipes to `gitgandalf.js`
2. Script sends diff + metadata to local LLM with review prompt
3. LLM judges risk level: LOW, MEDIUM, or HIGH
4. Decision applied:
   - **LOW** → ✅ Commit proceeds
   - **MEDIUM** → ⚠️ Commit proceeds (warning shown)
   - **HIGH** → 🚫 Commit blocked

## Limitations

- **Local only**: Requires LLM running locally (no cloud calls)
- **No retries**: If LLM times out, commit is warned (not blocked)
- **No configuration**: Policy is hardcoded (LOW→ALLOW, MEDIUM→WARN, HIGH→BLOCK)
- **No prompts**: Prompt is fixed and versioned inline

## Environment Variables

- `GANDALF_LLM_URL` — OpenAI-compatible API endpoint (default: `http://localhost:1234/v1/chat/completions`)

## Exit Codes

- `0` — Commit allowed (LOW or MEDIUM risk)
- `1` — Commit blocked (HIGH risk or internal error)
