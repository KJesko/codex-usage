# 开发与维护

[返回 README](../README.md) · 简体中文 | [English](DEVELOPMENT.en.md)

[开发与测试](#开发与测试) · [演示维护](#维护在线演示) · [翻译](#英文翻译) · [桌面构建](#windows-桌面构建) · [文档打包](#文档与打包) · [许可证](#来源与许可证)

使用者从 [README](../README.md) 开始；安装参数与后台配置见[安装与配置](SETUP.md)。提交规则见[贡献指南](../CONTRIBUTING.md)，安全报告见 [SECURITY](../SECURITY.md)。

## 开发与测试

后端使用 Python 标准库和 `tzdata`，前端为 HTML / CSS / JavaScript，无需 npm 依赖安装或打包。前端检查建议使用 Node.js 20+。

```sh
# 在已激活、已安装 requirements.txt 的虚拟环境中执行
python -m unittest discover -s tests -v
npm run check
npm test
npm run test:demo
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

欢迎通过 [Issues](https://github.com/KJesko/codex-usage/issues) 报告问题或提交 Pull Request。复现信息和测试数据请先脱敏，具体流程见 [贡献指南](../CONTRIBUTING.md)。

### 维护在线演示

```sh
python scripts/build-demo.py
node --test tests/test_demo.cjs
python -m http.server 8791 --bind 127.0.0.1 --directory dist
```

打开 <http://127.0.0.1:8791/demo/>。构建只复制明确列出的前端文件和价格快照，不启动 Python 应用，也不读取任何用户日志或配置。模拟数据与浏览器适配代码位于 `demo/`，生成目录 `dist/demo/` 不提交到 Git。

`npm run test:demo` 会核对 72 组筛选组合及四种 CSV，覆盖原始事件合计、日 / 周 / 月分桶、会话搜索排序、未定价与自定义价格、跨时区和夏令时、未来日期及额度重置。`npm test` 检查共享前端的图表与导航行为。

推送到 `main` 后，[Pages 工作流](../.github/workflows/pages.yml) 自动构建、验证并部署。Fork 后如需自行发布，请在仓库 Settings → Pages 中选择 GitHub Actions，并更新 README 和演示页中的项目链接。

## 英文翻译

英文文案集中维护在 `src/codex_usage/locales/en.json`。`web_i18n.py` 为受信任的界面资源生成英文版本，仅翻译 API 中应用自身的提示字段。新增中文界面文案应同时添加英文条目；覆盖测试会检查遗漏和英文脚本语法，不改写用户标题、路径或模型标识。

## Windows 桌面构建

这是单独的构建方式；v1.2.0 网页版发布不提供新的桌面可执行文件。

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

## 文档与打包

README 只保留介绍、下载、启动和文档入口。安装/连接/后台问题放入 `docs/SETUP.md`，Agent 提示词放入 `docs/AGENT_SETUP.md`，功能/统计/隐私说明放入 `docs/USER_GUIDE.md`；开发资料集中在本文。对应 `.en.md` 同步维护，链接与图片相对于当前文档目录。

源码包的 `pyproject.toml` include 列表应包含 `docs/`、根目录指南及引用资源，使离线阅读不会丢失链接。在线演示只发布允许的合成数据和前端资产，不复制个人资料。旧版发布验证记录见 [RELEASE_CHECKLIST](../RELEASE_CHECKLIST.md)。

## 来源与许可证

本项目基于 [physcom/claude-usage-dashboard](https://github.com/physcom/claude-usage-dashboard) 的 `f3473a332123e810363bdcc43dd991a5c7c2cb1f` 定制，保留上游 Git 历史和版权声明。本地 HTTP 服务、线程安全缓存及启动器结构来自上游；Codex 日志解析、统计、计价和中文界面为后续实现。

`src/claude_usage_dashboard`、`.claude-plugin`、`commands/` 和 `docs/demo.svg` 为保留的上游代码或资料，不属于当前 Codex 看板的运行入口，也不代表当前界面或支持的安装方式。

采用 [MIT 许可证](../LICENSE)，来源及第三方说明见 [NOTICE](../NOTICE)。
