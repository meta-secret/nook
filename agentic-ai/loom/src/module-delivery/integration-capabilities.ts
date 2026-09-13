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
import {
  isModuleIntegrationCapabilityMintAuthority,
} from './integration-capability-authority.ts';
import type { ModuleIntegrationCapabilityMintAuthority } from './integration-capability-authority.ts';

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

  static registerIntegratedWriterFrontier(
    request: RegisterIntegratedWriterFrontierRequest,
  ): void {
    ModuleIntegrationCapabilityRegistry.assertMintAuthority(request.authority);
    ModuleIntegrationCapabilityRegistry.WRITER_FRONTIER_PROVENANCE.set(
      request.capability,
      Object.freeze(request.provenance),
    );
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

  static registerCanonicalEvidenceTransition(
    request: RegisterCanonicalEvidenceTransitionRequest,
  ): void {
    ModuleIntegrationCapabilityRegistry.assertMintAuthority(request.authority);
    ModuleIntegrationCapabilityRegistry.CANONICAL_EVIDENCE_TRANSITIONS.set(
      request.transition,
      Object.freeze(request.provenance),
    );
  }

  private static assertMintAuthority(
    authority: ModuleIntegrationCapabilityMintAuthority,
  ): void {
    if (!isModuleIntegrationCapabilityMintAuthority(authority))
      throw new Error('Module integration capability mint authority is invalid.');
  }
}

type RegisterIntegratedWriterFrontierRequest = Readonly<{
  authority: ModuleIntegrationCapabilityMintAuthority;
  capability: ModuleDeliveryIntegratedWriterFrontierCapability;
  provenance: IntegratedWriterFrontierProvenance;
}>;

type RegisterCanonicalEvidenceTransitionRequest = Readonly<{
  authority: ModuleIntegrationCapabilityMintAuthority;
  transition: ModuleDeliveryCanonicalEvidenceTransition;
  provenance: CanonicalEvidenceTransitionProvenance;
}>;
