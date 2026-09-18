# ADR-001：先做 TypeScript 本地服务内核，桌面壳（Tauri 2）后置

- 状态：Accepted（2026-09-18）
- 背景：项目要求跨平台、Windows 一等公民、可安装可分发。候选：Tauri(Rust)+TS、Electron、纯本地服务+浏览器。
- 决策：核心以 TypeScript monorepo（npm workspaces）实现为"本地 Node 服务 + 静态 Web UI"（默认 http://localhost:7333），域逻辑全部在 `@agentos/core`、`@agentos/agents` 中、与 UI 壳解耦；Tauri 2 仅作为 M5 的外壳，用 sidecar 打包 Node 服务（研究结论见 docs/research/06-stack-decisions.md：Tauri sidecar = 独立 Node 进程 + HTTP/IPC）。
- 理由：最快达到"真实可运行闭环"；避免 MVP 阶段引入 Rust 工具链与原生构建；Node 生态与各 agent CLI 的 JSONL 事件解析同为 TS。
- 后果：初期分发形态是 `npm start`（与 Ollama/LM Studio 的本地服务形态同类）；桌面壳后置不阻塞任何核心能力。
