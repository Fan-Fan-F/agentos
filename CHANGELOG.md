# Changelog

## 0.5.0-rc.1（2026-09-22）— 恢复、交接与可验证代码审查预览

- 代码审查展示逐文件真实补丁，支持中文及重命名；跟进意见保留已有草稿，二进制/超限/失败明确提示。
- Capsule JSON、Markdown 与 Context Compiler 保留重命名来源及必要上下文；修复往返交接、权限继承和误用旧 Session。
- 崩溃恢复保护未提交文件，支持首次运行中断、follow-up 崩溃后接力；损坏 Timeline 记录不再阻断有效历史。
- 服务加固：单数据目录实例锁、本地 HTTP/WebSocket 来源校验、参数白名单、存储 ID 与 worktree 归属校验；已取消请求不再启动子进程。
- 修复实时 Timeline、过期页面响应和任务状态刷新；Git 差异读取失败不再冒充零变更。
- 同步应用、工作区包、锁文件和界面版本；私有迭代指令及本机路径不进入发布内容。
- 本地证据：164 项测试通过，1 项 POSIX 专用测试在 Windows 跳过；真实 Windows 进程/Git 恢复和局部浏览器验收通过。云端结果以当前提交的 Actions 为准。
- 限制：真实模型接力成功尚未验证；孤儿 Agent 协调、长 Timeline/大仓库性能及历史测试证据连续性仍需改进。此版本为预览，未合入稳定 main。

## 0.4.0（2026-09-20）— 统一权限档位（ADR-010）

- **Permission Profile**：safe / developer / full 三档 → 各家原生 flag 映射（映射表见 COMPATIBILITY.md），
  Runner/API/UI 全链贯通；`full` 档与 bypass flag 同受 `AGENTOS_ALLOW_BYPASS=1` 门禁（默认 400，UI 禁用）。
- 设置面板新增"默认权限档"；任务详情页一键切换档位；real-e2e 改用 developer 档（真实验证映射 flag）。
- 测试 77 项（新增映射表/优先级/未知 agent 不猜 flag/server 门禁/stub 收到映射 flags 断言）。

## 0.3.0（2026-09-18）— 桌面体验全面翻新（全流程审计）

### 桌面端
- **双击即用**：`AgentOS.bat`（Windows）/ `AgentOS.command`（macOS）→ 首次自动构建 → 启动服务 → 以 Edge/Chrome **App 模式独立窗口**打开（无边框无地址栏，原生应用观感）；`npm run desktop` 等价；`node scripts/setup.mjs` 一键安装+构建+只读体检（ADR-009）。
- **UI 全面翻新（ChatGPT/OpenAI 风格设计系统）**：平面卡片 + 细分隔线 + 翡翠强调色；浅色/深色/跟随系统主题（服务端持久化）；侧栏含最近任务；顶栏上下文操作；**首次使用三步向导**（本地优先理念 → 只读扫描 Agent → 三步上手指引）；全部空态有引导；设置面板（主题/默认 Agent/版本/数据目录）。
- 经浏览器实测逐屏截图验证（向导/任务/Agents 三视图）。

### 全流程补齐（下载→首用→长期使用）
- `GET /api/meta`：版本/平台/数据目录（设置面板展示）。
- `GET/PUT /api/settings`：主题、默认 Agent 偏好持久化在数据目录（换浏览器不丢）。
- `DELETE /api/tasks/:id`：任务删除 = 清理 worktree + 移除任务数据（分支与提交保留），UI 有确认弹窗；长期使用的数据管理闭环。
- 时间线事件渲染升级：彩色事件点、相对时间、成本徽标（claude 的 costUsd 直接可见）。
- 任务创建支持直接粘贴仓库路径（不再强制先登记项目）；Ctrl+Enter 提交；全部输入框支持 Enter。

### 测试
- 61 项（新增 meta/settings/delete 路由 + runner.deleteTask worktree 清理断言）。

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
