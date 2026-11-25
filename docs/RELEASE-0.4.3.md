# Quota Glass 0.4.3

- 统计 `sessions` 和 `archived_sessions` 中的普通 JSONL 与 Zstandard 压缩日志。同一 rollout 的普通、压缩或归档副本只计一次。
- 默认本机 Codex 目录下，热力图可用 CC Switch 的 Codex 每日汇总补齐缺少 Token 记录的日期。点击补录日期可查看来源。账户额度、会话、项目、模型和本地累计仍按各自原始数据计算。
- 在设置的「外观与刷新」中新增「账户额度刷新」。支持 5 秒、10 秒、30 秒和 1 分钟，默认 5 秒。一次查询同时更新 5 小时和每周额度，保存后立即切换刷新间隔。

Windows 64 位用户可运行 `QuotaGlass-Setup-0.4.3-x64.exe`。如果旧版正在运行，请先从系统托盘退出再安装。
