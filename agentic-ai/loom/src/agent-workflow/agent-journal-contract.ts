import type {
  AgentAttemptAdapterKind,
  AgentAttemptParent,
  AgentProcessingWorkflowName,
  GitCommit,
  IsoTimestamp,
  TaskTerminal,
  WorkflowAttemptNumber,
  WorkflowRunId,
  WorkflowVersion,
} from './domain.ts';
export type AgentAttemptJournalAdapter = AgentAttemptAdapterKind;

export type AgentAttemptJournalConfiguration = {
  readonly adapter: AgentAttemptJournalAdapter;
  readonly runDirectory: string;
  readonly runId: WorkflowRunId;
  readonly workflow: AgentProcessingWorkflowName;
  readonly workflowVersion: WorkflowVersion;
  readonly sourceCommit: GitCommit;
  readonly originMainSha: GitCommit;
  readonly pinnedLocalDevSha: GitCommit;
  readonly featureHeadSha: GitCommit;
  readonly task: string;
  readonly agent: string;
  readonly attempt: WorkflowAttemptNumber;
  readonly depth: number;
  readonly parent: AgentAttemptParent;
  readonly now: () => IsoTimestamp;
  readonly knownCortexIdentifiers?: ReadonlySet<string>;
  readonly compactOutput?: (line: string) => void | Promise<void>;
};

export type ModuleExpertAttemptJournalConfiguration = Omit<
  AgentAttemptJournalConfiguration,
  'adapter'
>;

export type CreateModuleExpertAttemptJournalArgs = {
  readonly configuration: ModuleExpertAttemptJournalConfiguration;
};

export type FinalizeModuleExpertAttemptArgs<TTask extends string> = {
  readonly terminal: TaskTerminal<TTask>;
};

export type StructuralExpertAttemptJournalConfiguration = Omit<
  AgentAttemptJournalConfiguration,
  'adapter'
>;

export type CreateStructuralExpertAttemptJournalArgs = {
  readonly configuration: StructuralExpertAttemptJournalConfiguration;
};

export type FinalizeStructuralExpertAttemptArgs<TTask extends string> = {
  readonly terminal: TaskTerminal<TTask>;
};
