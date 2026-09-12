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
import type {
  ModuleExpertJournalAuthority,
  ModuleExpertRuntimeIdentity,
  TrustedModuleExpertExecution,
} from '../module-experts/trusted-runtime.ts';
import type {
  StructuralJournalAuthority,
  StructuralRuntimeIdentity,
  TrustedStructuralExecution,
} from '../structural-experts/trusted-runtime.ts';
export type AgentAttemptJournalAdapter =
  AgentAttemptAdapterKind.GenericDelegationRecorder;

export type AgentAttemptJournalConfiguration = {
  readonly adapter: AgentAttemptJournalAdapter;
  readonly runDirectory: string;
  readonly runId: WorkflowRunId;
  readonly workflow: AgentProcessingWorkflowName;
  readonly workflowVersion: WorkflowVersion;
  readonly sourceCommit: GitCommit;
  readonly task: string;
  readonly agent: string;
  readonly attempt: WorkflowAttemptNumber;
  readonly depth: number;
  readonly parent: AgentAttemptParent;
  readonly invocationContextSha256?: string;
  readonly now: () => IsoTimestamp;
  readonly knownCortexIdentifiers?: ReadonlySet<string>;
  readonly compactOutput?: (line: string) => void | Promise<void>;
};

export type ModuleExpertAttemptJournalConfiguration = Omit<
  AgentAttemptJournalConfiguration,
  'adapter' | 'invocationContextSha256'
> & {
  readonly invocationContextSha256: string;
};

export type CreateModuleExpertAttemptJournalArgs = {
  readonly configuration: ModuleExpertAttemptJournalConfiguration;
  readonly authority: ModuleExpertJournalAuthority;
  readonly identity: ModuleExpertRuntimeIdentity;
};

export type ConfigurationIdentityMatchArgs = {
  readonly configuration: ModuleExpertAttemptJournalConfiguration;
  readonly identity: ModuleExpertRuntimeIdentity;
};

export type FinalizeModuleExpertAttemptArgs<TTask extends string> = {
  readonly terminal: TaskTerminal<TTask>;
  readonly execution: TrustedModuleExpertExecution;
};

export type StructuralExpertAttemptJournalConfiguration = Omit<
  AgentAttemptJournalConfiguration,
  'adapter'
>;

export type CreateStructuralExpertAttemptJournalArgs = {
  readonly configuration: StructuralExpertAttemptJournalConfiguration;
  readonly authority: StructuralJournalAuthority;
  readonly identity: StructuralRuntimeIdentity;
};

export type FinalizeStructuralExpertAttemptArgs<TTask extends string> = {
  readonly terminal: TaskTerminal<TTask>;
  readonly execution: TrustedStructuralExecution;
};
