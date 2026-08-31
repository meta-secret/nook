import { restoreModuleDeliveryCanonicalEvidenceReceipt } from './admission.ts';
import {
  assertFreshModuleIntegrationState,
  assertModuleIntegrationLeaseFrontier,
  immutableModuleIntegrationState,
  integrationProvenance,
  moduleIntegrationCompletedWaveCount,
  registerIntegrationState,
  retireIntegrationState,
} from './integration-provenance.ts';

import type {
  ModuleDeliveryAttemptLease,
  ModuleDeliveryGenerationAuthority,
} from './admission.ts';
import type { ValidatedModuleDeliveryPlan } from './domain.ts';
import type { ModuleDeliveryAcceptedProviderEvidenceIdentity } from './evidence.ts';
import type { ModuleIntegrationState } from './integration-provenance.ts';

export function restoreModuleDeliveryIntegrationEvidence(
  request: Readonly<{
    authority: ModuleDeliveryGenerationAuthority;
    acceptedPlan: ValidatedModuleDeliveryPlan;
    lease: ModuleDeliveryAttemptLease;
    state: ModuleIntegrationState;
    receipt: ModuleDeliveryAcceptedProviderEvidenceIdentity;
  }>,
): ModuleIntegrationState {
  const provenance = integrationProvenance(request.state);
  assertFreshModuleIntegrationState({ state: request.state, provenance });
  assertModuleIntegrationLeaseFrontier({
    state: request.state,
    lease: request.lease,
  });
  const restored = restoreModuleDeliveryCanonicalEvidenceReceipt({
    ...request,
    state: request.state.admissionState,
    acceptedEvidence: request.state.acceptedEvidence,
  });
  const provisional: ModuleIntegrationState = {
    ...request.state,
    acceptedEvidence: [...request.state.acceptedEvidence, restored.evidence],
    admissionState: restored.state,
  };
  const immutable = immutableModuleIntegrationState({
    ...provisional,
    completedWaveCount: moduleIntegrationCompletedWaveCount({
      acceptedPlan: request.acceptedPlan,
      state: provisional,
    }),
  });
  registerIntegrationState({
    authority: request.authority,
    state: immutable,
    sourceSnapshot: provenance.sourceSnapshot,
    workspaceSnapshot: provenance.workspaceSnapshot,
    session: provenance.session,
  });
  retireIntegrationState(request.state);
  return immutable;
}
