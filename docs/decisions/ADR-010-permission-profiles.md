# ADR-010：统一权限档位（Permission Profile）→ 各家原生 flag 映射

- 状态：Accepted（2026-09-20）
- 背景：任务书 §16 要求统一 Permission Policy 并由 Adapter 映射到各家权限系统；真实使用中"每次运行手动拼 flag"（E2E 脚本曾硬编码 devFlags）既易错又不可审计。
- 决策：三档位模型（`safe / developer / full`），映射表实现在 `packages/agents/src/permissions.ts`：

| 档位 | 语义 | Claude Code | Codex CLI | Gemini CLI | OpenCode |
|---|---|---|---|---|---|
| safe（默认） | 不追加任何 flag，尊重各家默认安全档 | — | — | — | — |
| developer | 允许在**独立 worktree 内**读写文件与执行命令 | `--permission-mode acceptEdits --allowedTools Read,Edit,Write,Glob,Grep,Bash` | `--sandbox workspace-write` | `--approval-mode auto_edit` | （run 默认即在工作区执行，如实为空） |
| full | 解除沙箱（bypass 类） | `--permission-mode bypassPermissions` | `--sandbox danger-full-access` | `--approval-mode yolo` | （无对应 flag） |

- 强制规则：
  1. 优先级：显式 `permissionFlags` > `profile` > safe；显式 flags 同样过黑名单。
  2. 未收录的 agent（stub/自定义插件）**绝不猜测 flag**，映射为空。
  3. `full` 档与 bypass 类 flag 同受服务端 `AGENTOS_ALLOW_BYPASS=1` 门禁（默认 400 拒绝，UI 中该档直接禁用）。
  4. worktree 物理隔离是第一道防线，任何档位下 agent 都只在自己的 worktree/分支工作。
- 理由：真实 E2E 中手动 flags 暴露的易错性 + 任务书"权限体验碎片化"痛点；三档覆盖 95% 场景且可被各家官方文档逐一验证（docs/research/04）。
- 后果：`--allowedTools` 粒度（如仅允许 `Bash(node --test:*)`）留作后续 per-task 细化；当前三档已消除手动拼 flag 的主要出错面。
