import type {
  AgentAttemptAdapterKind,
  AgentAttemptParent,
  AgentProcessingWorkflowName,
  GitCommit,
  IsoTimestamp,
  MaterializedViewReference,
  ProjectionReference,
  TaskTerminalKind,
  WorkflowAttemptNumber,
  WorkflowEventSequence,
  WorkflowRunId,
  WorkflowVersion,
} from './domain.ts';
export enum AgentAttemptEventKind {
  AttemptStarted = 'attempt-started',
  ResultProjected = 'result-projected',
  ViewProjected = 'view-projected',
  AttemptTerminalRecorded = 'attempt-terminal-recorded',
}

export type AgentAttemptEventMetadata = {
  readonly adapter: AgentAttemptAdapterKind;
  readonly runId: WorkflowRunId;
  readonly workflow: AgentProcessingWorkflowName;
  readonly workflowVersion: WorkflowVersion;
  readonly sourceCommit: GitCommit;
  readonly task: string;
  readonly agent: string;
  readonly attempt: WorkflowAttemptNumber;
  readonly depth: number;
  readonly parent: AgentAttemptParent;
  readonly sequence: WorkflowEventSequence;
  readonly actionId: string;
  readonly occurredAt: IsoTimestamp;
};

export type AgentAttemptStartedEvent = AgentAttemptEventMetadata & {
  readonly kind: AgentAttemptEventKind.AttemptStarted;
};

export type AgentResultProjectedEvent = AgentAttemptEventMetadata & {
  readonly kind: AgentAttemptEventKind.ResultProjected;
  readonly result: ProjectionReference;
};

export type AgentViewProjectedEvent = AgentAttemptEventMetadata & {
  readonly kind: AgentAttemptEventKind.ViewProjected;
  readonly view: MaterializedViewReference;
};

export type AgentAttemptTerminalRecordedEvent = AgentAttemptEventMetadata & {
  readonly kind: AgentAttemptEventKind.AttemptTerminalRecorded;
  readonly terminalKind: TaskTerminalKind;
  readonly result: ProjectionReference;
  readonly view: MaterializedViewReference;
};

export type AgentAttemptEvent =
  | AgentAttemptStartedEvent
  | AgentResultProjectedEvent
  | AgentViewProjectedEvent
  | AgentAttemptTerminalRecordedEvent;

export type AgentAttemptEventWithoutMetadata =
  | Omit<AgentAttemptStartedEvent, keyof AgentAttemptEventMetadata>
  | Omit<AgentResultProjectedEvent, keyof AgentAttemptEventMetadata>
  | Omit<AgentViewProjectedEvent, keyof AgentAttemptEventMetadata>
  | Omit<AgentAttemptTerminalRecordedEvent, keyof AgentAttemptEventMetadata>;
