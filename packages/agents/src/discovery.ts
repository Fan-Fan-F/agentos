import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AGENT_CATALOG, catalogEntry } from './catalog.js';
import { findInPath, getNpmGlobalRoot, probeVersion } from './where.js';
import type { DiscoveredAgent, AuthStatus } from '@agentos/core';

/**
 * 本机 Agent 自动发现（ADR-006，只读）：
 * PATH 存在性扫描 + npm 全局目录匹配 + 家目录标记 stat。
 * 绝不读取凭据内容，绝不执行 agent 二进制 —— 版本探测仅在 probe=true（用户显式触发）时进行。
 */

export interface ScanOptions {
  homeDir?: string;
  pathEnv?: string;
  /** 传入 null 可在测试中跳过 npm 探测；缺省时运行 `npm root -g` */
  npmGlobalRoot?: string | null;
  /** 深度检测：执行 `<bin> --version`（默认 false，需要用户显式触发） */
  probe?: boolean;
}

function statExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

export async function scanAgents(opts: ScanOptions = {}): Promise<DiscoveredAgent[]> {
  const home = opts.homeDir ?? os.homedir();
  const npmRoot = opts.npmGlobalRoot === undefined ? await getNpmGlobalRoot() : opts.npmGlobalRoot;

  const results = await Promise.all(
    AGENT_CATALOG.map(async (entry): Promise<DiscoveredAgent> => {
      const binaries = findInPath(entry.binaries[0]!, opts.pathEnv);

      // 家目录标记（仅存在性）
      const homeMarkersFound: string[] = [];
      for (const marker of entry.homeMarkers) {
        const p = path.join(home, marker);
        if (statExists(p)) homeMarkersFound.push(marker);
      }

      // 登录状态（仅标记存在性）
      let auth: AuthStatus = 'unknown';
      if (entry.authMarkers.length) {
        const hasAuth = entry.authMarkers.some((m) => statExists(path.join(home, m)));
        auth = hasAuth ? 'ok' : (binaries.length > 0 ? 'unknown' : 'unknown');
      }

      // npm 全局安装来源
      let installSource: DiscoveredAgent['installSource'];
      if (entry.npmPackage && npmRoot) {
        const parts = entry.npmPackage.split('/');
        const pkgDir = path.join(npmRoot, ...parts);
        if (statExists(pkgDir)) installSource = 'npm';
      }

      let version: string | undefined;
      if (opts.probe && binaries[0]) {
        version = await probeVersion(binaries[0]);
      }

      const status: DiscoveredAgent['status'] = binaries.length > 0 ? 'installed' : 'not-installed';

      return {
        id: entry.id,
        name: entry.name,
        status,
        binaries,
        version,
        installSource,
        npmPackage: entry.npmPackage,
        auth,
        protocols: entry.protocols,
        capabilities: entry.capabilities,
        homeMarkersFound,
      };
    }),
  );

  return results;
}

export { catalogEntry };
