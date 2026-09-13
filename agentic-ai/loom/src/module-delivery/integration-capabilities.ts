import type {
  AssertModuleDeliveryIntegratedWriterFrontierCapabilityRequest,
  IntegratedWriterFrontierProvenance,
  ModuleDeliveryIntegratedWriterFrontierCapability,
} from './integration-contracts.ts';
import type {
  AssertModuleDeliveryCanonicalEvidenceTransitionRequest,
  CanonicalEvidenceTransitionProvenance,
  ModuleDeliveryCanonicalEvidenceTransition,
} from './integration-provenance.ts';

type ModuleIntegrationCapabilityBridge = Readonly<{
  frontierProvenance: (
    capability: ModuleDeliveryIntegratedWriterFrontierCapability,
  ) => IntegratedWriterFrontierProvenance | undefined;
  transitionProvenance: (
    transition: ModuleDeliveryCanonicalEvidenceTransition,
  ) => CanonicalEvidenceTransitionProvenance | undefined;
}>;

(() => {
  const globalValue = (globalThis as unknown as Record<symbol, unknown>)[
    Symbol.for('nook.loom.module-integration-capability-bridge')
  ];
  if (Array.isArray(globalValue)) return;
  const bridges: ModuleIntegrationCapabilityBridge[] = [];
  Object.defineProperty(
    globalThis,
    Symbol.for('nook.loom.module-integration-capability-bridge'),
    { configurable: false, enumerable: false, value: bridges, writable: true },
  );
})();

const capabilityBridges = (): ModuleIntegrationCapabilityBridge[] => {
  const value = (globalThis as unknown as Record<symbol, unknown>)[
    Symbol.for('nook.loom.module-integration-capability-bridge')
  ];
  return Array.isArray(value) ? (value as ModuleIntegrationCapabilityBridge[]) : [];
};

/**
 * Owns verification for the provenance-backed capabilities emitted by module
 * integration. Minting stays in the coordinator's lexical closure: this
 * module intentionally has no factory or registration operation.
 */
export class ModuleIntegrationCapabilityRegistry {
  private constructor() {}

  static assertModuleDeliveryIntegratedWriterFrontierCapability(
    request: AssertModuleDeliveryIntegratedWriterFrontierCapabilityRequest,
  ): void {
    const bridge = capabilityBridges().at(-1);
    if (!bridge)
      throw new Error('Integrated writer frontier capability is invalid.');
    const provenance = bridge.frontierProvenance(request.capability);
    if (
      !provenance ||
      provenance.authority !== request.authority ||
      request.capability.taskId !== provenance.taskId ||
      request.capability.attempt !== provenance.attempt ||
      request.capability.generation !== provenance.generation ||
      request.capability.planDigest !== provenance.planDigest ||
      request.capability.headCommit !== provenance.headCommit ||
      JSON.stringify(request.capability.integratedTaskIds) !==
        JSON.stringify(request.integratedTaskIds)
    )
      throw new Error('Integrated writer frontier capability is invalid.');
  }

  static assertModuleDeliveryCanonicalEvidenceTransition(
    request: AssertModuleDeliveryCanonicalEvidenceTransitionRequest,
  ): void {
    const bridge = capabilityBridges().at(-1);
    if (!bridge)
      throw new Error('Canonical evidence transition is invalid.');
    const provenance = bridge.transitionProvenance(request.transition);
    if (
      !provenance ||
      provenance.authority !== request.authority ||
      request.transition.previousHeadCommit !== request.previousHeadCommit ||
      request.transition.canonicalHeadCommit !== request.canonicalHeadCommit ||
      JSON.stringify(request.transition.integratedTaskIds) !==
        JSON.stringify(request.integratedTaskIds)
    )
      throw new Error('Canonical evidence transition is invalid.');
  }
}
