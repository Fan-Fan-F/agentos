import { z } from 'zod';

/**
 * Universal Session Capsule v1（ADR-004）。
 * 只保存可观测状态：消息/工具事件/执行结果/决策摘要/git 与测试状态；
 * 绝不保存模型隐藏思维链。未来版本 = 新增可选字段 + migrate()。
 */

export const CAPSULE_SCHEMA_VERSION = 1;

export const CapsuleSchemaV1 = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  task: z.object({
    id: z.string(),
    objective: z.string(),
    constraints: z.array(z.string()).default([]),
    userInstructions: z.array(z.string()).default([]),
  }),
  status: z.enum(['in-progress', 'blocked', 'review', 'done', 'failed']),
  origin: z.object({
    agentId: z.string(),
    sessionId: z.string().optional(),
    nativeSessionRef: z.string().optional(),
    resumedFromCapsuleId: z.string().optional(),
  }),
  progress: z.object({
    completed: z.array(z.string()).default([]),
    remaining: z.array(z.string()).default([]),
    decisions: z
      .array(
        z.object({
          summary: z.string(),
          rationale: z.string().optional(),
          byAgent: z.string().optional(),
          at: z.string().optional(),
          superseded: z.boolean().default(false),
        }),
      )
      .default([]),
    rejectedApproaches: z
      .array(z.object({ approach: z.string(), reason: z.string() }))
      .default([]),
  }),
  workspace: z.object({
    repoRoot: z.string(),
    baseBranch: z.string().optional(),
    baseCommit: z.string().optional(),
    branch: z.string().optional(),
    worktreePath: z.string().optional(),
    changedFiles: z
      .array(z.object({ path: z.string(), change: z.enum(['added', 'modified', 'deleted', 'renamed']) }))
      .default([]),
    diffStat: z.string().optional(),
    commits: z.array(z.object({ hash: z.string(), message: z.string() })).default([]),
  }),
  verification: z
    .object({
      tests: z
        .array(
          z.object({
            command: z.string(),
            passed: z.number().int().default(0),
            failed: z.number().int().default(0),
            summary: z.string().optional(),
            outputTail: z.string().optional(),
          }),
        )
        .default([]),
    })
    .default({ tests: [] }),
  artifacts: z
    .array(z.object({ name: z.string(), path: z.string().optional(), description: z.string().optional() }))
    .default([]),
  context: z
    .object({
      keyFacts: z.array(z.string()).default([]),
      environment: z.record(z.string(), z.string()).default({}),
    })
    .default({ keyFacts: [], environment: {} }),
  permissions: z.object({ expectations: z.array(z.string()).default([]) }).default({ expectations: [] }),
  handoff: z
    .object({
      fromAgent: z.string().optional(),
      toAgent: z.string().optional(),
      summary: z.string().optional(),
    })
    .default({}),
  /** 命名空间化扩展位（如 `agentos.acp.*`） */
  extensions: z.record(z.string(), z.unknown()).default({}),
});

export type Capsule = z.infer<typeof CapsuleSchemaV1>;
export type CapsuleInput = z.input<typeof CapsuleSchemaV1>;

export class CapsuleVersionError extends Error {
  constructor(public readonly foundVersion: number) {
    super(
      `Capsule schemaVersion ${foundVersion} 高于本版本支持的 ${CAPSULE_SCHEMA_VERSION}；请升级 AgentOS，而不是猜测字段。`,
    );
    this.name = 'CapsuleVersionError';
  }
}
