#!/usr/bin/env node
/**
 * AgentOS 桌面启动器：
 * 启动本地服务并以「app 模式」打开独立窗口（无边框、无地址栏 —— 桌面应用观感）。
 * Windows 优先 Edge/Chrome 的 --app 窗口；无则回退默认浏览器。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

if (!fs.existsSync(path.join(root, 'packages', 'server', 'dist', 'index.js'))) {
  console.error('[AgentOS] 尚未构建。请先运行：npm install && npm run build');
  console.error('[AgentOS] 或一键完成：node scripts/setup.mjs');
  process.exit(1);
}

const { startAgentOSServer } = await import('@agentos/server');
const server = await startAgentOSServer({ port: Number(process.env.AGENTOS_PORT ?? 7333) });
console.log(`[AgentOS] 已启动: ${server.url}`);
console.log(`[AgentOS] 数据目录: ${server.dataDir}（所有数据留在本机）`);

function openAppWindow(url) {
  const appArg = `--app=${url}`;
  const candidates =
    process.platform === 'win32'
      ? [
          ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'],
          ['C:/Program Files/Google/Chrome/Application/chrome.exe'],
          [process.env.LOCALAPPDATA?.replace(/\\/g, '/'), 'Google/Chrome/Application/chrome.exe'],
        ].filter((c) => c.length === 1 && c[0])
      : process.platform === 'darwin'
        ? [
            ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
            ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
          ]
        : [['google-chrome'], ['chromium'], ['chromium-browser']];

  for (const [cmd] of candidates) {
    try {
      if (cmd.includes('/') && process.platform === 'win32' && !fs.existsSync(cmd)) continue;
      const child = spawn(cmd, [appArg], { detached: true, stdio: 'ignore', windowsHide: true });
      child.on('error', () => {});
      child.unref();
      return true;
    } catch {
      // 尝试下一个候选
    }
  }
  // 兜底：默认浏览器普通标签页
  try {
    if (process.platform === 'win32') spawn('cmd.exe', ['/d', '/s', '/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    console.log(`[AgentOS] 请手动在浏览器打开 ${url}`);
  }
  return false;
}

const opened = openAppWindow(server.url);
console.log(opened ? '[AgentOS] 已在独立窗口打开。' : '[AgentOS] 已在默认浏览器打开。');
console.log('[AgentOS] 按 Ctrl+C 停止服务。');

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
