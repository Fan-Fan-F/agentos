# 研究：Agent CLI 能力（无头/会话/恢复/权限/MCP）

> 调研日期：2026-09-18。由研究子代理完成（36 次网络检索），AgentOS 研究笔记。
> 这些事实直接决定 adapters 的参数设计；schema 类信息社区逆向居多，**必须以容错方式解析**。

## 1) Claude Code（Anthropic）

- **无头**：`claude -p`；`--output-format text|json|stream-json`；`--include-partial-messages`（`-p` + stream-json 时输出 `stream_event` 增量）；stream-json 消息类型：`system`（subtype `init`，含 `session_id`、`tools`、`mcp_servers`）→ `assistant`/`user`（content blocks）→ `result`（subtype `success|error_max_turns|error_max_budget_usd|error_during_execution`，含 `total_cost_usd`、`duration_ms`、`num_turns`、`usage`、`result`、`session_id`）。`--verbose` 配合 stream-json 显示工具明细。
- **恢复**：`--resume <session_id|name>`；`--continue/-c` 当前目录最近会话；`--session-id <uuid>`；`--fork-session`（resume 时生成新 ID，不污染原会话）。无头下从 `system/init` 或 `result` 事件回读 `session_id`。
- **磁盘**：`~/.claude/projects/<cwd 转义>/<uuid>.jsonl`；行含 `type`、`uuid`、`parentUuid`（消息链）、`message`、`toolUseResult`、`isSidechain`、`sessionId`、`timestamp`、`version`【官方未文档化，随版本漂移，只读须容错】。
- **权限**：`--permission-mode default|acceptEdits|plan|auto|dontAsk|bypassPermissions|manual`；`--allowedTools/--disallowedTools`（支持 `Bash(git log *)`、`mcp__*` 模式）；`--dangerously-skip-permissions` ≡ bypassPermissions。
- **MCP/其他**：`--mcp-config <file>`；hooks（PreToolUse/PostToolUse…）；`--agents` 定义子代理；`--append-system-prompt`。
- **SDK**：`@anthropic-ai/claude-agent-sdk`；`query({prompt, options})`，Options 含 `resume`、`continue`、`forkSession`、`resumeSessionAt`、`systemPrompt`、`settingSources`、`canUseTool`、`permissionMode`。
- **登录标记**：`~/.claude.json`（全局状态）、`~/.claude/.credentials.json`（无 Keychain 时的凭据；macOS Keychain 时可能不存在）。**AgentOS 只 stat 存在性，绝不读内容。**
- **分发**：npm 包 `@anthropic-ai/claude-code`；官方亦推荐原生安装器（独立二进制 `~/.local/bin/claude`）。

## 2) OpenAI Codex CLI（Rust）

- **无头**：`codex exec "<prompt>"`（进度走 stderr，最终消息走 stdout）；`--json`（stdout 变 JSONL）；`-o/--output-last-message <path>`；`--output-schema <schema.json>`；`--sandbox read-only|workspace-write|danger-full-access`；`--full-auto`（已废弃，仅兼容）；`--dangerously-bypass-approvals-and-sandbox`（别名 `--yolo`）；`-C/--cd`；`-m`；`--skip-git-repo-check`；`--ephemeral`；`-c key=value`。
- **--json 事件**：`thread.started`（`thread_id`）、`turn.started`、`turn.completed`（usage tokens）、`turn.failed`、`item.started/item.completed`（item 类型：`command_execution`、`agent_message`、`reasoning`、`file_change`、`mcp_tool_call`、`web_search`、plan）、`error`。
- **恢复**：`codex exec resume <SESSION_ID|last>`；TUI `codex resume`。无头 session id 从 `thread.started` 取。**不支持自定义 session id / rollout 文件名**（GitHub discussion #3827）。
- **存储**：`~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`；行 envelope `{timestamp,type,payload}`，type：`session_meta`（首行，含 session_id/cwd/version）、`turn_context`、`response_item`、`event_msg`。
- **config**：`~/.codex/config.toml`（`CODEX_HOME` 默认 `~/.codex`）：`model`、`approval_policy`（现行 `on-request|never`）、`sandbox_mode`、`model_reasoning_effort`；`[mcp_servers.<name>]`（command/args/env/url…）；profile 为 `$CODEX_HOME/<name>.config.toml` + `--profile`。
- **登录标记**：`~/.codex/auth.json` 存在即已登录。
- **生态**：npm 包 `@openai/codex`；`codex mcp-server` 已移除，改 `codex app-server`；`codex mcp` 管理 MCP；`codex apply` 应用 patch。

## 3) Google Gemini CLI

- **无头**：`gemini -p "..."`（或 stdin）；`--output-format text|json`（json 顶层 `response/stats/error`，**无官方 session_id 字段**；`stream-json`【未验证】）；`--approval-mode default|auto_edit|yolo`；`--include-directories`；`-d`。
- **会话**：`/chat save <tag>`、`/chat resume <tag>`、`/chat list`；2025-12 起自动保存并支持搜索恢复；文件在 `~/.gemini/tmp/<项目hash>/`。文件级 checkpointing（`checkpointing.enabled` + `/restore`）与 /chat 是两套机制。无头 `--resume`【未验证】。
- **配置**：`~/.gemini/settings.json`：`mcpServers`、`selectedAuthType`（oauth-personal / gemini-api-key / vertex-ai）、`checkpointing.enabled`；OAuth 凭据 `~/.gemini/oauth_creds.json`（存在性标记）。
- **ACP**：`--experimental-acp`（2026 仍 experimental）。npm 包 `@google/gemini-cli`。

## 4) OpenCode（SST）

- **无头**：`opencode run [message..]`：`--continue/-c`、`--session/-s <id>`、`--fork`、`--share`、`-m provider/model`、`--agent`、`--format default|json`（json 为原始事件流）、`-f`、`--title`。**注意 `-p` 是 server 密码不是 prompt**。
- **Server**：`opencode serve --port --hostname --cors`；OpenAPI 3.1 在 `/doc`；鉴权 `OPENCODE_SERVER_PASSWORD`。端点：`POST /session`、`POST /session/:id/message`（同步）、`POST /session/:id/prompt_async`（204）、`POST /session/:id/fork|abort|revert|summarize`；事件 `GET /event`（SSE）。
- **存储**：`~/.local/share/opencode/`（Windows 也是 `%USERPROFILE%\.local\share\opencode`）：`storage/session/`、`storage/message/`，新版本迁移为 SQLite `opencode.db`；凭据 `auth.json`。
- **配置**：`opencode.json`：`provider`、`mcp.{name}.type local|remote`、`agent`、`model`。**ACP 原生**：`opencode acp`。npm 包 `opencode-ai`。

## 5) 其他（简表）

- **Qwen Code**：`@qwen-code/qwen-code`，gemini-cli 官方 fork，沿用 `-p`/`--output-format json` 与 `/chat` 体系；另有 `@qwen-code/sdk`。
- **Kimi CLI**（Moonshot）：`uv tool install kimi-cli`；原生 ACP agent；v1.17+ 曾锁定 `agent-client-protocol==0.8.0` 导致破坏性升级（生态兼容性教训）。
- **Aider**：`--message`/`--message-file` + `--yes-always` 无头；**默认自动 git commit**（`--no-auto-commits` 关闭）——编排器必须处理这一行为。
- **GitHub Copilot CLI**：`copilot -p`；`--allow-tool`/`--deny-tool`（如 `shell(git)`、`MCP-Server(tool)`）。
- **Cursor Agent CLI**：`cursor-agent -p`；`--force`/`--yolo`；社区报告偶发挂起（需要超时保护）。
- **Factory Droid**：`droid exec "task"`，`--auto medium` 等自主度。
- **Amp**：`amp -x "..."`；另有 `--stream-json`。
- **Charm Crush**：Go TUI；MCP 原生；ACP 经第三方桥 `crush-acp`。

## 统一适配器设计启示（AgentOS adapters 的依据）

1. **原生 JSON 流**：Claude（stream-json，语义最全）、Codex（--json，thread/item 模型）、OpenCode（--json / SSE）；**仅文本**：Gemini（仅最终 response+stats）、Aider、Copilot、Cursor、Droid。→ 两条解析管线：事件归一化 + 文本兜底。
2. **原生 resume**：Claude（--resume/--fork-session）、Codex（exec resume <id|last>）、OpenCode（-s/-c/HTTP fork）强；Gemini 弱（tag 机制），**Gemini 热切换依赖 capsule 注入**。
3. 会话文件是私有 schema 且漂移 —— 只读导入必须容错（未知字段忽略、缺字段容忍），且**绝不写**。
4. 权限三对偶：Claude `--permission-mode/--allowedTools` ↔ Codex `--sandbox/--approval` ↔ Gemini `--approval-mode`；"全自动 bypass 类" flag 一律映射 AgentOS 沙箱等级，不得默认携带。
5. 会话 ID 捕获点：Claude `system/init`、Codex `thread.started`、OpenCode `session created` 事件 —— adapter 必须在首事件即落库。
