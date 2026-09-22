# AgentOS 对标与产品升级决策（2026-09-22）

本次目标是提高用户完成真实任务的把握，而不是追平竞品功能数量。结论基于官方文档、公开仓库与本机源码；未安装或实测竞品产品，也没有做性能排名。GitHub CLI 返回 401，未修改认证，改读公开仓库网页。按 agent-reach 路由查阅公开资料，Exa 未安装，使用网页搜索补充。Agent Reach 更新检查为 v1.5.0、无可用新版。

## 对标结论

| 产品 | 官方资料确认的能力 | 对 AgentOS 的意义 |
| --- | --- | --- |
| [Vibe Kanban](https://www.vibekanban.com/docs/workspaces/changes) | 逐文件 diff、行内意见、将反馈交给 Agent，形成审查与修正循环 | AgentOS 原 Diff 页仅显示统计，不足以让用户验收。优先补实际补丁与反馈入口。 |
| [Claude Squad](https://github.com/smtg-ai/claude-squad) | 多终端 Agent、独立 Git 工作区、审查后处理改动；依赖 tmux | 独立工作区已是基础能力。Windows 原生支持必须靠真实测试证明，不应把并行数量当优势。 |
| [OpenAI Codex 审查](https://learn.chatgpt.com/docs/code-review) / [工作树](https://developers.openai.com/zh-Hans/docs/environments/git-worktrees) | 代码审查、Git 工作树及本地/工作树之间交接 | 任务接续与代码验收需要清楚且可操作的界面。不同位置之间的交接不等于跨厂商原生会话兼容。 |
| [GitHub Copilot](https://docs.github.com/en/copilot/concepts/agents/code-review) / [安全边界](https://docs.github.com/en/copilot/responsible-use/agents) | PR 审查与修复建议；云端 Agent 有仓库、分支、秘密访问等权限限制，保留人类审查 | “Agent 已完成”不等于独立验证。审查结果、测试证据和权限必须有来源及明确边界。 |
| [Cursor Cloud Agents](https://cursor.com/docs/cloud-agent) | 隔离虚拟机、开发环境配置、测试与运行诊断 | worktree 只隔离 Git 工作文件，不是系统沙箱。先解决任务进程归属和环境可复现性，再考虑云执行产品化。 |
| [Claude Code checkpoints](https://code.claude.com/docs/en/checkpointing) | 可恢复代码/会话并压缩上下文；官方说明 Bash 与部分外部改动不被同等追踪 | 不能承诺任意失败一键回滚。AgentOS 应明确 Git checkpoint 的覆盖范围与可恢复证据。 |
| [Gemini CLI checkpointing](https://geminicli.com/docs/cli/checkpointing/) | 本地 shadow Git 快照、会话和工具调用恢复；默认不启用 | 应区分 CLI 自己的恢复能力和 AgentOS 的跨 Agent 状态包，不擅自更改用户 CLI 配置。 |

### 必须纠正的旧判断

- [Vibe Kanban 2026-04-10 官方公告](https://www.vibekanban.com/blog/shutdown)说明 bloop 关闭、项目继续以开源社区方式维护，远程服务计划退出而本地工作区继续可用。不能把旧的商业云版本描述当作当前可购买能力。
- “其他工具都只做并行会话”“换 Agent 必然从头来”“AgentOS 独有 handoff”等绝对说法缺少横向实测支持。文档没有说明的能力应标为未核实，不能直接判定不存在。
- 本项目的机会是：Windows 上可靠的任务与成果连续性、可携带的可观测上下文、诚实的验证状态和简洁审查。这是产品方向，尚不是已经证明的竞争优势。

## 本轮已落地：把统计页变成可用的代码审查入口

用户可以选择文件，查看任务基线至当前工作区的真实增删内容，包括已暂存/未暂存的已跟踪改动。中文重命名保留源路径，显示在 UI、Capsule JSON、Markdown 与 Context Compiler 中。

点击“填写跟进意见”只填入当前文件位置并聚焦现有输入框，不自动调用模型，不覆盖已有草稿。复用已有 follow-up，未引入第二套聊天、PR 平台或评审状态库。

读取前核验最近 worktree 的注册与分支归属；只接受当前变更清单中的文件，路径按字面解释；关闭 external diff/textconv，避免只读审查调用仓库配置的外部转换命令。文件补丁捕获上限 512 KiB、10 秒；超限明确说明不展示正文，前端最多渲染 3000 行并标注不完整。二进制差异、无变更与读取失败分开显示。补丁内容按纯文本转义。

这些限制只约束逐文件补丁和 DOM，不代表整个大仓库或 Timeline 的性能审计已经完成。清单仍全量计算；运行中的文件也可能在读取期间变化，结果不构成不可变快照。未跟踪文件未直接展示，需通过已有 checkpoint 流程进入 Git。

## 后续优先级与验收条件

| 顺序 | 工作 | 完成条件 |
| --- | --- | --- |
| P0 | 运行中止、服务重启与孤儿 Agent 归属 | 真实 Windows 父子进程故障注入；只处理当前任务进程；不误认正在工作的 Agent 已退出；无关进程与目录保持不变。 |
| P1 | Capsule 上下文与验证证据连续性 | A→B→A、follow-up、首次运行崩溃后接力都保留约束、关键事实和来源；历史测试与当前提交是否匹配明确标注。 |
| P1 | CLI 兼容与环境可复现性 | 明确记录可用二进制、版本、退出结果和实际代码/测试产物；至少两家真实模型走通；契约 Stub 不能替代。 |
| P2 | 长 Timeline / 大仓库审查 | 有代表性数据量与 Windows 基准；历史分页、前端有界显示、重连无丢事件；指标与环境公开，不能凭主观流畅宣称完成。 |
| P2 | 错误恢复与交接解释 | 用户能看懂工作目录、最近结果、可执行的恢复步骤、将被携带/省略的内容；风险操作可预览、产物可保留。 |
| 暂缓 | Workflow Canvas、MCP Hub、更多 Agent、原生壳、团队云平台 | 只有核心闭环成熟且存在具体用户痛点时重新评估，避免增加维护面。 |

## 验证范围

真实 Git/API 回归覆盖实际增删、重命名、字面路径、目录归属、二进制、大补丁与外部转换配置；前端单测覆盖 HTML 转义与 DOM 行数上限；真实浏览器完成局部审查 dogfood。细节见 [验收记录](../dogfood/2026-09-22-code-review.md)和 [QUALITY](../QUALITY.md)。

没有复制竞品源码，没有上传本机代码/凭据给竞品服务，没有调整全局 Agent 安装或认证，没有推送、发布、合入 main 或执行云端测试。Claude/Codex 的既有真实模型阻塞及 Gemini/OpenCode 未安装状态仍按 blockers 记录，未重复调用。
