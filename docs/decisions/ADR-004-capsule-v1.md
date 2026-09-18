# ADR-004：Universal Session Capsule v1 —— JSON schema + Markdown 视图

- 状态：Accepted（2026-09-18）
- 决策：Capsule 采用版本化 JSON（`schemaVersion: 1`，zod 校验）+ 由其生成的 Markdown 视图；字段覆盖：任务目标/约束/用户指令、进度（完成/剩余）、决策（含已否决方案）、工作区（repo/分支/worktree/变更文件/commits）、验证（测试命令与通过失败数）、关键事实、环境、权限预期、handoff 摘要、`extensions` 命名空间。
- 规则：
  1. 只保存**可观测状态**（消息、工具事件、执行结果、决策摘要、git/测试状态）；**绝不**保存模型隐藏思维链。
  2. 未来版本演进 = 新增可选字段 + `migrate()`；读取到更高 `schemaVersion` 必须显式报错而非猜测。
  3. `extensions` 只允许命名空间化（如 `agentos.acp.*`），保证互操作插件可扩展。
- 落盘位置：`<AGENTOS_HOME>/tasks/<taskId>/capsules/<capsuleId>.json` 与同名 `.md`。
- 理由：研究显示 transcript 注入与记忆文件两路线各有硬伤；结构化 capsule 是可版本化、可编译、可人审的中间态（docs/research/05-session-portability.md）。
