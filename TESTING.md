# TESTING（测试策略）

运行：`npm test`（vitest，仓库根）。

## 分层与真实性边界（禁止"假完成"）

| 层 | 覆盖 | 真实性 |
|---|---|---|
| Unit | Capsule schema 往返/版本策略、ContextCompiler 预算裁剪、Store 原子写与重载、EventLog 追加/重放、Memory 去重、Router 评分 | 纯本地 |
| Integration（Git） | GitEngine 对**真实临时 git 仓库**：init/commit/worktree/branch/diff/checkpoint/remove、分支命名约束 | 真实 git |
| Adapter Contract | 统一契约套件对 StubAdapter 断言：事件流形状、sessionRef 捕获、resume 契约、中断、退出事件 | 契约级 |
| 解析器 Unit | Claude stream-json / Codex --json 的**真实 schema 样本行** → 归一化 AgentEvent；文本兜底管线；提示词通道（stdin/@file）断言 | schema 样本（来自 docs/research/04，标注来源） |
| 导入器 Unit | 自造 Claude/Codex 会话 JSONL fixture → 会话列表 + Capsule 转换（坏行容错、子代理过滤） | fixture（不触碰真实用户目录） |
| Launcher Unit | resolveLauncher 实测断言：claude→原生 exe 直接执行、codex→node+js（本机真实验证，见 COMPATIBILITY 平台矩阵） | 只读解析，不执行 agent |
| Handoff 集成 | Stub A → Swap → Stub B：B 收到的 prompt 必须含目标/决策/HANDOFF 标记；七问探针发出且回答入 Timeline；新 capsule 链接源 capsule | 契约级 |
| followUp 集成 | 同会话续聊走原生 resume；链式 Capsule；并发守卫（同任务二次运行拒绝） | 契约级 |
| 崩溃恢复 | "重启"后 recoverAll 把 running 判为 interrupted；resume 用 capsule 续接产生新 capsule；Store 跳过损坏文件 | 契约级 |
| Server API | fastify.inject 全 REST 面（health/agents/projects/tasks/run/swap/ask/followup/fork/diff/capsule/events/imports）+ 安全面（bypass flag 400） | 契约级 |
| 跨平台 CI | GitHub Actions 矩阵 windows/ubuntu/macos：build + test + doctor 只读冒烟 | 提交后 CI 执行 |

## 真实 agent 集成测试的立场

- 本开发环境遵用户指令**不执行**用户已装的 claude/codex 等二进制（ADR-006）。因此：
  - 不声称"真实集成测试通过"；
  - 真实端到端由 **用户自愿运行** `node scripts/e2e-handoff.mjs --repo <git仓库> --from claude --to codex`（消耗用户自己的额度，输出全程时间线）；
  - 适配器与真实 CLI 的契约由①解析器 schema 样本单测 ②契约测试套件 ③e2e 脚本三层覆盖，任何一层失败都会暴露适配器回归。
- 未来 CI（有沙箱环境时）可用环境变量 `AGENTOS_CONTRACT_REAL=1` 启用真实二进制冒烟（检测到未登录/未安装则优雅跳过并标注 SKIPPED，不伪造）。

## Windows 注意

- 全部测试使用临时目录（os.tmpdir）与显式 `AGENTOS_HOME` 覆盖，不触碰用户家目录。
- git 操作经 simple-git，路径全程 `path.join`；分支名/任务 ID 仅用 `[a-z0-9-]`。
