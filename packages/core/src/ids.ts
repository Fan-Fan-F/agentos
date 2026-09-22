import { customAlphabet } from 'nanoid';

const nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10);

/** 生成仅含 [a-z0-9_] 的 id（可用于 git 分支名/目录名）。 */
export function newId(prefix: string): string {
  return `${prefix}_${nano()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Reject path separators, traversal, alternate streams and Windows device names. */
export function assertStorageId(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id)) {
    throw new Error('Invalid storage id');
  }
  return id;
}
