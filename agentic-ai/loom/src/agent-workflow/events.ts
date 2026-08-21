import type {
  GitCommit,
  IsoTimestamp,
  StaticAgentWorkflowName,
  TaskTerminalKind,
  WorkflowAttemptNumber,
  WorkflowEventSequence,
  WorkflowRunId,
  WorkflowTerminalKind,
  WorkflowVersion,
  MaterializedViewReference,
  TaskProcessingReference,
} from './domain.ts';

export enum WorkflowEventKind {
  WorkflowStarted = 'workflow-started',
  TaskEligible = 'task-eligible',
  TaskAttemptStarted = 'task-attempt-started',
  RuntimeActivity = 'runtime-activity',
  TaskTerminalRecorded = 'task-terminal-recorded',
  SuccessorsActivated = 'successors-activated',
  WorkflowTerminalRecorded = 'workflow-terminal-recorded',
}

export enum WorkflowRuntimeActivityKind {
  ThreadStarted = 'thread-started',
  TurnStarted = 'turn-started',
  CommandStarted = 'command-started',
  CommandCompleted = 'command-completed',
  FileChangeCompleted = 'file-change-completed',
  AgentMessageCompleted = 'agent-message-completed',
  TurnCompleted = 'turn-completed',
  TurnFailed = 'turn-failed',
  RuntimeError = 'runtime-error',
}

export type WorkflowEventMetadata = {
  readonly runId: WorkflowRunId;
  readonly workflow: StaticAgentWorkflowName;
  readonly workflowVersion: WorkflowVersion;
  readonly sequence: WorkflowEventSequence;
  readonly occurredAt: IsoTimestamp;
  readonly sourceCommit: GitCommit;
};

export type WorkflowStartedEvent<TTask extends string> =
  WorkflowEventMetadata & {
    readonly kind: WorkflowEventKind.WorkflowStarted;
    readonly entry: TTask;
  };

export type TaskEligibleEvent<TTask extends string> = WorkflowEventMetadata & {
  readonly kind: WorkflowEventKind.TaskEligible;
  readonly task: TTask;
  readonly attempt: WorkflowAttemptNumber;
};

export type TaskAttemptStartedEvent<TTask extends string> =
  WorkflowEventMetadata & {
    readonly kind: WorkflowEventKind.TaskAttemptStarted;
    readonly task: TTask;
    readonly attempt: WorkflowAttemptNumber;
  };

export type RuntimeActivityEvent<TTask extends string> =
  WorkflowEventMetadata & {
    readonly kind: WorkflowEventKind.RuntimeActivity;
    readonly task: TTask;
    readonly attempt: WorkflowAttemptNumber;
    readonly activity: WorkflowRuntimeActivityKind;
    readonly detail: string;
  };

export type TaskTerminalRecordedEvent<TTask extends string> =
  WorkflowEventMetadata & {
    readonly kind: WorkflowEventKind.TaskTerminalRecorded;
    readonly task: TTask;
    readonly attempt: WorkflowAttemptNumber;
    readonly terminalKind: TaskTerminalKind;
    readonly resultPath: string;
    readonly resultSha256: string;
    readonly processing: TaskProcessingReference;
  };

export type SuccessorsActivatedEvent<TTask extends string> =
  WorkflowEventMetadata & {
    readonly kind: WorkflowEventKind.SuccessorsActivated;
    readonly sourceTask: TTask;
    readonly activatedTasks: readonly TTask[];
    readonly arrivedJoins: readonly string[];
  };

export type WorkflowTerminalRecordedEvent = WorkflowEventMetadata & {
  readonly kind: WorkflowEventKind.WorkflowTerminalRecorded;
  readonly terminalKind: WorkflowTerminalKind;
  readonly resultPath: string;
  readonly resultSha256: string;
  readonly materializedView: MaterializedViewReference;
};

export type WorkflowEvent<TTask extends string> =
  | WorkflowStartedEvent<TTask>
  | TaskEligibleEvent<TTask>
  | TaskAttemptStartedEvent<TTask>
  | RuntimeActivityEvent<TTask>
  | TaskTerminalRecordedEvent<TTask>
  | SuccessorsActivatedEvent<TTask>
  | WorkflowTerminalRecordedEvent;

export type WorkflowEventWithoutMetadata<TTask extends string> =
  | Omit<WorkflowStartedEvent<TTask>, keyof WorkflowEventMetadata>
  | Omit<TaskEligibleEvent<TTask>, keyof WorkflowEventMetadata>
  | Omit<TaskAttemptStartedEvent<TTask>, keyof WorkflowEventMetadata>
  | Omit<RuntimeActivityEvent<TTask>, keyof WorkflowEventMetadata>
  | Omit<TaskTerminalRecordedEvent<TTask>, keyof WorkflowEventMetadata>
  | Omit<SuccessorsActivatedEvent<TTask>, keyof WorkflowEventMetadata>
  | Omit<WorkflowTerminalRecordedEvent, keyof WorkflowEventMetadata>;

export type RuntimeActivityObservation = {
  readonly activity: WorkflowRuntimeActivityKind;
  readonly detail: string;
};
