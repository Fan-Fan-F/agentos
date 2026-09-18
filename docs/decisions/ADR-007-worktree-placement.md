# ADR-007：worktree 放仓库外兄弟目录

- 状态：Accepted（2026-09-18）
- 决策：并行任务 worktree 统一放在 `<repoRoot>/../.agentos-worktrees/<repoName>/<taskId>-<agentId>/`（父目录不可写时回退到 `<AGENTOS_HOME>/worktrees/`）；分支命名 `agentos/<taskId>/<agentId>`。
- 理由：worktree 放仓库内部会成为父仓库的未跟踪文件污染 status；兄弟目录 + 仓库内 `.gitignore` 双保险（研究见 docs/research/06-stack-decisions.md）。
- 后果：需要处理父目录只读场景（回退路径）；AgentOS 元数据目录（`.agentos/`，存放 HANDOFF.md 等）写入 worktree 内部并加入其 `.git/info/exclude` 建议。
