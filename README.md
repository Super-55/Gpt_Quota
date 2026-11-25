# Quota Glass

当前版本 **0.4.3** 支持压缩及归档日志、CC Switch 历史热力图补录，以及可调的账户额度刷新间隔。详见 [0.4.3 更新说明](docs/RELEASE-0.4.3.md)。

根据 MyCodex 参考图片设计的本地 Codex 用量桌面工具。详细设计见 [docs/DESIGN.md](docs/DESIGN.md)，模型与额度设计见 [docs/DESIGN-0.3.md](docs/DESIGN-0.3.md)，窗口与外观修复见 [docs/DESIGN-0.4.md](docs/DESIGN-0.4.md)。

## 启动

从 [GitHub Releases](https://github.com/Super-55/Gpt_Quota/releases) 获取 Windows x64 安装包。运行环境已随包提供。升级时先从托盘退出旧版。

实时额度需要接收者已安装并登录自己的 Codex CLI，且终端可以执行 `codex`。没有 CLI 时仍可读取本机日志或使用演示模式。安装包不含个人日志、设置或登录凭据。

**仅源码开发需要** Node.js 22.13+ 和 npm。首次运行：

```powershell
npm install --cache .cache/npm
npm start
```

桌面默认读取本机 `CODEX_HOME/sessions`，否则读取用户目录下 `.codex/sessions`。可在设置切换演示模式或选择其他 sessions 目录。**不会修改 Codex 原始日志，不读取认证文件，不触发模型请求。**

浏览器演示（不能连接本地日志）：

```powershell
npm run dev
```

桌面开发可在另一个终端设置 `$env:QUOTA_DEV_URL='http://127.0.0.1:5173'` 后运行 `npm run desktop`。

## 验证与构建

```powershell
npm test
npm run build
npm run test:ui
npm run pack
npm run pack:installer
```

Windows 免安装程序输出到 `release`。关闭主窗口会保留托盘，从托盘菜单退出应用。

安装器构建输出为 `release/installer/QuotaGlass-Setup-0.4.3-x64.exe`。应用在当前 Windows 用户目录保存设置和统计缓存。

`npm test` 覆盖日志读取、历史补录、额度轮询和设置迁移。`node scripts/installer-smoke.mjs` 可验证从实际安装包提取的应用及首次使用流程。Windows 安装包目前未进行代码签名。

## 统计口径

- 总量仅为本机已读取日志的 Token，不等于全账户用量或账单。输入 Token 包含缓存输入；推理输出不重复累加。
- 今日按本机时区；近 7 日含今天；自然周从周一开始。热力图缺少覆盖的日期显示未知。
- 桌面本地模式默认每 5 秒自动只读查询账户额度。设置支持 5 秒、10 秒、30 秒和 1 分钟。本地额度快照会显示来源和时间。
- 5 小时额度只匹配账户提供的 300 分钟窗口，缺少时显示未知；到期等待账户新结果，不自动回满。
- 模型用量按每轮日志归属，缺少字段归入未知模型；同一会话使用多个模型时分别计入各自会话数。
- Skill 显示可识别的 `SKILL.md` 文档加载次数，不代表成功执行；工具不提供伪精确 Token 费用。
- 多机器、已删除日志、未记录的压缩调用、未标明继承关系的分叉可能导致本地覆盖不完整。读取起点以前的首次累计值只能归入记录首次出现的日期。
- JSON 导出包含项目路径、会话 ID 和统计；分享前请自行检查路径信息。不会包含对话正文或认证信息。

## 技能

按用户要求使用 find-skills 工作流，核验并安装了 Anthropic 的 frontend-design 技能辅助界面设计，参考图优先。
