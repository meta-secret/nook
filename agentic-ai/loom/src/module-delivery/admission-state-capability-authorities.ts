import { ModuleIntegrationCapabilityRegistry } from './integration-capabilities.ts';
import type { AssertModuleDeliveryIntegratedWriterFrontierCapabilityRequest } from './integration-contracts.ts';
import type { AssertModuleDeliveryCanonicalEvidenceTransitionRequest } from './integration-provenance.ts';

/** Owns deferred integration capability checks used by admission state. */
export class ModuleAdmissionStateCapabilityAuthorities {
  static assertCanonicalTransition(
    request: AssertModuleDeliveryCanonicalEvidenceTransitionRequest,
  ): void {
    ModuleIntegrationCapabilityRegistry.assertModuleDeliveryCanonicalEvidenceTransition(
      request,
    );
  }

  static assertWriterFrontier(
    request: AssertModuleDeliveryIntegratedWriterFrontierCapabilityRequest,
  ): void {
    ModuleIntegrationCapabilityRegistry.assertModuleDeliveryIntegratedWriterFrontierCapability(
      request,
    );
  }
}
