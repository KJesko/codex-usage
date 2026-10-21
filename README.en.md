# Codex Usage

[简体中文](README.md) | English

[![Checks](https://github.com/KJesko/codex-usage/actions/workflows/ci.yml/badge.svg)](https://github.com/KJesko/codex-usage/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**A local-first Codex usage dashboard with first-class Simplified Chinese support, an English interface, and multi-machine aggregation over SSH.** Explore token usage by project, session, model and date, estimate API-equivalent costs, and track observed account quota and reset events.

Independent community project; not affiliated with or endorsed by OpenAI. API-equivalent costs are estimates, **not subscription bills or actual charges**. Observed token usage is not a conversion of your subscription quota.

**[Stable web release v1.2.0](https://github.com/KJesko/codex-usage/releases/tag/v1.2.0)** · [English interactive demo](https://kjesko.github.io/codex-usage/en/) · [Changelog](CHANGELOG.md) · [Security & privacy](SECURITY.md)

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

## Install the stable web version

Requirements: **Python 3.10+** (3.12 recommended on Windows), readable Codex logs, and a modern browser. Node.js is needed for development tests, not normal use. Initial dependency installation needs network access; local log statistics work offline afterward. Live quota additionally requires an installed, signed-in Codex CLI and network access. Missing quota access does not prevent local usage reporting.

### Windows — recommended source package

1. Download `codex-usage-1.2.0-web-source.zip` from the [release page](https://github.com/KJesko/codex-usage/releases/tag/v1.2.0).
2. Extract it to a permanent folder and install Python if needed.
3. Double-click `run.bat`, or run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\run.ps1
```

The launcher creates `.venv`, installs the time-zone dependency and opens `http://127.0.0.1:8787`. Select **English** in the top bar. Choose **Data & settings** to configure sources and, optionally, automatic startup and crash recovery. Automatic collection requires a signed-in Windows session; shutdown and sleep interrupt collection.

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

## Upgrade safely

1. Disable Windows automatic protection, if enabled, using `scripts/enable-web-background.ps1 -Disable`, and wait for the service to exit. Stop a manually launched server with Ctrl+C.
2. With the service stopped, back up the entire `~/.codex-usage` directory.
3. Replace the source with the new release, or extract to a new permanent folder. Recreate the virtual environment rather than copying `.venv`; install requirements and launch again.
4. If you moved the source directory, run `run.ps1` there first, then `scripts/enable-web-background.ps1` to register its new location.

Do not delete the user-data directory. Version 1.2.0 retains existing settings, usage indexes and quota history. Browser theme and hidden-project preferences remain intact. To roll back, stop the service and restore the previous source and pre-upgrade data backup. Never run two versions against the same data directory simultaneously.

Verify downloads against `SHA256SUMS.txt` with `Get-FileHash -Algorithm SHA256`, `sha256sum`, or `shasum -a 256`. Checksums detect transfer errors; they are not code signatures.

## Data boundaries and network activity

Default logs: `~/.codex`. App data: `~/.codex-usage`, including settings, usage indexes, remote snapshots, quota history and a public-price cache. Indexes can contain **session titles, project paths and account groups**; titles may derive from a first user message. Do not publish real logs, database files, exports or unredacted screenshots.

Network access is limited to the features used:

- Dependency installation via Python's package infrastructure.
- Codex's own authenticated service for live quota; the dashboard does not read or store `auth.json` or OAuth tokens.
- Configured SSH hosts for remote aggregation. Use your existing verified-host, passwordless SSH setup; remote Python 3 is required.
- OpenAI's public pricing documentation for used-model price updates. The request contains no logs, account credentials or usage records.
- Codex Resets public forecast data when that panel is used. Forecasts are third-party estimates, not confirmed account events or guarantees.

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
