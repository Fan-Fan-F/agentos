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
