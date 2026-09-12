import type { ModuleDeliveryGenerationAuthority } from './admission.ts';

import type {
  ModuleDeliveryHandoffSubmission,
  ModuleDeliveryProviderSubmission,
  ModuleIntegrationState,
} from './integration-provenance.ts';

import type {
  ValidatedModuleDeliveryPlan,
  WriteModuleDeliveryNode,
} from './domain.ts';

import type { ModuleIntegrationProvenance } from './integration-provenance.ts';

import type { ModuleDeliveryAttemptLease } from './admission.ts';
export type ModuleGitInvocation = {
  readonly cwd: string;
  readonly args: readonly string[];
  readonly allowFailure?: boolean;
};

export type ExpectedHandoff = {
  readonly node: WriteModuleDeliveryNode;
  readonly baselineCommit: string;
  readonly submission: ModuleDeliveryHandoffSubmission;
};

export type ExpectedHandoffVerification = {
  readonly expected: ExpectedHandoff;
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
};

export type ValidatedWaveApplication = {
  readonly state: ModuleIntegrationState;
  readonly expectedHandoffs: readonly ExpectedHandoff[];
  readonly provenance: ModuleIntegrationProvenance;
};

export type AdvancedIntegrationStateRequest = {
  readonly previousState: ModuleIntegrationState;
  readonly nextState: ModuleIntegrationState;
  readonly provenance: ModuleIntegrationProvenance;
  readonly writerFrontiers: readonly ModuleDeliveryIntegratedWriterFrontierCapability[];
};

export type ProviderLeaseInspection = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
  readonly lease: ModuleDeliveryAttemptLease;
  readonly submission: ModuleDeliveryProviderSubmission;
};

export type RefreshedWriterFrontiersRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  state: ModuleIntegrationState;
}>;

export type IntegrationStateUpdate = readonly [
  ModuleIntegrationState,
  Partial<ModuleIntegrationState>,
];

export type ModuleDeliveryIntegratedWriterFrontierCapability = Readonly<{
  taskId: string;
  attempt: number;
  generation: number;
  planDigest: string;
  headCommit: string;
  integratedTaskIds: readonly string[];
}>;

export type AssertModuleDeliveryIntegratedWriterFrontierCapabilityRequest =
  Readonly<{
    capability: ModuleDeliveryIntegratedWriterFrontierCapability;
    authority: ModuleDeliveryGenerationAuthority;
    taskId: string;
    attempt: number;
    generation: number;
    planDigest: string;
    headCommit: string;
    integratedTaskIds: readonly string[];
  }>;

export type IntegratedWriterFrontierProvenance = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  taskId: string;
  attempt: number;
  generation: number;
  planDigest: string;
  headCommit: string;
  integratedTaskIds: readonly string[];
}>;

export type MintIntegratedWriterFrontierRequest =
  IntegratedWriterFrontierProvenance;
