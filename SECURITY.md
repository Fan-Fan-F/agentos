# SECURITY（安全模型）

## 铁律（用户资产零接触）

1. **凭据零接触**：AgentOS 绝不读取、复制、上传、迁移任何 agent 的认证凭据（`~/.claude/.credentials.json`、`~/.codex/auth.json`、`~/.gemini/oauth_creds.json` 等只允许 stat 存在性，用于"是否已登录"的粗略提示）。
2. **已登录不重登**：认证始终由原厂 agent 自有机制管理；AgentOS 不要求、不协助、不代为登录。
3. **默认不执行用户已装的 agent**：自动发现只做存在性扫描（PATH stat / npm 全局目录列举 / 家目录标记 stat）；`--version` 探测与安装都需要用户显式触发（ADR-006）。
4. **不绕权**：禁止通过平台帮 agent 获得其本无法合法获得的权限；bypass 类 flag（`--dangerously-skip-permissions`、`--yolo`）只允许由用户在策略档中显式选择，绝不默认携带。
5. **配置写入须确认**：未来 MCP Hub / Permission 映射写入用户 agent 配置文件（`.mcp.json`、`config.toml`、`settings.json`、`opencode.json`）前，必须展示 diff 并获得确认。
6. **来源官方**：安装中心只提供官方 registry/安装器的命令预览；不使用第三方镜像二进制。

## 数据边界

- 所有数据本地存储于 `AGENTOS_HOME`（默认 `~/.agentos`），不上传任何服务器；源码/仓库内容只在本机进程间流转。
- Timeline/Capsule 可能包含代码片段与命令输出 —— 这是本地文件，用户拥有完整查看/删除权（删除任务目录即全删）。
- Secret 管理（M3+）：接入 OS Keychain / secure credential store；MVP 不存储任何 secret。

## 权限模型（MVP → M3）

- MVP：adapter 默认安全档（不追加任何权限放宽 flag）；任务在**独立 worktree** 中运行，物理隔离即第一道防线；大规模修改前自动 checkpoint（GitEngine）。
- M3：统一 Permission Policy（Read=allow / Edit workspace=allow / Run tests=allow / Install=ask / Network=ask / Delete=ask / Outside workspace=deny；Safe / Developer / Full / Custom 档位）→ Adapter 映射到各家原生权限系统（Claude `--permission-mode/--allowedTools`、Codex `--sandbox/--approval-policy`、Gemini `--approval-mode`、ACP `session/request_permission`）。

## 已知风险与缓解

| 风险 | 缓解 |
|---|---|
| agent 生成恶意命令 | 默认安全档 + worktree 隔离 + Timeline 全程留痕；用户审 diff 后合并 |
| 会话 JSONL 私有 schema 变动 | 只读容错解析，绝不写 |
| 无头进程失控（挂起） | 每次 run 有超时与 AbortController，强制 kill 进程树 |
| prompt 注入跨 agent（A 的输出进入 B 的上下文） | Handoff 包明确标注来源与"不可信内容"边界；七问探针校验再水化效果 |
