@echo off
chcp 65001 >nul
title AgentOS
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [AgentOS] 未检测到 Node.js，请先安装：https://nodejs.org
  pause
  exit /b 1
)
if not exist "packages\server\dist\index.js" (
  echo [AgentOS] 首次运行：安装依赖并构建（约 1-2 分钟）...
  call npm install --no-audit --no-fund
  if errorlevel 1 ( echo [AgentOS] 安装失败，请检查网络 & pause & exit /b 1 )
  call npm run build
  if errorlevel 1 ( echo [AgentOS] 构建失败 & pause & exit /b 1 )
)
node scripts\desktop.mjs
pause
