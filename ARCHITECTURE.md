# AgentOS 架构（M1）

## 设计原则

1. **协议中立**：ACP（Client↔Agent）、A2A（Agent↔Agent）、MCP（Agent↔Tools）都是被封装在抽象之下的实现，不是地基。
2. **本地优先**：源码/数据/凭据全部留在本机；agent 用用户已装的、用户自己登录的原厂 CLI。
3. **无头优先**（ADR-003）：闭环先用各 CLI 的 headless JSON 流；PTY 交互后置。
4. **可观测**：一切进入统一 Timeline（JSONL），指标必须有用。
5. **Windows 一等公民**：零 tmux 依赖、零原生依赖（MVP）、路径处理全程 node:path。

## 分层

```
┌────────────────────────────────────────────────────────────┐
│ apps/web            零构建静态 SPA（任务/时间线/换人/Fork）    │
├────────────────────────────────────────────────────────────┤
│ @agentos/server     Fastify REST + WebSocket 推送            │
├────────────────────────────────────────────────────────────┤
│ @agentos/agents     Discovery / Installer / AgentAdapter      │
│                     ├─ CliHeadlessAdapter(Claude/Codex/     │
│                     │   Gemini/OpenCode, JSONL 解析)        │
│                     ├─ StubAdapter（契约测试/无 agent 演示）  │
│                     ├─ AcpAdapter（骨架，M3 用官方 TS SDK）   │
│                     ├─ Handoff（capsule→context→接管→七问）  │
│                     └─ TaskRunner（solo/swap/forkAll/ask/    │
│                         recover）                            │
├────────────────────────────────────────────────────────────┤
│ @agentos/core       Capsule(zod v1) / ContextCompiler        │
│                     GitEngine(worktree/checkpoint/diff)      │
│                     EventLog(JSONL+订阅) / Store(原子写)      │
│                     ProjectMemory / Router / Bus            │
├────────────────────────────────────────────────────────────┤
│ 本机 agent CLI      claude / codex / gemini / opencode       │
│ （用户已装、用户自登录；AgentOS 只 spawn headless 进程）        │
└────────────────────────────────────────────────────────────┘
```

## 关键数据流

### 1) Solo 运行
`POST /tasks/:id/run` → TaskRunner: GitEngine.createWorktree（`agentos/<taskId>/<agentId>`，位于仓库外兄弟目录，ADR-007）→ Adapter.run(prompt) → stdout JSONL 归一化为 AgentEvent → EventLog 落盘 + WS 推送 → 进程退出后：GitEngine 采集 diff/commits → buildCapsule → Store 保存（.json + .md）。

### 2) Hot Swap（任意→任意）
最新 Capsule → ContextCompiler.standard（预算裁剪）→ GitEngine.createWorktree(**基于源 agent 分支**，改动随分支带走) → 写入 `.agentos/HANDOFF.md` → 目标 Adapter.run(handoffPrompt=前言+上下文+交接指令) → 七问验证探针 → 回答入 Timeline → 新 Capsule（`origin.resumedFromCapsuleId` 链接）。
若目标 agent 支持 resume 且原生会话存在（同 agent 续接），优先走原生 resume（adapter.resume()）。

### 3) Session Fork
同一 base commit 为每个 agent 建 worktree + 分支 → 相同 objective + 相同 capsule 并行运行 → 各自结果（solution/diff/tests/时长）汇总为对比报告 → 用户选择/评审/合并（M1 提供汇总与 diff，合并走用户本地 git 流程）。

### 4) Agent 间提问（ask）
`POST /tasks/:id/ask {toAgentId, question}` → Compiler.minimal(capsule) + question → 目标 Adapter.run（只读预期）→ `agent.asked` / `agent.replied` 入 Timeline → 回复返回给调用方（UI 中即 `@codex review ...` 的 M1 形态）。

## 存储布局（`AGENTOS_HOME`，默认 `~/.agentos`，测试全部指向临时目录）

```
$AGENTOS_HOME
├─ projects.json
└─ tasks/<taskId>/
   ├─ task.json          # 任务元数据（status: created/running/interrupted/done/failed）
   ├─ events.jsonl       # 统一 Timeline（追加写）
   ├─ sessions.json      # 每次运行的记录（agent、分支、worktree、capsuleId、退出码）
   └─ capsules/<id>.json(+.md)
```

## 事件归一化

所有 adapter 的输出统一为 `AgentEvent`：`{ agentId, ts, type: system|message|tool_call|tool_result|error|result, data }`。
- Claude：`system/init`(session_id)、`assistant`、`result`（docs/research/04-agent-clis.md §1）
- Codex：`thread.started`(thread_id)、`item.completed(agent_message|command_execution|file_change...)`、`turn.completed/failed`
- Gemini/OpenCode：文本或 JSON 结果兜底管线
解析必须容错：未知行忽略、缺字段容忍、私有 schema 漂移不崩溃。

## 权限与安全边界（摘要，详见 SECURITY.md）

- Discovery 只读（ADR-006）；版本探测/安装显式触发。
- Adapter 默认不带任何 bypass 类 flag；AgentOS Permission Profile → 各家 flag 映射表在 M3 落地（Claude `--permission-mode/--allowedTools` ↔ Codex `--sandbox/--approval-policy` ↔ Gemini `--approval-mode`）。
- 凭据零接触：只 stat 标记文件存在性。

## 后续演进位（已预留接口，未实现）

- AcpAdapter：`AgentAdapter` 同一接口，用官方 `@zed-industries/agent-client-protocol` 实现（session/update 流、request_permission 映射权限策略、session/load 映射恢复）。
- MCP Hub：本地聚合器 + 为各 agent 生成指向 Hub 的配置条目（写配置前必须展示 diff 并确认）。
- Workflow Canvas：TaskRunner 之上加编排器（sequence/parallel/condition/retry/human approval）。
- Agent Teams / Router 策略扩展：Router 已按能力评分，策略可插拔。
