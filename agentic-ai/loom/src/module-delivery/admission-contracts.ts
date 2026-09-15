import type { AgentAttemptParent } from '../agent-workflow/domain.ts';
import type { TeamKey } from '../team-agents/catalog.ts';
import type { TeamTaskContext } from '../team-agents/context.ts';
import type { PinnedDevBaseEvidence } from '../lib/base-evidence.ts';
import type {
  ModuleDeliveryOwnerIdentity,
  ModuleDeliveryResourceClaims,
  ValidatedModuleDeliveryPlan,
} from './domain.ts';
import type { ModuleDeliveryProviderResult } from './integration-provenance.ts';
import type { ModuleGenerationAuthority } from './admission-authority.ts';

export type ModuleDeliveryGenerationAuthority = ModuleGenerationAuthority;

export enum ModuleDeliveryAdmissionSelectionStatus {
  Selected = 'selected',
  Blocked = 'blocked',
}

export enum ModuleDeliveryAttemptDispositionKind {
  Accepted = 'accepted',
  FinalUnusable = 'final-unusable',
}

export enum ModuleDeliveryGenerationFenceKind {
  Accepted = 'accepted',
  Cancelled = 'cancelled',
  Failed = 'failed',
  Rejected = 'rejected',
}

export type ModuleDeliveryExpectedLineage = Readonly<{
  taskId: string;
  parentLineage: AgentAttemptParent;
}>;

export type CreateModuleDeliveryGenerationAuthorityRequest = Readonly<{
  acceptedPlan: ValidatedModuleDeliveryPlan;
  expectedLineage: readonly ModuleDeliveryExpectedLineage[];
  repositoryRoot: string;
}>;

export type CreateModuleDeliveryAdmissionStateRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  acceptedPlan: ValidatedModuleDeliveryPlan;
  headCommit: string;
  integratedWriterFrontiers: readonly ModuleDeliveryWriterFrontier[];
  acceptedEvidence: readonly ModuleDeliveryProviderResult[];
}>;

export type PrepareFinalModuleDeliveryAdmissionStateRequest =
  CreateModuleDeliveryAdmissionStateRequest &
    Readonly<{ previousState: ModuleDeliveryAdmissionState }>;

export type CommitFinalModuleDeliveryAdmissionStateRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  previousState: ModuleDeliveryAdmissionState;
  state: ModuleDeliveryAdmissionState;
}>;

export type RollbackFinalModuleDeliveryAdmissionStateRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  finalizedState: ModuleDeliveryAdmissionState;
  previousState: ModuleDeliveryAdmissionState;
}>;

export type RestartModuleDeliveryGenerationRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  previousState: ModuleDeliveryAdmissionState;
  acceptedPlan: ValidatedModuleDeliveryPlan;
  expectedLineage: readonly ModuleDeliveryExpectedLineage[];
}>;

export type AttemptIdentity = Readonly<{
  taskId: string;
  attempt: number;
  generation: number;
  planDigest: string;
}>;

/** A trusted in-process admission. It is scheduler data, not a capability. */
export type ModuleDeliveryAdmission = AttemptIdentity &
  PinnedDevBaseEvidence & {
    readonly startingFrontier: string;
    readonly resources: ModuleDeliveryResourceClaims;
    readonly context?: TeamTaskContext;
    readonly team: TeamKey;
    readonly functionalOwner: ModuleDeliveryOwnerIdentity;
    readonly acceptanceOwner: ModuleDeliveryOwnerIdentity;
    readonly parentLineage: AgentAttemptParent;
    readonly acceptanceRequirements: readonly string[];
  };

export type ModuleDeliveryAttemptLease = ModuleDeliveryAdmission;

export type ModuleDeliveryAttemptDisposition = AttemptIdentity & {
  readonly kind: ModuleDeliveryAttemptDispositionKind;
  readonly conclusion: ModuleDeliveryGenerationFenceKind;
};

export type ModuleDeliveryWriterFrontier = Readonly<{
  taskId: string;
  attempt: number;
  headCommit: string;
  integratedTaskIds: readonly string[];
}>;

/** Immutable scheduler state reduced after each trusted task result. */
export type ModuleDeliveryAdmissionState = PinnedDevBaseEvidence &
  Readonly<{
    generation: number;
    planDigest: string;
    headCommit: string;
    integratedWriterFrontiers: readonly ModuleDeliveryWriterFrontier[];
    acceptedProviderEvidence: readonly ModuleDeliveryProviderResult[];
  }>;

export type SelectModuleDeliveryAdmissionsRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  acceptedPlan: ValidatedModuleDeliveryPlan;
  state: ModuleDeliveryAdmissionState;
}>;

export type ModuleDeliveryAdmissionSelection = Readonly<{
  status: ModuleDeliveryAdmissionSelectionStatus;
  admissions: readonly ModuleDeliveryAdmission[];
  pendingTaskIds: readonly string[];
  blockedTaskIds: readonly string[];
}>;

export type RecordModuleDeliveryAttemptLeasesRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  state: ModuleDeliveryAdmissionState;
  admissions: readonly ModuleDeliveryAdmission[];
}>;

export type ModuleDeliveryLeaseRecording = Readonly<{
  state: ModuleDeliveryAdmissionState;
  leases: readonly ModuleDeliveryAttemptLease[];
}>;

export type ModuleDeliveryDispositionOutcome = Readonly<{
  kind: ModuleDeliveryAttemptDispositionKind;
  conclusion: ModuleDeliveryGenerationFenceKind;
}>;

export type RecordModuleDeliveryAttemptDispositionRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  state: ModuleDeliveryAdmissionState;
  lease: ModuleDeliveryAttemptLease;
  outcome: ModuleDeliveryDispositionOutcome;
}>;
