# Product Quality Scorecard

> 用途：定位最弱环节，驱动夜间迭代优先级。禁止用加分自我庆祝；只允许通过修复最低项提高分数。
> 评分 1-5，每项必须附证据与"下一步"。更新于每轮迭代后。

| 维度 | 分数 | 证据 | 下一步 |
|---|---|---|---|
| Reliability | **3.0** | 61 测试全绿；但核心闭环（真实 agent E2E）从未真实运行过 | **今晚 P0：真实 E2E（dogfooding）** |
| Recoverability | 4.0 | recoverAll/restart 测试通过；Store 坏记录容错；task 删除可清理 worktree | 故障注入：杀进程/超时自动化测试 |
| Session Portability | 3.5 | Capsule 链 + 七问探针 stub 验证；真实 agent 未验证 | 真实 handoff 中验证九要素传递 |
| Context Fidelity | 3.5 | Compiler 预算裁剪有测试；但"最小上下文是否足够"未经真实任务检验 | E2E 中对比 minimal/standard 效果 |
| Agent Interoperability | **2.5** | 四家适配器仅有 schema 样本解析测试 + stub 契约；真实二进制 0 次调用 | **今晚 P0：真实调用 claude/codex** |
| UX Simplicity | 4.0 | 向导/空态/设置持久化/截图验证；turn 完成≠任务完成的语义混乱待修 | waiting 状态语义修正 |
| Performance | 3.0 | 未测大仓库/长 Timeline（EventLog readAll 无上限） | 记录为已知限制，暂不优化 |
| Security | 4.5 | 只读发现/凭据零接触/flag 黑名单；无 secret 存储 | 无进一步行动项 |
| Test Coverage | 4.0 | 61 项覆盖核心路径；故障注入类缺失 | R4 补齐 |
| Compatibility | 3.0 | Windows 实测（launcher/doctor/doctor 冒烟）；mac/linux 仅 CI 计划，**Not Verified** | CI 运行后更新 |

**结论（本轮最弱环节）**：Agent Interoperability 与 Reliability —— 核心价值"任意 agent 接管任意 agent 的工作"从未被真实 agent 验证。今晚优先做真实 E2E dogfooding，其次故障注入。
