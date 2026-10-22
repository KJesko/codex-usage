# Setup & configuration

[Back to README](../README.en.md) · [简体中文](SETUP.md) | English

[Environment](#environment--installation) · [Logs](#connect-local-logs) · [Account](#account-connection) · [Options](#configuration--startup-options) · [SSH](#ssh-aggregation) · [Background operation](#windows-background-operation) · [Upgrades](#upgrade--backup) · [Troubleshooting](#troubleshooting)

These instructions cover the v1.3.0 stable web release. For the shortest startup steps, see the [README](../README.en.md#start); for a copyable prompt, see [Agent-assisted setup](AGENT_SETUP.en.md). Follow the bundled instructions when using an older release.

## Environment & installation

Run under the computer and OS user where you use Codex. Windows, WSL, containers and remote hosts have different homes, executables and authentication. Prefer running Codex and the dashboard in the same environment.

- Python 3.10+ (3.12 recommended on Windows). Initial dependency installation needs internet access; local log reporting works offline afterward.
- No Node.js, database server or desktop dependencies are needed for normal web use. Node.js is for development tests.
- Token reporting needs readable Codex logs. You can start without logs, but the app will not invent usage.
- Quota requires installed, authenticated local Codex and network access. A quota failure does not block log reporting.
- Recommended: [download the v1.3.0 web ZIP](https://github.com/KJesko/codex-usage/releases/download/v1.3.0/codex-usage-1.3.0-web-source.zip). The [release page](https://github.com/KJesko/codex-usage/releases/tag/v1.3.0) includes release notes, a wheel and checksums. ZIP downloads do not require Git.

If Codex is missing, see the [official installation guide](https://learn.chatgpt.com/docs/codex/cli) and [authentication guide](https://learn.chatgpt.com/docs/auth).

### Get the source with Git

```sh
git clone --branch v1.3.0 --depth 1 https://github.com/KJesko/codex-usage.git
cd codex-usage
```

This selects the stable release. Omit `--branch v1.3.0 --depth 1` to work on development `main`. Run from the extracted folder containing `codex_usage.py`, `requirements.txt` and `src/`, not from your `.codex` log directory.

### Windows

Double-click `run.bat`, or run in the project folder:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\run.ps1
```

The current launcher checks `python` and `py -3`, validates Python 3.10+, creates `.venv` and installs `requirements.txt`. Reopen your terminal after installing Python.

### macOS / Linux

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python codex_usage.py
```

### Python package alternative

From the repository root in an activated virtual environment:

```sh
python -m pip install .
codex-usage
```

Alternatively, install a wheel downloaded from the release:

```sh
python -m pip install ./codex_usage_local-1.3.0-py3-none-any.whl
codex-usage --no-browser
```

Open the [local dashboard](http://127.0.0.1:8787). Windows background controls require the source installation's `scripts/` and `.venv`. The project is not on PyPI, and the stable web release does not include a new desktop executable.

## Connect local logs

On first launch, the default URL opens **Data & settings** until settings are saved. Getting started separately checks recognizable log folders, usage in the current filters and the quota connector. Expand runtime details for the backend system, address and app-data directory. Existing settings and explicit routes are preserved.

1. Choose a folder or use the detected default. Select the Codex home, not a project folder or `sessions` child folder. If you choose a child folder, use the suggested parent action.
2. Select **Check directories (without saving)**. A recognized folder does **not** guarantee recorded token events.
3. Select your reporting time zone, optionally using the browser time zone. Choose **Save and get started**, or **Save & reload** for existing settings. Selecting and checking alone do not save; empty logs are allowed.
4. Open **Project analysis** or **Sessions**. If empty, complete a local Codex session, wait roughly 30 seconds for scanning, then check filters, usage start date and data coverage. Cloud-only or deleted history is not downloaded or reconstructed.

| System | Default Codex home example |
| --- | --- |
| Windows | `C:\Users\you\.codex` |
| macOS | `/Users/you/.codex` |
| Linux | `/home/you/.codex` |

`CODEX_HOME` takes priority when set. Multiple log directories are supported. Sources include `sessions`, `archived_sessions`, `session_index.jsonl` and readable log paths referenced by `state_*.sqlite`.

## Account connection

**Token logs and live quota are separate connections.** Changing log folders does not switch the quota account. Browser-only ChatGPT sign-in and API-key access are not equivalent to local Codex subscription authentication.

### Reuse local Codex authentication

Run `codex login status` under the same OS user, `CODEX_HOME` and network environment as the dashboard. If signed in, choose **Reconnect quota**. Otherwise run `codex login` and complete official ChatGPT sign-in yourself. Verify a successful quota status and recent timestamp; login success or stale cache alone is insufficient.

### Start official sign-in from the dashboard

Open **Data & settings → Getting started → Browser sign-in**, then **Open official sign-in page** when the link is ready. Complete the flow in a new tab on the same computer. The dashboard requests quota afterward. **This updates the local Codex account and may affect other Codex clients under the same OS user.**

No Session, Cookie or Token copying is required. The authorization URL is kept temporarily in memory; Codex handles credential storage and refresh. The flow expires after five minutes. Cancelling stops only the pending login, not the existing account session. On failure, check the Codex version, backend network/proxy and local callback-port conflicts.

### If the connector is not found

Set `CODEX_USAGE_CLI` to the absolute native Codex executable path: `codex.exe` on Windows, not a `.cmd` or `.bat` wrapper. Restart the backend; refreshing the page does not update the backend environment.

Custom `CODEX_HOME` must match between login and the backend. Enabling Windows supervision saves these two path overrides. If they change later, configure supervision again from the new environment. Other temporary environment variables, including proxies, are not copied automatically.

Quota is collected every 60 seconds by default. Failure does not prevent token reporting. The dashboard does not directly read or copy `auth.json` / OAuth tokens, request passwords or API keys, or perform purchases, conversations or quota resets. Email lookup is independent of quota collection.

## Configuration & startup options

Change sources, reporting time zone and usage start date in **Data & settings**, model prices in **Pricing & billing**, and quota alerts in **Quota & resets**. The default reporting time zone is `America/Los_Angeles`; choose another IANA zone as needed.

| Option | Purpose |
| --- | --- |
| `--port 8790` | Use another port; default `8787` |
| `--no-browser` | Start without opening a browser |
| `--codex-home PATH` | Log source; repeat to merge directories |
| `--data-dir PATH` | App configuration/cache directory; default `~/.codex-usage` |
| `--timezone Asia/Shanghai` | Reporting time zone |
| `--version` | Display version |

For example, merge two log directories on Windows:

```powershell
.\run.ps1 --timezone Asia/Shanghai --codex-home "$env:USERPROFILE\.codex" --codex-home "D:\codex-logs" --port 8790
```

The usage start date includes increments from midnight in the selected time zone. Clear it to restore all readable history without deleting logs. Top filters affect log charts, tables and CSV exports; quota has its own date range.

## SSH aggregation

In **Data & settings → Remote servers**, add an existing SSH alias such as `my-server`. The app uses the username, port, key and jump-host settings in `~/.ssh/config`.

Requirements: local OpenSSH, trusted host keys, passwordless login and remote Python 3. A blank remote path discovers remote `CODEX_HOME` or `~/.codex`. Default synchronization is every 120 seconds, configurable from 30 to 86400 seconds.

The collector runs in remote memory without installing a service. It returns usage events, session titles, project paths and required metadata, not conversation bodies or authentication files. Offline hosts retain their last successful snapshot. SSH does not connect remote live account quota.

You can also copy other machines' logs into separate local folders and merge them with `--codex-home`. Do not copy `auth.json`.

## Windows background operation

First run `run.ps1` to prepare the project environment. The preferred method is to enable **Data & settings → Web background service** in the running instance. This saves the current port, app-data directory, sources and time zone, including command-line overrides, plus `CODEX_HOME` and `CODEX_USAGE_CLI` paths. The full environment and proxy credentials are not copied; networking must work in the background user's environment.

Each data directory has an independent scheduled task and a `web-service/` profile/status folder. The default directory retains the legacy task name. Status distinguishes **Managed by supervisor**, **Waiting for the foreground server to exit** and **Port occupied by another service**. Close the foreground process only after enabling protection, then verify takeover and a recent successful collection. The supervisor does not kill unrelated port owners. Never run two instances against the same data directory.

For script use, save sources and time zone in the matching instance first. Register the default instance with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\enable-web-background.ps1
```

Register, inspect or disable a custom instance with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\enable-web-background.ps1 -Port 8790 -DataDir "D:\Codex Usage Data"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\enable-web-background.ps1 -DataDir "D:\Codex Usage Data" -Status
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\enable-web-background.ps1 -DataDir "D:\Codex Usage Data" -Disable
```

The task starts silently at sign-in and restarts an exited server. Keep the project directory and `.venv` available. To disable the default instance and stop its supervised server:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\enable-web-background.ps1 -Disable
```

Disabling in the web UI leaves the current server running but removes future recovery. Disabling never deletes history. Starting normally in the foreground does not install a task.

Closing the page does not stop collection. A foreground server can be stopped with `Ctrl+C`. Startup requires a signed-in Windows user; sleep, shutdown and signed-out sessions interrupt collection. macOS/Linux have no built-in service installer, so keep the process running. Missing quota observations are not reconstructed.

## Upgrade & backup

1. Disable Windows automatic protection, if enabled, using `scripts/enable-web-background.ps1 -Disable` from the old installation, and wait for the service to exit. Stop a manually launched server with Ctrl+C.
2. With the service stopped, back up the entire `~/.codex-usage` directory.
3. Extract v1.3.0 to a permanent folder. Recreate the virtual environment rather than copying `.venv`; install requirements and launch with your original options.
4. After starting the new version, re-enable protection from that running instance's settings page. Confirm `python codex_usage.py --version` reports `1.3.0`, then check usage, quota history and a recent successful sync.

For a custom app-data directory, pass its `-DataDir` when disabling and back up that directory instead. Re-enable with both the original `-DataDir` and `-Port`, or turn protection on from the web instance started with those options. Default commands control the default instance.

Do not delete the user-data directory. Version 1.3.0 retains existing settings, usage indexes and quota history. Browser theme and hidden-project preferences remain intact when using the same address. To roll back, stop the service and restore the previous source and pre-upgrade data backup. Never run two versions against the same data directory simultaneously.

Verify downloads against `SHA256SUMS.txt` with `Get-FileHash -Algorithm SHA256`, `sha256sum`, or `shasum -a 256`. Checksums detect transfer errors; they are not code signatures.

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| Unsure where commands go | Open PowerShell/Terminal in the extracted folder containing `codex_usage.py`; quote paths containing spaces. A ZIP download does not require Git |
| Windows `python` is missing or opens the Store | The launcher checks both `python` and `py -3` and requires Python 3.10+. If neither works, install a supported Python and reopen the terminal. Recreate an incompatible old `.venv` with a supported version |
| Linux cannot create venv or find pip | Install your distribution's matching Python venv/pip components. Do not install project dependencies into system Python using sudo |
| Dependency download times out or reports certificate errors | Check connectivity/proxy/certificates for the terminal running pip; do not disable verification. Offline installation needs prepared dependencies |
| Page cannot open or port is busy | Keep the startup terminal running and use the printed URL. Default: `http://127.0.0.1:8787`; use `--port 8790` if needed, without killing an unknown process |
| No tokens appear | Check the Codex home folder, actual usage events, date/source/model filters and statistics start date. Complete a local session and wait for scanning. Cloud-only history may have no local logs |
| Codex is in WSL but the dashboard is in Windows | Their homes, executables and authentication differ. Prefer running both in the same environment; reading another environment's logs does not connect its quota account |
| Browser sign-in works but quota does not | Verify local Codex ChatGPT authentication, native executable, backend network/proxy and a recent successful quota timestamp |
| Terminal Codex works but the dashboard cannot find it | On Windows a `.cmd` wrapper is insufficient. Point CODEX_USAGE_CLI at the native executable; restart the backend after changing its environment, not just the webpage |
| Automatic startup is enabled but collection stops | Check server/supervisor status and last successful collection. The supervisor may wait for a foreground server to exit before taking over. Sleep, shutdown and signed-out sessions interrupt collection. Verify the displayed address/data folder and distinguish waiting for takeover from a port conflict |

Setup is complete when the page works, sources and time zone are saved, actual usage or its absence is explained, quota success or failure is explicit, and you know what happens when you close the page, terminal or computer.
