import type {
  AgentProfile,
  AgentTaskExecution,
  GitCommit,
  LoomLeafTaskExecution,
  TaskTerminal,
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
  readonly output: WorkflowTaskOutput;
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

export type AgentWorkflowTaskInvocation<
  TTask extends string,
  TAgent extends string,
> = WorkflowTaskInvocationBase<TTask> & {
  readonly execution: AgentTaskExecution<TAgent>;
  readonly agentProfile: AgentProfile<TAgent>;
};

export type LoomLeafWorkflowTaskInvocation<TTask extends string> =
  WorkflowTaskInvocationBase<TTask> & {
    readonly execution: LoomLeafTaskExecution;
  };

export type WorkflowTaskInvocation<
  TTask extends string,
  TAgent extends string,
> =
  | AgentWorkflowTaskInvocation<TTask, TAgent>
  | LoomLeafWorkflowTaskInvocation<TTask>;

export interface WorkflowTaskRuntime<
  TTask extends string,
  TAgent extends string,
> {
  start(
    invocation: WorkflowTaskInvocation<TTask, TAgent>,
  ): WorkflowTaskAttempt<TTask>;
}

export enum TaskStopReason {
  Timeout = 'timeout',
  WorkflowCancellation = 'workflow-cancellation',
}

export type TaskStopRequest = {
  readonly reason: TaskStopReason;
  readonly hardDeadlineMs: number;
};

export enum TaskTeardownKind {
  Confirmed = 'confirmed',
}

export type ConfirmedTaskTeardown = {
  readonly kind: TaskTeardownKind.Confirmed;
};

export interface WorkflowTaskAttempt<TTask extends string> {
  readonly completion: Promise<TaskTerminal<TTask>>;
  stop(request: TaskStopRequest): Promise<ConfirmedTaskTeardown>;
}

export class UnconfirmedTaskTeardownError extends Error {
  constructor(task: string) {
    super(`Task ${task} did not confirm teardown before its hard deadline.`);
    this.name = 'UnconfirmedTaskTeardownError';
  }
}

export type AgentExecutionInvocation<
  TTask extends string,
  TAgent extends string,
> = AgentWorkflowTaskInvocation<TTask, TAgent>;

export type AgentExecutionCompletion = {
  readonly threadId: string;
  readonly output: WorkflowTaskOutput;
};

export interface AgentTaskRuntime<TTask extends string, TAgent extends string> {
  executeAgent(
    invocation: AgentExecutionInvocation<TTask, TAgent>,
  ): Promise<AgentExecutionCompletion>;
}
