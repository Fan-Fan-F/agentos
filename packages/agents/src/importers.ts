import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createCapsule, nowIso, type Capsule } from '@agentos/core';

/**
 * 会话导入器（M2，只读）：
 * 把用户之前在裸 Claude Code / Codex CLI 里产生的会话（磁盘 JSONL）转换为 Universal Session Capsule，
 * 让任意 agent 可以接管"平台外"的历史工作。全程只读、容错解析（私有 schema 会漂移），
 * 绝不写入、绝不移动用户目录中的任何文件。
 */

export interface ImportedSessionSummary {
  source: 'claude' | 'codex';
  sessionId: string;
  file: string;
  mtimeMs: number;
  cwd?: string;
  /** 首条用户消息预览（≤120 字符） */
  preview: string;
  messageCount: number;
}

type Line = Record<string, unknown>;

async function readLines(file: string, maxLines = Number.POSITIVE_INFINITY): Promise<Line[]> {
  let raw: string;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch {
    return [];
  }
  const out: Line[] = [];
  for (const line of raw.split('\n')) {
    if (out.length >= maxLines) break;
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as Line);
    } catch {
      // 容错：坏行跳过
    }
  }
  return out;
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === 'object' && typeof (b as Record<string, unknown>)['text'] === 'string' ? (b as Record<string, unknown>)['text'] as string : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

async function* jsonlFilesUnder(dir: string): AsyncGenerator<string> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* jsonlFilesUnder(p);
    else if (e.isFile() && e.name.endsWith('.jsonl')) yield p;
  }
}

/* ---------------- Claude Code：~/.claude/projects/<escaped-cwd>/<uuid>.jsonl ---------------- */

export function defaultClaudeProjectsDir(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

interface ParsedConversation {
  sessionId?: string;
  cwd?: string;
  userTexts: string[];
  assistantTexts: string[];
}

function parseClaudeLine(line: Line, acc: ParsedConversation): void {
  if (typeof line['sessionId'] === 'string' && !acc.sessionId) acc.sessionId = line['sessionId'];
  if (typeof line['cwd'] === 'string' && !acc.cwd) acc.cwd = line['cwd'];
  if (line['type'] === 'user' && !line['isSidechain']) {
    const message = line['message'] as { content?: unknown } | undefined;
    const text = textFromContent(message?.content);
    if (text.trim() && !text.startsWith('<')) acc.userTexts.push(text); // 过滤系统注入的 XML 块
  }
  if (line['type'] === 'assistant' && !line['isSidechain']) {
    const message = line['message'] as { content?: unknown } | undefined;
    const text = textFromContent(message?.content);
    if (text.trim()) acc.assistantTexts.push(text);
  }
}

export async function listClaudeSessions(projectsDir = defaultClaudeProjectsDir()): Promise<ImportedSessionSummary[]> {
  const out: ImportedSessionSummary[] = [];
  for await (const file of jsonlFilesUnder(projectsDir)) {
    const lines = await readLines(file, 80);
    const acc: ParsedConversation = { userTexts: [], assistantTexts: [] };
    for (const l of lines) parseClaudeLine(l, acc);
    if (!acc.userTexts.length && !acc.sessionId) continue;
    let mtimeMs = 0;
    try {
      mtimeMs = (await fsp.stat(file)).mtimeMs;
    } catch {
      continue;
    }
    out.push({
      source: 'claude',
      sessionId: acc.sessionId ?? path.basename(file, '.jsonl'),
      file,
      mtimeMs,
      cwd: acc.cwd,
      preview: truncate(acc.userTexts[0] ?? '', 120),
      messageCount: acc.userTexts.length + acc.assistantTexts.length,
    });
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 100);
}

export async function claudeSessionToCapsule(file: string, opts: { objective?: string } = {}): Promise<Capsule> {
  const lines = await readLines(file);
  const acc: ParsedConversation = { userTexts: [], assistantTexts: [] };
  for (const l of lines) parseClaudeLine(l, acc);
  const sessionId = acc.sessionId ?? path.basename(file, '.jsonl');
  const objective = opts.objective?.trim() || acc.userTexts[0] || `（导入的 Claude Code 会话 ${sessionId}）`;
  const lastAssistant = acc.assistantTexts.at(-1) ?? '';
  return createCapsule({
    task: { id: 'imported', objective },
    status: 'in-progress',
    origin: { agentId: 'claude', sessionId },
    progress: {},
    workspace: { repoRoot: acc.cwd ?? '' },
    handoff: {
      fromAgent: 'claude',
      summary: lastAssistant
        ? `（由 Claude Code 会话导入，共 ${acc.userTexts.length + acc.assistantTexts.length} 条消息）最近一段回复：\n${truncate(lastAssistant, 2000)}`
        : `（由 Claude Code 会话导入，共 ${acc.userTexts.length + acc.assistantTexts.length} 条消息）`,
    },
    context: { keyFacts: [`导入自 Claude Code 会话文件 ${path.basename(file)}`], environment: { importedAt: nowIso() } },
    extensions: { 'agentos.import': { source: 'claude', file, importedAt: nowIso() } },
  });
}

/* ---------------- Codex CLI：~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl ---------------- */

export function defaultCodexSessionsDir(): string {
  return path.join(os.homedir(), '.codex', 'sessions');
}

interface CodexAcc extends ParsedConversation {
  /** rollout 的 envelope：{timestamp, type, payload} */
}

function parseCodexLine(line: Line, acc: CodexAcc): void {
  const payload = (line['payload'] ?? line) as Record<string, unknown>;
  const type = (payload['type'] ?? line['type']) as string | undefined;
  if (type === 'session_meta') {
    if (typeof payload['id'] === 'string' && !acc.sessionId) acc.sessionId = payload['id'];
    if (typeof payload['cwd'] === 'string' && !acc.cwd) acc.cwd = payload['cwd'];
    return;
  }
  if (type === 'message') {
    const role = payload['role'] as string | undefined;
    const content = payload['content'];
    let text = '';
    if (Array.isArray(content)) {
      text = content
        .map((c) => (c && typeof c === 'object' ? ((c as Record<string, unknown>)['text'] ?? '') as string : ''))
        .filter(Boolean)
        .join('\n');
    } else if (typeof content === 'string') {
      text = content;
    }
    if (!text.trim()) return;
    if (role === 'user' && !text.startsWith('<')) acc.userTexts.push(text);
    if (role === 'assistant') acc.assistantTexts.push(text);
  }
}

export async function listCodexSessions(sessionsDir = defaultCodexSessionsDir()): Promise<ImportedSessionSummary[]> {
  const out: ImportedSessionSummary[] = [];
  for await (const file of jsonlFilesUnder(sessionsDir)) {
    if (!path.basename(file).startsWith('rollout-')) continue;
    const lines = await readLines(file, 60);
    const acc: CodexAcc = { userTexts: [], assistantTexts: [] };
    for (const l of lines) parseCodexLine(l, acc);
    if (!acc.userTexts.length && !acc.sessionId) continue;
    let mtimeMs = 0;
    try {
      mtimeMs = (await fsp.stat(file)).mtimeMs;
    } catch {
      continue;
    }
    out.push({
      source: 'codex',
      sessionId: acc.sessionId ?? path.basename(file, '.jsonl'),
      file,
      mtimeMs,
      cwd: acc.cwd,
      preview: truncate(acc.userTexts[0] ?? '', 120),
      messageCount: acc.userTexts.length + acc.assistantTexts.length,
    });
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 100);
}

export async function codexSessionToCapsule(file: string, opts: { objective?: string } = {}): Promise<Capsule> {
  const lines = await readLines(file);
  const acc: CodexAcc = { userTexts: [], assistantTexts: [] };
  for (const l of lines) parseCodexLine(l, acc);
  const sessionId = acc.sessionId ?? path.basename(file, '.jsonl');
  const objective = opts.objective?.trim() || acc.userTexts[0] || `（导入的 Codex 会话 ${sessionId}）`;
  const lastAssistant = acc.assistantTexts.at(-1) ?? '';
  return createCapsule({
    task: { id: 'imported', objective },
    status: 'in-progress',
    origin: { agentId: 'codex', sessionId },
    progress: {},
    workspace: { repoRoot: acc.cwd ?? '' },
    handoff: {
      fromAgent: 'codex',
      summary: lastAssistant
        ? `（由 Codex 会话导入，共 ${acc.userTexts.length + acc.assistantTexts.length} 条消息）最近一段回复：\n${truncate(lastAssistant, 2000)}`
        : `（由 Codex 会话导入，共 ${acc.userTexts.length + acc.assistantTexts.length} 条消息）`,
    },
    context: { keyFacts: [`导入自 Codex 会话文件 ${path.basename(file)}`], environment: { importedAt: nowIso() } },
    extensions: { 'agentos.import': { source: 'codex', file, importedAt: nowIso() } },
  });
}
