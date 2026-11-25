# Quota Glass — 详细设计与验收方案

版本：1.0 · 2026-10-23 · Windows 优先，保留 macOS 兼容结构。

## 1. 产品目标与证据边界

根据用户提供的四张 MyCodex 照片，复刻一个本地 Codex 用量分析桌面工具，工作名 Quota Glass。保留玻璃材质、粉色图表、四项概览、双列趋势、Skill/工具排行、紧凑面板。使用自己的名称和绘制的图标。

照片可确认：7 天剩余额度；今日/近 7 天/累计 Token；未缓存/缓存/输出分类；半年/90 天热力图；7 天折线；今日累计与历史均值对照；额度时间节奏；今日/自然周目标；Skill 和工具排行；设置、刷新、主窗口入口。

补充设计：今日任务页具体内容、项目排行字段、详情抽屉、首次连接、空态/错误态、设置页、演示模式。上述均不宣称是原软件行为。照片中的续费日期不能从日志推断，本版仅提供手动日期配置。

## 2. 本次交付范围

交付可运行 Electron 桌面应用及浏览器演示入口；主窗口、独立紧凑窗口、托盘、四个标签页、设置、详情、真实本地会话解析、历史额度快照、手动刷新和定时增量刷新、SQLite 缓存、JSON 统计导出、Windows 免安装包构建配置。

账户额度：优先支持主动读取 Codex app-server 的只读 account/rateLimits/read；不可用时显示本地日志最近快照及其时间，不把旧值包装为实时值。账户级 account/usage/read 作为后续独立口径，不混入本地合计。本次不执行任何模型回合、不消耗重置券、不读写认证文件。

不提供无法准确证明的工具/Skill 实际 Token 账单。工具仅统计调用次数；Skill 统计可识别的文档读取次数，明确是“加载记录”，不等同成功执行。没有证据时保留空态。

## 3. 信息架构与交互

### 3.1 主窗口

默认 1180×850，最小 940×700。顶栏：品牌、当前数据来源、最近同步、打开紧凑面板、导出、刷新、设置。Windows 使用系统标题栏，避免伪装 macOS 系统按钮。

概览四列：7 天额度剩余（不可用则 —；展示重置时刻/快照时效）；今日 Token；近 7 个自然日 Token；本地累计 Token。后三项有未缓存、缓存、输出明细。总量标明本机日志覆盖，不声称全账户累计。没有 7 天额度窗口时显示实际可用窗口；禁止将 primary/secondary 固定映射为小时/周。

标签区：今日任务、用量趋势（默认）、项目排行、Skill。右侧日期/覆盖会话数。

用量趋势页：半年热力图（周列、周一至周日行、缺失与零值区别、悬停日期/量）；近 7 日折线（合计、日均）；今日 24 小时累计曲线与此前 7 个完整自然日同期累计均值；额度节奏（窗口时间进度/额度已用，快照过期提示）；可编辑目标。

今日任务页：今日有活动的会话列表，展示项目、最后活动时间、今日 Token、工具调用数。只显示“本地记录”，不用历史日志推断正在运行或已完成。点击会话进入统计详情。

项目排行：工作目录标准化后按项目路径聚合，展示本地总量、会话数、缓存命中率、最近活动。默认不跨 worktree 猜测同一项目，避免错误合并。详情可追溯会话。

Skill 页：左列可识别的 Skill 文档加载 TOP20，右列工具调用 TOP20。展示次数、关联会话数、最近活动，点击展开统计依据。可排序次数/会话数。Skill 的 Token 归因不实现，显示解释。

### 3.2 紧凑面板

窗口 440×680：额度环+今日累计迷你图；今日/自然周目标；90 天热力图；底部设置/主窗口/隐藏按钮。默认不置顶，可在设置切换；托盘点击切换紧凑窗口。关闭主窗口隐藏至托盘；托盘“退出”真正退出并清理定时器和子进程。

### 3.3 设置

数据来源：本机 Codex / 演示（显式标签，默认桌面本机、浏览器演示）。本机默认目录 CODEX_HOME/sessions，否则用户目录 .codex/sessions；选择目录通过原生对话框。设置持久化至 Electron userData。

外观：玫瑰玻璃/石墨玻璃；背景不透明度；减少动画跟随系统。数据：刷新间隔 30/60/300 秒；时区使用系统本地时区，本版不开放任意时区以避免错误跨日聚合。目标：每日/自然周原始 Token 数。其他：紧凑窗口置顶、手动续费日期。

### 3.4 状态和反馈

扫描/刷新中禁止重复提交；保留旧数据并显示同步状态。目录不存在、解析警告、账户接口不支持/未登录分别显示可理解的信息。空数组不是全账户零使用；统计覆盖开始日可见。刷新失败保留上次结果和时间。详情及设置支持 Escape、键盘焦点、可访问名称。浏览器不提供本地文件伪连接。

## 4. 视觉系统

背景：深酒红/石墨的柔和光斑，模拟照片环境但不复制红色链条壁纸。桌面材质能用原生模糊则启用，不支持则使用稳定的半透明纯色。

颜色：底色 #21151e；表面 rgba(255,255,255,.055)；边框 rgba(255,230,244,.14)；主文 #fff2f8；次文 #c8abbc；强调 #f5a4cc；热力图 5 阶粉色；输入蓝色、缓存粉色、输出琥珀色。字体 Segoe UI / Microsoft YaHei / system-ui；数字 tabular-nums。

间距 4/8/12/16/24/32；窗口圆角 24，卡片 18，按钮 10。主指标 30–34 px，卡片标题 13 px，正文 13 px，辅助 11–12 px。图表不使用大面积网格，所有数据点具备 tooltip/title。细微进入动效 180 ms，不做循环闪烁。

布局 1100 px 以上两列；窄屏指标两列、图表单列；紧凑模式独立布局。页面允许纵向滚动，不裁切榜单。

## 5. 技术架构

Electron 主进程（ESM）管理 BrowserWindow、Tray、原生文件选择、只读采集、SQLite、IPC。contextIsolation=true、nodeIntegration=false、sandbox=true；preload 只暴露固定方法；禁止渲染进程任意读文件/执行命令；IPC 校验设置与枚举值；新窗口/外部导航默认阻止。

React + TypeScript + Vite 渲染；轻量自绘 SVG 图表，HTML/CSS 热力图，lucide-react 图标。不引入可视化大包。共享类型定义，renderer 通过 window.quota 访问 API；浏览器适配器只返回可复现的演示数据。

主进程模块：collector.mjs（目录扫描、增量解析）；analytics.mjs（纯聚合函数）；store.mjs（SQLite 及设置）；account.mjs（可选 app-server 读取）；main.mjs（生命周期和 IPC）；preload.cjs（桥接）。业务聚合与 Electron 分离，Node 原生 test 可独立验证。

SQLite 使用 Electron 对应 Node 的 node:sqlite，避免原生三方编译。安装后先验证可用性；若运行时不支持则应调整固定 Electron 版本，禁止静默丢失持久化。

## 6. 采集与统计规则

### 6.1 输入记录

只递归读取 sessions 目录下 .jsonl 文件，不读取 auth.json。兼容 session_meta、turn_context、event_msg/token_count、response_item/function_call 及 custom_tool_call。时间采用事件时间戳，非法记录计警告。目录遍历不跟随符号链接。

每文件缓存 byte offset、尾部未完成行、文件身份信息及已聚合事件。首次扫描全量，以后仅追加；文件缩短/替换则重建该文件索引；半行待后续补齐，不将正在写入文件报告为损坏。避免单文件异常中断全量。

### 6.2 Token

累计 total_token_usage 以会话/文件计数段计算差值，重复累计快照增量为零；首次可用累计值按事件时间计入并标记历史起点可能不完整。计数下降开启新段并加诊断，不能把负数作为消耗。last_token_usage 不反复累加。仅当没有累计计数时不猜测相邻快照是否同一回合，跳过并告知覆盖不足。

输入包含缓存输入：uncached=max(0,input-cached)，total=input+output；reasoning_output_tokens 不额外加到 output。缓存超出输入时限制到输入并计警告。工具调用自身不新增模型 Token。模型事件 token_count 的 total_tokens 仅用于一致性诊断。

会话分叉存在继承计数风险。显式 forked_from_id / parent_thread_id 的日志首次累计仅作基线，后续差值计入；子代理父子关系不自动视为分叉。未声明的继承无法完美消除，覆盖说明保留该限制。

### 6.3 时间

今日按系统本地 00:00 至现在；近 7 日包含今天和此前 6 日；自然周从周一 00:00 开始；日均=近 7 日/7。今日对照使用此前 7 个完整自然日，缺失历史不当作已确认零值，展示实际有效天数。半年热力图固定 182 个日期，90 日为 90 日期；未来格留空；累计是已读取本地日志总量。

目标 percentage=原始用量/原始目标×100，显示可超过 100%，进度条宽度上限 100%。目标为零/非法时拒绝保存。变化率基线为零时显示 —。

### 6.4 工具、Skill 与额度

工具按会话+call_id 去重；无 ID 时按文件+行位置；function_call 和 custom_tool_call 分别兼容。Skill 只在明确读文件命令中识别 SKILL.md 路径，名称取其父目录；显示为“文档加载记录”，不扫描任意对话提及；保守识别可能漏记但不伪造执行次数。函数工具名不用于推导 Token 费用。

额度读取 primary/secondary 的 window_minutes 或 windowDurationMins；used_percent 或 usedPercent；resets_at 或 resetsAt。根据真实窗口长度选择 7 天窗口。缺失/null 是未知；数值限制 0–100；相同 bucket 的最新时间戳优先；快照超过 10 分钟标为历史。仅具有 reset 与 window 时计算时间进度。

主动读取：固定 codex app-server 命令，JSON-RPC initialize → initialized → account/rateLimits/read；超时 15 秒；不传入模型回合；返回后终止自身子进程；进程不可用、方法不存在时降级快照。将命令启动/认证失败作为状态，不弹出授权登录。

## 7. 数据模型与 IPC

SQLite tables：file_cache(path PRIMARY KEY, signature, offset, carry, state_json)；settings(id=1,json)；metadata(key,value)。file state 保存 Token 增量、调用和额度必要字段，不保存用户消息与工具正文。聚合基于缓存，可随时重新扫描重建。

Dashboard：source、coverage、updatedAt、diagnostics、quota、summary(today/week/recent7/lifetime)、days、hourly、sessions、projects、skills、tools、settings。所有 Token 原始整数，展示层格式化 K/M/B。

IPC allowlist：dashboard:get、data:refresh、settings:save、directory:choose、window:compact、window:main、window:hideCompact、window:pin、data:export、account:refresh。浏览器返回明确 unsupported，不尝试调用本地端点。

## 8. 执行顺序

1. 固化本设计、建立项目与运行脚本。
2. 开发纯统计、增量采集与测试，使用脱敏合成 fixture。
3. 实现四页主窗口、紧凑视图、设置与数据详情。
4. Electron 集成托盘、SQLite、只读账户接口及实际本机扫描。
5. 构建、数据正确性测试、交互与视觉验收，生成 Windows 免安装包。
6. 由 GPT-6 Astra 独立验收，修复阻塞项，再交付运行入口、方案和验收结果。

## 9. 验收标准

- 四个标签、刷新、模式切换、设置持久化、详情、导出均可操作；无未说明的假按钮。
- 演示始终显式标记；本机数据不可用时保持空态，不自动掺入演示值。
- 合成测试覆盖重复累计、缓存输入、推理输出、计数重置、跨日/自然周、工具去重、分叉基线、非法/半行 JSON、增量文件变化、未知额度。
- 同一目录重复刷新不改变结果；追加事件增加对应增量；文件截断正确重建。
- 不触发模型请求；不输出消息正文、认证信息；渲染层无 Node 权限。
- 桌面应用可启动，主窗口/紧凑窗可切换，退出清理资源；浏览器可独立查看演示。
- 1180×850 主窗口和 440×680 紧凑面板可完整滚动；键盘可关闭模态；深色下文字与线条可辨。
- 提交测试、构建和独立审查结果，失败/未验证项如实列出，不以“代码写完”等同运行验收。

## 10. 来源

- 用户提供的四张截图：视觉及可见功能依据。
- https://developers.openai.com/codex/app-server/ ：只读额度与活动接口，具体以已安装版本为准。
- https://developers.openai.com/codex/pricing/ ：额度与 Token 不等价。
- https://skills.sh/anthropics/skills/frontend-design ：已核查来源、安装量及仓库声誉；辅助视觉实现，用户截图优先。
