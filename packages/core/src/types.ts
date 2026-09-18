/** AgentOS 核心领域类型。 */

export type AgentProtocol = 'acp' | 'cli' | 'pty' | 'sdk' | 'api';

export type AuthStatus = 'ok' | 'required' | 'unknown';

export type AgentSkill =
  | 'coding'
  | 'planning'
  | 'debugging'
  | 'review'
  | 'testing'
  | 'largeContext'
  | 'speed'
  | 'costEfficiency';

export interface AgentCapabilities {
  headless: boolean;
  /** 支持原生会话恢复（同 agent 续接） */
  resume: boolean;
  /** 无头模式输出结构化 JSON 事件流 */
  jsonStream: boolean;
  mcp: boolean;
  hooks: boolean;
}

export interface AgentProfile {
  id: string;
  name: string;
  protocols: AgentProtocol[];
  capabilities: AgentCapabilities;
  skills?: Partial<Record<AgentSkill, number>>;
}

export type AgentInstallStatus = 'installed' | 'not-installed' | 'update-available' | 'auth-required';

export interface DiscoveredAgent {
  id: string;
  name: string;
  status: AgentInstallStatus;
  /** 找到的可执行文件绝对路径（可能多个） */
  binaries: string[];
  version?: string;
  latestVersion?: string;
  installSource?: 'npm' | 'pipx' | 'cargo' | 'brew' | 'other' | 'unknown';
  npmPackage?: string;
  auth: AuthStatus;
  protocols: AgentProtocol[];
  capabilities: AgentCapabilities;
  /** 检测到的家目录标记（仅存在性，不读内容） */
  homeMarkersFound: string[];
}

export type FileChangeKind = 'added' | 'modified' | 'deleted' | 'renamed';

export interface ChangedFile {
  path: string;
  change: FileChangeKind;
}

export type TaskStatus = 'created' | 'running' | 'interrupted' | 'done' | 'failed';

export type RunMode = 'run' | 'swap' | 'fork' | 'ask' | 'resume';

export interface DecisionRecord {
  summary: string;
  rationale?: string;
  byAgent?: string;
  at?: string;
  superseded?: boolean;
}

export interface RejectedApproach {
  approach: string;
  reason: string;
}

export interface SessionRun {
  id: string;
  agentId: string;
  mode: RunMode;
  sessionId?: string;
  branch?: string;
  worktreePath?: string;
  capsuleId?: string;
  exitCode: number | null;
  startedAt: string;
  finishedAt?: string;
  finalMessage?: string;
  error?: string;
  durationMs?: number;
}

export interface TaskRecord {
  id: string;
  objective: string;
  constraints: string[];
  userInstructions: string[];
  repoRoot: string;
  baseRef: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  progress: {
    completed: string[];
    remaining: string[];
    decisions: DecisionRecord[];
    rejectedApproaches: RejectedApproach[];
  };
  runs: SessionRun[];
  latestCapsuleId?: string;
}

export interface TimelineEvent {
  id: string;
  ts: string;
  taskId: string;
  actor: string;
  type: string;
  payload?: unknown;
}
