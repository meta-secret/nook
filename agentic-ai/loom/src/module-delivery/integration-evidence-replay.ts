import { ModuleGenerationAuthority } from './admission.ts';

import { ModuleWriterFrontierRegistry } from './integration-writer-frontiers.ts';

import { ModuleIntegrationProvenanceRegistry } from './integration-provenance.ts';

import type {
  ModuleDeliveryAttemptLease,
  ModuleDeliveryGenerationAuthority,
} from './admission.ts';

import type { ValidatedModuleDeliveryPlan } from './domain.ts';

import type { ModuleDeliveryAcceptedProviderEvidenceIdentity } from './evidence.ts';

import type { ModuleIntegrationState } from './integration-provenance.ts';

export class ModuleIntegrationEvidence {
  private constructor(
    private readonly request: RestoreModuleDeliveryIntegrationEvidenceRequest,
  ) {}
  static restore(
    request: RestoreModuleDeliveryIntegrationEvidenceRequest,
  ): ModuleIntegrationState {
    return new ModuleIntegrationEvidence(request).execute();
  }
  private execute(): ModuleIntegrationState {
    const request = this.request;
    const provenance =
      ModuleIntegrationProvenanceRegistry.integrationProvenance(request.state);
    ModuleIntegrationProvenanceRegistry.assertFreshModuleIntegrationState({
      state: request.state,
      provenance,
    });
    ModuleIntegrationProvenanceRegistry.assertModuleIntegrationLeaseFrontier({
      state: request.state,
      lease: request.lease,
    });
    const restored =
      ModuleGenerationAuthority.restoreModuleDeliveryCanonicalEvidenceReceipt({
        ...request,
        state: request.state.admissionState,
        acceptedEvidence: request.state.acceptedEvidence,
      });
    const provisional: ModuleIntegrationState = {
      ...request.state,
      acceptedEvidence: [...request.state.acceptedEvidence, restored.evidence],
      admissionState: restored.state,
    };
    const immutable =
      ModuleIntegrationProvenanceRegistry.immutableModuleIntegrationState({
        ...provisional,
        completedWaveCount:
          ModuleIntegrationProvenanceRegistry.moduleIntegrationCompletedWaveCount(
            {
              acceptedPlan: request.acceptedPlan,
              state: provisional,
            },
          ),
      });
    ModuleIntegrationProvenanceRegistry.registerIntegrationState({
      authority: request.authority,
      state: immutable,
      sourceSnapshot: provenance.sourceSnapshot,
      workspaceSnapshot: provenance.workspaceSnapshot,
      session: provenance.session,
    });
    ModuleWriterFrontierRegistry.registerModuleDeliveryWriterFrontiers({
      state: immutable,
      writerFrontiers: immutable.admissionState.integratedWriterFrontiers,
    });
    ModuleIntegrationProvenanceRegistry.retireIntegrationState(request.state);
    return immutable;
  }
}

export type RestoreModuleDeliveryIntegrationEvidenceRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  acceptedPlan: ValidatedModuleDeliveryPlan;
  lease: ModuleDeliveryAttemptLease;
  state: ModuleIntegrationState;
  receipt: ModuleDeliveryAcceptedProviderEvidenceIdentity;
}>;
