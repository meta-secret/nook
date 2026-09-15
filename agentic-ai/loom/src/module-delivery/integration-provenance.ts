import type { TeamKey } from '../team-agents/catalog.ts';
import type { PinnedDevBaseEvidence } from '../lib/base-evidence.ts';
import type {
  ModuleDeliveryAdmissionState,
  ModuleDeliveryAttemptLease,
  ModuleDeliveryGenerationAuthority,
  ModuleDeliveryWriterFrontier,
} from './admission.ts';
import type {
  ModuleDeliveryOwnerIdentity,
  ValidatedModuleDeliveryPlan,
} from './domain.ts';
import type { VerifiedModuleCommitHandoff } from './handoff.ts';
import type { ModuleWorktreeHandle } from './workspace.ts';

export const MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION = 1 as const;

export enum ModuleDeliveryProviderSubmissionKind {
  ReadOnlyEvidence = 'read-only-evidence',
  Write = 'write',
}

export enum ModuleDeliveryEvidenceVerdict {
  TerminalSuccess = 'terminal-success',
  TerminalFailure = 'terminal-failure',
}

export enum ModuleIntegrationPhase {
  AcceptingProviders = 'accepting-providers',
  Finalized = 'finalized',
}

/** A typed result passed directly between trusted harness agents. */
export type ModuleDeliveryProviderResult = PinnedDevBaseEvidence &
  Readonly<{
    kind: ModuleDeliveryProviderSubmissionKind.ReadOnlyEvidence;
    taskId: string;
    attempt: number;
    generation: number;
    planDigest: string;
    sourceCommit: string;
    producerTeam: TeamKey;
    functionalOwner: ModuleDeliveryOwnerIdentity;
    acceptanceOwner: ModuleDeliveryOwnerIdentity;
    acceptanceRequirements: readonly string[];
    result: readonly string[];
    providerResults?: readonly ModuleDeliveryProviderResult[];
  }>;

export type AcceptedModuleDeliveryEvidence = ModuleDeliveryProviderResult;
export type ModuleDeliveryReadOnlyEvidenceSubmission =
  ModuleDeliveryProviderResult;

export type ModuleDeliveryHandoffSubmission = PinnedDevBaseEvidence &
  Readonly<{
    kind: ModuleDeliveryProviderSubmissionKind.Write;
    taskId: string;
    attempt: number;
    generation: number;
    planDigest: string;
    sourceCommit: string;
    producerTeam: TeamKey;
    functionalOwner: ModuleDeliveryOwnerIdentity;
    acceptanceOwner: ModuleDeliveryOwnerIdentity;
    acceptanceRequirements: readonly string[];
    handoff: VerifiedModuleCommitHandoff;
    allowedWriteClaims: readonly string[];
  }>;

export type ModuleDeliveryProviderSubmission =
  ModuleDeliveryProviderResult | ModuleDeliveryHandoffSubmission;

export type PrepareModuleIntegrationRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  acceptedPlan: ValidatedModuleDeliveryPlan;
  repositoryRoot: string;
  workspaceRoot: string;
  state: ModuleDeliveryAdmissionState;
}>;

export type ModuleIntegrationCleanupHandle = Readonly<{
  sessionId: string;
  workspace: ModuleWorktreeHandle;
}>;

export type ModuleIntegrationState = PinnedDevBaseEvidence &
  Readonly<{
    phase: ModuleIntegrationPhase;
    generation: number;
    planDigest: string;
    sourceCommit: string;
    topologicalOrder: readonly string[];
    waves: readonly (readonly string[])[];
    completedWaveCount: number;
    integratedTaskIds: readonly string[];
    acceptedWrites: readonly ModuleDeliveryHandoffSubmission[];
    acceptedEvidence: readonly ModuleDeliveryProviderResult[];
    integratedWriterFrontiers: readonly ModuleDeliveryWriterFrontier[];
    headCommit: string;
    admissionState: ModuleDeliveryAdmissionState;
    workspace: ModuleWorktreeHandle;
    cleanupHandle: ModuleIntegrationCleanupHandle;
  }>;

export type IntegrateVerifiedModuleDeliveryTaskRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  acceptedPlan: ValidatedModuleDeliveryPlan;
  lease: ModuleDeliveryAttemptLease;
  state: ModuleIntegrationState;
  submission: ModuleDeliveryProviderSubmission;
}>;

export type FinalizeModuleDeliveryIntegrationRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  acceptedPlan: ValidatedModuleDeliveryPlan;
  state: ModuleIntegrationState;
}>;

export type CleanupModuleIntegrationRequest = Readonly<{
  state: ModuleIntegrationState;
}>;
export type CleanupModuleIntegrationResult = Readonly<{ removed: boolean }>;

export type SourceSnapshotExpectation = Readonly<{
  repositoryRoot: string;
  expected: SourceRepositorySnapshot;
}>;
export type SourceRepositorySnapshot = Readonly<{
  headCommit: string;
  symbolicHead: string;
  contentDigest: string;
  metadataDigest: string;
  indexDigest: string;
  refsDigest: string;
  configDigest: string;
}>;
