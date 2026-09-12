import type {
  ModuleDeliveryAttemptLease,
  ModuleDeliveryAttemptDisposition,
  ModuleDeliveryAdmissionState,
} from './admission-contracts.ts';

import type { AgentAttemptParent } from '../agent-workflow/domain.ts';

import type {
  ModuleDeliveryNodeV2,
  ValidatedModuleDeliveryPlan,
} from './domain.ts';

import type { ModuleDeliveryDispositionOutcome } from './integration-provenance.ts';

import type { AcceptedModuleDeliveryEvidenceRegistry } from './authority.ts';

import type { ModuleDeliveryGenerationAuthority } from './admission.ts';

export type AuthorityState = {
  repositoryRoot: string;
  inputPlan: ValidatedModuleDeliveryPlan;
  acceptedPlan: ValidatedModuleDeliveryPlan;
  expectedLineage: ReadonlyMap<string, AgentAttemptParent>;
  activeLeases: Map<string, ModuleDeliveryAttemptLease>;
  leaseHistory: Map<string, ModuleDeliveryAttemptLease>;
  attemptsByTask: Map<string, number>;
  dispositions: ModuleDeliveryAttemptDisposition[];
  evidenceRegistry: AcceptedModuleDeliveryEvidenceRegistry;
};

export type CapabilityProvenance = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly state: ModuleDeliveryAdmissionState;
};

export type NodeLookupRequest = {
  readonly plan: ValidatedModuleDeliveryPlan;
  readonly taskId: string;
};

export type AuthorityTaskRequest = {
  readonly authority: AuthorityState;
  readonly taskId: string;
};

export type TaskReadyRequest = {
  readonly authority: AuthorityState;
  readonly state: ModuleDeliveryAdmissionState;
  readonly node: ModuleDeliveryNodeV2;
};

export type SynthesisReadyRequest = {
  readonly state: ModuleDeliveryAdmissionState;
  readonly node: ModuleDeliveryNodeV2;
};

export type DispositionValidationRequest = {
  readonly authority: AuthorityState;
  readonly state: ModuleDeliveryAdmissionState;
  readonly lease: ModuleDeliveryAttemptLease;
  readonly outcome: ModuleDeliveryDispositionOutcome;
};

export type StartingFrontierRequest = {
  readonly authority: AuthorityState;
  readonly state: ModuleDeliveryAdmissionState;
  readonly node: ModuleDeliveryNodeV2;
  readonly plan: ValidatedModuleDeliveryPlan;
};
