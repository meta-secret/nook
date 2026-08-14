import type {
  AgentProfile,
  AgentTaskExecution,
  GitCommit,
  StaticTaskExecution,
  TaskTerminal,
  WorkflowAttemptNumber,
  WorkflowRunId,
  WorkflowTaskOutput,
} from './domain.ts';
import type { RuntimeActivityObservation } from './events.ts';

export type RuntimeActivityObserver = (
  observation: RuntimeActivityObservation,
) => Promise<void>;

export type WorkflowDependencyOutput<TTask extends string> = {
  readonly task: TTask;
  readonly output: WorkflowTaskOutput;
};

export type WorkflowTaskInvocation<
  TTask extends string,
  TAgent extends string,
> = {
  readonly task: TTask;
  readonly attempt: WorkflowAttemptNumber;
  readonly execution: StaticTaskExecution<TAgent>;
  readonly agentProfile: AgentProfile<TAgent>;
  readonly sourceCommit: GitCommit;
  readonly runId: WorkflowRunId;
  readonly workingDirectory: string;
  readonly upstreamOutputs: readonly WorkflowDependencyOutput<TTask>[];
  readonly signal: AbortSignal;
  readonly observe: RuntimeActivityObserver;
};

export interface WorkflowTaskRuntime<
  TTask extends string,
  TAgent extends string,
> {
  execute(
    invocation: WorkflowTaskInvocation<TTask, TAgent>,
  ): Promise<TaskTerminal<TTask>>;
}

export type AgentExecutionInvocation<
  TTask extends string,
  TAgent extends string,
> = Omit<WorkflowTaskInvocation<TTask, TAgent>, 'execution'> & {
  readonly execution: AgentTaskExecution<TAgent>;
};

export type AgentExecutionCompletion = {
  readonly threadId: string;
  readonly output: WorkflowTaskOutput;
};

export interface AgentTaskRuntime<TTask extends string, TAgent extends string> {
  executeAgent(
    invocation: AgentExecutionInvocation<TTask, TAgent>,
  ): Promise<AgentExecutionCompletion>;
}
