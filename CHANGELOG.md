# Changelog

## 1.2.0 — 2026-10-21

Stable **web/source** release. No new desktop executable and no PyPI publication.

### Added / 新增

- Simplified Chinese / English switching in the top bar, persisted per browser. English navigation, chart labels, forms, help and application status messages; raw project names and session content remain unchanged.
- English README, English synthetic demo, installation and upgrade guidance, and security reporting guidance.
- Official pricing synchronization for models with usage history every 24 hours. New missing prices trigger an early query; missing models also retain a manual fetch button.
- Persistent hidden projects in the treemap, individual restore controls and Restore all.

### Improved / 改进

- Only used models appear in Pricing & billing. Custom prices take precedence; failed fetches preserve previous rates. Unknown or unsupported prices are never treated as zero.
- All historical API-equivalent costs use the latest configured prices. These are reference estimates, not historical invoices.
- English month labels and accessible controls; fixed the sidebar update time under English locale.
- Added locale resources to packaging, bilingual demo checks and translation-coverage tests.
- Manual price polling no longer refreshes over an in-progress custom-price draft.

### Existing capabilities included / 本版包含

Interactive usage/model/quota charts; annual activity heatmap; project and session drill-down; CSV export; SSH multi-machine aggregation; locally persisted quota observations, reset classifications and collection gaps; Windows source-web startup and crash recovery controls.

### Upgrade / 升级

Stop the service (disable its Windows supervisor first), back up `~/.codex-usage`, replace the source and reinstall dependencies. Keep the user-data directory. Re-register Windows startup if the source path changed. See [中文安装说明](README.md#安装稳定版与升级) or [English upgrade instructions](README.en.md#upgrade-safely).

### Known limits / 已知边界

- Live quota depends on the installed Codex CLI, login and upstream availability. Sleep, shutdown and network outages leave observation gaps.
- Automatic startup controls require a Windows source installation, not the wheel-only installation.
- Official pricing documentation may change format. Failed or unsupported updates retain cached prices and show status; manual price overrides remain available.
- Reset causes and third-party forecasts are estimates. No reset operation is performed by this app.
- No telemetry or project-hosted log upload; local indexes and CSV files can still contain private metadata and require careful handling.

## [1.1.0] — 2026-10-21

Initial public source publication of the Codex Usage customization.

### Added
- Chinese Codex dashboard with daily, weekly, monthly, project, session and model reports.
- Local log indexing, deduplication, timezone-aware aggregation and API-equivalent cost estimates.
- SSH synchronization, quota history, reset observations, alerts and CSV export.
- Windows desktop build scripts and optional background startup and recovery.
- Python and JavaScript tests, cross-platform CI, installation and contribution documentation.

The entries below describe the original upstream project, not releases of this customization.

## Upstream [0.1.0] — 2026-07-02

Initial public release.

### Added
- Local, stdlib-only web dashboard over [`ccusage`](https://github.com/ryoppippi/ccusage).
- Summary cards: total cost, tokens, cache hit-rate, hits vs misses, project/session counts.
- **Live 5-hour block** card: cost-so-far → projected, burn rate ($/hr · tok/min),
  cache hit-rate, and an elapsed/remaining progress bar (polls every 20s, ticks every 1s).
- Charts: tokens/day (stacked), cost/day, cache hit-rate/day, cost by model.
- **Date-range filter**: All time / 7 / 30 / 90 days / custom (via `ccusage --since/--until`).
- **Projects → sessions tree**: real project paths (from each session's logged `cwd`),
  expandable to VS Code-tab-style session names (first prompt) + git branch.
- **Agent filter** (All / Claude / Codex), recomputed client-side — no refetch.
- Three install channels: pip/pipx CLI, npm/npx wrapper, and Claude Code plugin.
