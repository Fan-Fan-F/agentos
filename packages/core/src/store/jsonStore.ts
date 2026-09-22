import fs from 'node:fs';
import { assertStorageId } from '../ids.js';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** 原子写：临时文件 + rename（Windows 上 rename 会替换已存在目标）。 */
export async function atomicWriteFile(file: string, data: string): Promise<void> {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fsp.writeFile(tmp, data, 'utf8');
  await fsp.rename(tmp, file);
}

export async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  await atomicWriteFile(file, JSON.stringify(value, null, 2));
}

export function defaultDataDir(): string {
  return process.env.AGENTOS_HOME || path.join(os.homedir(), '.agentos');
}

/** 按实体分目录的 JSON 存储（ADR-002；SQLite 后置，接口不变）。 */
export class JsonStore<T extends { id: string }> {
  /** all() 跳过损坏文件时记录于此（崩溃恢复韧性：一条坏记录不拖垮列表） */
  readonly skippedFiles: string[] = [];

  constructor(private readonly dir: string) {
    ensureDir(dir);
  }

  private fileFor(id: string): string {
    return path.join(this.dir, `${assertStorageId(id)}.json`);
  }

  async put(value: T): Promise<void> {
    await atomicWriteJson(this.fileFor(value.id), value);
  }

  async get(id: string): Promise<T | undefined> {
    try {
      const raw = await fsp.readFile(this.fileFor(id), 'utf8');
      return JSON.parse(raw) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
  }

  async all(): Promise<T[]> {
    let names: string[];
    try {
      names = await fsp.readdir(this.dir);
    } catch {
      return [];
    }
    this.skippedFiles.length = 0;
    const out: T[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(this.dir, name);
      try {
        const raw = await fsp.readFile(file, 'utf8');
        out.push(JSON.parse(raw) as T);
      } catch {
        // 损坏/半写文件：跳过并记录，不拖垮整个列表（崩溃韧性）
        this.skippedFiles.push(file);
      }
    }
    return out;
  }

  async delete(id: string): Promise<boolean> {
    try {
      await fsp.unlink(this.fileFor(id));
      return true;
    } catch {
      return false;
    }
  }
}
