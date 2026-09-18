# 研究：Agent Client Protocol（ACP）

> 调研日期：2026-09-18。AgentOS 研究笔记，仅供设计参考；不复制任何上游代码。

## 定位

ACP 由 Zed 主导，是编辑器/客户端 ↔ AI coding agent 之间的开放协议，自称 "AI Coding 的 LSP"：
客户端（编辑器、编排器）把 agent 作为**子进程**拉起，双方通过 **stdio 上的 JSON-RPC 2.0（换行分隔 JSON）** 通信。

- 官方站点与 schema：https://agentclientprotocol.com
- 协议解析（第三方）：https://blog.marcnuri.com （"The LSP for AI Coding"）、https://www.philschmid.de （ACP Overview，2026-02）

## 核心模型（对 AgentOS 最重要的部分）

- **Client ↔ Agent 单向控制**：client 负责 UI/文件系统/终端等"用户环境"，agent 请求 client 代为执行（`fs/read_text_file`、`fs/write_text_file`、`terminal/create` 等反向调用）。
- 关键方法（schema 见官网）：
  - `initialize`：握手，交换协议版本与能力
  - `session/new`（cwd、mcpServers）→ `session/prompt`（content blocks）
  - `session/update`（agent→client 通知流）：`agent_message_chunk`、`tool_call`、`tool_call_update`、`plan` 等
  - `session/request_permission`：agent 向 client 请求许可，client 从 options 中选择 —— **统一权限层的天然挂点**
  - `session/load`：**会话恢复/加载已进 spec**，为跨进程 resume 提供了标准入口
- 传输：stdio（必选）；HTTP 变体在演进【未验证细节】。

## TypeScript SDK

- 包：`@zed-industries/agent-client-protocol`（npm，2025-10 起活跃），examples 目录同时含 Agent 与 Client 的最小实现（https://www.npmjs.com/package/@zed-industries/agent-client-protocol）。
- 用法（README）：client 侧 spawn agent 子进程 → 在 stdio 上运行 JSON-RPC 连接 → 处理 `session/update` 通知流；agent 侧实现对应 handler。
- 另有社区实现：Elixir `ACPex`（hexdocs.pm）、Vercel AI SDK 的 ACP community provider（https://ai-sdk.dev/providers/community-providers/acp ，声称支持 Claude Code / Gemini CLI / Codex CLI 等）。

## 2026-09 各 agent 的 ACP 支持现状

| Agent | 接入方式 | 状态 |
|---|---|---|
| Gemini CLI | `gemini --experimental-acp` | 官方文档在列，仍带 experimental 前缀（https://geminicli.com/docs/cli/acp-mode） |
| Claude Code | `claude-code-acp` 适配器（基于 Claude Agent SDK） | 社区/官方生态适配器 |
| OpenCode | 原生 `opencode acp`（stdin/stdout nd-JSON） | 官方支持（https://opencode.ai） |
| Codex CLI | 经 AI SDK community provider 等桥接 | 非一等 ACP agent【未验证原生支持】 |
| Kimi CLI | 原生 ACP（锁定 agent-client-protocol 0.8.0） | 官方支持 |

## ACP Registry

存在按 agent 列生态的官网 agents 列表；独立"注册中心"服务形态【未验证】。AgentOS 的 Agent Manifest 设计与其保持字段兼容。

## 对 AgentOS 的设计结论

1. **ACP 是本地 Client↔Agent 的首选协议**：会话流（session/update）、权限请求（request_permission）、会话恢复（session/load）三件套正好覆盖 AgentOS 的运行时、Permission Broker 与 Hot Swap 需求。
2. 但 AgentOS 不得与 ACP 强绑定：内部 `AgentAdapter` 抽象，ACP 只是其中一种 transport 实现（另有 CLI/PTY/SDK/API）。
3. `session/request_permission` 的 option 列表 → 映射 AgentOS Permission Policy 的 ask/allow/deny。
4. 落地顺序：MVP 用 headless CLI 适配器跑通闭环 → M3 用官方 TS SDK 实现 AcpAdapter（优先接 OpenCode 与 Gemini，二者 ACP 最成熟）。
