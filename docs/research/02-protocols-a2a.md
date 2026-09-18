# 研究：Agent2Agent Protocol（A2A）

> 调研日期：2026-09-18。AgentOS 研究笔记。

## 定位与现状

- Google 于 2025-04 发布，现由 **Linux Foundation** 托管，150+ 组织参与（https://www.linuxfoundation.org）。
- 规范：https://github.com/a2aproject/A2A `docs/specification.md`（2025-11 版本在列）："an open protocol enabling communication and interoperability between **opaque** agentic applications"。
- 解读文章：https://mastra.ai （五对象数据模型）、https://agentprotocol.ai 。

## 核心概念

- **Agent Card**：自述文档（`/.well-known/agent-card.json`，早期为 agent.json），描述能力、端点、鉴权要求 —— Agent Discovery 的标准化参考。
- **Task / Message / Artifact**：跨 agent 委托的工作单元；`message/send`、`message/stream`（SSE）、`tasks/get` 等 JSON-RPC over HTTPS 方法。
- 官方 SDK：Python 与 JS/TS（a2aproject/A2A 下）。
- 传输是 **HTTPS 远程优先**：面向"跨组织、互不透明、各自服务器"的场景。

## 对本地同机多 Agent 编排的适配度评估

| 维度 | A2A | AgentOS 需求 |
|---|---|---|
| 传输 | HTTPS + SSE，需每 agent 起 HTTP 服务 | 本地 stdio 子进程即可 |
| 信任模型 | 跨组织、外部鉴权 | 同机、共享文件系统 |
| 粒度 | 整任务委托（opaque） | 需要细粒度事件流（tool calls、diff） |
| 会话上下文 | 无内置项目上下文概念 | 核心诉求（Session Capsule） |

结论：**A2A 是 Agent↔Agent 的长期标准方向，但不是本地闭环 MVP 的正确底层**。
设计上：AgentOS Message Bus 的事件语义（ask/delegate/review/approve/reject/send_artifact）保持与 A2A Task/Message 概念对齐，未来可加 A2A Bridge（把 AgentOS 内的 agent 暴露为 A2A server，或消费外部 A2A agent 作为远端节点）。

## 采用者

Google 生态与 50+ 厂商联盟宣布支持（2025）；实际生产级本地 coding agent 场景采用仍少【未验证】。
