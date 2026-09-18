# DECISIONS（决策索引）

全部架构决策以 ADR 形式记录于 `docs/decisions/`：

| ADR | 主题 | 一句话结论 |
|---|---|---|
| [ADR-001](./docs/decisions/ADR-001-ts-core-first-tauri-later.md) | 技术栈 | TS 本地服务内核先行，Tauri 2 壳后置 |
| [ADR-002](./docs/decisions/ADR-002-json-store-first.md) | 存储 | MVP 原子写 JSON + JSONL，SQLite 后置（接口不变） |
| [ADR-003](./docs/decisions/ADR-003-headless-first.md) | 运行模式 | 无头优先，PTY 交互 M5 再上（@lydell/node-pty） |
| [ADR-004](./docs/decisions/ADR-004-capsule-v1.md) | Capsule | 版本化 JSON + MD 视图；只存可观测状态，不存思维链 |
| [ADR-005](./docs/decisions/ADR-005-handoff-pipeline.md) | 交接 | 内联上下文 + HANDOFF.md + 七问验证探针 |
| [ADR-006](./docs/decisions/ADR-006-read-only-discovery.md) | 发现/认证 | 只读扫描；不执行不读凭据；探测/安装显式触发 |
| [ADR-007](./docs/decisions/ADR-007-worktree-placement.md) | worktree | 仓库外兄弟目录 `.agentos-worktrees/`，独立分支命名 |
| [ADR-008](./docs/decisions/ADR-008-static-web-ui.md) | UI | 零构建静态 SPA 先行，React 迁移后置 |
| [ADR-009](./docs/decisions/ADR-009-app-mode-desktop.md) | 桌面端 | App 模式窗口先行（双击启动器），Tauri 原生壳 M5 |

## 关键开放问题（后续 ADR 候选）

1. ACP SDK 版本锁定策略（Kimi CLI 锁 0.8.0 造成破坏的教训，docs/research/04）。
2. Capsule 大小的压缩/过期策略（避免无限膨胀）。
3. 多 agent 并行时父仓库 `index.lock` 争用的串行化粒度。
