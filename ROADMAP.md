# ROADMAP

## 当前产品决策（2026-09-22）

优先级：进程与恢复安全 → 跨 Agent 上下文/验证证据 → 真实 CLI 闭环 → 审查与长历史性能。对标依据及验收条件见 [竞品升级决策](docs/research/07-competitive-upgrade-2026-09-22.md)。

本轮已实现逐文件真实补丁审查、重命名来源贯通、文件反馈入口和读取边界；局部浏览器验收见 [记录](docs/dogfood/2026-09-22-code-review.md)。真实模型成功 E2E 和云端 CI 尚未通过；下面 M3–M5 是候选方向，不是必须堆齐的功能清单。

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
- 🟡 真实 agent 端到端验证：`scripts/real-e2e.mjs` 已真实执行：引擎半程（Capsule 链/HANDOFF/时间线/诊断/探针跳过）真实验证通过；agent 半程被用户侧问题阻塞（claude 402 需充值、codex 需升级，见 docs/blockers.md），解除后仍需按实际产物与测试结果重新验收
- 🟡 AcpAdapter：接口位已留，实现列为 M3

## M2 — 深化（进行中）
- ✅ 会话导入器：读取 ~/.claude/projects、~/.codex/sessions 既有会话（只读、容错）→ Capsule → 创建接管任务
- ✅ followUp 同会话跟进（原生 resume 优先）
- ✅ Windows 进程启动加固（launcher 解析，规避 CVE-2024-27980 .cmd EINVAL）
- ✅ 长提示词通道（stdin / gemini @file），规避命令行长度与上游 stdin 重复 bug
- 🟡 CI 三平台矩阵配置已编写（windows/ubuntu/macos），尚未推送或实际运行云端验证
- ✅ API 安全面：权限参数允许清单、loopback/Origin 校验、数据目录实例锁（均有本地回归）
- ✅ 桌面体验：双击启动器 + App 模式窗口 + ChatGPT 风格 UI 全面翻新 + 首次使用向导 + 设置持久化 + 任务删除（ADR-009）
- ⬜ Tauri 2 原生壳（cargo 已确认可用；系统托盘/自动更新/文件对话框）
- ⬜ SQLite（node:sqlite）存储后端（Store 接口不变）
- ⬜ Codex/Gemini 真实接入的兼容性矩阵实测（COMPATIBILITY.md 更新）
- ⬜ worktree setup 钩子（每任务初始化命令：装依赖等）
- ✅ Permission Profile 三档 → 各家 flag 映射（ADR-010；safe/developer/full + BYPASS 门禁）

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
