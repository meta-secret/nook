import { taskResourcePatternsOverlap } from '../agent-workflow/domain.ts';
import { ModuleDeliveryValidationStatus } from './domain.ts';
import { decodeAndValidateModuleDeliveryPlan } from './validation.ts';

import type {
  AgentAttemptParent,
  TaskResourcePatternPair,
} from '../agent-workflow/domain.ts';
import type {
  ModuleDeliveryAdmissionSelection,
  ModuleDeliveryExpectedLineage,
  ModuleDeliveryGenerationAuthority,
} from './admission.ts';
import type {
  ModuleDeliveryResourceClaims,
  ValidatedModuleDeliveryPlan,
} from './domain.ts';
import type {
  ModuleDeliveryAcceptedProviderEvidenceIdentity,
  ModuleDeliveryEvidenceClaimIdentity,
} from './evidence.ts';
import type { AcceptedModuleDeliveryEvidence } from './integration-provenance.ts';

export type AcceptedModuleDeliveryEvidenceInspection = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly evidence: AcceptedModuleDeliveryEvidence;
};

export type AcceptedModuleDeliveryEvidenceCollectionRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  acceptedPlan: ValidatedModuleDeliveryPlan;
  entries: readonly AcceptedModuleDeliveryEvidence[];
  headCommit: string;
  integratedWriteClaims: readonly string[];
}>;

export type AcceptedModuleDeliveryEvidenceCollection = Readonly<{
  accepted: readonly AcceptedModuleDeliveryEvidence[];
  identities: readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[];
}>;

export type AcceptedModuleDeliveryEvidenceRegistry = Readonly<{
  register: (request: AcceptedModuleDeliveryEvidenceInspection) => void;
  assert: (request: AcceptedModuleDeliveryEvidenceInspection) => void;
  identity: (
    evidence: AcceptedModuleDeliveryEvidence,
  ) => ModuleDeliveryAcceptedProviderEvidenceIdentity;
  collect: (
    request: AcceptedModuleDeliveryEvidenceCollectionRequest,
  ) => AcceptedModuleDeliveryEvidenceCollection;
}>;

type EvidenceFreshnessRequest = Readonly<{
  identity: ModuleDeliveryAcceptedProviderEvidenceIdentity;
  headCommit: string;
  integratedWriteClaims: readonly string[];
}>;

export type ExpectedLineageMapRequest = {
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
  readonly entries: readonly ModuleDeliveryExpectedLineage[];
};

export type ResourceConflictRequest = {
  readonly first: ModuleDeliveryResourceClaims;
  readonly second: ModuleDeliveryResourceClaims;
};

type ResourceClaimPair = {
  readonly first: readonly string[];
  readonly second: readonly string[];
};

export type FrozenAdmissionSelectionRequest =
  Readonly<ModuleDeliveryAdmissionSelection>;

export function trustedModuleDeliveryPlanSnapshot(
  candidate: ValidatedModuleDeliveryPlan,
): ValidatedModuleDeliveryPlan {
  const accepted = decodeAndValidateModuleDeliveryPlan(
    JSON.stringify(candidate.plan),
  );
  if (
    accepted.status !== ModuleDeliveryValidationStatus.Accepted ||
    accepted.planDigest !== candidate.planDigest ||
    JSON.stringify(accepted.topologicalOrder) !==
      JSON.stringify(candidate.topologicalOrder) ||
    JSON.stringify(accepted.waves) !== JSON.stringify(candidate.waves) ||
    JSON.stringify(accepted.executionPrecedence) !==
      JSON.stringify(candidate.executionPrecedence)
  )
    throw new Error('Validated module delivery plan metadata is inconsistent.');
  return accepted;
}

export function expectedModuleDeliveryLineageMap(
  request: ExpectedLineageMapRequest,
): ReadonlyMap<string, AgentAttemptParent> {
  if (request.entries.length !== request.acceptedPlan.plan.nodes.length)
    throw new Error('Expected lineage must bind every module delivery task.');
  const result = new Map<string, AgentAttemptParent>();
  for (const entry of request.entries) {
    const node = request.acceptedPlan.plan.nodes.find(
      ({ taskId }) => taskId === entry.taskId,
    );
    if (
      !node ||
      result.has(entry.taskId) ||
      JSON.stringify(entry.parentLineage) !== JSON.stringify(node.parentLineage)
    )
      throw new Error(`Expected lineage is invalid for ${entry.taskId}.`);
    const parent: AgentAttemptParent = { ...entry.parentLineage };
    result.set(entry.taskId, Object.freeze(parent));
  }
  return result;
}

function claimsOverlap(request: ResourceClaimPair): boolean {
  return request.first.some((left) =>
    request.second.some((right) => {
      const pair: TaskResourcePatternPair = { first: left, second: right };
      return taskResourcePatternsOverlap(pair);
    }),
  );
}

export function moduleDeliveryResourcesConflict(
  request: ResourceConflictRequest,
): boolean {
  const pairs: readonly ResourceClaimPair[] = [
    { first: request.first.write, second: request.second.write },
    { first: request.first.write, second: request.second.read },
    { first: request.first.read, second: request.second.write },
  ];
  return pairs.some(claimsOverlap);
}

function frozenClaim(
  claim: ModuleDeliveryEvidenceClaimIdentity,
): ModuleDeliveryEvidenceClaimIdentity {
  const copy: ModuleDeliveryEvidenceClaimIdentity = { ...claim };
  return Object.freeze(copy);
}

export function freezeProviderEvidenceIdentity(
  identity: ModuleDeliveryAcceptedProviderEvidenceIdentity,
): ModuleDeliveryAcceptedProviderEvidenceIdentity {
  const copy: ModuleDeliveryAcceptedProviderEvidenceIdentity = {
    ...identity,
    claimIdentities: Object.freeze(identity.claimIdentities.map(frozenClaim)),
    acceptanceRequirements: Object.freeze([...identity.acceptanceRequirements]),
    acceptedProviderEvidence: Object.freeze(
      identity.acceptedProviderEvidence.map(freezeProviderEvidenceIdentity),
    ),
  };
  return Object.freeze(copy);
}

function evidenceFreshAtHead(request: EvidenceFreshnessRequest): boolean {
  const claims: ResourceClaimPair = {
    first: request.identity.claimIdentities.map(({ claim }) => claim),
    second: request.integratedWriteClaims,
  };
  return (
    (request.identity.verifiedHeadCommit === request.headCommit ||
      (request.integratedWriteClaims.length > 0 && !claimsOverlap(claims))) &&
    request.identity.acceptedProviderEvidence.every((identity) => {
      const nestedRequest: EvidenceFreshnessRequest = {
        identity,
        headCommit: request.headCommit,
        integratedWriteClaims: request.integratedWriteClaims,
      };
      return evidenceFreshAtHead(nestedRequest);
    })
  );
}

export function freezeModuleDeliveryAdmissionSelection(
  request: FrozenAdmissionSelectionRequest,
): ModuleDeliveryAdmissionSelection {
  const selection: ModuleDeliveryAdmissionSelection = {
    ...request,
    admissions: Object.freeze([...request.admissions]),
    pendingTaskIds: Object.freeze([...request.pendingTaskIds]),
    blockedTaskIds: Object.freeze([...request.blockedTaskIds]),
  };
  return Object.freeze(selection);
}

export function createAcceptedModuleDeliveryEvidenceRegistry(): AcceptedModuleDeliveryEvidenceRegistry {
  const authorities = new WeakMap<
    AcceptedModuleDeliveryEvidence,
    ModuleDeliveryGenerationAuthority
  >();
  const assert = (request: AcceptedModuleDeliveryEvidenceInspection): void => {
    if (authorities.get(request.evidence) !== request.authority)
      throw new Error(
        'Accepted module delivery evidence authority is invalid.',
      );
  };
  const identity = (
    evidence: AcceptedModuleDeliveryEvidence,
  ): ModuleDeliveryAcceptedProviderEvidenceIdentity => {
    if (!authorities.has(evidence))
      throw new Error('Accepted module delivery evidence is forged.');
    const acceptedIdentity: ModuleDeliveryAcceptedProviderEvidenceIdentity = {
      schemaVersion: evidence.schemaVersion,
      generation: evidence.generation,
      planDigest: evidence.planDigest,
      taskId: evidence.taskId,
      attempt: evidence.attempt,
      producerTeam: evidence.producerTeam,
      functionalOwner: evidence.functionalOwner,
      acceptanceOwner: evidence.acceptanceOwner,
      sourceCommit: evidence.sourceCommit,
      verifiedHeadCommit: evidence.verifiedHeadCommit,
      artifactIdentity: evidence.artifactIdentity,
      artifactDigest: evidence.artifactDigest,
      sourceProvenanceDigest: evidence.sourceProvenanceDigest,
      verdict: evidence.verdict,
      claimIdentities: evidence.claimIdentities,
      acceptanceRequirements: evidence.acceptanceRequirements,
      acceptedProviderEvidence: evidence.acceptedProviderEvidence,
    };
    return freezeProviderEvidenceIdentity(acceptedIdentity);
  };
  const register = (
    request: AcceptedModuleDeliveryEvidenceInspection,
  ): void => {
    if (authorities.has(request.evidence))
      throw new Error(
        'Accepted module delivery evidence is already registered.',
      );
    authorities.set(request.evidence, request.authority);
  };
  const collect = (
    request: AcceptedModuleDeliveryEvidenceCollectionRequest,
  ): AcceptedModuleDeliveryEvidenceCollection => {
    const seen = new Set<string>();
    const accepted = request.entries.map((evidence) => {
      const inspection: AcceptedModuleDeliveryEvidenceInspection = {
        authority: request.authority,
        evidence,
      };
      assert(inspection);
      const acceptedIdentity = identity(evidence);
      const freshnessRequest: EvidenceFreshnessRequest = {
        identity: acceptedIdentity,
        headCommit: request.headCommit,
        integratedWriteClaims: request.integratedWriteClaims,
      };
      if (
        acceptedIdentity.generation !== request.acceptedPlan.plan.generation ||
        acceptedIdentity.planDigest !== request.acceptedPlan.planDigest ||
        seen.has(acceptedIdentity.taskId) ||
        !evidenceFreshAtHead(freshnessRequest)
      )
        throw new Error(
          `Accepted evidence is invalid for ${acceptedIdentity.taskId}.`,
        );
      seen.add(acceptedIdentity.taskId);
      return evidence;
    });
    const collection: AcceptedModuleDeliveryEvidenceCollection = {
      accepted: Object.freeze([...accepted]),
      identities: Object.freeze(accepted.map(identity)),
    };
    return Object.freeze(collection);
  };
  const registry: AcceptedModuleDeliveryEvidenceRegistry = {
    register,
    assert,
    identity,
    collect,
  };
  return Object.freeze(registry);
}
