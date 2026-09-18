# 研究：会话可移植性先例（Session Portability Prior Art）

> 调研日期：2026-09-18。AgentOS 研究笔记。"换 agent 不丢上下文"是本项目核心命题，此文档记录 2025-2026 已有的解法与空白。

## 已存在的单点工具（2026 上半年爆发）

1. **authsec.ai 的会话搬运 CLI**（2026-05）：在 Claude Code / Codex / Gemini 之间一次性转移"会话上下文、决策、权衡"（https://authsec.ai）。
2. **GitHub topic `context-transfer`**：多个小工具，如单条 `/handoff` 命令把 Claude Code 活动会话带进 Codex（https://github.com/topics/context-transfer）。
3. **`npx continues`**（Show HN）：跨 5 个工具（Claude Code、Copilot、Gemini CLI、Codex、OpenCode）发现已有会话，选择后生成可续接的 handoff（https://news.ycombinator.com）。
4. **handoff-gemini skill**：Claude 侧 skill，把研究/长文档分析委托给 Gemini CLI 以省 token（https://mcpmarket.com）——"agent 间请求-响应"的雏形。
5. **配置同步讨论**（OpenAI 社区，2026-05）：在 `~/.codex` 与 `~/.claude` 之间同步 skills/agents/MCP/permissions。

## 社区主流解法谱系

| 路线 | 做法 | 缺陷 |
|---|---|---|
| 重述 prompt | 人工把目标+现状粘给新 agent | 用户当"消息中间人"，易丢信息 |
| 记忆文件 | AGENTS.md / CLAUDE.md 等静态记忆 | 粒度粗，不含任务态/测试态 |
| transcript 注入 | 导出原会话 JSONL 塞给新 agent | 私有 schema 漂移、token 浪费、上下文污染 |
| **结构化 capsule** | 提炼决策/进度/diff/测试为可版本化文档 | **尚无平台化实现 —— AgentOS 空间** |

## 各家原生会话恢复能力（可移植性的"原生快车道"）

- Claude Code：`--resume <session_id>` / `--fork-session`（同 agent 内无缝续接）。
- Codex：`codex exec resume <id|last>`。
- OpenCode：`-s <id>` / `-c` / HTTP `fork`。
- Gemini CLI：`/chat save|resume` tag 机制，无头恢复弱【未验证】→ 依赖 capsule。

**结论（AgentOS 策略）**：
1. 同 agent 续接 → 优先原生 resume（adapter 声明 `resume.supported`）。
2. 跨 agent 接管 → Universal Session Capsule + Context Compiler + HANDOFF.md 注入 + 7 问验证（任何 agent 可回答"任务是什么/完成了什么/下一步"）。
3. Capsule 是**人可读、可版本化、可扩展**的 JSON+Markdown，绝不保存隐藏思维链，只保存可观测状态。
