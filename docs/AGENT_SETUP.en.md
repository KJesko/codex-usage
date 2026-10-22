# Agent-assisted setup

[Back to README](../README.en.md) · [简体中文](AGENT_SETUP.md) | English

Open the extracted project in Codex, Claude Code, Cursor, or another Agent with access to **your local terminal and files**, and paste the prompt below. It also works before downloading. An existing checkout takes priority; otherwise it requests the latest stable source release. Choose `main` only if you want a development version.

The prompt authorizes project dependency installation and local startup. You complete official account sign-in yourself. SSH and automatic startup are off by default; edit the preferences if needed. An Agent in WSL, a container or a remote machine must identify that environment before configuring anything.

```text
Configure and start the Codex Usage web app on my computer. Execute and verify the setup, rather than only giving instructions.
Repository: https://github.com/KJesko/codex-usage

Preferences:
- Version: use the current project if present; otherwise download the latest non-prerelease stable source package.
- Interface: English. Keep the existing reporting time zone, or ask my preferred zone on first installation.
- Logs: check CODEX_HOME, otherwise the current user's .codex directory.
- Quota: reuse existing local ChatGPT authentication; guide me if sign-in is needed.
- Remote SSH sources: none for now.
- Automatic startup/crash recovery: off until the foreground setup is verified.

1. Identify the actual OS, user and working directory. Distinguish Windows, WSL, containers and remote hosts. Read the selected version's README, docs/SETUP.en.md if present, requirements and launcher. Preserve existing code changes and settings. If missing, download this repository's stable source package into a permanent writable folder and verify the published checksum when available. Do not install an unrelated package with a similar name or use the demo as a real dashboard.
2. Verify Python 3.10+, venv and pip. Use a project-local .venv and requirements.txt. Follow run.ps1/run.bat on Windows; if only py works, use py -3 to create .venv and verify its Python version before running the launcher. On macOS/Linux use python3 -m venv .venv and .venv/bin/python for installation and startup. No desktop dependencies or Node.js are needed for the dashboard; separately installing Codex may have its own prerequisites. Explain any missing OS component or permission. Do not disable certificate validation or change global security policies.
3. Check port 8787. Reuse an existing instance only after /api/health identifies codex-usage and its installation is checked. If an unrelated app owns the port, leave it running and choose another port. Do not run two instances against the same app-data directory. Start codex_usage.py using the virtual environment and keep the service bound to 127.0.0.1.
4. Identify the Codex home directory, not a project directory or the sessions child folder. Inspect structure and readability without displaying conversation bodies. Use the selected version's settings UI or supported configuration to save sources and time zone; command-line overrides alone are not proof of persistence. Use directory validation if available. If several plausible sources exist, show paths and reasoning and let me choose. Do not scan the entire disk or modify source logs.
5. Check quota independently. Locate the native Codex executable and inspect login status using that version's supported command. A Windows codex.cmd wrapper is not suitable for CODEX_USAGE_CLI; find and verify the actual codex.exe from the app or CLI installation. If missing or app-server is unsupported, follow official installation/update guidance. Use the same OS user, CODEX_HOME and network environment as the dashboard. Do not repeat an already-working login. If sign-in is needed, explain that it updates the local Codex account, then use the version's browser sign-in UI or codex login and let me complete official authentication. Never read, copy or print auth.json, cookies, sessions, tokens or API keys. A quota failure must not block local log setup.
6. Report three separate acceptance results: A. Correct /api/health response and working webpage; B. Actual project/session tokens, or an explicit reason for no data; C. Successful quota response with a recent timestamp, or a specific unresolved connection issue. Health, authentication or stale cache is not proof of quota synchronization. If no usage logs exist, ask me to complete a local Codex session and allow roughly 30 seconds for scanning. Do not fabricate records or automatically send model requests to generate data.
7. Configure SSH or persistent startup only if requested in my preferences. SSH uses my supplied, trusted passwordless alias and aggregates logs only. Windows built-in supervision requires the source folder and .venv. Enable it from the running instance to preserve its port, app-data folder, sources and time zone; each data folder has an independent task. Save settings and verify that the supervisor actually takes over; a registered task alone is insufficient. macOS/Linux have no built-in persistent-service installer.
8. Finish with the installed path/version, start/stop/reopen instructions, browser URL, log and app-data directories, reporting time zone, separate token/quota checks, background status and remaining actions for me. Do not commit, push or publish code. If processes launched by your Agent are killed when the session ends, say so and provide a command I can run in my own terminal.
```

See [Troubleshooting](SETUP.en.md#troubleshooting) for errors and [Setup & configuration](SETUP.en.md) for detailed instructions.
