# ADR-005：跨 Agent 接管 = 内联上下文 + HANDOFF.md + 七问验证

- 状态：Accepted（2026-09-18）
- 决策：Agent Hot Swap 流程固定为：
  1. 源 agent 会话状态 → Capsule（保存）；
  2. Context Compiler 按 budget 生成上下文（minimal/standard/full）；
  3. 目标 agent 在**从源分支新建的独立 worktree** 中启动（改动随分支带走）；
  4. 交接包双通道投递：长文写入目标 worktree `.agentos/HANDOFF.md`，同时内联进首条 prompt；
  5. 发送**七问验证探针**（当前任务？已完成？已否决方案？改了哪些文件？测试通过？测试失败？下一步？），回答入 Timeline，作为"再水化成功"的证据。
- 理由：同 agent 续接优先原生 resume（Claude/Codex/OpenCode）；跨 agent 只有 capsule 通道可保证"无需用户重新解释"。七问把"交接是否成功"变成可测试断言（contract test 用 stub 断言探针与上下文标记）。
- 禁止：把完整 transcript 无编译地塞给目标 agent（上下文污染）。


## 2026-09-21 上下文保真补充

编译预算优先保证约束、用户指令、权限约定、当前状态、工作区定位和已记录的验证信息；文件清单独立于工作区定位，可与其他历史内容按预算省略。正文必须标明被省略的段落；核心内容超过预算时显式失败，由调用方选择更大的级别或缩短核心内容后重试。API 的 minimal/standard/full 仅控制上下文预算，与权限档位完全独立。未记录测试结果须明确提示未知，不把 Agent 自述当作测试通过证据。该规则不新增测试执行或结果采集能力。
