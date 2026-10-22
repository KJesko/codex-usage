# Codex Usage

简体中文 | [English](README.en.md)

**稳定版 v1.2.0（网页版）**：[下载与更新说明](https://github.com/KJesko/codex-usage/releases/tag/v1.2.0) · [更新日志](CHANGELOG.md) · [安全与隐私](SECURITY.md)

**当前 `main` 的改进尚未打包进 v1.2.0。** 下文的首次启动检查、浏览器登录、目录选择及自定义端口/数据目录后台任务需要 [下载当前源码](https://github.com/KJesko/codex-usage/archive/refs/heads/main.zip) 或使用 `git clone`。稳定版下载包保持原样，在线演示随 `main` 更新。

[![Checks](https://github.com/KJesko/codex-usage/actions/workflows/ci.yml/badge.svg)](https://github.com/KJesko/codex-usage/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

一个支持简体中文 / English、优先在本地运行的 **Codex 用量看板**。按日期、项目、会话和模型查看 Token 消耗，估算 API 等价成本，记录账号额度变化，也可以通过 SSH 汇总远程机器的用量。

Python 后端 + 原生 JavaScript 前端，无需前端构建。支持浏览器运行，并提供 Windows 桌面版构建脚本。

> 本项目是独立社区工具，与 OpenAI 无隶属关系。统计来自可读取的本地或远程日志；API 等价成本是估算值，不代表订阅账单、实际付款或账号的固定 Token 配额。

**第一次使用：** [选择安装方式](#先选适合你的安装方式) · [让 Agent 配置并启动](#让-agent-配置并启动可选) · [首次连接日志和额度](#首次使用先接入日志再连接额度) · [安装与连接排错](#安装与连接排错)

## 在线体验与界面预览

**[打开在线交互演示 →](https://kjesko.github.io/codex-usage/)** · 无需安装或登录。

演示站复用真实应用的前端，在浏览器中生成 **近 12 个月、6 个虚构项目、3 台模拟机器**的用量。可以切换日期、机器和模型，展开项目 / 会话详情，查看成本与缓存收益，体验额度曲线并导出模拟 CSV。

模拟场景包含稀疏工作日、周末与休假空档，项目用量从几十万到数亿 Token，输入缓存命中率约 95%。总览、活动热图、项目 / 模型 / 会话明细及 CSV 都由同一批记录汇总。默认「全部时间」的数据均在热图的 12 个日历月窗口内，合计一致。

不同项目使用不同的模型组合，并包含少量多模型会话。CSV 跟随顶部的日期、机器、项目、模型和账号筛选；会话导出还包含搜索命中的所有分页，并保留当前排序。导出提供用量构成、成本分项、缓存收益、会话标识和统计时区。未定价部分的 `cost` 留空，`known_cost` 仅为已定价小计；金额保留计算精度，页面金额按显示位数四舍五入。模型图表的勾选和缩放只影响图表展示，不改变下方汇总和导出范围。

额度曲线另行模拟夜间休息、午休、集中消耗、缓慢使用和采集中断。正常周期完整持续 7 天，均匀参考线在周期末到达 100%；提前发生的官方重置与重置卡事件单独分段。示例完整周期恰好耗尽额度，但正常周期重置并不要求实际用量达到 100%。额度百分比用于演示账号窗口，不按 Token 总数换算。

建议依次体验：[全年活动总览](https://kjesko.github.io/codex-usage/) → [近 30 天详细分析](https://kjesko.github.io/codex-usage/?view=overview&tab=analysis&range=30) → [项目分析](https://kjesko.github.io/codex-usage/?view=projects&range=all) → [额度与重置](https://kjesko.github.io/codex-usage/?view=quota)。

所有账号、用量、费用、额度及下方截图均为**模拟数据**。演示站不会读取访客的 Codex 文件、连接真实账号或 SSH，也不启动后台任务。价格与统计设置仅在当前页面内生效，刷新或点击「重置演示」即可恢复；主题偏好保存在浏览器中。导出的文件名称和内容均带有演示标记。

**用量总览：** 汇总 Token、API 等价成本、缓存命中率和会话数量，按全年活动热图查看使用节奏。

[![Codex Usage 用量总览，全部为模拟数据](docs/screenshots/demo-overview.png)](https://kjesko.github.io/codex-usage/)

<details>
<summary>更多截图：项目分析、模型对比、额度与重置</summary>

**项目分析：** 用矩形树图比较项目占比，点击项目查看每日趋势和所属会话。

![项目分析与缓存收益，全部为模拟数据](docs/screenshots/demo-projects.png)

**模型分析：** 对比模型的每日用量，切换 Token / 成本视图，查看未定价模型和缓存收益。

![模型每日用量对比，全部为模拟数据](docs/screenshots/demo-models.png)

**额度与重置：** 默认展开完整历史，查看完整七天周期、夜间平台、蓝色采集缺口和三种重置事件，支持缩放及日期范围选择。

![额度曲线和重置记录，全部为模拟数据](docs/screenshots/demo-quota.png)

</details>

## 功能

| 功能 | 说明 |
| --- | --- |
| 用量总览 | 日 / 周 / 月聚合、Token 活动热图、趋势图、周期对比及增长归因 |
| 项目与会话 | 项目排行与矩形树图、项目每日趋势、会话搜索、排序和分页 |
| 模型分析 | 输入、缓存读取、缓存写入、输出及推理明细，模型趋势与缓存收益分析 |
| 成本估算 | 随仓库提供模型价格快照，支持自定义价格，未知模型明确标记为待定价 |
| 账号额度 | 通过本机 Codex 读取额度窗口、剩余比例和重置时间，保存观测历史及提醒 |
| 多机器汇总 | 合并多个 Codex 数据目录，SSH 增量同步，断线时保留上次快照 |
| 筛选与导出 | 日期、机器、项目、模型及账号分组筛选，导出适用于 Excel 的 UTF-8 CSV |
| 本地体验 | 中英切换、深浅主题、窄窗口适配、键盘操作，图表支持缩放和平移 |

## 先选适合你的安装方式

建议先在**实际使用 Codex 的那台电脑、同一个系统用户**下安装网页版；不需要先部署到云服务器，也不需要配置数据库或前端构建。

| 你的目标 | 选择 | 还需要什么 |
| --- | --- | --- |
| 先看看界面 | 在线演示 | 不用安装；里面是模拟数据，不会显示你的用量 |
| 稳定使用 | Release 中的 `web-source.zip` 源码包 | Python 3.10+；解压到固定目录，ZIP 方式不需要 Git |
| 使用本 README 中的最新界面改进 | 当前仓库 `main` 源码（Git clone 或 Code → Download ZIP） | 这是开发中的代码，不等同于已发布稳定包；已有安装不要直接覆盖未备份的数据 |
| 让 Agent 代为操作 | 下方可复制提示词 | Agent 必须能在你的本机读文件、运行终端；只有聊天权限或云端沙箱的 Agent 无法配置你的电脑 |

本 README 描述当前源码；旧 Release 以其压缩包内的 README 和更新日志为准。下载后应能在同一目录看到 `codex_usage.py`、`requirements.txt` 和 `src/`，在这个目录打开终端。不要在 ZIP 压缩包内直接启动，也不要把 `.codex` 日志目录当作项目安装目录。

**只看 Token 不需要登录额度账号。** 接入已有本地日志即可；没有日志时可以启动空看板，但不会凭空产生项目或会话。需要实时额度时，再检查本机 Codex 与 ChatGPT 登录。若还没有 Codex，请使用 [Codex 官方安装说明](https://learn.chatgpt.com/docs/codex/cli)；订阅登录与 API Key 登录的区别见 [官方认证说明](https://learn.chatgpt.com/docs/auth)。

## 让 Agent 配置并启动（可选）

在 Codex、Claude Code、Cursor 等能够操作**本机目录和终端**的 Agent 中打开下载后的项目目录，复制下面整段提示词。还没下载也可以使用：Agent 会先准备源码。已有目录优先使用当前版本；没有目录时默认选择最新非预发布稳定源码包，要体验当前改进可把“版本”改为 `main`。

提示词授权安装项目依赖并启动本地看板。账号登录由你在官方页面完成；默认不配置 SSH、不更换已有账号、不启用开机自启。需要这些功能时先改好“我的偏好”。如果 Agent 运行在 WSL、容器或远程主机，先让它说明操作的是哪台机器、哪个用户，而不是误以为正在配置你的桌面系统。

```text
请帮我在本机配置并启动 Codex Usage 网页版，执行操作并验证结果，不要只给安装说明。
项目地址：https://github.com/KJesko/codex-usage

我的偏好：
- 版本：已有项目使用当前目录；未下载则使用最新非预发布稳定版源码包。
- 界面：简体中文；统计时区：Asia/Shanghai。
- 日志目录：先检查 CODEX_HOME，否则检查当前用户的 .codex。
- 账号额度：尝试复用本机已有 ChatGPT 登录；需要新登录时引导我完成。
- 多机器 SSH：暂不配置。
- 开机自启与异常恢复：暂不开启，先完成前台验收。

请按以下步骤执行：
1. 确认你的终端实际所在的操作系统、用户、工作目录，区分 Windows、WSL、容器和远程环境。先读所选版本的 README、依赖文件和启动脚本。已有目录保留代码改动与配置；没有目录时下载上述仓库的正式源码包到可写的固定目录，有发布校验文件时核对 SHA256。不要把演示站或同名第三方包当成安装来源。
2. 检查 Python 3.10+、venv、pip；在项目内使用 .venv 安装 requirements.txt。Windows 启动器会依次检测 python 和 py -3；使用 run.ps1/run.bat 创建并验证 .venv。macOS/Linux 使用 python3 -m venv .venv，再通过 .venv/bin/python 安装和启动。不要为了运行网页版安装桌面依赖或 Node.js；若另外安装 Codex 需要依赖，按其官方说明处理。遇到缺失的系统组件或权限限制，给我精确的处理步骤，不要禁用证书校验或更改全局安全策略。
3. 检查默认端口 8787。若 /api/health 确认已有 codex-usage，优先复用并核实其安装位置，不重复启动；若被其他程序占用，不结束它，选择空闲端口并告知完整地址。保留所有既有数据，不让两个实例写入同一数据目录。用项目虚拟环境启动 codex_usage.py，保持仅监听 127.0.0.1。
4. 识别 Codex 主目录，而非项目源码目录或 sessions 子目录；只检查目录结构和可读性，不展示对话内容。通过该版本支持的设置界面或配置方式保存来源与统计时区；启动参数不等于已持久保存，需确认重新启动后仍有效。支持目录检查功能时先检查再保存。若有多套候选目录，列出路径和判断依据让我选择，不扫描整块磁盘。不改动源日志。
5. 独立检查账号额度。定位本机原生 Codex 可执行文件，用该版本支持的 login status 检查状态。Windows 若只找到 codex.cmd，不能把它直接作为 CODEX_USAGE_CLI；检查应用自带或安装包内真实的 codex.exe，必要时使用已验证的绝对路径。若缺失或不支持 app-server，参考官方安装/更新说明。保持与看板相同的用户、CODEX_HOME 和网络环境。已有可用登录不重新登录；需要时说明会更新本机账号，使用该版本的浏览器登录入口或 codex login，由我完成官方页面认证。不要读取、复制或输出 auth.json、Cookie、Session、Token 或 API Key。额度失败时继续完成本地日志功能，并说明具体原因。
6. 验收必须分开记录：A. /api/health 返回正确应用，网页能打开；B. 项目/会话能显示实际 Token，或明确说明没有日志、无 Token 事件、日期筛选等原因；C. 额度请求成功并有最近更新时间，或明确说明尚未连接。不能把健康检查、已登录或旧缓存当成额度同步成功。没有日志时请让我完成一次本地 Codex 会话，再等待默认约 30 秒扫描；不要为演示伪造数据或自动发送模型请求。
7. 仅在我的偏好要求时配置 SSH 或后台启动。SSH 复用我提供的已验证别名与免密连接，只汇总日志。Windows 内置自启需要源码目录与项目 .venv；通过当前运行实例的设置页开启，保存当前端口、数据目录、日志来源和时区，每个数据目录有独立任务。需自启时，保存设置并验证守护进程接管，不将“任务已创建”等同于已接管。macOS/Linux 无内置自启安装器，不宣称关闭终端后仍会运行。
8. 最后给我简短交付单：安装路径与版本、启动/停止/再次打开的方法、浏览器地址、日志来源、应用数据目录、统计时区、Token 和额度的分别验收结果、后台是否持续运行，以及仍需我完成的事项。不要提交、推送或发布代码。若你的进程会随会话结束被回收，明确告诉我，并给出可在我自己的终端执行的启动命令。
```

### 安装与连接排错

| 看到的现象 | 先做什么 |
| --- | --- |
| 不知道命令在哪里执行 | 解压后进入含 `codex_usage.py` 的目录打开 PowerShell / Terminal；带空格的路径用引号包住。下载 ZIP 不必先装 Git |
| Windows 的 `python` 找不到或打开商店 | 先验证 `python --version`；启动器需要 Python 3.10+，会自动尝试 `python` 和 `py -3`；两者均不可用时安装 Python 并重新打开终端。旧 `.venv` 的版本不合适时，备份后用正确版本重建 |
| Linux 创建 venv 失败、找不到 pip | 按发行版安装与 Python 匹配的 venv/pip 组件后重试；不要用 sudo 向系统 Python 安装项目依赖 |
| 安装依赖超时、代理或证书错误 | 看终端报错，确认运行 pip 的终端网络可用；企业代理/证书按所在环境配置，不用关闭校验解决。离线机器需预先准备匹配依赖 |
| 网页打不开或地址被占用 | 保持启动终端运行，核对输出地址；默认是 `http://127.0.0.1:8787`。需要换端口时加 `--port 8790`，不要结束不认识的占用进程 |
| Token 一直为零 | 检查的是 `.codex` 主目录而非项目文件夹；确认有实际用量日志，并检查统计起始日期及顶部筛选；完成本地会话后等下一轮扫描。云端会话不保证有本地日志 |
| Codex 在 WSL，网页服务在 Windows | 两边用户目录、可执行文件和登录环境不同。优先把看板与 Codex 放在同一环境；配置另一个环境的日志路径只解决日志读取，不会自动连接它的额度账号 |
| 浏览器已登录，额度仍未连接 | 确认本机 Codex 使用 ChatGPT 登录；网页会话与本机登录不同。按下文连接步骤检查原生可执行文件、登录状态、后台网络和更新时间 |
| 终端能用 Codex，但看板找不到 | Windows 的 `.cmd` 包装器不能直接作为额度接口程序；设置 `CODEX_USAGE_CLI` 为实际原生程序路径。修改环境后重启后台，不能只刷新网页 |
| 开了自启但采集中断 | 查看设置页的服务、守护进程和最近成功采集状态；默认前台终端关闭后可能需要等待守护进程接管。睡眠、关机和未登录期间不采集；确认显示的访问地址和数据目录正确；“等待前台退出”表示尚未接管，“端口被占用”需要先排查占用者 |

**首次配置完成的标准：** 网页能打开；日志来源与时区已保存；项目/会话显示实际用量（或明确为何没有）；额度显示最近成功同步时间（或明确暂不可用）；知道关网页、关终端和关机分别如何影响采集。

## 安装稳定版与升级

推荐从 [v1.2.0 Release](https://github.com/KJesko/codex-usage/releases/tag/v1.2.0) 下载 `codex-usage-1.2.0-web-source.zip`，解压到固定目录。Windows 安装 Python 3.10+ 后双击 `run.bat`；macOS / Linux 按下方命令创建虚拟环境。首次联网安装依赖后，浏览器打开 `http://127.0.0.1:8787`。本次发布提供网页版源码、Python wheel / sdist 及 SHA256，不提供新桌面 exe，也不发布到 PyPI。

升级前：如果启用了 Windows 自动保护，先运行 `scripts/enable-web-background.ps1 -Disable`，等待后台退出；手动启动的服务用 Ctrl+C 停止。服务停止后备份整个 `~/.codex-usage` 目录，再用新版替换源码或解压到新目录，重装依赖并启动。**不要删除用户数据目录**；本版沿用原有配置、日志索引和额度历史。已有浏览器的主题与隐藏项目设置继续保留。

使用自定义应用数据目录时，停用命令也要传入 `-DataDir "你的目录"`，备份该目录；重新启用时同时传入原来的 `-DataDir` 和 `-Port`，或在以这两个参数启动的网页中打开自动保护。不要套用默认目录/端口命令，否则会操作另一个实例。

如改动安装目录，请在新目录运行一次 `run.ps1`，再执行 `scripts/enable-web-background.ps1` 重新启用自启。不要复制旧 `.venv`。Linux / macOS 不提供内置登录自启；服务需保持运行才能采集额度。回退时停止服务并使用原源码及升级前备份，不要让两个版本同时写同一数据目录。

校验下载包：Windows 使用 `Get-FileHash 文件名 -Algorithm SHA256`；Linux 使用 `sha256sum`，macOS 使用 `shasum -a 256`，与 Release 中 `SHA256SUMS.txt` 比对。哈希用于检测传输差错，不代表代码签名。

## 快速开始

### 环境要求

- **Python 3.10+**；Windows 建议使用 Python 3.12。
- 本机存在 Codex 会话日志，默认目录为 `~/.codex`，也可指定其他目录。
- 首次安装 Python 依赖需要网络；安装后，本地日志统计可以离线使用。
- 账号额度功能另外需要本机可用且已登录的 Codex CLI，以及网络连接。额度读取不可用时，仍可查看日志统计。
- Node.js 仅用于前端开发检查或可选的 `npm start` 启动方式，日常运行不需要。

### Windows

```powershell
git clone https://github.com/KJesko/codex-usage.git
cd codex-usage
powershell -NoProfile -ExecutionPolicy Bypass -File .\run.ps1
```

也可以在下载并解压源码后双击 `run.bat`。启动脚本会创建项目内的 `.venv` 并安装所需时区数据，随后自动打开 <http://127.0.0.1:8787>。

### macOS / Linux

```sh
git clone https://github.com/KJesko/codex-usage.git
cd codex-usage
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python codex_usage.py
```

### 安装为命令行程序

在已激活的 Python 虚拟环境中，从仓库根目录执行：

```sh
python -m pip install .
codex-usage
```

这里使用源码安装；无需从 npm 或 PyPI 安装同名包。当前仓库不包含预构建的 Windows exe。

## 使用与配置

进入「数据与设置」可以修改统计时区、统计起始日期和数据目录；模型价格在「价格与计费」，额度提醒在「额度与重置」。默认统计时区为 `America/Los_Angeles`；需要北京时间时可改为 `Asia/Shanghai`。

浏览器版常用参数：

| 参数 | 用途 |
| --- | --- |
| `--port 8790` | 更换端口，默认 `8787` |
| `--no-browser` | 启动服务但不自动打开浏览器 |
| `--codex-home PATH` | 指定 Codex 日志目录，可重复传入以合并多个目录 |
| `--data-dir PATH` | 指定本工具的配置与缓存目录，默认 `~/.codex-usage` |
| `--timezone Asia/Shanghai` | 指定 IANA 统计时区 |
| `--version` | 显示版本 |

例如，在 Windows 上合并两个日志目录：

```powershell
.\run.ps1 --timezone Asia/Shanghai --codex-home "$env:USERPROFILE\.codex" --codex-home "D:\codex-logs" --port 8790
```

默认扫描 `CODEX_HOME` 环境变量指定的目录，否则扫描 `~/.codex`。数据来源包括 `sessions`、`archived_sessions`、`session_index.jsonl` 及 `state_*.sqlite` 中可读取的日志路径。

统计起始日期按所选时区的当天零点截断，只计入此后的用量增量；留空恢复全部可用历史，不删除源日志。顶部筛选影响日志图表、统计表和 CSV，账号额度页面有独立的日期范围。

本地服务每 30 秒扫描日志，账号额度默认每 60 秒采集一次。关闭浏览器页面后，服务仍会继续采集；在启动终端按 `Ctrl+C` 可停止前台服务。关机、休眠或服务停止期间无法采集账号额度，也不会补造缺失观测。

## 首次使用：先接入日志，再连接额度

首次打开默认地址且尚未保存配置时，会直接进入「数据与设置」。顶部展示目录识别、当前筛选下的实际用量、额度连接程序三项独立检查，并可展开查看后台系统、地址和数据目录。旧配置不会被重置，显式打开其他路由也不会被强制跳转。

可一键填入检测到的默认日志目录、使用浏览器时区；误选 `sessions` 子目录时，可一键采用建议的上一级目录。选择或检查不等于保存，点击「保存并开始使用」才持久生效。没有日志时允许先保存，额度连接也是可选项。

在「开始使用」区域，分别配置两条独立的数据来源：

1. **项目和会话 Token**：点击「选择文件夹」浏览本机目录，或手动填写 Codex 主目录（默认 `CODEX_HOME`，否则 `~/.codex`）。Windows 通常是 `C:\Users\你的用户名\.codex`。不要填写项目源码目录，也不要直接填写 `sessions` 子目录。
2. 点击「检查目录（不保存）」。系统逐项检查目录是否存在、是否可读、是否包含 Codex 日志结构；选到子目录时给出上一级路径。检查通过只代表识别到目录，**不保证已有 Token 记录**。确认后点击「保存并重新读取」。
3. 打开「项目分析」或「会话明细」。若仍为空，先用 Codex 完成一次本地会话，并检查日期/机器/模型筛选、统计起始日期，以及「数据覆盖情况」。日志默认每 30 秒扫描；不存在的云端日志和已删除历史不会自动下载或补齐。
4. **账号额度**：在运行看板的同一系统用户和 Codex 环境中运行 `codex login status`；未登录时运行 `codex login` 并使用 ChatGPT 账号登录。回到「开始使用」点击「重新连接额度」，以成功状态和最近更新时间确认连接。浏览器已登录 ChatGPT 并不代表本机 Codex 已登录；API Key 登录也不等同于订阅额度。
5. 未找到 Codex 时，将 `CODEX_USAGE_CLI` 设为原生可执行文件的绝对路径（Windows 为 `codex.exe`，不是 `.cmd` / `.bat`），然后重启看板后台。使用自定义 `CODEX_HOME` 时，应确保登录命令与后台进程使用相同环境。后台自启进程不会自动继承某个终端刚设置的临时变量。

额度默认每 60 秒采集；失败时根据连接提示检查登录、Codex 版本和后台进程的网络/代理。**额度读取失败不影响本地 Token 统计；修改日志目录不会切换额度账号。** 看板不要求填写密码或 API Key，登录仅在用户点击「浏览器登录」后发起，不执行额度重置操作。

多机器用户可点击「管理服务器」直接定位远程配置：先在终端确认已有 SSH 别名可以免密连接、主机密钥已验证、远端 Python 3 可用，再添加该别名并检查同步状态。远程目录留空可自动发现，默认每 120 秒同步；SSH 汇总的是日志，并不连接远端账号的实时额度。后台自动启动放在设置页下方，建议在日志和额度确认正常后再开启。

目录选择器会显示用户目录、磁盘和子文件夹，也可直接输入完整路径；选择后只填入表单，点击「保存并重新读取」才生效。路径示例始终显示，支持添加多个目录。

账号名称显示脱敏邮箱。头像直接使用自定义文字，可在「数据与设置」填写一至三个英文字母、数字或汉字，保存后生效。邮箱资料独立查询，最多每 5 分钟更新，登录完成后重新获取；查询失败不影响额度采集，也不读取登录凭据。

### 在看板中使用浏览器登录（可选）

原有方式保持可用：默认读取本机 Codex 已有登录状态，也可继续使用 `codex login` 后点击「重新连接额度」。

新增方式：进入「数据与设置 → 开始使用」，点击「浏览器登录」，待链接生成后点击「打开官方登录页」。在新标签页完成 OpenAI 官方登录后，回到看板等待自动读取额度。**这会更新本机 Codex 的登录账号，可能影响同一用户下的其他 Codex 客户端。** 登录成功与额度查询成功是两件事，以上方额度连接状态和更新时间为准。

无需复制 Session、Cookie 或 Token。看板只临时保留授权链接，凭据保存与刷新交给 Codex。等待最多 5 分钟，可点击「取消登录」；取消只终止待完成的登录，不执行退出已有账号。若失败，请检查 Codex 版本、后台网络/代理以及本机回调端口是否被其他登录过程占用。浏览器与看板应在同一台机器上完成此流程。

### 实时账号额度

额度由本机 Codex 的只读 `app-server` 接口提供，认证交由 Codex 处理。程序不直接读取、复制或保存 `auth.json` / OAuth token，仅在用户主动点击时发起官方登录，不执行购买、对话或额度重置操作。

如果未自动找到 Codex，可将 `CODEX_USAGE_CLI` 环境变量设为原生 Codex 可执行文件的绝对路径，然后重启看板。Windows 上应指向 `codex.exe`，不要指向 `.cmd` 或 `.bat` 包装脚本。

- 历史额度观测与提醒保存在本机，保留最近 90 天，按账号、套餐和窗口隔离。
- 额度消耗速度与耗尽时间依赖连续观测；缺失区间不补零，数据不足时不作有效预测。
- 重置记录根据观测到的额度恢复识别；界面中的「官方重置」「重置卡重置」可能属于推断，不是服务端操作回执。
- 可选桌面通知需要浏览器授权且页面保持打开；后台提醒记录不依赖页面打开。
- **公开重置动态**来自第三方 [Codex Resets](https://codex-resets.com/zh-CN)：展示已安排重置的公告时间、预计执行时间、常规重置或发放重置卡的类型、最近公开消息及历史统计，并附原帖与完整历史入口。页面每 5 分钟按需同步，不再展示预测概率。
- 公告时间已过但来源尚未确认执行时，显示“等待后续确认”；同步失败保留上次数据并明确标注。公开消息和历史平均间隔不代表个人账号已重置，也不用于预测下次重置，实际到账仍以本机额度监测为准。

这些功能依赖当前 Codex 版本和账号接口支持情况。读取失败时会展示错误或上次更新时间，不把缓存当作实时结果。

### SSH 远程同步

在「数据与设置 → 远程服务器」添加本机已有的 SSH 连接别名，例如 `my-server`。应用沿用 `~/.ssh/config` 中的用户名、端口、密钥和跳板配置。

需要本机 OpenSSH 客户端、已验证的主机密钥、免密 SSH 登录，以及远程 Python 3。远程目录留空时使用远程 `CODEX_HOME` 或 `~/.codex`。

同步默认间隔为 120 秒，可设为 30 至 86400 秒。采集程序在远端内存中执行，无需安装远程服务，只返回用量事件、会话标题、项目路径及必要元数据，不下载对话正文或认证文件。断线时保留上次成功快照。

也可以手动把其他机器的日志复制到独立目录，再通过 `--codex-home` 合并。**不要复制 `auth.json`。**

### Windows 后台启动（可选）

先运行一次 `run.ps1` 准备环境，再执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\enable-web-background.ps1
```

在当前运行实例的「数据与设置 → 网页版后台服务」开启时，会保存**当前端口、应用数据目录、日志来源和统计时区**，包括命令行覆盖的来源与时区；`CODEX_HOME`、`CODEX_USAGE_CLI` 的路径覆盖也会保留。不会复制完整环境或保存代理凭据；代理仍需在后台用户环境中可用。

每个应用数据目录使用独立计划任务，配置与运行记录保存在该目录的 `web-service/`。默认目录沿用原任务名，旧安装可兼容。界面区分「已接管后台服务」「等待当前前台服务退出后接管」「端口被其他服务占用」。开启后可关闭原前台终端，再核对接管状态和最近成功采集；不会强行结束占用端口的其他程序。不要让两个实例写入同一数据目录。

命令行配置自定义实例（先在该实例界面保存来源与时区）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\enable-web-background.ps1 -Port 8790 -DataDir "D:\Codex Usage Data"
# 查询或停用同一个实例时也传入其数据目录
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\enable-web-background.ps1 -DataDir "D:\Codex Usage Data" -Status
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\enable-web-background.ps1 -DataDir "D:\Codex Usage Data" -Disable
```

这会为当前用户创建 Windows 计划任务，在登录后静默启动服务，并在异常退出后自动恢复。启用后请保持项目路径和 `.venv` 可用；可在「数据与设置 → 网页版后台服务」查看状态。

停用并停止由守护进程启动的服务：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\enable-web-background.ps1 -Disable
```

停用不会删除历史数据。默认前台启动不会自动安装此计划任务。

## 统计口径与限制

- 按用量事件的时间、模型和工作目录归属数据，支持时区及夏令时。累计 Token 取相邻差值，跳过重复通知，并处理复制日志、分叉继承及计数回退。
- 输入包含缓存读取和缓存写入，输出包含推理。**总 Token = 输入 + 输出**，推理不会再次加到总量或成本中。
- API 等价美元成本 =（未缓存输入 × 输入价 + 缓存读取 × 缓存价 + 缓存写入 × 写入价 + 输出 × 输出价）÷ 1,000,000。适用模型的长上下文倍率按单次请求判断。
- 所有日期都使用当前配置的价格快照重算，不是历史账单还原；不包含订阅费、工具调用费及未建模的价格附加项。仓库价格快照的标注日期为 `2026-10-15`，使用前可在设置中核对或覆盖价格，见 [prices.json](src/codex_usage/prices.json) 与 [NOTICE](NOTICE)。
- 未知模型的成本标为待定价，只显示已定价小计，不静默按零成本处理。
- 仅有元数据但缺少日志的会话会单独展示参考信息，不混入按日 Token 明细和成本。
- 看板只能统计配置目录内可读取的数据；未配置的其他机器、WSL 或云端记录不会自动出现。多个账号共用目录且日志缺少账号标记时，无法准确归属账号。

## 数据与隐私

服务仅监听 `127.0.0.1`。源日志和 Codex 元数据库以只读方式访问；页面、图表代码和价格快照随源码提供，不使用分析 SDK 或远程 CDN。

| 位置 | 内容 |
| --- | --- |
| `~/.codex-usage/settings.json` | 数据目录、时区、价格、SSH 数据源及提醒设置 |
| `~/.codex-usage/usage.sqlite` | 用量索引和必要会话元数据 |
| `~/.codex-usage/quota-history.sqlite` | 额度观测、事件及提醒相关数据 |
| `~/.codex-usage/official-prices.json` | 官方价格缓存与同步时间 |
| `~/.codex-usage/remote/` | 远程用量快照 |
| `~/.codex-usage/web-service/` | Windows 后台服务状态与日志 |

本机索引可能包含**会话标题、项目路径和账号分组**，会话标题也可能来自首条用户消息。请勿把这些数据、真实日志、CSV 导出或未经脱敏的截图提交到公开仓库。

日志不会上传至本项目的服务器。使用账号额度时由 Codex 访问其服务；启用远程同步时访问配置的 SSH 主机；查看公开重置动态时会请求第三方公开接口，不附带本地日志、账号或额度信息。价格同步每 24 小时请求 OpenAI 官方公开价目表，新缺价模型也会主动查询；请求不携带日志、账号凭据或模型使用记录。认证凭据和可兑换的重置卡 ID 不传给网页。

## 构建 Windows 桌面版

在 Windows x64、Python 3.12 环境中运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-windows.ps1
```

脚本安装固定版本的桌面依赖，运行 Python 测试，生成图标与第三方许可证，使用 PyInstaller 打包，最后执行成品自检并生成 SHA256。输出为 `dist/CodexUsage.exe`，相关许可证也会放入 `dist/`。

桌面版使用 pywebview 和系统 [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)，目标平台为 Windows 10 / 11 x64。构建后的 exe 无需额外安装 Python 或 Node.js，使用独立窗口，并与浏览器版共享默认数据目录。当前构建脚本未配置代码签名。

开发时可直接启动桌面窗口：

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-desktop.txt
.\.venv\Scripts\python.exe codex_usage_desktop.py
```

## 开发与贡献

后端使用 Python 标准库和 `tzdata`，前端为 HTML / CSS / JavaScript，无需 npm 依赖安装或打包。前端检查建议使用 Node.js 20+。

```sh
# 在已激活、已安装 requirements.txt 的虚拟环境中执行
python -m unittest discover -s tests -v
npm run check
npm test
git diff --check
```

GitHub Actions 在 Ubuntu / Windows、Python 3.10 / 3.12 上运行自动检查。测试使用合成数据，覆盖日志解析、去重、跨时区统计、计价、SSH、额度历史、本地服务及前端交互逻辑。

```text
src/codex_usage/
  reader.py                 日志发现、解析、去重与索引
  analytics.py / insights.py 聚合、周期对比与增长归因
  pricing.py / prices.json   API 等价成本与价格快照
  account.py / quota_*.py    账号额度、历史、重置与提醒
  remote.py                 SSH 同步
  app.py / desktop.py       本地 HTTP 服务与桌面入口
  static/                   中英双语前端
tests/                      Python 与 JavaScript 测试
scripts/                    桌面资源准备与 Windows 后台服务
packaging/                  Windows 打包配置
```

欢迎通过 [Issues](https://github.com/KJesko/codex-usage/issues) 报告问题或提交 Pull Request。复现信息和测试数据请先脱敏，具体流程见 [贡献指南](CONTRIBUTING.md)。

### 维护在线演示

```sh
python scripts/build-demo.py
node --test tests/test_demo.cjs
python -m http.server 8791 --bind 127.0.0.1 --directory dist
```

打开 <http://127.0.0.1:8791/demo/>。构建只复制明确列出的前端文件和价格快照，不启动 Python 应用，也不读取任何用户日志或配置。模拟数据与浏览器适配代码位于 `demo/`，生成目录 `dist/demo/` 不提交到 Git。

`npm run test:demo` 会核对 72 组筛选组合及四种 CSV，覆盖原始事件合计、日 / 周 / 月分桶、会话搜索排序、未定价与自定义价格、跨时区和夏令时、未来日期及额度重置。`npm test` 检查共享前端的图表与导航行为。

推送到 `main` 后，[Pages 工作流](.github/workflows/pages.yml) 自动构建、验证并部署。Fork 后如需自行发布，请在仓库 Settings → Pages 中选择 GitHub Actions，并更新 README 和演示页中的项目链接。

## 来源与许可证

本项目基于 [physcom/claude-usage-dashboard](https://github.com/physcom/claude-usage-dashboard) 的 `f3473a332123e810363bdcc43dd991a5c7c2cb1f` 定制，保留上游 Git 历史和版权声明。本地 HTTP 服务、线程安全缓存及启动器结构来自上游；Codex 日志解析、统计、计价和中文界面为后续实现。

`src/claude_usage_dashboard`、`.claude-plugin`、`commands/` 和 `docs/demo.svg` 为保留的上游代码或资料，不属于当前 Codex 看板的运行入口，也不代表当前界面或支持的安装方式。

采用 [MIT 许可证](LICENSE)，来源及第三方说明见 [NOTICE](NOTICE)。

网页版后台每 24 小时同步所有实际使用模型的官方价格，发现新缺价模型时也会主动访问 https://developers.openai.com/api/docs/pricing.md 获取适用 Standard 单价。价格页只展示已使用模型；缺价行可点击“从官方获取”。官方未公布则继续待补价。自定义单价优先；官方暂未公布的模型每天自动重试，所有请求至少间隔 60 秒；检查时间与价格持久保存到 official-prices.json，服务关闭期间到期的检查在下次启动补做。

### 界面语言 / Display language

网页版顶部栏可选择简体中文或 English。语言选择保存在当前浏览器，刷新或重新打开后继续生效；切换保留当前路由与筛选条件，不修改项目名称、会话标题、模型标识或原始数据。语言设置不改变统计时区和价格计算方式。

Choose 简体中文 or English in the web app's top bar. The preference is saved in this browser. Switching language retains the current route and filters. Project names, session titles and raw data are unchanged; reporting time zone and pricing calculations remain the same.

英文文案集中维护在 `src/codex_usage/locales/en.json`。`web_i18n.py` 为受信任的界面资源生成英文版本，仅翻译 API 中应用自身的提示字段。新增中文界面文案应同时添加英文条目；覆盖测试会检查遗漏和英文脚本语法。
