# 研究：Model Context Protocol（MCP）与统一 MCP Hub

> 调研日期：2026-09-18。AgentOS 研究笔记。

## 现状要点

- MCP 已是 agent ↔ 工具/数据的事实标准：stdio 与 Streamable HTTP 两种 transport；tools/resources/prompts 三类原语（https://modelcontextprotocol.io）。
- 四大 coding agent 的 MCP 配置位置（AgentOS MCP Hub 必须能写入的文件）：

| Agent | 配置文件 | 格式 |
|---|---|---|
| Claude Code | 项目 `.mcp.json` 或 `claude mcp add`（用户级 `~/.claude.json`） | `mcpServers: {name: {command, args, env}}` |
| Codex CLI | `~/.codex/config.toml`（项目 `.codex/config.toml`） | `[mcp_servers.<name>]` `command/args/env` |
| Gemini CLI | `~/.gemini/settings.json` | `mcpServers: {name: {command, args, env}}` |
| OpenCode | `opencode.json` | `mcp: {name: {type: local, command: [...], enabled}}` |

## 聚合器/网关先例（N×M 配置问题的解法）

- **1mcp**：一个本地端点、一份配置，供所有 AI 客户端复用（GitHub）。
- **McGravity**：把多个 MCP server 组合成单一端点，带负载均衡/故障转移（GitHub）。
- **mcp-proxy**：聚合多个 MCP server 于单一接口（mcpservers.org 在列）。
- 2026 年企业侧：Gravitee MCP Proxy（2026-01）、Envoy AI Gateway MCP、AgentGateway 多路复用（2026-02）、Bifrost —— 共同模式：**单端点聚合 + 鉴权 + 工具过滤 + 观测**（https://www.gravitee.io 等）。

## 对 AgentOS 的设计结论

1. **统一 MCP Hub = 一个本地聚合器进程**：AgentOS 维护一份 MCP Server 清单（AgentOS 配置），为每个已装 agent 生成其自有配置文件中的条目，全部指向 Hub 的单端点。agent 侧只需"信任 AgentOS 注入的一个 server"。
2. 权限过滤在 Hub 层做：同一 MCP 工具对不同 agent/任务可施加不同 allowlist（Permission Broker 的落点之一）。
3. 不重写 MCP SDK：Hub 基于官方 MCP SDK（TS）实现（M3+ 里程碑）。
4. 写用户 agent 配置文件前必须展示 diff 并征得同意（见 SECURITY.md；用户明令不得擅改其现有 agent 环境，注入功能默认关闭、逐项确认）。
