import { ModuleIntegrationCapabilityAssertions } from './integration.ts';
import type { AssertModuleDeliveryIntegratedWriterFrontierCapabilityRequest } from './integration-contracts.ts';
import type { AssertModuleDeliveryCanonicalEvidenceTransitionRequest } from './integration-provenance.ts';

/**
 * Owns verification for the provenance-backed capabilities emitted by module
 * integration. Minting stays in the coordinator's lexical closure: this
 * module intentionally has no factory or registration operation. The runtime
 * import is cycle-safe because the assertion boundary is only read by calls.
 */
export class ModuleIntegrationCapabilityRegistry {
  private constructor() {}

  static assertModuleDeliveryIntegratedWriterFrontierCapability(
    request: AssertModuleDeliveryIntegratedWriterFrontierCapabilityRequest,
  ): void {
    ModuleIntegrationCapabilityAssertions.assertModuleDeliveryIntegratedWriterFrontierCapability(
      request,
    );
  }

  static assertModuleDeliveryCanonicalEvidenceTransition(
    request: AssertModuleDeliveryCanonicalEvidenceTransitionRequest,
  ): void {
    ModuleIntegrationCapabilityAssertions.assertModuleDeliveryCanonicalEvidenceTransition(
      request,
    );
  }
}
