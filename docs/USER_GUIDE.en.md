# User guide

[Back to README](../README.en.md) · [简体中文](USER_GUIDE.md) | English

[Features](#features) · [Demo](#demo--screenshots) · [Charts & exports](#charts--exports) · [Pricing](#pricing) · [Quota](#quota--resets) · [Accounting](#accounting--limits) · [Preferences](#interface-preferences) · [Privacy](#data--privacy)

For installation and account connection, see [Setup & configuration](SETUP.en.md). This guide covers features, accounting and data boundaries.

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

## Demo & screenshots

The [English interactive demo](https://kjesko.github.io/codex-usage/en/) reuses the app frontend with **synthetic data only**: 12 months, six fictional projects and three simulated machines. It does not read visitor files, connect to Codex accounts or SSH, or run background tasks. Settings apply only to the current page and reset on reload or **Reset demo**; the theme is remembered. CSV files are marked as demo data.

Suggested tour: [Overview](https://kjesko.github.io/codex-usage/en/) → [Detailed analysis](https://kjesko.github.io/codex-usage/en/?view=overview&tab=analysis&range=30) → [Projects](https://kjesko.github.io/codex-usage/en/?view=projects&range=all) → [Quota](https://kjesko.github.io/codex-usage/en/?view=quota).

The same synthetic records drive totals, heatmaps, projects, models, sessions and exports. Fixtures include sparse weekdays, weekends, holidays, different model mixes and high cache reuse. Quota is simulated separately with full seven-day cycles, idle time, collection gaps, early official resets and reset-card events; token totals do not determine quota percentages. A normal reset does not require prior usage to reach 100%.

The screenshots below show the Chinese interface with simulated data; the live demo also supports English.

![Usage overview, synthetic data](screenshots/demo-overview.png)

<details>
<summary>Projects, model comparison and quota screenshots</summary>

![Project treemap and cache savings, synthetic data](screenshots/demo-projects.png)

![Daily model comparison, synthetic data](screenshots/demo-models.png)

![Quota curves and reset records, synthetic data](screenshots/demo-quota.png)

</details>

## Charts & exports

Overview includes an annual activity heatmap; detailed analysis contains trends, comparisons and growth attribution. Projects support a treemap and daily/session drill-down. Model charts compare tokens or reference costs, with cache savings and explicit unpriced usage. Time charts support zoom and pan.

CSV follows date, machine, project, model and account filters. Session exports also include every matching search page and the current sort order. Exports include token/cost breakdowns, cache savings, session identifiers and reporting time zone. Unpriced `cost` is blank; `known_cost` is only the priced subtotal. Calculations retain precision while the interface rounds displayed amounts. Model-chart checkboxes and zoom change only the chart, not summaries or export scope.

## Pricing

Only models with usage history appear in **Pricing & billing**. Their official Standard API prices are refreshed every 24 hours from [OpenAI public pricing](https://developers.openai.com/api/docs/pricing.md). New missing prices trigger early queries; unpriced rows also provide **Fetch official price**. Unpublished prices remain unknown and are retried daily, with at least 60 seconds between requests.

Custom prices take priority. Check times and fetched prices persist in `official-prices.json`; overdue checks run after restart. All historical API-equivalent costs use the latest configured prices, not historical invoices. Failed requests retain cached and custom prices. See the bundled [price snapshot](../src/codex_usage/prices.json) and [NOTICE](../NOTICE).

## Quota & resets

Quota comes from the local Codex `app-server` interface; authentication is handled by Codex. Observation history and alerts are stored locally for 90 days, separated by account, plan and window. Missing observations cannot be reconstructed. Consumption-rate estimates require sufficient continuous observations; gaps are not filled with zeros.

Resets outside the normal cycle default to official resets; a concurrent reduction in reset cards is treated as a reset-card reset. These classifications are **inferences**, not official operation receipts. Browser desktop notifications require permission and an open page; stored alert records do not.

**Public reset updates** come from [Codex Resets](https://codex-resets.com), checked on demand at most every five minutes. The panel shows announced schedules, expected times, regular resets or banked-credit grants, the latest public record, historical statistics, original posts and full history. It no longer displays forecast probabilities.

An elapsed schedule remains **Awaiting confirmation** until the source confirms execution. Failed updates retain clearly labeled cached data. Announcements and historical average intervals neither confirm an individual account reset nor predict the next one; local quota observations determine account events. Availability depends on the installed Codex version and upstream interface.

## Accounting & limits

- Events are attributed by time, model and working directory, including time zones and daylight saving. Cumulative counters are converted to deltas, with duplicate notifications, copied logs, fork inheritance and counter rollbacks handled.
- Input includes cached reads and cache writes; output includes reasoning. **Total tokens = input + output**. Reasoning is not counted again in totals or costs.
- Reference cost in USD = (uncached input × input price + cached reads × cache price + cache writes × write price + output × output price) ÷ 1,000,000. Applicable long-context multipliers are evaluated per request.
- Estimates exclude subscription fees, tool charges and unmodeled surcharges. Unknown prices remain unpriced, not free; only known subtotals are displayed.
- Sessions with metadata but no logs are shown separately and are excluded from daily token/cost totals.
- Only readable configured sources are included. Other machines, WSL or cloud sessions do not appear automatically. Shared directories without account markers cannot reliably attribute usage to accounts.

## Interface preferences

Choose Simplified Chinese or English in the top bar and light/dark theme in the sidebar. Language is remembered per browser and preserves routes and filters; it does not rewrite user titles, paths, model identifiers, reporting time zone or prices.

In **Data & settings**, use one to three English letters, digits or Chinese characters for custom avatar text. The account label uses a masked email. Email metadata is fetched separately at most every five minutes and after login; failed lookups do not block quota.

Right-click a project tile to hide it from the treemap. Hidden projects appear below with individual restore buttons and **Restore all**. The browser remembers this choice across visits.

## Data & privacy

The service binds only to `127.0.0.1`; source logs and Codex metadata are read-only. Frontend code and bundled pricing are local, without analytics SDKs or remote CDN dependencies. Language translation does not call an external service.

Default logs are in `~/.codex`. The app uses `~/.codex-usage` unless changed with `--data-dir`:

| Location | Contents |
| --- | --- |
| `settings.json` | Sources, reporting time zone, prices, SSH and alert settings |
| `usage.sqlite` | Usage index and required session metadata |
| `quota-history.sqlite` | Quota observations, events and alerts |
| `official-prices.json` | Official price cache and check times |
| `remote/` | Remote snapshots |
| `web-service/` | Windows launch profile, status and logs |

Indexes can contain **session titles, project paths and account groups**; titles may derive from a first user message. Keep real logs, databases, exports and unredacted screenshots out of public reports and repositories.

Network access depends on the features used: dependency installation via Python's package infrastructure; Codex's authenticated service for live quota; configured SSH hosts for remote aggregation; OpenAI's public pricing; and Codex Resets for public announcements. Pricing and public-reset requests carry no local logs, credentials or usage records. Credentials and redeemable reset-card identifiers are never sent to the web frontend. See [SECURITY](../SECURITY.md) for security boundaries and reporting.
