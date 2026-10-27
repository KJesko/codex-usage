# Codex Usage

简体中文 | [English](README.en.md)

[![Checks](https://github.com/KJesko/codex-usage/actions/workflows/ci.yml/badge.svg)](https://github.com/KJesko/codex-usage/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

一个在本地运行的 Codex 用量看板，支持简体中文 / English。按项目、会话和模型查看 Token 与参考成本，跟踪账号额度与重置，也能通过 SSH 汇总多台机器的用量。源日志只读，无需上传到本项目的服务器。

**[在线演示](https://kjesko.github.io/codex-usage/)**（全部为模拟数据） · [功能与截图](docs/USER_GUIDE.md) · [更新日志](docs/CHANGELOG.md)

## 下载

在实际使用 Codex 的电脑、同一个系统用户下安装。需要 **Python 3.10+**；日常运行不需要 Node.js、数据库服务器或前端构建。首次安装依赖需要联网。

| 版本 | 下载 | 适合谁 |
| --- | --- | --- |
| **稳定网页版 v1.3.0（推荐）** | **[下载 ZIP](https://github.com/KJesko/codex-usage/releases/download/v1.3.0/codex-usage-1.3.0-web-source.zip)** · [更新说明与校验文件](https://github.com/KJesko/codex-usage/releases/tag/v1.3.0) | 新安装或升级 |
| 开发源码 `main` | [下载 ZIP](https://github.com/KJesko/codex-usage/archive/refs/heads/main.zip) | 参与开发或提前体验后续改动 |

v1.3.0 已包含首次启动引导、浏览器登录、目录选择和自定义端口/数据目录后台支持。本次只发布网页版；已有安装请先看[升级与备份](docs/SETUP.md#升级与备份)。

## 启动

先把 ZIP 解压到固定目录，确认里面有 `codex_usage.py`、`requirements.txt` 和 `src/`。不要在压缩包内运行。

### Windows

安装 Python 后，双击解压目录中的 **`run.bat`**。脚本会准备虚拟环境、安装依赖并打开浏览器。

### macOS / Linux

在解压后的项目目录打开终端，执行：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python codex_usage.py
```

打开 [本机看板](http://127.0.0.1:8787)。遇到启动问题，查看[安装排错](docs/SETUP.md#安装与连接排错)；也可以让 Agent 帮你完成，[复制配置提示词](docs/AGENT_SETUP.md)。

## 首次使用

开发源码还包含一个独立的 **Windows 后台助手**：账号连接、额度追踪状态、消息中心、系统托盘和一键打开详细看板。界面沿用网页版风格。查看[后台助手启动与运行方式](docs/SETUP.md#独立后台助手windows)。现有 v1.3.0 网页下载包不包含此次新增的 GUI。

1. **接入 Token 日志：** 在「数据与设置」填写 Codex 主目录（默认 `~/.codex`），保存后查看项目和会话。日志统计不需要登录额度账号。
2. **连接账号额度（可选）：** 在看板点击「浏览器登录」，按[账号连接步骤](docs/SETUP.md#账号连接)完成官方页面授权（已有有效登录无需重复操作），以最近成功同步时间确认连接。
3. **保持后台运行：** 关闭网页不会停止采集，关闭服务、休眠或关机会中断。Windows 可按[后台启动说明](docs/SETUP.md#windows-后台启动)开启登录自启和异常恢复。

## 文档

| 文档 | 内容 |
| --- | --- |
| [安装与配置](docs/SETUP.md) | 数据目录、账号连接、SSH、自定义端口、后台服务、升级与排错 |
| [Agent 辅助安装](docs/AGENT_SETUP.md) | 可直接复制的配置与启动提示词、验收标准 |
| [使用指南](docs/USER_GUIDE.md) | 功能、截图、图表与导出、价格与统计口径、额度及隐私边界 |
| [开发与维护](docs/DEVELOPMENT.md) | 测试、项目结构、英文翻译、演示站部署、桌面构建 |

[贡献指南](.github/CONTRIBUTING.md) · [安全与隐私](.github/SECURITY.md) · [问题反馈](https://github.com/KJesko/codex-usage/issues)

独立社区项目，与 OpenAI 无隶属关系。API 等价成本仅供参考，不是订阅账单。采用 [MIT 许可证](LICENSE)。

## 项目来源

项目起源于并参考了 [physcom/claude-usage-dashboard](https://github.com/physcom/claude-usage-dashboard)（版本 `f3473a3`），本地 HTTP 服务、线程安全缓存和启动器结构由其改编。Codex 日志解析、统计、计价、额度追踪和现有界面为后续独立实现。仓库已移除不使用的 Claude 看板源码、插件及旧演示资料；原有版权与许可声明保留在 [LICENSE](LICENSE) 中。
