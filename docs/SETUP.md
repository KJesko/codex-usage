# 安装与配置

[返回 README](../README.md) · 简体中文 | [English](SETUP.en.md)

[安装环境](#安装环境与方式) · [首次日志接入](#首次接入日志) · [账号连接](#账号连接) · [启动参数](#常用配置与启动参数) · [SSH](#ssh-远程同步) · [后台启动](#windows-后台启动) · [升级](#升级与备份) · [排错](#安装与连接排错)

本文适用于 v1.3.0 稳定网页版。最短启动步骤见 [README](../README.md#启动)，可复制提示词见 [Agent 辅助安装](AGENT_SETUP.md)。使用旧版本时请以包内文档为准。

## 安装环境与方式

在实际使用 Codex 的电脑、同一系统用户下运行。Windows、WSL、容器和远程主机的用户目录、登录环境与可执行文件不同；优先让看板和 Codex 位于同一环境。

- Python 3.10+（Windows 推荐 3.12），首次安装依赖需要联网；日志统计之后可以离线使用。
- 网页版不需要 Node.js、数据库服务器或桌面依赖。Node.js 仅用于开发测试。
- Token 统计需要可读取的 Codex 日志；没有日志也能启动，但不会生成用量。
- 额度连接另需已安装、已登录的本机 Codex 和网络；额度失败不阻断日志功能。
- 推荐[下载 v1.3.0 网页版 ZIP](https://github.com/KJesko/codex-usage/releases/download/v1.3.0/codex-usage-1.3.0-web-source.zip)；[Release 页面](https://github.com/KJesko/codex-usage/releases/tag/v1.3.0)提供更新说明、wheel 和校验文件。下载 ZIP 不需要 Git。

缺少 Codex 时参考[官方安装说明](https://learn.chatgpt.com/docs/codex/cli)；订阅与 API Key 登录区别见[官方认证说明](https://learn.chatgpt.com/docs/auth)。

### 从 Git 获取源码

```sh
git clone --branch v1.3.0 --depth 1 https://github.com/KJesko/codex-usage.git
cd codex-usage
```

以上获取稳定版；参与开发时可省略 `--branch v1.3.0 --depth 1` 使用 `main`。在含 `codex_usage.py`、`requirements.txt` 和 `src/` 的目录启动；不要把 `.codex` 日志目录当作安装目录。

### Windows

双击 `run.bat`，或在项目目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\run.ps1
```

当前启动器会依次检测 `python` 和 `py -3`，验证 Python 3.10+，创建项目 `.venv` 并安装 `requirements.txt`。Python 安装后需要重新打开终端。

### macOS / Linux

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python codex_usage.py
```

### 安装为命令行程序

在已激活的虚拟环境中从仓库根目录执行：

```sh
python -m pip install .
codex-usage
```

也可以从 Release 下载 wheel 后安装：

```sh
python -m pip install ./codex_usage_local-1.3.0-py3-none-any.whl
codex-usage --no-browser
```

打开 [本机看板](http://127.0.0.1:8787)。Windows 后台任务依赖源码目录的 `scripts/` 和 `.venv`，请使用源码安装。项目未发布到 PyPI，本次稳定版没有新桌面 exe。

## 首次接入日志

首次打开默认地址且尚未保存配置时，会进入「数据与设置」。顶部独立检查日志目录、当前筛选下的实际用量和额度连接程序；展开「运行位置与配置」可查看后台系统、地址和应用数据目录。已有配置和显式路由不会被重置。

1. 点击「选择文件夹」或填入检测到的默认目录。应选择 Codex 主目录，不能选择项目源码目录或 `sessions` 子目录。误选子目录时可一键采用建议的上一级目录。
2. 点击「检查目录（不保存）」。识别目录只代表有 Codex 日志结构，**不保证已有 Token 事件**。
3. 选择统计时区，也可使用浏览器时区，然后点击「保存并开始使用」；已有配置的按钮为「保存并重新读取」。选择和检查不会自动保存，空日志也允许保存。
4. 打开「项目分析」或「会话明细」核对用量。若为空，完成一次本地 Codex 会话，等待默认约 30 秒扫描，并检查顶部筛选、统计起始日期及「数据覆盖情况」。云端或已删除的日志不会自动下载或补齐。

| 系统 | 默认 Codex 主目录示例 |
| --- | --- |
| Windows | `C:\Users\you\.codex` |
| macOS | `/Users/you/.codex` |
| Linux | `/home/you/.codex` |

设置了 `CODEX_HOME` 时优先使用该路径。支持多个日志目录；来源包括 `sessions`、`archived_sessions`、`session_index.jsonl` 和 `state_*.sqlite` 中可读取的日志路径。

## 账号连接

**日志统计与账号额度是独立连接。** 改日志目录不会切换额度账号；浏览器已登录 ChatGPT 也不等于本机 Codex 已登录。API Key 登录不等同于订阅额度。

### 从看板发起官方浏览器登录

在「数据与设置 → 开始使用」点击「浏览器登录」，看板会自动打开官方登录页。在同一台机器的新标签页完成登录，看板随后会自动获取和更新额度，无需再次连接。如果浏览器拦截了新标签页，点击「打开官方登录页」继续。**这会更新本机 Codex 账号，可能影响同一系统用户下的其他 Codex 客户端。**

网页版只提供这一种登录入口，无需在终端执行登录命令。已有有效登录会自动读取额度，不要求重复登录。以看板的成功状态和最近更新时间确认连接，不能只看登录成功或旧缓存。

不需要复制 Session、Cookie 或 Token。授权链接只临时保留在内存中，凭据由 Codex 保存与刷新。流程最多等待 5 分钟；取消只终止待完成的登录，不退出原账号。失败时检查 Codex 版本、后台网络/代理及本机回调端口冲突。

### 找不到连接程序时

将 `CODEX_USAGE_CLI` 设为原生 Codex 可执行文件的绝对路径，Windows 应为 `codex.exe`，不能是 `.cmd` 或 `.bat` 包装器。然后重启看板后台，刷新网页不会更新后台环境。

使用自定义 `CODEX_HOME` 时，官方浏览器登录由看板后台发起，使用该后台的环境。Windows 后台开启时会保存这两个路径覆盖；之后若改变它们，需要从新环境重新配置后台。临时代理等其他环境变量不会自动复制到计划任务。

额度默认每 60 秒采集，失败不影响 Token 统计。看板不直接读取或复制 `auth.json` / OAuth token，不要求填写密码或 API Key，也不执行购买、对话或额度重置。邮箱查询与额度采集相互独立。

额度和重置卡共用一次请求；上游响应慢时最多等待 90 秒，期间不会重复发送。连续 3 次服务/路由错误后，会在下次采集时重建连接。邮箱在登录或检测到账号切换后读取一次，单独等待最多 30 秒；仅缓存脱敏邮箱并按账号隔离，重启后复用，不定时查询。失败后可在「额度与重置」页面点击「刷新」再试一次。展开「额度采集」可查看具体失败原因和上次请求耗时；超时不等于登录失效，只有明确提示登录失效时才需要重新登录。未成功刷新时，旧额度和重置卡仍标记为上次结果，不会当作新记录写入历史。

## 常用配置与启动参数

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

统计起始日期按所选时区的当天零点截断，只计入此后的用量增量；留空恢复全部可用历史，不删除源日志。顶部筛选影响日志图表、统计表和 CSV，账号额度页面有独立的日期范围。

## SSH 远程同步

在「数据与设置 → 远程服务器」添加本机已有的 SSH 连接别名，例如 `my-server`。应用沿用 `~/.ssh/config` 中的用户名、端口、密钥和跳板配置。

需要本机 OpenSSH 客户端、已验证的主机密钥、免密 SSH 登录，以及远程 Python 3。远程目录留空时使用远程 `CODEX_HOME` 或 `~/.codex`。

同步默认间隔为 120 秒，可设为 30 至 86400 秒。采集程序在远端内存中执行，无需安装远程服务，只返回用量事件、会话标题、项目路径及必要元数据，不下载对话正文或认证文件。断线时保留上次成功快照。

也可以手动把其他机器的日志复制到独立目录，再通过 `--codex-home` 合并。**不要复制 `auth.json`。**

## Windows 后台启动

先运行一次 `run.ps1` 准备环境，推荐从当前运行实例的「数据与设置 → 网页版后台服务」开启。这样会保存**当前端口、应用数据目录、日志来源和统计时区**，包括命令行覆盖的来源与时区；`CODEX_HOME`、`CODEX_USAGE_CLI` 的路径覆盖也会保留。不会复制完整环境或保存代理凭据；代理仍需在后台用户环境中可用。

每个应用数据目录使用独立计划任务，配置与运行记录保存在该目录的 `web-service/`。默认目录沿用原任务名，旧安装可兼容。界面区分「已接管后台服务」「等待当前前台服务退出后接管」「端口被其他服务占用」。开启后可关闭原前台终端，再核对接管状态和最近成功采集；不会强行结束占用端口的其他程序。不要让两个实例写入同一数据目录。

命令行启用默认实例（先在该实例界面保存来源与时区）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\enable-web-background.ps1
```

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

关闭网页不会停止服务或采集。手动前台服务可用 `Ctrl+C` 停止；页面内关闭自动保护会保留当前服务，退出后不再恢复。登录自启要求当前 Windows 用户已登录，休眠、关机或未登录期间不能采集。macOS / Linux 暂无内置自启安装器，需要保持服务进程运行。缺失的额度观测不会补造。

## 独立后台助手（Windows）

后台助手是独立的小窗口，详细分析仍在默认浏览器打开。使用开发源码，在项目目录执行：

```powershell
.venv\Scripts\python.exe -m pip install -r packaging/requirements-desktop.txt
.venv\Scripts\pythonw.exe packaging/codex_usage_desktop.py
```

安装过项目后，也可使用 `codex-usage-desktop` 入口。构建独立 EXE：运行 `packaging/build-windows.ps1`，生成 `dist/CodexUsage.exe`。GUI 使用 Windows WebView2；不修改现有 v1.3.0 网页发布包。

- **账号连接：** 点击「浏览器登录」，在系统默认浏览器完成官方授权。登录完成自动读取额度；切换账号会更新本机 Codex 登录。
- **追踪状态：** 同时检查最近成功时间、采集线程和历史保存结果；缓存过期、连接失败、登录失效会单独显示，不将旧数据当作追踪成功。
- **消息提醒：** 显示网页版已有的额度提醒并同步已读状态。系统提醒可开关与测试，同一提醒会持久化去重。系统勿扰模式可能隐藏通知，消息中心仍保留记录。
- **窗口与托盘：** 点击关闭只收进托盘，继续采集与提醒。托盘不可用时请最小化窗口。显式「退出助手」会停止助手自己启动的后台；连接到已有独立服务时不会关闭它。
- **服务复用：** 默认使用已保存后台配置的端口（没有配置时为 8787），验证服务标识与数据目录后复用。服务未运行时启动一个本机后台。使用其他端口或数据目录时传入 `--port 8790 --data-dir "D:\CodexUsageData"`；同一目录不要并行启动不同端口的服务。
- **外观：** 使用网页版同一份样式与配色，支持浅色、深色和跟随系统。助手偏好单独保存于数据目录下的 `companion-preferences.json`；浏览器中自定义的字体与强调色不会跨浏览器存储自动同步。

目前没有自动安装助手开机自启。已有网页版后台自启保持原配置，助手打开时会连接它。助手退出后不再发送系统通知；后台仍可继续保存额度提醒。此 GUI 首先面向 Windows，其他系统的托盘体验尚未验证。

## 升级与备份

升级前：如果启用了 Windows 自动保护，先从旧安装目录运行 `scripts/enable-web-background.ps1 -Disable`，等待后台退出；手动启动的服务用 Ctrl+C 停止。服务停止后备份整个 `~/.codex-usage` 目录，再解压 v1.3.0 到固定目录，重装依赖并启动。**不要删除用户数据目录**；v1.3.0 沿用原有配置、日志索引和额度历史。已有浏览器的主题与隐藏项目设置在访问地址不变时继续保留。

使用自定义应用数据目录时，停用命令也要传入 `-DataDir "你的目录"`，备份该目录；重新启用时同时传入原来的 `-DataDir` 和 `-Port`，或在以这两个参数启动的网页中打开自动保护。不要套用默认目录/端口命令，否则会操作另一个实例。

在新版目录运行一次 `run.ps1`（自定义实例保留原来的启动参数），然后从当前实例的设置页重新启用后台保护。不要复制旧 `.venv`。用 `python codex_usage.py --version` 确认显示 `1.3.0`，并检查项目用量、额度历史及最近成功同步时间。Linux / macOS 不提供内置登录自启；服务需保持运行才能采集额度。回退时停止服务并使用原源码及升级前备份，不要让两个版本同时写同一数据目录。

校验下载包：Windows 使用 `Get-FileHash 文件名 -Algorithm SHA256`；Linux 使用 `sha256sum`，macOS 使用 `shasum -a 256`，与 Release 中 `SHA256SUMS.txt` 比对。哈希用于检测传输差错，不代表代码签名。

## 安装与连接排错

| 看到的现象 | 先做什么 |
| --- | --- |
| 不知道命令在哪里执行 | 解压后进入含 `codex_usage.py` 的目录打开 PowerShell / Terminal；带空格的路径用引号包住。下载 ZIP 不必先装 Git |
| Windows 的 `python` 找不到或打开商店 | 先验证 `python --version`；启动器需要 Python 3.10+，会自动尝试 `python` 和 `py -3`；两者均不可用时安装 Python 并重新打开终端。旧 `.venv` 的版本不合适时，备份后用正确版本重建 |
| Linux 创建 venv 失败、找不到 pip | 按发行版安装与 Python 匹配的 venv/pip 组件后重试；不要用 sudo 向系统 Python 安装项目依赖 |
| 安装依赖超时、代理或证书错误 | 看终端报错，确认运行 pip 的终端网络可用；企业代理/证书按所在环境配置，不用关闭校验解决。离线机器需预先准备匹配依赖 |
| 网页打不开或地址被占用 | 保持启动终端运行，核对输出地址；默认是 `http://127.0.0.1:8787`。需要换端口时加 `--port 8790`，不要结束不认识的占用进程 |
| Token 一直为零 | 检查的是 `.codex` 主目录而非项目文件夹；确认有实际用量日志，并检查统计起始日期及顶部筛选；完成本地会话后等下一轮扫描。云端会话不保证有本地日志 |
| Codex 在 WSL，网页服务在 Windows | 两边用户目录、可执行文件和登录环境不同。优先把看板与 Codex 放在同一环境；配置另一个环境的日志路径只解决日志读取，不会自动连接它的额度账号 |
| 浏览器已登录，额度仍未连接 | 通过看板的「浏览器登录」入口完成官方授权；仅在其他标签页登录 ChatGPT 不会完成此次授权。按[账号连接](#账号连接)步骤检查原生可执行文件、登录状态、后台网络和更新时间 |
| 终端能用 Codex，但看板找不到 | Windows 的 `.cmd` 包装器不能直接作为额度接口程序；设置 `CODEX_USAGE_CLI` 为实际原生程序路径。修改环境后重启后台，不能只刷新网页 |
| 开了自启但采集中断 | 查看设置页的服务、守护进程和最近成功采集状态；默认前台终端关闭后可能需要等待守护进程接管。睡眠、关机和未登录期间不采集；确认显示的访问地址和数据目录正确；“等待前台退出”表示尚未接管，“端口被占用”需要先排查占用者 |

**首次配置完成的标准：** 网页能打开；日志来源与时区已保存；项目/会话显示实际用量（或明确为何没有）；额度显示最近成功同步时间（或明确暂不可用）；知道关网页、关终端和关机分别如何影响采集。
