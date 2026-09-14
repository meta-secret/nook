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

/** Owns private provenance identity for capabilities emitted by integration. */
export class ModuleIntegrationCapabilityProvenance {
  #frontiers = new WeakMap<
    ModuleDeliveryIntegratedWriterFrontierCapability,
    IntegratedWriterFrontierProvenance
  >();
  #transitions = new WeakMap<
    ModuleDeliveryCanonicalEvidenceTransition,
    CanonicalEvidenceTransitionProvenance
  >();

  recordFrontier(
    ...[capability, provenance]: [
      capability: ModuleDeliveryIntegratedWriterFrontierCapability,
      provenance: IntegratedWriterFrontierProvenance,
    ]
  ): void {
    this.#frontiers.set(capability, provenance);
  }

  recordTransition(
    ...[transition, provenance]: [
      transition: ModuleDeliveryCanonicalEvidenceTransition,
      provenance: CanonicalEvidenceTransitionProvenance,
    ]
  ): void {
    this.#transitions.set(transition, provenance);
  }

  assertFrontier(
    request: AssertModuleDeliveryIntegratedWriterFrontierCapabilityRequest,
  ): void {
    const provenance = this.#frontiers.get(request.capability);
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

  assertTransition(
    request: AssertModuleDeliveryCanonicalEvidenceTransitionRequest,
  ): void {
    const provenance = this.#transitions.get(request.transition);
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
