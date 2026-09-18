import fs from 'node:fs';
import path from 'node:path';
import { compileContext, capsuleToMarkdown, type Capsule, type ContextLevel } from '@agentos/core';

/**
 * Handoff 管线（ADR-005）：
 * capsule → ContextCompiler → 目标 agent（内联上下文 + worktree 内 .agentos/HANDOFF.md）→ 七问验证探针。
 */

export const HANDOFF_DIR = '.agentos';
export const HANDOFF_FILE = 'HANDOFF.md';

export const CHECKPOINT_QUESTIONS = [
  '当前任务是什么？',
  '之前完成了什么？',
  '哪些方案已经被否决？',
  '修改了哪些文件？',
  '哪些测试通过？',
  '哪些测试失败（如有）？',
  '下一步应该干什么？',
] as const;

export function buildHandoffPreamble(capsule: Capsule, toAgentId: string): string {
  return [
    `你（${toAgentId}）正在接管另一个 AI agent（${capsule.origin.agentId}）在仓库 ${capsule.workspace.repoRoot} 中未完成的工作。`,
    '规则：',
    '- 不要重做已完成的工作；不要重新解释项目。',
    '- 已定决策必须遵守；确需偏离时先说明理由。',
    '- 已否决的方案不要再提。',
    '- 所有变更都发生在当前分支上，先查看 git 状态再动手。',
  ].join('\n');
}

export interface HandoffPackage {
  prompt: string;
  handoffMd: string;
  contextMd: string;
  handoffFilePath: string;
  includedSections: string[];
  droppedSections: string[];
}

export function buildHandoffPrompt(capsule: Capsule, toAgentId: string, level: ContextLevel = 'standard'): HandoffPackage {
  const compiled = compileContext(capsule, level);
  const handoffMd = [
    `# Handoff：${capsule.origin.agentId} → ${toAgentId}`,
    '',
    capsuleToMarkdown(capsule),
    '',
    '---',
    '接管者开始工作前，请先逐条回答以下检查点（确认你已理解当前局面，不要重新解释项目）：',
    ...CHECKPOINT_QUESTIONS.map((q, i) => `${i + 1}. ${q}`),
  ].join('\n');

  const prompt = [
    buildHandoffPreamble(capsule, toAgentId),
    '',
    '=== 交接上下文（由 AgentOS Context Compiler 编译）===',
    compiled.markdown,
    '=== 交接上下文结束 ===',
    '',
    `完整的交接文档已写入当前工作目录的 ${HANDOFF_DIR}/${HANDOFF_FILE}，如需细节可读取该文件。`,
    '',
    '开始工作前，先用一小段话逐条回答以下检查点：',
    ...CHECKPOINT_QUESTIONS.map((q, i) => `${i + 1}. ${q}`),
    '',
    '回答完毕后，直接继续完成剩余工作，不要等待用户确认。',
  ].join('\n');

  return {
    prompt,
    handoffMd,
    contextMd: compiled.markdown,
    handoffFilePath: path.join(HANDOFF_DIR, HANDOFF_FILE),
    includedSections: compiled.includedSections,
    droppedSections: compiled.droppedSections,
  };
}

/** 七问验证探针：确认目标 agent 已经"再水化"（回答会进入 Timeline 作为证据）。 */
export function buildVerifyProbe(): string {
  return [
    '（AgentOS 交接验证，无需执行任何工具）',
    '请仅凭你已获得的上下文，逐条简短回答：',
    ...CHECKPOINT_QUESTIONS.map((q, i) => `${i + 1}. ${q}`),
  ].join('\n');
}

export function writeHandoffFile(worktreePath: string, handoffMd: string): string {
  const dir = path.join(worktreePath, HANDOFF_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, HANDOFF_FILE);
  fs.writeFileSync(file, handoffMd, 'utf8');
  return file;
}
