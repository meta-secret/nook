import type {
  AssertModuleDeliveryIntegratedWriterFrontierCapabilityRequest,
  IntegratedWriterFrontierProvenance,
} from './integration-contracts.ts';
import type {
  AssertModuleDeliveryCanonicalEvidenceTransitionRequest,
} from './integration-provenance.ts';

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
    const provenance: IntegratedWriterFrontierProvenance = {
      authority: request.authority,
      taskId: request.taskId,
      attempt: request.attempt,
      generation: request.generation,
      planDigest: request.planDigest,
      headCommit: request.headCommit,
      integratedTaskIds: request.integratedTaskIds,
    };
    if (
      !ModuleIntegrationCapabilityRegistry.#hasAuthorityProof(
        request.capability,
        request.authority,
      ) ||
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
    if (
      !ModuleIntegrationCapabilityRegistry.#hasAuthorityProof(
        request.transition,
        request.authority,
      ) ||
      request.transition.previousHeadCommit !== request.previousHeadCommit ||
      request.transition.canonicalHeadCommit !== request.canonicalHeadCommit ||
      JSON.stringify(request.transition.integratedTaskIds) !==
        JSON.stringify(request.integratedTaskIds)
    )
      throw new Error('Canonical evidence transition is invalid.');
  }

  static #hasAuthorityProof(value: object, authority: object): boolean {
    const authoritySymbols = Object.getOwnPropertySymbols(authority);
    if (
      !authoritySymbols.some(
        (symbol) => (authority as Record<symbol, unknown>)[symbol] === true,
      )
    )
      return false;
    const proof = authoritySymbols
      .map((symbol) => (authority as Record<symbol, unknown>)[symbol])
      .find((candidate): candidate is object =>
        typeof candidate === 'object' && candidate !== null,
      );
    if (!proof) return false;
    return Object.getOwnPropertySymbols(value).some(
      (symbol) => (value as Record<symbol, unknown>)[symbol] === proof,
    );
  }
}
