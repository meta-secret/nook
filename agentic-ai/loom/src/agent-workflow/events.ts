export enum WorkflowRuntimeActivityKind {
  ThreadStarted = 'thread-started',
  TurnStarted = 'turn-started',
  CommandStarted = 'command-started',
  CommandCompleted = 'command-completed',
  FileChangeCompleted = 'file-change-completed',
  SourceReadCompleted = 'source-read-completed',
  AgentMessageCompleted = 'agent-message-completed',
  TurnCompleted = 'turn-completed',
  TurnFailed = 'turn-failed',
  RuntimeError = 'runtime-error',
}

export type RuntimeActivityObservation = {
  readonly activity: WorkflowRuntimeActivityKind;
  readonly detail: string;
};
