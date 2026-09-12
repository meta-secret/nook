import type { ExpertIsolationFailure } from '../module-experts/isolation-failure.ts';
import type { Result } from 'neverthrow';
import type { HostCommandFailure } from '../lib/run.ts';
import type {
  AgentProfile,
  AgentTaskExecution,
  GitCommit,
  TaskTerminalKind,
  WorkflowAttemptNumber,
  WorkflowRunId,
  WorkflowTaskOutput,
  MaterializedViewReference,
} from './domain.ts';
import type { RuntimeActivityObservation } from './events.ts';

export type RuntimeActivityObserver = (
  observation: RuntimeActivityObservation,
) => Promise<void>;

export type WorkflowDependencyOutput<TTask extends string> = {
  readonly task: TTask;
  readonly terminalKind: TaskTerminalKind;
  readonly view: MaterializedViewReference;
  readonly materializedViewMarkdown: string;
  readonly resultArtifact: VerifiedWorkflowResultArtifact;
};

export type VerifiedWorkflowResultArtifact = {
  readonly location: string;
  readonly sha256: string;
};

type WorkflowTaskInvocationBase<TTask extends string> = {
  readonly task: TTask;
  readonly attempt: WorkflowAttemptNumber;
  readonly sourceCommit: GitCommit;
  readonly runId: WorkflowRunId;
  readonly workingDirectory: string;
  readonly upstreamOutputs: readonly WorkflowDependencyOutput<TTask>[];
  readonly signal: AbortSignal;
  readonly observe: RuntimeActivityObserver;
};

export type AgentExecutionInvocation<
  TTask extends string,
  TAgent extends string,
> = WorkflowTaskInvocationBase<TTask> & {
  readonly execution: AgentTaskExecution<TAgent>;
  readonly agentProfile: AgentProfile<TAgent>;
};

export type AgentExecutionCompletion = {
  readonly threadId: string;
  readonly output: WorkflowTaskOutput;
};

export interface AgentTaskRuntime<TTask extends string, TAgent extends string> {
  executeAgent(
    invocation: AgentExecutionInvocation<TTask, TAgent>,
  ): Promise<Result<AgentExecutionCompletion, AgentExecutionFailure>>;
}

export enum AgentExecutionFailureKind {
  WorkspacePolicy = 'workspacePolicy',
  SourceCommit = 'sourceCommit',
  DirtyWorktree = 'dirtyWorktree',
  FailedTurn = 'failedTurn',
  IncompleteTurn = 'incompleteTurn',
  ResultKind = 'resultKind',
  RuntimeSession = 'runtimeSession',
  IsolationReceipt = 'isolationReceipt',
  RuntimeBoundary = 'runtimeBoundary',
}
export type AgentExecutionFailure =
  | ExpertIsolationFailure
  | HostCommandFailure
  | {
      readonly kind: AgentExecutionFailureKind;
      readonly message: string;
    };
