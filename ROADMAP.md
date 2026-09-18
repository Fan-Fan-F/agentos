# ROADMAP

状态标记（诚实原则，禁止"假完成"）：
✅ Implemented = 真实运行且有测试覆盖；🟡 Partial = 部分可用；⬜ Not Implemented = 仅有接口位/未开始。

## M0 — 研究与地基（2026-09-18）✅
- ✅ 协议研究：ACP / A2A / MCP（docs/research/01-03）
- ✅ 竞品研究：vibe-kanban、claude-squad、CCManager、ccmux、Conductor、OpenHands 等（00）
- ✅ Agent CLI 能力研究：无头/会话/恢复/权限/MCP 精确事实（04）
- ✅ 会话可移植性先例 + 技术选型（05、06）
- ✅ ADR 001-008

## M1 — 最小真实闭环（当前里程碑）
- ✅ monorepo 脚手架（npm workspaces + TS + vitest）
- ✅ core：Capsule v1 / ContextCompiler / GitEngine / EventLog / Store / ProjectMemory / Router / Bus
- ✅ agents：Discovery（只读）/ Installer（dry-run 默认）/ Stub + Claude/Codex/Gemini/OpenCode headless 适配器（含 JSONL 解析与原生 resume 支持）
- ✅ Handoff：capsule → context → 分支接管 → HANDOFF.md → 七问验证
- ✅ TaskRunner：solo / swap / forkAll / ask / recover（崩溃恢复）
- ✅ server：Fastify REST + WS；零构建 Web UI（Minimal）
- ✅ 测试：unit / integration / adapter contract / handoff / recovery 全绿
- 🟡 真实 agent 端到端验证：提供 `scripts/e2e-handoff.mjs`；本开发环境遵用户指令**未执行**用户的 claude/codex（契约测试以 Stub 覆盖，解析器以真实 schema 样本单测覆盖 —— 不冒充"真实集成测试通过"）
- 🟡 AcpAdapter：接口位已留，实现列为 M3

## M2 — 深化（进行中）
- ✅ 会话导入器：读取 ~/.claude/projects、~/.codex/sessions 既有会话（只读、容错）→ Capsule → 创建接管任务
- ✅ followUp 同会话跟进（原生 resume 优先）
- ✅ Windows 进程启动加固（launcher 解析，规避 CVE-2024-27980 .cmd EINVAL）
- ✅ 长提示词通道（stdin / gemini @file），规避命令行长度与上游 stdin 重复 bug
- ✅ CI 三平台矩阵（windows/ubuntu/macos）
- ✅ API 安全面：权限参数黑名单
- ✅ 桌面体验：双击启动器 + App 模式窗口 + ChatGPT 风格 UI 全面翻新 + 首次使用向导 + 设置持久化 + 任务删除（ADR-009）
- ⬜ Tauri 2 原生壳（cargo 已确认可用；系统托盘/自动更新/文件对话框）
- ⬜ SQLite（node:sqlite）存储后端（Store 接口不变）
- ⬜ Codex/Gemini 真实接入的兼容性矩阵实测（COMPATIBILITY.md 更新）
- ⬜ worktree setup 钩子（每任务初始化命令：装依赖等）
- ⬜ Permission Profile → 各家 flag 映射（已有黑名单基线）

## M3 — 协议层
- ⬜ AcpAdapter（@zed-industries/agent-client-protocol；OpenCode/Gemini 优先）
- ⬜ 统一 MCP Hub（注册表 + 本地聚合器 + 配置注入需用户确认 diff）
- ⬜ Permission Broker 完整策略（Safe/Developer/Full/Custom → 各家映射）

## M4 — 编排与差异化
- ⬜ Workflow Canvas（sequence/parallel/fan-out/join/condition/retry/approval）
- ⬜ Agent Router 策略扩展（quota/成本/历史表现）
- ⬜ Agent Teams 预设（Software/Research/Bug Hunt）
- ⬜ React/Vite UI 迁移 + Diff 高亮 + Workflow 画布
- ⬜ Fork 后的组合合并（combine/cherry-pick 辅助）

## M5 — 分发与交互
- ⬜ Tauri 2 桌面壳（Node sidecar；Windows 一等）
- ⬜ 交互式 PTY 会话（@lydell/node-pty + xterm.js）
- ⬜ 安装中心一键安装（官方源，用户确认）
- ⬜ Dogfooding：用 AgentOS 自身组织后续开发并记录痛点

## 终局标准（项目完成的定义）
docs/research 之外的 E2E 闭环（README "端到端闭环"）在真实仓库、真实 agent 上完整跑通 —— 以此为准，不以文档为准。
