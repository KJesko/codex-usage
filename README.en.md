# Codex Usage

**The current `main` improvements are not included in the v1.2.0 archive.** First-launch checks, browser sign-in, folder selection and background tasks with custom ports/data directories require the [current source](https://github.com/KJesko/codex-usage/archive/refs/heads/main.zip) or `git clone`. The stable archive is unchanged; the online demo follows `main`.

[简体中文](README.md) | English

[![Checks](https://github.com/KJesko/codex-usage/actions/workflows/ci.yml/badge.svg)](https://github.com/KJesko/codex-usage/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**A local-first Codex usage dashboard with first-class Simplified Chinese support, an English interface, and multi-machine aggregation over SSH.** Explore token usage by project, session, model and date, estimate API-equivalent costs, and track observed account quota and reset events.

Independent community project; not affiliated with or endorsed by OpenAI. API-equivalent costs are estimates, **not subscription bills or actual charges**. Observed token usage is not a conversion of your subscription quota.

**[Stable web release v1.2.0](https://github.com/KJesko/codex-usage/releases/tag/v1.2.0)** · [English interactive demo](https://kjesko.github.io/codex-usage/en/) · [Changelog](CHANGELOG.md) · [Security & privacy](SECURITY.md)

**New here?** [Choose an installation](#choose-an-installation) · [Agent setup](#let-an-agent-configure-and-start-it-optional) · [First-run checks](#first-run-connect-logs-and-quota-separately) · [Troubleshooting](#installation-and-connection-troubleshooting)

## Why this project?

- **Chinese users are first-class users.** A complete Simplified Chinese interface, English switching, configurable reporting time zones, and UTF-8 CSV exports suitable for Excel. Language is remembered in the browser and does not change the reporting time zone.
- **Private by default.** The service binds only to `127.0.0.1`. Usage logs stay on your machines; there is no project-operated upload service, analytics SDK, or CDN dependency. Existing Codex authentication is handled by Codex itself.
- **One view across machines.** Combine local Codex directories and remote SSH sources. Incremental synchronization keeps the last successful snapshot when a server is offline. Remote conversation bodies and authentication files are not downloaded.
- **Explainable estimates.** Input, cached reads, cache writes and output are accounted for separately. Reasoning tokens are included in output, not counted twice. Unknown prices remain explicitly unpriced.

## Features

| Area | Included |
| --- | --- |
| Overview | Usage totals, annual activity heatmap, daily/weekly/monthly trends, period comparison |
| Projects | Treemap, daily drill-down, cache savings, right-click hiding with persistent restore controls |
| Models and sessions | Model comparison, search, sorting, pagination, filtered CSV exports |
| Quota | Local observation history, interactive zoom/pan, collection-gap references, reset markers and alerts |
| Pricing | Only used models are listed; official prices refresh every 24 hours, with early queries for new missing prices and manual fetching |
| Background operation | Windows source installation supports sign-in startup, crash recovery and status controls |
| Interface | Chinese/English, light/dark themes, keyboard controls and responsive charts |

The online demo uses **synthetic data only**: fictional projects, machines, sessions and quota histories. It does not read visitor files, connect to Codex accounts or SSH, or run background services. Demo settings reset on reload. The English demo is also suitable for reviewers who do not read Chinese.

## Choose an installation

Start on the **computer and OS user where you actually use Codex**. No cloud deployment, database server or frontend build is required.

| Goal | Recommended route | Requirements |
| --- | --- | --- |
| Explore the interface | Online demo | No installation; synthetic data only |
| Stable daily use | Release `web-source.zip` | Python 3.10+; extract to a permanent directory; Git is optional |
| Latest UI improvements described here | Current `main` source, via Git or Code → Download ZIP | Development code, not the released stable package; preserve existing changes and data |
| Assisted installation | Copy the Agent prompt below | An Agent with access to your local files and terminal, not only a remote sandbox |

This README describes the current source. For older releases, follow the README and changelog bundled with that release. Open a terminal in the extracted folder containing `codex_usage.py`, `requirements.txt` and `src/`. Do not run inside the ZIP, or confuse the installation folder with your `.codex` log folder.

**Token reporting does not require quota sign-in.** Existing readable local logs are sufficient. You can start an empty dashboard without logs, but it will not create usage records. Live quota is a separate connection. If Codex is missing, use the [official CLI installation guide](https://learn.chatgpt.com/docs/codex/cli); the [authentication guide](https://learn.chatgpt.com/docs/auth) explains ChatGPT subscription sign-in versus API-key access.

## Let an Agent configure and start it (optional)

Open the extracted project in Codex, Claude Code, Cursor, or another Agent with access to **your local terminal and files**, and paste the prompt below. It also works before downloading. An existing checkout takes priority; otherwise it requests the latest stable source release. Change the version preference to `main` for the current improvements.

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

1. Identify the actual OS, user and working directory. Distinguish Windows, WSL, containers and remote hosts. Read the selected version's README, requirements and launcher. Preserve existing code changes and settings. If missing, download this repository's stable source package into a permanent writable folder and verify the published checksum when available. Do not install an unrelated package with a similar name or use the demo as a real dashboard.
2. Verify Python 3.10+, venv and pip. Use a project-local .venv and requirements.txt. Follow run.ps1/run.bat on Windows; if only py works, use py -3 to create .venv and verify its Python version before running the launcher. On macOS/Linux use python3 -m venv .venv and .venv/bin/python for installation and startup. No desktop dependencies or Node.js are needed for the dashboard; separately installing Codex may have its own prerequisites. Explain any missing OS component or permission. Do not disable certificate validation or change global security policies.
3. Check port 8787. Reuse an existing instance only after /api/health identifies codex-usage and its installation is checked. If an unrelated app owns the port, leave it running and choose another port. Do not run two instances against the same app-data directory. Start codex_usage.py using the virtual environment and keep the service bound to 127.0.0.1.
4. Identify the Codex home directory, not a project directory or the sessions child folder. Inspect structure and readability without displaying conversation bodies. Use the selected version's settings UI or supported configuration to save sources and time zone; command-line overrides alone are not proof of persistence. Use directory validation if available. If several plausible sources exist, show paths and reasoning and let me choose. Do not scan the entire disk or modify source logs.
5. Check quota independently. Locate the native Codex executable and inspect login status using that version's supported command. A Windows codex.cmd wrapper is not suitable for CODEX_USAGE_CLI; find and verify the actual codex.exe from the app or CLI installation. If missing or app-server is unsupported, follow official installation/update guidance. Use the same OS user, CODEX_HOME and network environment as the dashboard. Do not repeat an already-working login. If sign-in is needed, explain that it updates the local Codex account, then use the version's browser sign-in UI or codex login and let me complete official authentication. Never read, copy or print auth.json, cookies, sessions, tokens or API keys. A quota failure must not block local log setup.
6. Report three separate acceptance results: A. Correct /api/health response and working webpage; B. Actual project/session tokens, or an explicit reason for no data; C. Successful quota response with a recent timestamp, or a specific unresolved connection issue. Health, authentication or stale cache is not proof of quota synchronization. If no usage logs exist, ask me to complete a local Codex session and allow roughly 30 seconds for scanning. Do not fabricate records or automatically send model requests to generate data.
7. Configure SSH or persistent startup only if requested in my preferences. SSH uses my supplied, trusted passwordless alias and aggregates logs only. Windows built-in supervision requires the source folder and .venv. Enable it from the running instance to preserve its port, app-data folder, sources and time zone; each data folder has an independent task. Save settings and verify that the supervisor actually takes over; a registered task alone is insufficient. macOS/Linux have no built-in persistent-service installer.
8. Finish with the installed path/version, start/stop/reopen instructions, browser URL, log and app-data directories, reporting time zone, separate token/quota checks, background status and remaining actions for me. Do not commit, push or publish code. If processes launched by your Agent are killed when the session ends, say so and provide a command I can run in my own terminal.
```

### Installation and connection troubleshooting

| Symptom | Next step |
| --- | --- |
| Unsure where commands go | Open PowerShell/Terminal in the extracted folder containing `codex_usage.py`; quote paths containing spaces. A ZIP download does not require Git |
| Windows `python` is missing or opens the Store | Check `python --version`. If only `py` works, run `py -3 -m venv .venv`, verify `.\.venv\Scripts\python.exe --version` is 3.10+, then use `run.bat`; otherwise install a supported Python |
| Linux cannot create venv or find pip | Install your distribution's matching Python venv/pip components. Do not install project dependencies into system Python using sudo |
| Dependency download times out or reports certificate errors | Check connectivity/proxy/certificates for the terminal running pip; do not disable verification. Offline installation needs prepared dependencies |
| Page cannot open or port is busy | Keep the startup terminal running and use the printed URL. Default: `http://127.0.0.1:8787`; use `--port 8790` if needed, without killing an unknown process |
| No tokens appear | Check the Codex home folder, actual usage events, date/source/model filters and statistics start date. Complete a local session and wait for scanning. Cloud-only history may have no local logs |
| Codex is in WSL but the dashboard is in Windows | Their homes, executables and authentication differ. Prefer running both in the same environment; reading another environment's logs does not connect its quota account |
| Browser sign-in works but quota does not | Verify local Codex ChatGPT authentication, native executable, backend network/proxy and a recent successful quota timestamp |
| Terminal Codex works but the dashboard cannot find it | On Windows a `.cmd` wrapper is insufficient. Point CODEX_USAGE_CLI at the native executable; restart the backend after changing its environment, not just the webpage |
| Automatic startup is enabled but collection stops | Check server/supervisor status and last successful collection. The supervisor may wait for a foreground server to exit before taking over. Sleep, shutdown and signed-out sessions interrupt collection. Verify the displayed address/data folder and distinguish waiting for takeover from a port conflict |

Setup is complete when the page works, sources and time zone are saved, actual usage or its absence is explained, quota success or failure is explicit, and you know what happens when you close the page, terminal or computer.

## Install the stable web version

Requirements: **Python 3.10+** (3.12 recommended on Windows), readable Codex logs, and a modern browser. Node.js is needed for development tests, not normal use. Initial dependency installation needs network access; local log statistics work offline afterward. Live quota additionally requires an installed, signed-in Codex CLI and network access. Missing quota access does not prevent local usage reporting.

### Windows — recommended source package

1. Download `codex-usage-1.2.0-web-source.zip` from the [release page](https://github.com/KJesko/codex-usage/releases/tag/v1.2.0).
2. Extract it to a permanent folder and install Python if needed.
3. Double-click `run.bat`, or run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\run.ps1
```

The Windows launcher tries both `python` and `py -3`, validates Python 3.10+, creates `.venv`, installs the time-zone dependency and opens `http://127.0.0.1:8787`. Select **English** in the top bar. Choose **Data & settings** to configure sources and, optionally, automatic startup and crash recovery. Automatic collection requires a signed-in Windows session; shutdown and sleep interrupt collection. Enabling supervision from the running instance saves its current port, app-data directory, log sources and time zone, including command-line source/time-zone overrides. Each app-data directory has its own task and `web-service/launch.json`. Only CODEX_HOME and CODEX_USAGE_CLI path overrides are saved; proxy credentials and the full environment are not copied. Status distinguishes an owned server, waiting for the foreground server to exit, and an unrelated port conflict. For script use, pass `-Port 8790 -DataDir "D:\Codex Usage Data"`; also pass `-DataDir` when checking with `-Status` or disabling with `-Disable`. Save sources/time zone in the UI before registering directly from the script.

### macOS / Linux

Extract the source package, then run in its directory:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python codex_usage.py
```

Keep the process running to collect quota. This release does not include a macOS launch agent or Linux service installer.

### Python package alternative

Download the wheel from the release and install it in an activated virtual environment:

```sh
python -m pip install ./codex_usage_local-1.2.0-py3-none-any.whl
codex-usage --no-browser
```

Open `http://127.0.0.1:8787`. **Use the source package for Windows background-task controls**, which rely on the repository's `scripts/` directory. This release is not uploaded to PyPI and does not ship a new desktop executable. The existing Windows desktop build instructions remain available in the [Chinese README](README.md).

## First run: connect logs and quota separately

The default URL opens **Data & settings** on first launch until settings are saved. Existing installations and explicit routes are preserved. Getting started shows separate checks for recognizable log folders, usage in the current filters and the quota connector. Expand runtime details to confirm the actual backend environment, URL and app-data folder.

Use the detected default folder or browser time zone with one click. A mistaken `sessions` subfolder has a parent-folder action. Choose **Save and get started** to persist changes; checking a folder alone does not save it. Empty logs and optional quota sign-in do not block saving.

The dashboard has two independent data sources:

1. **Project and session tokens:** choose **Check log directory**. Enter the Codex home directory, normally `CODEX_HOME` or `~/.codex` (for example, `C:\Users\you\.codex` on Windows). Do not enter your project source directory or the `sessions` subdirectory.
2. Choose **Check directories (without saving)**. Each path is checked for existence, access and recognizable Codex structure. A selected `sessions` child directory produces a parent-path hint. A recognized directory does **not** guarantee recorded token events. Then choose **Save and reload**.
3. Visit **Project analysis** or **Sessions**. If empty, complete a local Codex session and check date/machine/model filters, the statistics start date and data coverage. Logs refresh every 30 seconds by default. Cloud-only or deleted history is not downloaded or reconstructed.
4. **Account quota:** under the same OS user and Codex environment as the dashboard, run `codex login status`. If signed out, run `codex login` and sign in with ChatGPT. Return to Getting started and choose **Reconnect quota**. Confirm a successful status and recent timestamp. Browser-only ChatGPT sign-in and API-key authentication are not equivalent to a local subscription session.
5. If Codex is not found, set `CODEX_USAGE_CLI` to the absolute native executable path (`codex.exe` on Windows, not a `.cmd` or `.bat` wrapper), then restart the backend. If using a custom `CODEX_HOME`, use the same environment for login and the backend. A background startup task does not automatically inherit temporary environment variables from another terminal.

Quota refreshes every 60 seconds by default. Connection guidance distinguishes expired login, timeouts and unsupported versions. Check the backend network/proxy when requests time out. **Quota failure does not prevent local token reporting; changing log directories does not switch the quota account.** The dashboard never asks for a password or API key and starts official sign-in only after an explicit click and never performs quota resets.

For another machine, choose **Manage servers** to jump to SSH configuration. First verify key-based SSH access, trusted host keys and remote Python 3. Add the existing SSH alias and check its sync status. A blank remote path enables discovery; the default sync interval is 120 seconds. SSH aggregates logs, not remote live account quota. Optional Windows background controls are placed below data configuration; enable them after confirming logs and quota work.

### Folder selection and custom avatar

In Data & settings, use **Choose folder** to browse local folders and drives, or enter a full path. The example path remains visible. Selecting a folder only adds it to the draft; **Save and reload** applies the change. Multiple data folders are supported.

The account label shows a masked email address. The avatar uses custom text only: enter one to three English letters, digits, or Chinese characters in Data & Settings and save. Email metadata is fetched independently every five minutes and refreshed after browser login, so a failed lookup never blocks quota collection. Credentials remain with Codex.

## Optional browser sign-in from the dashboard

The existing method remains available: reuse local Codex authentication, or run `codex login` and choose **Reconnect quota**.

Alternatively, open **Data & settings → Getting started → Browser sign-in**, wait for the link, then choose **Open official sign-in page**. Complete OpenAI sign-in in the new tab; the dashboard automatically requests quota afterward. **This updates the local Codex login account and may affect other Codex clients under the same OS user.** Authentication success does not guarantee a successful quota response; check the separate quota status and timestamp.

No Session, Cookie or Token copying is required. The authorization URL is held temporarily in memory; Codex handles credential storage and refresh. The flow expires after five minutes and can be cancelled without logging out the existing account. On failure, check the Codex version, backend network/proxy and local callback-port conflicts. Complete this browser flow on the same machine as the dashboard.

## Upgrade safely

1. Disable Windows automatic protection, if enabled, using `scripts/enable-web-background.ps1 -Disable`, and wait for the service to exit. Stop a manually launched server with Ctrl+C.
2. With the service stopped, back up the entire `~/.codex-usage` directory.
3. Replace the source with the new release, or extract to a new permanent folder. Recreate the virtual environment rather than copying `.venv`; install requirements and launch again.
4. If you moved the source directory, run `run.ps1` there first, then `scripts/enable-web-background.ps1` to register its new location.

For a custom app-data directory, pass its `-DataDir` when disabling and back up that directory instead. Re-enable with both the original `-DataDir` and `-Port`, or turn protection on from the web instance started with those options. Default commands control the default instance.

Do not delete the user-data directory. Version 1.2.0 retains existing settings, usage indexes and quota history. Browser theme and hidden-project preferences remain intact. To roll back, stop the service and restore the previous source and pre-upgrade data backup. Never run two versions against the same data directory simultaneously.

Verify downloads against `SHA256SUMS.txt` with `Get-FileHash -Algorithm SHA256`, `sha256sum`, or `shasum -a 256`. Checksums detect transfer errors; they are not code signatures.

## Data boundaries and network activity

Default logs: `~/.codex`. App data: `~/.codex-usage`, including settings, usage indexes, remote snapshots, quota history and a public-price cache. Indexes can contain **session titles, project paths and account groups**; titles may derive from a first user message. Do not publish real logs, database files, exports or unredacted screenshots.

Network access is limited to the features used:

- Dependency installation via Python's package infrastructure.
- Codex's own authenticated service for live quota; the dashboard does not read or store `auth.json` or OAuth tokens.
- Configured SSH hosts for remote aggregation. Use your existing verified-host, passwordless SSH setup; remote Python 3 is required.
- OpenAI's public pricing documentation for used-model price updates. The request contains no logs, account credentials or usage records.
- Public reset updates from [Codex Resets](https://codex-resets.com) when that panel is used, checked at most once every five minutes. The panel shows announced schedules, expected times, regular resets or banked-credit grants, the latest public record, historical statistics, and links to original posts and full history. It no longer displays forecast probabilities.
- A schedule whose expected time has passed stays **Awaiting confirmation** until the source confirms execution. Failed updates retain clearly labeled cached data. Public announcements and average intervals do not confirm a reset on your account or predict the next reset; account events still come from local quota monitoring.

There is no guarantee of reconstructing missing quota history. Resets outside the normal cycle are classified as official by default; a simultaneous reduction in reset cards is classified as a reset-card reset. These causes are **inferences**, not official receipts. All historical API-equivalent costs are recalculated at the latest configured prices; custom prices take precedence.

## Development

Python standard library plus `tzdata`; vanilla HTML/CSS/JavaScript, with no frontend build required for local operation. Use Node.js 20+ for tests.

```sh
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
npm run check
npm test
npm run test:demo
```

English UI resources live in `src/codex_usage/locales/en.json`. The translation coverage test catches missing frontend phrases and checks generated English JavaScript syntax. Translation does not rewrite user titles, paths or model identifiers. The demo builder publishes only allowlisted assets and synthetic data.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contributions. Remove private data from all reports. Report security concerns as described in [SECURITY.md](SECURITY.md).

## License and attribution

MIT. Adapted from [physcom/claude-usage-dashboard](https://github.com/physcom/claude-usage-dashboard), retaining upstream history and notices. Codex parsing, quota tracking, multi-machine aggregation and bilingual UI are project customizations. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Retained upstream directories are not the Codex dashboard's runtime entry point.
