# Git Gandalf

Local LLM–powered pre-commit code reviewer. Your tech lead says: "You Shall Not Commit" (hopefully not too often 🧙).

## Setup (5 minutes)

### Requirements

- Node.js 18.0 or later
- Google Gemini API key ([get one free](https://aistudio.google.com/apikey))

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

4. Set your Gemini API key:
   ```bash
   export GEMINI_API_KEY="your-api-key-here"
   ```
   Or add to your shell profile (`.bashrc`, `.zshrc`, etc.)

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
2. Script sends diff + metadata to Google Gemini with review prompt
3. Gemini judges risk level: LOW, MEDIUM, or HIGH
4. Decision applied:
   - **LOW** → ✅ Commit proceeds
   - **MEDIUM** → ⚠️ Commit proceeds (warning shown)
   - **HIGH** → 🚫 Commit blocked

## Limitations

- **Requires API key**: GEMINI_API_KEY must be set
- **Cloud calls**: Diffs are sent to Google (not local)
- **No retries**: If API times out, commit is warned (not blocked)
- **No configuration**: Policy is hardcoded (LOW→ALLOW, MEDIUM→WARN, HIGH→BLOCK)
- **No prompts**: Prompt is fixed and versioned inline

## Environment Variables

- `GEMINI_API_KEY` — Required. Your Google Gemini API key

## Exit Codes

- `0` — Commit allowed (LOW or MEDIUM risk)
- `1` — Commit blocked (HIGH risk or internal error)
