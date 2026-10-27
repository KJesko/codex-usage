# Codex Usage

[简体中文](README.md) | English

[![Checks](https://github.com/KJesko/codex-usage/actions/workflows/ci.yml/badge.svg)](https://github.com/KJesko/codex-usage/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A local Codex usage dashboard with Simplified Chinese and English interfaces. Explore tokens and reference costs by project, session and model, track quota and resets, and aggregate multiple machines over SSH. Source logs are read-only and are not uploaded to a project-operated server.

**[Interactive demo](https://kjesko.github.io/codex-usage/en/)** (synthetic data only) · [Features & screenshots](docs/USER_GUIDE.en.md) · [Changelog](docs/CHANGELOG.md)

## Download

Install on the computer and OS user where you use Codex. Requires **Python 3.10+**; no Node.js, database server or frontend build is needed for normal use. Initial dependency installation requires internet access.

| Version | Download | Choose when |
| --- | --- | --- |
| **Stable web v1.3.0 (recommended)** | **[Download ZIP](https://github.com/KJesko/codex-usage/releases/download/v1.3.0/codex-usage-1.3.0-web-source.zip)** · [Release notes & checksums](https://github.com/KJesko/codex-usage/releases/tag/v1.3.0) | New installs and upgrades |
| Development source `main` | [Download ZIP](https://github.com/KJesko/codex-usage/archive/refs/heads/main.zip) | Development or trying upcoming changes |

v1.3.0 includes first-launch guidance, browser sign-in, folder selection and background operation with custom ports/data folders. This is a web-only release. For an existing installation, read [Upgrade & backup](docs/SETUP.en.md#upgrade--backup) first.

## Start

Extract the ZIP to a permanent folder containing `codex_usage.py`, `requirements.txt` and `src/`. Do not run inside the archive.

### Windows

Install Python, then double-click **`run.bat`** in the extracted folder. It prepares a virtual environment, installs dependencies and opens the browser.

### macOS / Linux

Open a terminal in the extracted project folder and run:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python codex_usage.py
```

Open the [local dashboard](http://127.0.0.1:8787). For startup problems, see [Troubleshooting](docs/SETUP.en.md#troubleshooting). To let an Agent configure it, [copy the setup prompt](docs/AGENT_SETUP.en.md).

## First use

1. **Connect token logs:** in **Data & settings**, enter your Codex home directory (normally `~/.codex`), save, then view projects and sessions. Log reporting does not require quota sign-in.
2. **Connect account quota (optional):** select **Browser sign-in** in the dashboard and complete the official authorization page using [Account connection](docs/SETUP.en.md#account-connection). Existing valid authentication does not require another sign-in. Confirm a recent successful quota timestamp.
3. **Keep collection running:** closing the page leaves the backend running; stopping the service, sleeping or shutting down interrupts collection. Windows users can enable sign-in startup and crash recovery using [Background operation](docs/SETUP.en.md#windows-background-operation).

## Documentation

| Guide | Contents |
| --- | --- |
| [Setup & configuration](docs/SETUP.en.md) | Log folders, account connection, SSH, custom ports, background services, upgrades and troubleshooting |
| [Agent-assisted setup](docs/AGENT_SETUP.en.md) | Copyable configuration prompt and acceptance checks |
| [User guide](docs/USER_GUIDE.en.md) | Features, screenshots, charts, exports, pricing, quota and privacy boundaries |
| [Development & maintenance](docs/DEVELOPMENT.en.md) | Tests, project structure, translations, demo deployment and desktop builds |

[Contributing](.github/CONTRIBUTING.md) · [Security & privacy](.github/SECURITY.md) · [Report an issue](https://github.com/KJesko/codex-usage/issues)

Independent community project, not affiliated with OpenAI. API-equivalent costs are estimates, not subscription bills. Licensed under [MIT](LICENSE).

## Project origins

This project originated from and was informed by [physcom/claude-usage-dashboard](https://github.com/physcom/claude-usage-dashboard) at `f3473a3`. Its local HTTP server, thread-safe cache and launcher structure were adapted as a starting point. Codex ingestion, analytics, pricing, quota tracking and the current interface were implemented separately. Unused Claude dashboard code, plugin files and old demo assets have been removed; the original copyright and license notices remain in [LICENSE](LICENSE).
