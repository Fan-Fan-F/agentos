# 研究：竞品与编排器格局（2026-09）

> 调研日期：2026-09-18。AgentOS 研究笔记。许可证一栏直接影响"能借鉴什么"（见 COMPATIBILITY.md）。

## 主要竞品

### Vibe Kanban（BloopAI）
- 定位：看板式编排 coding agent。GitHub: https://github.com/BloopAI/vibe-kanban ；官网 https://vibekanban.com 。
- 架构：Rust 后端 + React/TS 前端；"executor" 抽象承载 Claude Code / Codex / Gemini CLI / Amp / OpenCode 等；每个任务在**隔离 git worktree** 中执行；提供 review/merge 流程；内置 MCP server 允许让 Claude 操控看板。
- 借鉴：executor 抽象、worktree 隔离、任务生命周期。局限：**不做跨 agent 会话交接**（任务换 executor = 从头来）；不做 agent 间请求-响应协作。

### Claude Squad（smtg-ai）
- Go TUI；tmux session + git worktree 管理 claude code / aider 等；**AGPL-3.0**（许可证风险：只可借鉴思想，禁止复制代码）；依赖 tmux → **Windows 原生支持差**。

### CCManager
- Go TUI（~1.2k★，MIT），tmux 会话管理器，支持 Claude Code / Gemini CLI / Codex / Cursor Agent / Copilot CLI。同为 tmux 路线，Windows 弱。

### ccmux / muxtree / Zentty
- tmux 系变体；ccmux（epilande）亮点：**在 agent 之间"hand work"**（https://github.com/epilande/ccmux）——说明 handoff 是已被验证的真实需求；Zentty 主打无 tmux 依赖。

### Conductor（conductor.build / Microsoft Conductor）
- conductor.build：Mac 图形界面并行跑 Claude Code + worktree（Mac-only）。
- Microsoft Conductor：MIT，YAML 工作流的确定性多 agent 编排 CLI —— 与 AgentOS Workflow Canvas 思路相近。

### OpenHands（All-Hands-AI）
- 完整自治平台：event stream 架构、sandbox 执行、多 agent。重（Docker/沙箱），不聚焦"用户已装的各家 CLI 复用"。

### 其他
- claudia（getAsterisk）：Tauri 的 Claude Code GUI（单 agent 视角）。
- claude-flow（ruvnet）：Claude swarms 编排。
- omnara：多 agent 监控/操控。
- Anthropic 官方 **Claude Code Agent Teams**：team-lead 协调多个 Claude 实例 —— 单厂商内闭环，跨厂商不适用。
- 汇总清单参考：https://github.com/andyrewlee/awesome-agent-orchestrators 、augmentcode "9 open-source agent orchestrators"、addyosmani "The Code Agent Orchestra"、nimbalyst "Best Git Worktree Tools for AI Coding 2026"。

### Continuum
- 多次检索未定位到明确对应的"AI coding agent 管理器"项目【未验证】。不作为依赖参考。

## 格局总结与 AgentOS 机会点

1. 现有工具 = "并行会话管理器"（tmux/worktree + TUI/GUI），共同短板：**会话不可移植**（换 agent 丢上下文）、**agent 间无结构化协作**、Windows 二等公民（tmux 依赖）。
2. 2026 年出现了单点 handoff 工具（authsec.ai CLI、`npx continues`、GitHub topic `context-transfer`），验证需求但都只是"一次性导出"，没有平台化的 capsule/编译/worktree/时间线闭环（见 05-session-portability.md）。
3. AgentOS 差异化 = 互操作平台：Capsule + Context Compiler + 任意→任意接管 + agent 间请求-响应 + 统一权限/时间线 + Windows 一等公民（无 tmux 依赖，headless 子进程优先）。
