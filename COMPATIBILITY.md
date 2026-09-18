# COMPATIBILITY（兼容性矩阵）

> 依据 docs/research/04-agent-clis.md（2026-09-18 调研）。"解析器已测"= 以官方/社区公开 schema 样本做单元测试；真实二进制冒烟由用户环境执行（见 TESTING.md）。

## Agent 支持矩阵（M1）

| Agent | 无头模式 | JSON 事件流 | 原生 resume | AgentOS 适配器 | 解析器已测 | 备注 |
|---|---|---|---|---|---|---|
| Claude Code | `claude -p` | stream-json（init/assistant/result） | `--resume <id>`、`--fork-session` | ✅ | ✅ | session_id 从 `system/init`/`result` 回读 |
| Codex CLI | `codex exec` | `--json`（thread.started/item.*） | `codex exec resume <id|last>` | ✅ | ✅ | 不支持自定义 session id |
| Gemini CLI | `gemini -p` | `--output-format json`（仅结果+stats） | `/chat save\|resume` tag，无头恢复弱 | ✅（capsule 通道为主） | ✅（文本/JSON 兜底管线） | 热切换依赖 Capsule |
| OpenCode | `opencode run` | `--format json` 事件流 | `-s <id>` / `-c` | ✅ | ✅ | 注意 `-p` 是 server 密码 |
| Qwen Code | 同 Gemini 系 | 同 Gemini | 同 Gemini | ⬜ 计划 | — | gemini-cli fork |
| Kimi CLI | 无头 | — | — | ⬜ 计划（ACP 原生） | — | M3 走 ACP |
| Aider | `--message --yes-always` | 文本 | `--resume`? | ⬜ 计划 | — | 默认自动 commit，需处理 |
| Copilot CLI / Cursor / Droid / Amp / Crush | 各有无头 | Amp 有 --stream-json | 各异 | ⬜ 计划 | — | 见研究文档 §5 |

## 平台支持矩阵（Windows / macOS / Linux）

| 关注点 | Windows | macOS | Linux | 说明 |
|---|---|---|---|---|
| 进程启动 | ✅ launcher 解析 | ✅ 直接执行 | ✅ 直接执行（校验可执行位） | Windows 下 npm `.cmd` shim 经 Node ≥20.12 直接 spawn 会 EINVAL（CVE-2024-27980/CVE-2024-36138），AgentOS 解析 npm 全局包真实入口：原生 `.exe` 直接执行（如 claude.exe）、JS 用 `node` 启动（如 codex.js）；兜底 `cmd.exe /d /s /c`（仅限无空格参数） |
| 长提示词 | ✅ stdin/@file 通道 | ✅ | ✅ | claude/codex/opencode 走 stdin；gemini 长提示词写 `.agentos/PROMPT.md` + 官方 `@file` 引用 —— 绕开 cmd.exe 8K / node 32K 参数上限 |
| 超时杀进程树 | ✅ taskkill /T /F | ✅ kill(-pid) | ✅ | 无头进程失控保护 |
| git worktree | ✅（建议 `core.longpaths`） | ✅ | ✅ | worktree 外置兄弟目录（ADR-007），分支名仅 `[a-z0-9-/]` |
| 路径处理 | ✅ 全程 node:path | ✅ | ✅ | 分隔符零硬编码 |
| CI | GitHub Actions 矩阵（windows/ubuntu/macos）三平台 build+test（`.github/workflows/ci.yml`） | | | 提交后由 CI 持续验证 |
| tmux 依赖 | 不需要 | 不需要 | 不需要 | 与 claude-squad/CCManager 的关键差异 |

### 上游已知问题与 AgentOS 缓解（2026-09 调研）

| 上游问题 | 影响 | AgentOS 缓解 |
|---|---|---|
| `codex exec` stdin 不关闭会永久挂起 | 自动化集成 | spawn 层对 stdin 一律 `end()`（无论是否使用 stdin 通道） |
| `opencode run` API 错误时挂死 | 自动化集成 | 每次运行强制超时 + 进程树强杀 |
| claude stream-json 非 TTY 偶发挂起 | 自动化集成 | 同上（超时 + 杀树），事件增量已入 Timeline 不丢失 |
| gemini `stdin + -p` 组合会重复内容 | 提示词投递 | gemini 不用 stdin 通道，改用 @file |
| gemini/codex/claude 会话文件为私有 schema 且漂移 | 导入/恢复 | 只读 + 逐行容错解析（坏行跳过、缺字段容忍），绝不写 |
| codex 不支持自定义 session id | 会话管理 | 接受其原生 id；Capsule 链承担跨运行追踪 |

## 协议兼容（M3 目标）

| 协议 | AgentOS 立场 |
|---|---|
| ACP | Client 实现者（官方 TS SDK）；已适配 ACP 的 agent（OpenCode/Gemini/Kimi…）走 AcpAdapter |
| A2A | 语义对齐 + 未来 Bridge（本地 MVP 不引入 HTTPS 远程栈） |
| MCP | Hub 聚合器（写用户 agent 配置前必须显式确认） |

## 上游项目与许可证（借鉴边界）

| 项目 | License | 借鉴方式 |
|---|---|---|
| zed-industries/agent-client-protocol（ACP） | 见仓库（Apache-2.0 系）【以仓库为准】 | 协议/SDK 直接使用 |
| a2aproject/A2A | Apache-2.0 | 语义对齐 |
| modelcontextprotocol | MIT | SDK 使用（M3） |
| BloopAI/vibe-kanban | 见仓库 | 设计思想（executor/worktree） |
| smtg-ai/claude-squad | **AGPL-3.0** | **仅思想，零代码接触** |
| CCManager | MIT | 设计思想 |
| epilande/ccmux | 见仓库 | hand-work 思想参考 |
| OpenHands / claudia / claude-flow / omnara | 各见仓库 | 设计思想 |
| anthropics/claude-code、openai/codex、google-gemini/gemini-cli、sst/opencode | 各自条款 | 只通过公开 CLI 接口驱动，不逆向不改写 |

规则：任何"参考来源"进入代码前必须核对其 LICENSE；AGPL 项目只允许思想借鉴并在本文件记录。
