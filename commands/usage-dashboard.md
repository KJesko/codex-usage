---
description: Launch the Claude Code usage dashboard (tokens, cost, cache hit-rate) in the browser
argument-hint: "[--port 8787] [--no-browser]"
---

Launch the local **Claude Code usage dashboard** for the user.

Do this:

1. Start the server **in the background** so it does not block the session. Run:

   `python "${CLAUDE_PLUGIN_ROOT}/src/claude_usage_dashboard/app.py" $ARGUMENTS`

   - If `python` is not found, try `py -3` (Windows) or `python3`.
   - `$ARGUMENTS` may contain flags like `--port 9000` or `--no-browser`.
     Default port is `8787`.

2. The dashboard reads the user's **local** `~/.claude/projects` logs and needs
   the `ccusage` CLI on PATH. If the server logs that `ccusage`/`npx` is missing,
   tell the user to run `npm install -g ccusage`, then retry.

3. Once the server prints `Ready.` (or after a few seconds), tell the user it is
   running at **http://127.0.0.1:8787** (or the port they chose).

Keep your reply short: do **not** print or summarize the source code — just
launch it and report the URL. Everything stays on the user's machine; nothing is
uploaded anywhere.
