import { CAPSULE_SCHEMA_VERSION, CapsuleSchemaV1, CapsuleVersionError, type Capsule, type CapsuleInput } from './schema.js';
import { newId, nowIso } from '../ids.js';

export * from './schema.js';

export function createCapsule(input: Omit<CapsuleInput, 'schemaVersion' | 'id' | 'createdAt' | 'updatedAt'>): Capsule {
  const now = nowIso();
  return CapsuleSchemaV1.parse({
    schemaVersion: CAPSULE_SCHEMA_VERSION,
    id: newId('cap'),
    createdAt: now,
    updatedAt: now,
    ...input,
  });
}

/** 解析并校验；遇到更高 schemaVersion 显式报错（版本前向策略，ADR-004）。 */
export function parseCapsule(json: unknown): Capsule {
  if (typeof json === 'object' && json !== null && 'schemaVersion' in json) {
    const v = (json as { schemaVersion?: unknown }).schemaVersion;
    if (typeof v === 'number' && v > CAPSULE_SCHEMA_VERSION) {
      throw new CapsuleVersionError(v);
    }
  }
  return CapsuleSchemaV1.parse(json);
}

const bullet = (items: string[], empty = '（无）'): string =>
  items.length ? items.map((s) => `- ${s}`).join('\n') : `- ${empty}`;

/** 人可读 Markdown 视图（handoff 包与用户查看共用）。 */
export function capsuleToMarkdown(c: Capsule): string {
  const lines: string[] = [];
  lines.push(`# Session Capsule ${c.id}`);
  lines.push('');
  lines.push(`- schemaVersion: ${c.schemaVersion}`);
  lines.push(`- 生成时间: ${c.updatedAt}`);
  lines.push(`- 来源 agent: ${c.origin.agentId}${c.origin.sessionId ? ` (session ${c.origin.sessionId})` : ''}`);
  if (c.origin.resumedFromCapsuleId) lines.push(`- 接管自 capsule: ${c.origin.resumedFromCapsuleId}`);
  lines.push(`- 状态: ${c.status}`);
  lines.push('');
  lines.push('## 任务目标');
  lines.push(c.task.objective);
  if (c.task.constraints.length) {
    lines.push('');
    lines.push('## 约束');
    lines.push(bullet(c.task.constraints));
  }
  if (c.task.userInstructions.length) {
    lines.push('');
    lines.push('## 用户指令');
    lines.push(bullet(c.task.userInstructions));
  }
  lines.push('');
  lines.push('## 已完成工作');
  lines.push(bullet(c.progress.completed));
  lines.push('');
  lines.push('## 剩余工作');
  lines.push(bullet(c.progress.remaining));
  if (c.progress.decisions.length) {
    lines.push('');
    lines.push('## 已定决策');
    lines.push(
      c.progress.decisions
        .map((d) => `- ${d.summary}${d.rationale ? `（理由: ${d.rationale}）` : ''}${d.byAgent ? ` [${d.byAgent}]` : ''}${d.superseded ? '（已废弃）' : ''}`)
        .join('\n'),
    );
  }
  if (c.progress.rejectedApproaches.length) {
    lines.push('');
    lines.push('## 已否决方案');
    lines.push(c.progress.rejectedApproaches.map((r) => `- ${r.approach} — 否决理由: ${r.reason}`).join('\n'));
  }
  lines.push('');
  lines.push('## 工作区');
  lines.push(`- repo: ${c.workspace.repoRoot}`);
  if (c.workspace.branch) lines.push(`- 分支: ${c.workspace.branch}`);
  if (c.workspace.baseCommit) lines.push(`- 基线 commit: ${c.workspace.baseCommit}`);
  if (c.workspace.worktreePath) lines.push(`- worktree: ${c.workspace.worktreePath}`);
  if (c.workspace.changedFiles.length) {
    lines.push('- 变更文件:');
    lines.push(c.workspace.changedFiles.map((f) => `  - [${f.change}] ${f.path}`).join('\n'));
  }
  if (c.workspace.diffStat) {
    lines.push('');
    lines.push('```');
    lines.push(c.workspace.diffStat.trim());
    lines.push('```');
  }
  if (c.workspace.commits.length) {
    lines.push('');
    lines.push('## Commits');
    lines.push(c.workspace.commits.map((x) => `- ${x.hash} ${x.message}`).join('\n'));
  }
  if (c.verification.tests.length) {
    lines.push('');
    lines.push('## 验证');
    lines.push(
      c.verification.tests
        .map((t) => `- \`${t.command}\` — 通过 ${t.passed} / 失败 ${t.failed}${t.summary ? `（${t.summary}）` : ''}`)
        .join('\n'),
    );
  }
  if (c.context.keyFacts.length) {
    lines.push('');
    lines.push('## 关键事实');
    lines.push(bullet(c.context.keyFacts));
  }
  if (c.handoff.summary) {
    lines.push('');
    lines.push('## 交接摘要');
    lines.push(c.handoff.summary);
  }
  if (c.handoff.fromAgent || c.handoff.toAgent) {
    lines.push('');
    lines.push(`- 交接: ${c.handoff.fromAgent ?? '?'} → ${c.handoff.toAgent ?? '?'}`);
  }
  return lines.join('\n');
}
