# Changelog

## Unreleased

- 新增独立 Windows 后台助手：官方浏览器账号连接、实时额度追踪状态、浏览器详细看板、托盘常驻和消息提醒。自动复用相同数据目录的现有服务；退出只停止自己启动的后台。界面沿用网页版样式，支持浅色、深色和跟随系统。Add a native Windows background companion with official browser sign-in, tracking status, dashboard shortcuts, tray operation and deduplicated system notifications. Reuse existing services and stop only an owned backend on exit.

- 网页版账号登录统一为官方浏览器登录：移除终端登录指引与引导卡片的重复连接按钮，登录完成后自动获取额度；失败后通过额度页刷新重试。Unify web sign-in through the official browser flow, remove terminal sign-in guidance and the onboarding reconnect button, and retain automatic quota refresh.

- 精简仓库根目录：文档归入 docs，贡献与安全指南归入 .github，桌面入口与构建文件归入 packaging；更新链接和源码包清单，网页版启动方式不变。Organize documentation, community guides and desktop packaging files into their respective folders while preserving web launch commands.

- 移除闲置的旧看板源码、Claude 插件与演示素材；项目来源统一记录在 README，保留原有 MIT 版权与许可声明。Remove unused legacy dashboard code, Claude plugin files and demo assets; consolidate project origins in README while preserving MIT notices.

- 修复网页版演示的七天均匀使用参考线：提前重置只截断参考线，所有分段保持相同斜率，不再按距既有截止时间的剩余天数加速。Keep the demo's seven-day usage-plan reference lines parallel across early resets.

- 网页演示新增日常开发、连接中断、额度告急、长期记录四种场景，以及自动保存失败与重试体验；合成数据覆盖不同缓存特征、独立更新状态、数据覆盖缺口和近三个月重置历史。演示不读取本机数据或连接真实账号。The web demo now offers four realistic synthetic scenarios, save-failure recovery, varied cache behavior, independent source status, coverage gaps and three months of quota history, without accessing local data or real accounts.

- 数据更新状态移至「数据覆盖情况」，正常状态与更新时间合并为一行；自动保存说明收进「数据来源」帮助，逐项保留实际保存进度和错误反馈。Move update status into Data coverage, show healthy timestamps inline, and keep autosave guidance in source help while retaining actionable save feedback.

- 网页设置增加逐项自动保存反馈、输入校验和失败重试；修改按字段串行提交，刷新保留输入与焦点，保存和数据读取分别提示。新增本地日志、远程服务器、账号额度、模型价格的独立更新时间与异常处理入口。大列表支持搜索分页，轮询防重入并在连接失败时退避，清理失效弹层并限制界面状态缓存。Web settings now show per-field save feedback and retries, preserve drafts/focus, and distinguish saved changes from refresh failures. A source-status panel reports independent update times and recovery actions. Large selectors are searchable and paginated, polling is bounded, and stale UI controls are released.

- 登录从当前页面直接打开官方浏览器流程；登录成功优先从本机凭证提取仅用于显示的脱敏邮箱，额度异步恢复；修复取消后立即重试的流程竞争并补充安全的失败阶段诊断。Sign in directly without navigation, show masked local identity promptly, refresh quota asynchronously, and serialize cancelled sign-in retries.

- 新增看板账号登出与登录入口：登出状态跨重启保存，停止账号采集并隐藏额度、重置卡和账号历史，本地日志继续可用；不修改 Codex 客户端登录。Add persistent dashboard sign-out and sign-in controls without changing Codex client credentials or local usage logs.

- 网页提醒入口改为铃铛及红色未读角标，支持全部已读；已读提醒收进折叠历史并保留本机已读状态。Web alerts now use a bell with an unread badge, support marking all as read, and keep read alerts in collapsible history.

- 邮箱改为登录或账号切换后一次性读取，按账号缓存脱敏标签，重启后复用；失败仅手动重试，停止定时查询。Email is fetched once per sign-in/account change and cached locally in masked, account-scoped form across restarts; failed lookups retry only on manual reconnect.
- 修复额度和重置卡在慢响应时被过早中止的问题，连续服务错误后自动重建连接；邮箱查询独立重试，并在采集详情中显示脱敏错误与请求耗时。Allow slow quota/reset-card responses, reconnect after repeated service failures, and retry optional email lookup independently. Collection details now show sanitized errors and request duration.
- 项目与模型分析的每日缓存命中率图支持滚轮缩放、拖动平移及双击恢复全范围，自动刷新保留视图位置。Daily cache hit-rate charts support wheel zoom, drag-to-pan and double-click reset, preserving the viewport during automatic updates.
- 模型分析支持按天、按周、按月汇总 Tokens 与 API 等价费用，保留模型勾选和缩放拖动；悬浮明细显示实际统计日期范围。周从统计时区的周一开始，月从一日开始，首尾周期只包含当前筛选日期。
- Model analysis supports daily, weekly and monthly token/cost grouping, with model selection, zoom/pan and exact date ranges in tooltips. Weeks start Monday in the reporting time zone; partial boundary periods include only selected dates.

## 1.3.0 — 2026-10-22

Stable **web/source** release. 推荐下载 [v1.3.0 网页版 ZIP / Web ZIP](https://github.com/KJesko/codex-usage/releases/download/v1.3.0/codex-usage-1.3.0-web-source.zip)。本次不更新桌面 exe，也不发布到 PyPI。No new desktop executable or PyPI publication.

### 首次使用与连接 / Setup & connection

- 首次启动直接进入配置引导，分别检查日志目录、实际 Token 数据与额度连接程序；支持默认目录、浏览器时区及误选 `sessions` 子目录时的修正。已有配置继续保留。
- First-launch guidance separates log discovery, actual usage and the quota connector, with detected-folder and browser-time-zone shortcuts and parent-folder correction. Existing configurations remain intact.
- 引导打开官方浏览器登录，复用本机 Codex 认证；可显示脱敏邮箱，头像文字自定义。无需复制 Session、Cookie 或 Token，登录会更新本机 Codex 账号。
- Guided official browser sign-in reuses local Codex authentication. Optional masked email and custom avatar text; no credential copying. Sign-in updates the local Codex account.

### 后台与界面 / Background operation & UI

- Windows 启动器支持 `python` 与 `py -3`。后台任务按数据目录独立管理，保留自定义端口、数据目录、日志来源、时区和 Codex 路径配置，明确显示接管等待与端口冲突。
- Windows launchers support `python` and `py -3`. Background tasks are isolated by data directory and retain custom ports, data folders, sources, time zones and Codex path overrides, with explicit takeover and port-conflict status.
- 服务重启后，已打开的网页恢复操作凭据并保留未保存设置。修复深色页面底部背景，改进目录选择与路径示例；日历承载每日详情，删除重复统计表。
- Open pages recover their local operation token after a restart without losing unsaved settings. Fixed dark-page backgrounds, improved folder selection/path examples, enriched calendar details and removed the duplicate daily table.
- 公开重置动态改为来源提供的公告、安排时间和历史统计，移除已停用的概率预测；卡片改为紧凑的自适应布局。
- Public reset announcements, scheduled times and historical statistics replace discontinued probability forecasts, using compact responsive cards.

### 文档与发布 / Documentation & distribution

- 精简中英文 README，直接链接稳定版下载；安装排错、Agent 配置提示词、使用指南及开发维护分别归档，源码包内可离线阅读。同步更新双语模拟演示。
- Concise bilingual READMEs link directly to the stable download. Separate setup/troubleshooting, Agent-assisted setup, user and developer guides are bundled for offline reading. Updated the bilingual synthetic demo.
- Download assets: web-source ZIP, Python wheel, source tarball and `SHA256SUMS.txt`. The ZIP is recommended for Windows startup/crash recovery support.

### 升级 / Upgrade

先从旧目录停用 Windows 后台守护并停止服务，备份应用数据目录（默认 `~/.codex-usage`），解压新版、重建虚拟环境并以原端口和数据目录启动，再从当前实例重新开启后台保护。保留现有配置、日志索引和额度历史；不要复制旧 `.venv`，不要同时运行两个版本写入同一数据目录。

Disable the old Windows supervisor and stop the service, back up the app-data directory (default `~/.codex-usage`), extract the new version and recreate its virtual environment. Start with the original port/data options, then re-enable protection from that instance. Settings, usage indexes and quota history are retained; do not copy the old `.venv` or run two versions against the same data directory.

详细步骤 / Details: [中文升级说明](SETUP.md#升级与备份) · [English upgrade guide](SETUP.en.md#upgrade--backup) · [发布验证 / Verification](RELEASE_CHECKLIST.md).

### 已知边界 / Limits

- Windows 自启要求用户已登录；macOS/Linux 暂无内置后台安装器。Windows automatic startup requires a signed-in user; macOS/Linux have no built-in service installer.
- 额度依赖本机 Codex 登录、网络和上游接口；采集中断的记录无法补造。Quota depends on local Codex authentication, connectivity and upstream availability; missing observations cannot be reconstructed.
- 公开公告不代表个人账号已重置，默认重置归因并非官方确认。Public announcements do not confirm a reset for an individual account; inferred reset causes are not official confirmation.
- API 等价费用继续按最新价格计算，仅供参考。API-equivalent historical costs continue to use current prices and are reference estimates.

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

Stop the service (disable its Windows supervisor first), back up `~/.codex-usage`, replace the source and reinstall dependencies. Keep the user-data directory. Re-register Windows startup if the source path changed. See [中文安装说明](SETUP.md#升级与备份) or [English upgrade instructions](SETUP.en.md#upgrade--backup).

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
