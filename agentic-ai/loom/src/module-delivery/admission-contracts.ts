import type { ModuleDeliveryAcceptedProviderEvidenceIdentity } from './evidence.ts';

import type { AgentAttemptParent } from '../agent-workflow/domain.ts';

import type { TeamKey } from '../team-agents/catalog.ts';

import type { TeamTaskContext } from '../team-agents/context.ts';

import type {
  ModuleDeliveryOwnerIdentity,
  ModuleDeliveryResourceClaims,
  ValidatedModuleDeliveryPlan,
} from './domain.ts';

import type { AcceptedModuleDeliveryEvidence } from './integration-provenance.ts';

import type { ModuleDeliveryIntegratedWriterFrontierCapability } from './integration.ts';

import type { ModuleDeliveryCanonicalEvidenceTransition } from './integration-provenance.ts';

import type { ModuleDeliveryGenerationAuthority } from './admission.ts';

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

export type CreateModuleDeliveryGenerationAuthorityRequest = {
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
  readonly expectedLineage: readonly ModuleDeliveryExpectedLineage[];
  readonly repositoryRoot: string;
};

export type CreateModuleDeliveryAdmissionStateRequest = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
  readonly headCommit: string;
  readonly integratedWriterFrontiers: readonly ModuleDeliveryIntegratedWriterFrontierCapability[];
  readonly acceptedEvidence: readonly AcceptedModuleDeliveryEvidence[];
};

export type PrepareFinalModuleDeliveryAdmissionStateRequest =
  CreateModuleDeliveryAdmissionStateRequest & {
    readonly previousState: ModuleDeliveryAdmissionState;
    readonly canonicalTransition: ModuleDeliveryCanonicalEvidenceTransition;
  };

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

export type RestartModuleDeliveryGenerationRequest = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly previousState: ModuleDeliveryAdmissionState;
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
  readonly expectedLineage: readonly ModuleDeliveryExpectedLineage[];
};

export type AttemptIdentity = Readonly<{
  taskId: string;
  attempt: number;
  generation: number;
  planDigest: string;
}>;

export type ModuleDeliveryAdmission = AttemptIdentity & {
  readonly startingFrontier: string;
  readonly resources: ModuleDeliveryResourceClaims;
  readonly context?: TeamTaskContext;
  readonly team: TeamKey;
  readonly functionalOwner: ModuleDeliveryOwnerIdentity;
  readonly acceptanceOwner: ModuleDeliveryOwnerIdentity;
  readonly parentLineage: AgentAttemptParent;
  readonly acceptanceRequirements: readonly string[];
  readonly authorizedProviderEvidence: readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[];
};

export type ModuleDeliveryAttemptLease = ModuleDeliveryAdmission;

export type ModuleDeliveryAttemptDisposition = AttemptIdentity & {
  readonly kind: ModuleDeliveryAttemptDispositionKind;
  readonly conclusion: ModuleDeliveryGenerationFenceKind;
};

export type ModuleDeliveryAdmissionState = Readonly<{
  generation: number;
  planDigest: string;
  headCommit: string;
  integratedWriterFrontiers: readonly ModuleDeliveryIntegratedWriterFrontierCapability[];
  acceptedProviderEvidence: readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[];
}>;

export type SelectModuleDeliveryAdmissionsRequest = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
  readonly state: ModuleDeliveryAdmissionState;
};

export type ModuleDeliveryAdmissionSelection = {
  readonly status: ModuleDeliveryAdmissionSelectionStatus;
  readonly admissions: readonly ModuleDeliveryAdmission[];
  readonly pendingTaskIds: readonly string[];
  readonly blockedTaskIds: readonly string[];
};

export type RecordModuleDeliveryAttemptLeasesRequest = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly state: ModuleDeliveryAdmissionState;
  readonly admissions: readonly ModuleDeliveryAdmission[];
};

export type ModuleDeliveryLeaseRecording = {
  readonly state: ModuleDeliveryAdmissionState;
  readonly leases: readonly ModuleDeliveryAttemptLease[];
};
