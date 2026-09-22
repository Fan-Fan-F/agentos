import type { Capsule } from '../capsule/schema.js';

/**
 * Context Compiler（ADR-005）：不是把完整历史塞给下一个 agent，
 * 而是按预算从 capsule 中挑选相关内容，输出可追踪的上下文包。
 */

export type ContextLevel = 'minimal' | 'standard' | 'full';

export const CONTEXT_BUDGETS: Record<ContextLevel, number> = {
  minimal: 6000,
  standard: 24000,
  full: 120000,
};

export interface ContextSection {
  name: string;
  /** 越小越先保留 */
  priority: number;
  text: string;
}

export interface CompiledContext {
  markdown: string;
  capsuleId: string;
  level: ContextLevel;
  budgetChars: number;
  usedChars: number;
  includedSections: string[];
  droppedSections: string[];
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…（已截断）`;
}

function bullet(items: string[]): string {
  return items.map((s) => `- ${s}`).join('\n');
}

export function buildSections(c: Capsule): ContextSection[] {
  const sections: ContextSection[] = [];
  sections.push({ name: 'task-objective', priority: 1, text: `## 任务目标\n${truncate(c.task.objective, 4000)}` });
  if (c.task.constraints.length) {
    sections.push({ name: 'constraints', priority: 2, text: `## 约束\n${bullet(c.task.constraints)}` });
  }
  if (c.task.userInstructions.length) {
    sections.push({ name: 'user-instructions', priority: 2, text: `## 用户指令（必须遵守）\n${bullet(c.task.userInstructions)}` });
  }
  if (c.permissions.expectations.length) {
    sections.push({ name: 'permissions', priority: 2, text: `## 权限约定\n${bullet(c.permissions.expectations)}` });
  }
  sections.push({ name: 'status', priority: 2, text: `## 当前状态\n${c.status}` });
  if (c.progress.completed.length) {
    sections.push({ name: 'completed', priority: 3, text: `## 已完成（不要重做）\n${bullet(c.progress.completed)}` });
  }
  if (c.progress.remaining.length) {
    sections.push({ name: 'remaining', priority: 3, text: `## 剩余工作\n${bullet(c.progress.remaining)}` });
  }
  if (c.progress.decisions.length) {
    sections.push({
      name: 'decisions',
      priority: 4,
      text: `## 已定决策（除非有充分理由并说明，否则遵守）\n${bullet(
        c.progress.decisions.map((d) => `${d.summary}${d.rationale ? ` — 理由: ${d.rationale}` : ''}${d.superseded ? '（已废弃）' : ''}`),
      )}`,
    });
  }
  if (c.progress.rejectedApproaches.length) {
    sections.push({
      name: 'rejected',
      priority: 5,
      text: `## 已否决方案（不要重提）\n${bullet(c.progress.rejectedApproaches.map((r) => `${r.approach} — 否决理由: ${r.reason}`))}`,
    });
  }
  if (c.handoff.summary) {
    sections.push({ name: 'handoff-summary', priority: 5, text: `## 交接摘要（来自 ${c.handoff.fromAgent ?? '上一 agent'}）\n${truncate(c.handoff.summary, 4000)}` });
  }
  const wsLines: string[] = [`- repo: ${c.workspace.repoRoot}`];
  if (c.workspace.branch) wsLines.push(`- 分支: ${c.workspace.branch}（变更都在此分支上）`);
  if (c.workspace.baseCommit) wsLines.push(`- 基线: ${c.workspace.baseCommit}`);
  if (c.workspace.worktreePath) wsLines.push(`- worktree: ${c.workspace.worktreePath}`);
  sections.push({ name: 'workspace', priority: 6, text: `## 工作区\n${wsLines.join('\n')}` });
  if (c.workspace.changedFiles.length) {
    sections.push({ name: 'changed-files', priority: 7, text: `## 变更文件\n${bullet(c.workspace.changedFiles.map(f => `[${f.change}] ${f.previousPath ? f.previousPath + ' → ' : ''}${f.path}`))}` });
  }
  if (c.workspace.diffStat) {
    sections.push({ name: 'diff-stat', priority: 10, text: `## Diff 统计\n\`\`\`\n${truncate(c.workspace.diffStat.trim(), 3000)}\n\`\`\`` });
  }
  if (c.workspace.commits.length) {
    sections.push({ name: 'commits', priority: 7, text: `## 本任务 commits\n${bullet(c.workspace.commits.map((x) => `${x.hash} ${x.message}`))}` });
  }
  if (c.verification.tests.length) {
    sections.push({
      name: 'verification',
      priority: 8,
      text: `## 验证状态\n${bullet(c.verification.tests.map((t) => `\`${t.command}\` — 通过 ${t.passed} / 失败 ${t.failed}${t.summary ? `（${t.summary}）` : ''}`))}`,
    });
  }
  if (!c.verification.tests.length) {
    sections.push({ name: 'verification', priority: 8, text: '## 验证状态\n未记录测试结果，不能据此认定测试通过。Agent 的完成回复不等于独立验证。' });
  }
  if (c.context.keyFacts.length) {
    sections.push({ name: 'key-facts', priority: 9, text: `## 关键事实\n${bullet(c.context.keyFacts)}` });
  }
  const envEntries = Object.entries(c.context.environment);
  if (envEntries.length) {
    sections.push({ name: 'environment', priority: 11, text: `## 环境\n${bullet(envEntries.map(([k, v]) => `${k}: ${v}`))}` });
  }
  if (c.artifacts.length) {
    sections.push({ name: 'artifacts', priority: 12, text: `## 产出物\n${bullet(c.artifacts.map((a) => `${a.name}${a.path ? ` (${a.path})` : ''}`))}` });
  }
  return sections;
}

export function compileContext(capsule: Capsule, level: ContextLevel = 'standard'): CompiledContext {
  if (!Object.hasOwn(CONTEXT_BUDGETS, level)) throw new Error(`未知上下文级别: ${level}`);
  const budget = CONTEXT_BUDGETS[level];
  const sections = buildSections(capsule).sort((a, b) => a.priority - b.priority);
  const required = new Set(['task-objective', 'constraints', 'user-instructions', 'permissions', 'status', 'workspace', 'verification']);
  const included = new Set(sections.filter(section => required.has(section.name)).map(section => section.name));
  const header =
    `<!-- Context compiled by AgentOS · capsule=${capsule.id} · level=${level} · generated=${new Date().toISOString()} -->\n\n` +
    `你正在接管另一个 AI agent（${capsule.origin.agentId}）未完成的工作。以下是经编译的任务上下文。\n`;

  const render = () => {
    const dropped = sections.filter(section => !included.has(section.name)).map(section => section.name);
    const notice = dropped.length ? `\n\n## 上下文省略\n以下段落因预算省略：${dropped.join(', ')}。省略不表示这些信息不存在；需要时读取原始 Capsule。` : '';
    return header + sections.filter(section => included.has(section.name)).map(section => section.text).join('\n\n') + notice;
  };
  // Never silently drop user constraints or failed verification to make history fit.
  if (render().length > budget) {
    throw new Error(`核心交接上下文超过 ${level} 的 ${budget} 字符预算；请缩短核心内容或使用更大的上下文级别。未生成缺失约束的交接包。`);
  }
  for (const section of sections) {
    if (included.has(section.name)) continue;
    included.add(section.name);
    if (render().length > budget) included.delete(section.name);
  }
  const markdown = render();
  return {
    markdown,
    capsuleId: capsule.id,
    level,
    budgetChars: budget,
    usedChars: markdown.length,
    includedSections: sections.filter(section => included.has(section.name)).map(section => section.name),
    droppedSections: sections.filter(section => !included.has(section.name)).map(section => section.name),
  };
}
