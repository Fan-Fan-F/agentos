# SECURITY（安全模型）

## 铁律（用户资产零接触）

1. **凭据零接触**：AgentOS 绝不读取、复制、上传、迁移任何 agent 的认证凭据（`~/.claude/.credentials.json`、`~/.codex/auth.json`、`~/.gemini/oauth_creds.json` 等只允许 stat 存在性，用于"是否已登录"的粗略提示）。
2. **已登录不重登**：认证始终由原厂 agent 自有机制管理；AgentOS 不要求、不协助、不代为登录。
3. **默认不执行用户已装的 agent**：自动发现只做存在性扫描（PATH stat / npm 全局目录列举 / 家目录标记 stat）；`--version` 探测与安装都需要用户显式触发（ADR-006）。
4. **不越权**：API 与 TaskRunner 共用权限参数白名单，校验参数名、值、重复项和适配器归属。只接受已支持的权限参数；目录、配置、提示词覆盖等任意 CLI 参数均拒绝。`full` 与显式 bypass 值仍须 `AGENTOS_ALLOW_BYPASS=1`；开启后也不能绕过结构校验。
5. **配置写入须确认**：未来 MCP Hub / Permission 映射写入用户 agent 配置文件（`.mcp.json`、`config.toml`、`settings.json`、`opencode.json`）前，必须展示 diff 并获得确认。
6. **来源官方**：安装中心只提供官方 registry/安装器的命令预览；不使用第三方镜像二进制。

## 数据边界

- AgentOS 的任务数据保存在本机 `AGENTOS_HOME`（默认 `~/.agentos`），平台自身不上传任务数据。被调用的官方 Agent CLI 可能向其模型服务发送提示词、上下文和代码；实际网络与数据处理行为取决于用户的 CLI 配置和服务商。
- Timeline/Capsule 可能包含代码片段与命令输出 —— 这是本地文件，用户拥有完整查看/删除权（删除任务目录即全删）。
- Secret 管理（M3+）：接入 OS Keychain / secure credential store；MVP 不存储任何 secret。

## 权限模型（MVP → M3）

- MVP：adapter 默认安全档（不追加任何权限放宽 flag）；任务在**独立 worktree** 中运行，工作目录隔离用于减少误操作，不能替代操作系统沙箱；大规模修改前自动 checkpoint（GitEngine）。
- 已落地（ADR-010）：三档 Permission Profile（safe / developer / full）→ 各家原生 flag 映射，映射表见 COMPATIBILITY.md；`full` 档与 bypass 类 flag 同受 `AGENTOS_ALLOW_BYPASS=1` 门禁，UI 默认禁用。
- M3+：per-task 细粒度 allowlist（如仅允许 `Bash(node --test:*)`）、ACP `session/request_permission` 的策略化应答（当前默认拒绝）。

## 已知风险与缓解

| 风险 | 缓解 |
|---|---|
| agent 生成恶意命令 | 默认安全档 + worktree 隔离 + Timeline 全程留痕；用户审 diff 后合并 |
| 会话 JSONL 私有 schema 变动 | 只读容错解析，绝不写 |
| 无头进程失控（挂起） | 每次 run 有超时与 AbortController，强制 kill 进程树 |
| prompt 注入跨 agent（A 的输出进入 B 的上下文） | Handoff 包明确标注来源与"不可信内容"边界；七问探针校验再水化效果 |


## Local browser access boundary (2026-09-21)

HTTP and WebSocket requests require a loopback Host (localhost, 127.0.0.1, or [::1]). Browser Origin must match the service origin and cross-site Fetch Metadata is rejected before routes or WebSocket upgrades run. Native clients without Origin remain supported; this is not authentication against other local processes. WebSocket task ids must be valid and refer to existing tasks before opening a timeline.

Unattended verification uses dedicated temporary Git repositories, data directories, ephemeral loopback ports and owned child processes. Do not reuse the user's AgentOS home, read credentials, modify global Agent installations, or terminate unrelated processes. Cloud verification must use an isolated runner without uploading local credentials or unrelated files.


## Local service data ownership (2026-09-21)

Server construction acquires an exclusive data-directory lock before task recovery. The lock is published by atomically renaming a populated directory. A live owner blocks a second service even when it requests a different HTTP port. Normal shutdown and failed startup release ownership. A dead same-host PID permits reclamation of only its unique owner entry; cleanup never recursively removes lock directories. Unknown contents, an unidentifiable owner, and permission errors fail closed. PID reuse can conservatively block restart rather than displace a live process. This protects the server lifecycle on local filesystems; it is not a distributed lock or proof that an orphaned Agent child has exited. Direct TaskRunner consumers must coordinate their own lifecycle.
