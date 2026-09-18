import { customAlphabet } from 'nanoid';

const nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10);

/** 生成仅含 [a-z0-9_] 的 id（可用于 git 分支名/目录名）。 */
export function newId(prefix: string): string {
  return `${prefix}_${nano()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
