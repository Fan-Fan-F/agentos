# 研究：技术选型事实（PTY / SQLite / Tauri / worktree）

> 调研日期：2026-09-18。AgentOS 研究笔记。

## Node.js 生态

- **PTY**：`@lydell/node-pty`（microsoft/node-pty 的预编译发行版）**只走预编译二进制、绝不调用 node-gyp**，平台二进制独立发包（`@lydell/node-pty-win32-x64` 等），最新 ~v1.2.0-beta（https://www.npmjs.com/package/@lydell/node-pty）；已知问题：Windows 11 个别安装 `conpty.node` 缺失（2025-12）。原版 node-pty 需要 Windows/Unix 各自构建链。
  → **决策：MVP 无头模式用 `child_process` 管道（零原生依赖）；交互式 TUI 模式（M5）再引入 @lydell/node-pty。**
- **SQLite**：Node 24 内置 `node:sqlite`，但官方文档（直至 v26.x）仍标 **Stability 1.2 – Release Candidate**（LogRocket "Node.js 24 features"；nodejs.org docs）。
  → **决策：MVP 用原子写 JSON 存储（Store 接口隔离）；SQLite 列为 M2 可选升级，接口不变。**
- 原生模块在 Node 24 的 ABI 坑：2025 年 `node-abi` v3.75 曾缺 Node 24 最终 ABI 导致 prebuild-install 失败（GitHub）。→ MVP 尽量零原生依赖，符合此教训。

## Tauri 2 + Node sidecar（桌面分发）

- Tauri 官方支持把外部二进制作为 **sidecar** 嵌入，需 shell 插件并授予 execute/spawn 权限（https://v2.tauri.app/develop/sidecar/）。
- Tauri 团队明确：sidecar 就是"旁边跑一个独立 Node 进程"，UI 通过 IPC/HTTP 与之通信，Tauri 本身与 Node 无关（GitHub #7037）；实践教程：dev.to "Adding Node.js server to Tauri App as a sidecar"。
- 同类轻分发先例：LM Studio / Ollama = "本地服务 + 浏览器/桌面 UI"。
  → **决策：核心保持 `本地 Node 服务 + 静态 Web UI`（本里程碑）；Tauri 2 仅作后续外壳（M5），sidecar 打包 Node 服务，Windows 需 Rust 工具链 + WebView2。**

## Git worktree 实战坑（多 agent 并行的依据）

1. **同一分支不能同时 checkout 到两个 worktree**（git 硬约束）→ 每个 agent 必须有独立分支命名（AgentOS：`agentos/<taskId>/<agentId>`）。
2. **`index.lock` 争用**：多进程同 repo 写操作需串行化/重试。
3. **node_modules 不共享**：worktree 是全新目录，依赖要重装或用包管理器 store 硬链接（pnpm）——影响 fork 成本评估。
4. **Windows**：路径长度（`git config core.longpaths true`）、大小写不敏感文件系统冲突；worktree 放在**仓库外的兄弟目录**更干净（放在 repo 内会污染父仓库 status）。
5. 主流工具对策：vibe-kanban 每任务独立 worktree + 可选 nix/devcontainer 初始化脚本；claude-squad 用 tmux + worktree（非 Windows）。AgentOS 采用：仓库兄弟目录 `.agentos-worktrees/<repoName>/` + setup 命令钩子（M2）。
