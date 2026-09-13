import type {
  AssertModuleDeliveryIntegratedWriterFrontierCapabilityRequest,
  IntegratedWriterFrontierProvenance,
  MintIntegratedWriterFrontierRequest,
  ModuleDeliveryIntegratedWriterFrontierCapability,
} from './integration-contracts.ts';
import type {
  AssertModuleDeliveryCanonicalEvidenceTransitionRequest,
  CanonicalEvidenceTransitionProvenance,
  ModuleDeliveryCanonicalEvidenceTransition,
} from './integration-provenance.ts';

/** Owns the provenance-backed capabilities emitted by module integration. */
export class ModuleIntegrationCapabilityRegistry {
  private constructor() {}

  private static readonly WRITER_FRONTIER_PROVENANCE = new WeakMap<
    ModuleDeliveryIntegratedWriterFrontierCapability,
    IntegratedWriterFrontierProvenance
  >();

  private static readonly CANONICAL_EVIDENCE_TRANSITIONS = new WeakMap<
    ModuleDeliveryCanonicalEvidenceTransition,
    CanonicalEvidenceTransitionProvenance
  >();

  static mintIntegratedWriterFrontier(
    request: MintIntegratedWriterFrontierRequest,
  ): ModuleDeliveryIntegratedWriterFrontierCapability {
    const integratedTaskIds = Object.freeze(request.integratedTaskIds.slice());
    const capabilityValue: ModuleDeliveryIntegratedWriterFrontierCapability = {
      taskId: request.taskId,
      attempt: request.attempt,
      generation: request.generation,
      planDigest: request.planDigest,
      headCommit: request.headCommit,
      integratedTaskIds,
    };
    const capability = Object.freeze(capabilityValue);
    const provenance: IntegratedWriterFrontierProvenance = Object.assign(
      {},
      request,
      { integratedTaskIds },
    );
    ModuleIntegrationCapabilityRegistry.WRITER_FRONTIER_PROVENANCE.set(
      capability,
      Object.freeze(provenance),
    );
    return capability;
  }

  static assertModuleDeliveryIntegratedWriterFrontierCapability(
    request: AssertModuleDeliveryIntegratedWriterFrontierCapabilityRequest,
  ): void {
    const provenance =
      ModuleIntegrationCapabilityRegistry.WRITER_FRONTIER_PROVENANCE.get(
        request.capability,
      );
    if (
      !provenance ||
      provenance.authority !== request.authority ||
      provenance.taskId !== request.taskId ||
      provenance.attempt !== request.attempt ||
      provenance.generation !== request.generation ||
      provenance.planDigest !== request.planDigest ||
      provenance.headCommit !== request.headCommit ||
      JSON.stringify(provenance.integratedTaskIds) !==
        JSON.stringify(request.integratedTaskIds)
    )
      throw new Error('Integrated writer frontier capability is invalid.');
  }

  static assertModuleDeliveryCanonicalEvidenceTransition(
    request: AssertModuleDeliveryCanonicalEvidenceTransitionRequest,
  ): void {
    const provenance =
      ModuleIntegrationCapabilityRegistry.CANONICAL_EVIDENCE_TRANSITIONS.get(
        request.transition,
      );
    if (
      !provenance ||
      provenance.authority !== request.authority ||
      provenance.previousHeadCommit !== request.previousHeadCommit ||
      provenance.canonicalHeadCommit !== request.canonicalHeadCommit ||
      JSON.stringify(provenance.integratedTaskIds) !==
        JSON.stringify(request.integratedTaskIds)
    )
      throw new Error('Canonical evidence transition is invalid.');
  }

  static canonicalEvidenceTransition(
    request: CanonicalEvidenceTransitionProvenance,
  ): ModuleDeliveryCanonicalEvidenceTransition {
    const integratedTaskIds = Object.freeze(request.integratedTaskIds.slice());
    const transitionValue: ModuleDeliveryCanonicalEvidenceTransition = {
      previousHeadCommit: request.previousHeadCommit,
      canonicalHeadCommit: request.canonicalHeadCommit,
      integratedTaskIds,
    };
    const transition = Object.freeze(transitionValue);
    const provenance: CanonicalEvidenceTransitionProvenance = Object.assign(
      {},
      request,
      { integratedTaskIds },
    );
    ModuleIntegrationCapabilityRegistry.CANONICAL_EVIDENCE_TRANSITIONS.set(
      transition,
      Object.freeze(provenance),
    );
    return transition;
  }
}
