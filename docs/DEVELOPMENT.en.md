# Development & maintenance

[Back to README](../README.en.md) · [简体中文](DEVELOPMENT.md) | English

[Tests](#development--tests) · [Demo](#demo-maintenance) · [Translation](#translation) · [Desktop](#windows-desktop-builds) · [Documentation](#documentation--packaging) · [License](#attribution--license)

Users should start with the [README](../README.en.md). See [Setup & configuration](SETUP.en.md) for launch and background settings, [CONTRIBUTING](../.github/CONTRIBUTING.md) for contribution rules and [SECURITY](../.github/SECURITY.md) for security reports.

## Development & tests

The backend uses Python's standard library plus `tzdata`; the frontend is vanilla HTML/CSS/JavaScript with no npm dependency installation or build needed for local operation. Use Node.js 20+ for frontend tests.

Create a virtual environment following [Setup](SETUP.en.md#environment--installation). With it activated and requirements installed, run:

```sh
python -m unittest discover -s tests -v
npm run check
npm test
npm run test:demo
git diff --check
```

GitHub Actions tests Windows and Ubuntu with Python 3.10 and 3.12. Tests use synthetic data for parsing, deduplication, time zones, pricing, SSH, quota history, server boundaries and frontend interactions. Check narrow windows, both themes and keyboard navigation in a real browser for UI changes.

```text
src/codex_usage/
  reader.py                 Log discovery, parsing, deduplication and indexes
  analytics.py / insights.py Aggregation, comparisons and growth attribution
  pricing.py / prices.json   Reference costs and bundled prices
  account.py / quota_*.py    Quota history, resets and alerts
  remote.py                 SSH aggregation
  app.py / desktop.py       HTTP service and desktop entry point
  static/                   Bilingual frontend
tests/                      Python and JavaScript tests
scripts/                    Demo/desktop assets and Windows supervision
packaging/                  Desktop entry point, dependencies and Windows builds
docs/                       Guides, changelog and release verification
.github/                    Workflows, contribution guide and security policy
```

## Demo maintenance

```sh
python scripts/build-demo.py
node --test tests/test_demo.cjs
python -m http.server 8791 --bind 127.0.0.1 --directory dist
```

Open the [local demo](http://127.0.0.1:8791/demo/). The builder copies only allowlisted frontend assets and prices; it neither starts the application nor reads personal logs/configuration. Fixtures and the browser bridge live in `demo/`; generated `dist/demo/` is not committed.

`npm run test:demo` validates 72 filter combinations and four CSV types, event totals, day/week/month buckets, session search/sort, unpriced/custom pricing, time zones, daylight saving, future dates and reset events. `npm test` covers shared charts and navigation.

Pushes to `main` run the [Pages workflow](../.github/workflows/pages.yml), which builds, checks and deploys the synthetic bilingual demo. Fork owners should select GitHub Actions under Settings → Pages and update project links in the docs and demo.

## Translation

English UI resources live in `src/codex_usage/locales/en.json`. `web_i18n.py` generates English versions of trusted assets and translates application-owned API messages. Add English entries with new Chinese UI text. Coverage tests check missing phrases and generated JavaScript syntax. Do not translate user titles, paths or model identifiers.

## Windows desktop builds

This is a separate build path; the v1.3.0 web release does not ship a new desktop executable. On Windows x64 with Python 3.12:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\packaging\build-windows.ps1
```

The script installs pinned desktop dependencies, runs Python tests, generates icons/notices, packages with PyInstaller, performs a build self-check and writes SHA256 checksums. Output is `dist/CodexUsage.exe` with notices in `dist/`.

The desktop uses pywebview and [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/), targeting Windows 10/11 x64. Built executables do not need Python or Node.js and share the default app-data directory with the web app. The build script does not configure code signing.

To run a desktop window during development:

```powershell
.\.venv\Scripts\python.exe -m pip install -r packaging/requirements-desktop.txt
.\.venv\Scripts\python.exe packaging/codex_usage_desktop.py
```

## Documentation & packaging

Keep the README focused on introduction, download, startup and documentation links. Put installation/account/background details in `docs/SETUP.en.md`, Agent prompts in `docs/AGENT_SETUP.en.md`, feature/accounting/privacy details in `docs/USER_GUIDE.en.md`, and developer material here. Maintain matching Chinese files and resolve links/images relative to the containing document.

The source-distribution include list in `pyproject.toml` must carry `docs/`, contribution/security guides in `.github/`, and referenced assets for offline reading. The demo ships only allowlisted frontend assets and synthetic data. This release's validation is recorded in [RELEASE_CHECKLIST](RELEASE_CHECKLIST.md).

## Attribution & license

Project origins are documented in the [README](../README.en.md#project-origins). The current application lives under `src/codex_usage`; legacy dashboard and plugin entry points are no longer included. See the [MIT license](../LICENSE) and [price-reference notes](../NOTICE).
