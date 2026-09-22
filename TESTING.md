# TESTING（测试策略）

运行：先 `npm run build`，再 `npm test`（vitest，仓库根；真实服务子进程加载构建产物）。

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

- 2026-09-19 夜间迭代经用户"夜间自主迭代"指令授权，已真实执行 claude/codex（dogfooding），并据实修复 4 个缺陷（见 docs/dogfood/ 与 docs/blockers.md）。日常自动发现仍保持只读（ADR-006），深度探测/安装仍需用户显式触发。
  - 不声称"真实集成测试通过"；
  - 真实端到端由 **用户自愿运行** `node scripts/real-e2e.mjs`（2026-09-19 已真实执行一轮，报告见 docs/dogfood/；agent 侧被用户账户问题阻塞，见 docs/blockers.md）；
  - 适配器与真实 CLI 的契约由①解析器 schema 样本单测 ②契约测试套件 ③e2e 脚本三层覆盖，任何一层失败都会暴露适配器回归。
- 未来 CI（有沙箱环境时）可用环境变量 `AGENTOS_CONTRACT_REAL=1` 启用真实二进制冒烟（检测到未登录/未安装则优雅跳过并标注 SKIPPED，不伪造）。

## Windows 注意

- 全部测试使用临时目录（os.tmpdir）与显式 `AGENTOS_HOME` 覆盖，不触碰用户家目录。
- git 操作经 simple-git，路径全程 `path.join`；分支名/任务 ID 仅用 `[a-z0-9-]`。


## 2026-09-21 恢复回归

构建后执行 npm run e2e:recovery：在含中文/空格的临时路径创建真实 Git 仓库，强制杀死专用 Node 测试进程，在尚无完成记录时重启 TaskRunner，验证未提交文件可恢复且主仓库不变。该测试使用 StubAdapter，仅验证真实进程/存储/Git 恢复，不声称真实 AI Agent 成功。
新增回归覆盖 A→B→A、权限档传递、累计 Capsule、跨 Agent Session 隔离、未知目录保护、存储 ID 校验、任务异常后可重试以及 Timeline 截断恢复。
真实模型 E2E 必须有实际产物、独立执行的测试和成功接力。诊断账户/版本错误不构成 E2E 成功。


本地网络边界回归使用真实 loopback HTTP/WebSocket 连接、操作系统分配端口和全新临时数据目录，适配器为空，不执行用户 Agent。覆盖不同 Origin、DNS rebinding Host、非法或不存在任务的握手拒绝及正常本机客户端。故障注入另覆盖已取消请求不会启动进程写文件。


多服务实例回归：同目录的第二个服务须在恢复逻辑之前拒绝；8 个并发构造只产生一个所有者；不同数据目录可独立启动；正常关闭、构造失败、监听端口冲突均释放锁。真实 Node 服务使用临时目录、临时端口和空适配器，强制终止测试自有进程后让 6 个服务竞争恢复，必须只启动一个、只写入一次恢复事件。另验证 Windows junction/其他平台 symlink 指向同一目录时无法绕过互斥，以及未知锁内容不会被删除。本机验证为 Windows；其他平台未实际执行。

恢复脚本还覆盖已生成 Capsule 后的 follow-up 进程崩溃，直接 Hot Swap 到另一 StubAdapter 并验证新工作区收到未提交文件。Git 故障注入生成真实合并冲突，断言 checkpoint 拒绝且 HEAD、未合并索引和文件逐项不变。

Timeline WebSocket 回放回归使用真实临时连接，通过延迟历史读取确定性制造事件重叠和快照后追加；验证先历史后增量、每条事件恰好一次、恢复实时推送和4 MiB积压保护。时序故障注入不使用真实Agent。
