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

const WRITER_FRONTIER_PROVENANCE = new WeakMap<
  ModuleDeliveryIntegratedWriterFrontierCapability,
  IntegratedWriterFrontierProvenance
>();
const CANONICAL_EVIDENCE_PROVENANCE = new WeakMap<
  ModuleDeliveryCanonicalEvidenceTransition,
  CanonicalEvidenceTransitionProvenance
>();
const MINT_AUTHORITIES = new WeakSet<object>();
let boundMintAuthority: object | undefined;

/**
 * Owns verification for the provenance-backed capabilities emitted by module
 * integration. Minting stays in the coordinator's lexical closure: this
 * module intentionally has no factory or registration operation.
 */
export class ModuleIntegrationCapabilityRegistry {
  private constructor() {}

  static bindMintAuthority(authority: object): void {
    if (boundMintAuthority && boundMintAuthority !== authority)
      throw new Error('Module integration capability mint authority is bound.');
    boundMintAuthority ??= authority;
    MINT_AUTHORITIES.add(authority);
  }

  static acceptIntegratedWriterFrontier(
    request: BindIntegratedWriterFrontierRequest,
  ): void {
    ModuleIntegrationCapabilityRegistry.assertMintAuthority(
      request.mintAuthority,
    );
    WRITER_FRONTIER_PROVENANCE.set(
      request.capability,
      Object.freeze({
        ...request.provenance,
        integratedTaskIds: Object.freeze(
          request.provenance.integratedTaskIds.slice(),
        ),
      }),
    );
  }

  static acceptCanonicalEvidenceTransition(
    request: BindCanonicalEvidenceTransitionRequest,
  ): void {
    ModuleIntegrationCapabilityRegistry.assertMintAuthority(
      request.mintAuthority,
    );
    CANONICAL_EVIDENCE_PROVENANCE.set(
      request.transition,
      Object.freeze({
        ...request.provenance,
        integratedTaskIds: Object.freeze(
          request.provenance.integratedTaskIds.slice(),
        ),
      }),
    );
  }

  static assertModuleDeliveryIntegratedWriterFrontierCapability(
    request: AssertModuleDeliveryIntegratedWriterFrontierCapabilityRequest,
  ): void {
    const provenance = WRITER_FRONTIER_PROVENANCE.get(request.capability);
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
    const provenance = CANONICAL_EVIDENCE_PROVENANCE.get(request.transition);
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

  private static assertMintAuthority(authority: object): void {
    if (!MINT_AUTHORITIES.has(authority))
      throw new Error('Module integration capability mint authority is invalid.');
  }
}

type BindIntegratedWriterFrontierRequest = Readonly<{
  mintAuthority: object;
  capability: ModuleDeliveryIntegratedWriterFrontierCapability;
  provenance: IntegratedWriterFrontierProvenance;
}>;

type BindCanonicalEvidenceTransitionRequest = Readonly<{
  mintAuthority: object;
  transition: ModuleDeliveryCanonicalEvidenceTransition;
  provenance: CanonicalEvidenceTransitionProvenance;
}>;
