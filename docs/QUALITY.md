# Product Quality Scorecard

> 用途：定位最弱环节，驱动迭代优先级。禁止用加分自我庆祝；只允许通过修复最低项提高分数。
> 评分 1-5，每项必须附证据与"下一步"。（夜间迭代后更新：2026-09-19）

| 维度 | 分数 | 证据 | 下一步 |
|---|---|---|---|
| Reliability | **3.8** | 72 测试全绿；故障注入套件（真实子进程超时/杀树/坏输出/stderr/stdin 合同）；真实 E2E 失败路径全部可诊断、可行动、可恢复 | 解除 blockers 后重跑 real-e2e 验证成功路径 |
| Recoverability | 4.0 | recoverAll/restart/Store 容错/task 删除均测试；探针失败自动跳过 | 无新行动项 |
| Session Portability | 3.5 | Capsule 链 + HANDOFF.md 提交到分支已真实验证；七问回答待 agent 可用后验证 | 随 real-e2e 成功路径验证 |
| Context Fidelity | 3.5 | 预算裁剪有测试；真实效果待 agent 可用后对比 | 同上 |
| Agent Interoperability | **3.2** | 真实调用已发生：claude/codex 启动、输出解析、错误诊断全链路真实验证；产出半程被用户侧阻塞（blockers.md） | 用户充值/升级后重跑 |
| UX Simplicity | 4.5 | waiting 语义（turn≠任务）、WS 自动重连、⚠诊断信息直达 UI、成本徽标 | 无新行动项 |
| Performance | 3.0 | 未测大仓库/长 Timeline（EventLog readAll 无上限，已记录） | 明确卡到体验时再做 |
| Security | 4.5 | 只读发现/凭据零接触/flag 黑名单/诊断层不引入 secret | 无新行动项 |
| Test Coverage | 4.5 | 72 项：unit/integration/contract/handoff/recovery/failure-injection/diagnose/api | 保持 |
| Compatibility | 3.0 | Windows 实测充分（launcher/doctor/E2E）；mac/linux 仅 CI 配置，**Not Verified** | CI 首跑后更新 |

**当前最弱环节**：Agent Interoperability 与 Session Portability 的"成功半程" —— 均被两个用户侧外部问题阻塞（claude 账户 402、codex CLI 过旧，见 docs/blockers.md）。解除后重跑 `npm run e2e` 即为最高优先级。

