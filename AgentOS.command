#!/bin/bash
# AgentOS macOS 启动器（双击运行）
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "[AgentOS] 未检测到 Node.js，请先安装：https://nodejs.org"
  read -r -p "按回车退出…" _
  exit 1
fi
if [ ! -f "packages/server/dist/index.js" ]; then
  echo "[AgentOS] 首次运行：安装依赖并构建（约 1-2 分钟）..."
  npm install --no-audit --no-fund && npm run build || { echo "[AgentOS] 构建失败"; read -r -p "按回车退出…" _; exit 1; }
fi
node scripts/desktop.mjs
