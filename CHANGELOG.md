# Changelog

## 0.2.0（2026-09-18）— 跨平台加固 + 会话接管闭环

### 破坏性修复
- **Windows 进程启动**：npm `.cmd` shim 在 Node ≥20.12 直接 spawn 抛 EINVAL（CVE-2024-27980）。新增 launcher 解析层：npm 全局包真实入口（原生 .exe 直接执行 / JS 经 node 启动），实测 claude→`claude.exe`、codex→`node codex.js`。
- **长提示词通道**：claude/codex/opencode 提示词改走 stdin（官方模式），gemini 长提示词走 `.agentos/PROMPT.md` + `@file` 引用；绕开 Windows 命令行长度上限与转义问题。`codex exec` 场景 stdin 一律关闭（防官方已知挂起）。

### 新增
- **会话导入器（只读）**：把裸 Claude Code / Codex CLI 的磁盘会话（`~/.claude/projects`、`~/.codex/sessions`）转换为 Capsule → 创建任务 → 任意 agent 接管历史工作。API：`GET /api/imports/{claude|codex}`、`POST /api/imports/save`；`POST /api/tasks` 支持 `capsuleId`。
- **followUp 同会话跟进**：向最近运行的 agent 发送新指令，优先原生 resume（vibe-kanban 验证过的高频需求）。`POST /api/tasks/:id/followup` + UI 按钮。
- **CI 三平台矩阵**：windows/ubuntu/macos build+test+doctor 冒烟（`.github/workflows/ci.yml`）。

### 加固
- ACP 客户端：agent→client 请求默认应答（`session/request_permission` 一律拒绝 cancel，其余 -32601），杜绝 agent 干等挂死；通知监听改实例级。
- Runner：同一任务的 run/swap/fork/followup 增加进程内并发守卫。
- API 安全面：权限参数黑名单（`AGENTOS_ALLOW_BYPASS=1` 才可解锁）；install 执行路由补错误处理。
- EventLog 追加串行化（fork 并行时 JSONL 不交错）；JsonStore 跳过损坏记录（崩溃韧性）。

### 测试
- 60 项（新增：导入器 fixture、followUp、并发守卫、ACP 防挂死、Store 容错、API 安全面/imports 路由）。

## 0.1.0（2026-09-18）— M1 最小闭环

- 研究（ACP/A2A/MCP、竞品、CLI 能力、可移植性）+ ADR-001..008
- core：Capsule v1 / ContextCompiler / GitEngine / EventLog / Store / Router / Bus
- agents：只读 Discovery / 安装计划 / 四家 CLI 无头适配器 / 七问 Handoff / TaskRunner（solo/swap/fork/ask/recover）
- server（Fastify + WS）+ 零构建 Web UI；CLI：doctor/serve/capsule；e2e 交接脚本
