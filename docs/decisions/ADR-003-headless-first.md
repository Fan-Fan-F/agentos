# ADR-003：无头优先（headless-first），PTY 后置

- 状态：Accepted（2026-09-18）
- 背景：各 agent CLI 均有成熟无头模式：`claude -p --output-format stream-json`、`codex exec --json`、`gemini -p --output-format json`、`opencode run --format json`（详见 docs/research/04-agent-clis.md）。
- 决策：MVP 一律以无头子进程驱动 agent（stdout JSONL 事件解析 + stderr 日志旁路），交互式 TUI 会话（PTY/xterm.js）列为 M5，依赖 `@lydell/node-pty`（预编译、不调 node-gyp）。
- 理由：闭环（跑任务→capsule→换人→协作）只依赖无头模式；零原生依赖在 Windows 上最稳；无头事件流也更利于统一 Timeline 与观测。
- 后果：MVP 中"会话"是一次性交换（多轮续接走原生 resume flag），不能像 TUI 那样中途输入；交互模式后置补齐。
