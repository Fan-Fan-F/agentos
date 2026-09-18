# ADR-002：MVP 用原子写 JSON 存储，SQLite 后置

- 状态：Accepted（2026-09-18）
- 背景：需要持久化 tasks/capsules/events/projects。Node 24 内置 node:sqlite 但仍处 Stability 1.2 Release Candidate；better-sqlite3 为原生模块（Node 24 ABI 曾出问题）。
- 决策：数据目录（默认 `~/.agentos`，可用 `AGENTOS_HOME` 覆盖）下按实体分目录的 JSON 存储 + JSONL 事件日志，写入一律"临时文件 + rename"原子替换；所有访问经 `Store`/`EventLog` 接口。SQLite（node:sqlite）作为 M2 优化，接口不变。
- 理由：零原生依赖（研究教训：Node 24 ABI 预编译坑）；数据人可读可手改可备份；事件日志天然 JSONL。
- 后果：大规模查询性能在数据量大后需迁移 SQLite；迁移由接口层完成，调用方无感。
