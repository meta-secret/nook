export enum StaticAgentWorkflowName {
  CortexFullGarbageCollection = 'cortex-full-garbage-collection',
}

export enum WorkflowExecutorKind {
  Agent = 'agent',
  LoomLeaf = 'loom-leaf',
}

export enum AgentWorkspacePolicy {
  ReadOnly = 'read-only',
}

export enum AgentReasoningEffort {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

export enum TaskTargetKind {
  Task = 'task',
  Parallel = 'parallel',
  Join = 'join',
  None = 'none',
}

export enum JoinCompletionPolicy {
  AllCompleted = 'all-completed',
}

export enum TaskTerminalKind {
  Completed = 'completed',
  Failed = 'failed',
  Blocked = 'blocked',
  Cancelled = 'cancelled',
  TimedOut = 'timed-out',
  Skipped = 'skipped',
}

export enum WorkflowTerminalKind {
  Completed = 'completed',
  CompletedWithFailures = 'completed-with-failures',
  Cancelled = 'cancelled',
  Failed = 'failed',
}

export enum WorkflowArtifactKind {
  File = 'file',
  Report = 'report',
}

export enum WorkflowFindingSeverity {
  Information = 'information',
  Warning = 'warning',
  Error = 'error',
}

export enum WorkflowResultKind {
  CortexEvidence = 'cortex-evidence',
  CortexSynthesis = 'cortex-synthesis',
  LoomLeafEvidence = 'loom-leaf-evidence',
}

export type WorkflowRunId = string;
export type WorkflowVersion = string;
export type WorkflowEventSequence = number;
export type WorkflowAttemptNumber = number;
export type IsoTimestamp = string;
export type GitCommit = string;

export type AgentProfile<TAgent extends string> = {
  readonly name: TAgent;
  readonly instructionPrefix: string;
  readonly workspacePolicy: AgentWorkspacePolicy;
  readonly reasoningEffort: AgentReasoningEffort;
};

export enum LoomLeafKind {
  VerifyGitBaseline = 'verify-git-baseline',
  CortexAudit = 'cortex-audit',
}

export type AgentTaskExecution<TAgent extends string> = {
  readonly kind: WorkflowExecutorKind.Agent;
  readonly agent: TAgent;
  readonly instruction: string;
  readonly resultKind: WorkflowResultKind;
};

export type CortexAuditLeafExecution = {
  readonly kind: WorkflowExecutorKind.LoomLeaf;
  readonly leaf: LoomLeafKind.CortexAudit;
  readonly includeDensityLint: boolean;
};

export type VerifyGitBaselineLeafExecution = {
  readonly kind: WorkflowExecutorKind.LoomLeaf;
  readonly leaf: LoomLeafKind.VerifyGitBaseline;
};

export type StaticTaskExecution<TAgent extends string> =
  | AgentTaskExecution<TAgent>
  | CortexAuditLeafExecution
  | VerifyGitBaselineLeafExecution;

export type NoTaskTarget = {
  readonly kind: TaskTargetKind.None;
};

export type SingleTaskTarget<TTask extends string> = {
  readonly kind: TaskTargetKind.Task;
  readonly task: TTask;
};

export type ParallelTaskTarget<TTask extends string> = {
  readonly kind: TaskTargetKind.Parallel;
  readonly tasks: readonly TTask[];
};

export type JoinTaskTarget<TJoin extends string> = {
  readonly kind: TaskTargetKind.Join;
  readonly join: TJoin;
};

export type TaskOutcomeTarget<TTask extends string, TJoin extends string> =
  | NoTaskTarget
  | SingleTaskTarget<TTask>
  | ParallelTaskTarget<TTask>
  | JoinTaskTarget<TJoin>;

export type TaskResourceClaims = {
  readonly read: readonly string[];
  readonly write: readonly string[];
};

export type StaticTaskDefinition<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
> = {
  readonly name: TTask;
  readonly execution: StaticTaskExecution<TAgent>;
  readonly completed: TaskOutcomeTarget<TTask, TJoin>;
  readonly failed: TaskOutcomeTarget<TTask, TJoin>;
  readonly resources: TaskResourceClaims;
  readonly timeoutMs: number;
};

export type StaticJoinDefinition<TTask extends string, TJoin extends string> = {
  readonly name: TJoin;
  readonly policy: JoinCompletionPolicy.AllCompleted;
  readonly arrivals: readonly TTask[];
  readonly completed: TaskOutcomeTarget<TTask, TJoin>;
};

export type StaticAgentRegistry<TAgent extends string> = {
  readonly [TName in TAgent]: AgentProfile<TName>;
};

export type StaticTaskRegistry<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
> = {
  readonly [TName in TTask]: StaticTaskDefinition<TTask, TAgent, TJoin>;
};

export type StaticJoinRegistry<TTask extends string, TJoin extends string> = {
  readonly [TName in TJoin]: StaticJoinDefinition<TTask, TJoin>;
};

export type StaticAgentWorkflowDefinition<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
> = {
  readonly name: StaticAgentWorkflowName;
  readonly version: WorkflowVersion;
  readonly entry: TTask;
  readonly taskNames: readonly TTask[];
  readonly agentNames: readonly TAgent[];
  readonly joinNames: readonly TJoin[];
  readonly agents: StaticAgentRegistry<TAgent>;
  readonly tasks: StaticTaskRegistry<TTask, TAgent, TJoin>;
  readonly joins: StaticJoinRegistry<TTask, TJoin>;
};

export type WorkflowFinding = {
  readonly severity: WorkflowFindingSeverity;
  readonly title: string;
  readonly summary: string;
  readonly evidence: readonly string[];
  readonly affectedPaths: readonly string[];
};

export type WorkflowArtifactReference = {
  readonly kind: WorkflowArtifactKind;
  readonly location: string;
  readonly description: string;
};

export type WorkflowTaskOutput = {
  readonly resultKind: WorkflowResultKind;
  readonly summary: string;
  readonly findings: readonly WorkflowFinding[];
  readonly notesForParent: readonly string[];
  readonly artifacts: readonly WorkflowArtifactReference[];
};

export type CompletedTaskTerminal<TTask extends string> = {
  readonly kind: TaskTerminalKind.Completed;
  readonly task: TTask;
  readonly attempt: WorkflowAttemptNumber;
  readonly threadId: string;
  readonly output: WorkflowTaskOutput;
};

export type FailedTaskTerminal<TTask extends string> = {
  readonly kind: TaskTerminalKind.Failed;
  readonly task: TTask;
  readonly attempt: WorkflowAttemptNumber;
  readonly summary: string;
};

export type BlockedTaskTerminal<TTask extends string> = {
  readonly kind: TaskTerminalKind.Blocked;
  readonly task: TTask;
  readonly attempt: WorkflowAttemptNumber;
  readonly summary: string;
};

export type CancelledTaskTerminal<TTask extends string> = {
  readonly kind: TaskTerminalKind.Cancelled;
  readonly task: TTask;
  readonly attempt: WorkflowAttemptNumber;
  readonly summary: string;
};

export type TimedOutTaskTerminal<TTask extends string> = {
  readonly kind: TaskTerminalKind.TimedOut;
  readonly task: TTask;
  readonly attempt: WorkflowAttemptNumber;
  readonly summary: string;
};

export type SkippedTaskTerminal<TTask extends string> = {
  readonly kind: TaskTerminalKind.Skipped;
  readonly task: TTask;
  readonly attempt: WorkflowAttemptNumber;
  readonly summary: string;
};

export type TaskTerminal<TTask extends string> =
  | CompletedTaskTerminal<TTask>
  | FailedTaskTerminal<TTask>
  | BlockedTaskTerminal<TTask>
  | CancelledTaskTerminal<TTask>
  | TimedOutTaskTerminal<TTask>
  | SkippedTaskTerminal<TTask>;

export type WorkflowTaskTerminalSequence<TTask extends string> =
  readonly TaskTerminal<TTask>[];

export type WorkflowRunTerminal<TTask extends string> = {
  readonly kind: WorkflowTerminalKind;
  readonly runId: WorkflowRunId;
  readonly workflow: StaticAgentWorkflowName;
  readonly version: WorkflowVersion;
  readonly sourceCommit: GitCommit;
  readonly taskTerminals: WorkflowTaskTerminalSequence<TTask>;
  readonly startedAt: IsoTimestamp;
  readonly finishedAt: IsoTimestamp;
};

export const noTasks: NoTaskTarget = { kind: TaskTargetKind.None };
