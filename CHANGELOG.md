# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/).

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
