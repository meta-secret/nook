import { realpathSync } from 'node:fs';

import { taskResourcePatternsOverlap } from '../agent-workflow/domain.ts';
import {
  ModuleDeliveryTaskKind,
  ModuleDeliveryValidationStatus,
} from './domain.ts';
import { gitText, runModuleDeliveryGit } from './git-command.ts';
import { decodeAndValidateModuleDeliveryPlan } from './validation.ts';
import { MAX_EXPANDED_PROVIDER_EVIDENCE_IDENTITIES } from './evidence-limits.ts';

import type {
  AgentAttemptParent,
  TaskResourcePatternPair,
} from '../agent-workflow/domain.ts';
import type {
  ModuleDeliveryAdmission,
  ModuleDeliveryAdmissionSelection,
  ModuleDeliveryAttemptLease,
  ModuleDeliveryExpectedLineage,
  ModuleDeliveryGenerationAuthority,
} from './admission.ts';
import type {
  ModuleDeliveryNodeV2,
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
export type AcceptedModuleDeliveryEvidenceRegistration =
  AcceptedModuleDeliveryEvidenceInspection & {
    readonly integratedTaskIds: readonly string[];
  };
export type ModuleDeliveryIntegratedWrite = Readonly<{
  taskId: string;
  claims: readonly string[];
}>;
export type AcceptedModuleDeliveryEvidenceCollectionRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  acceptedPlan: ValidatedModuleDeliveryPlan;
  entries: readonly AcceptedModuleDeliveryEvidence[];
  headCommit: string;
  integratedWrites: readonly ModuleDeliveryIntegratedWrite[];
}>;
export type AcceptedModuleDeliveryEvidenceCollection = Readonly<{
  accepted: readonly AcceptedModuleDeliveryEvidence[];
  identities: readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[];
}>;
export type AcceptedModuleDeliveryEvidenceRegistry = Readonly<{
  register: (request: AcceptedModuleDeliveryEvidenceRegistration) => void;
  assert: (request: AcceptedModuleDeliveryEvidenceInspection) => void;
  identity: (
    evidence: AcceptedModuleDeliveryEvidence,
  ) => ModuleDeliveryAcceptedProviderEvidenceIdentity;
  collect: (
    request: AcceptedModuleDeliveryEvidenceCollectionRequest,
  ) => AcceptedModuleDeliveryEvidenceCollection;
}>;
type EvidenceFreshnessRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  identity: ModuleDeliveryAcceptedProviderEvidenceIdentity;
  headCommit: string;
  integratedWrites: readonly ModuleDeliveryIntegratedWrite[];
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
export type AuthenticateModuleDeliverySourceCommitRequest = {
  readonly repositoryRoot: string;
  readonly sourceCommit: string;
};
export type FrozenModuleDeliveryResourcesRequest = {
  readonly node: ModuleDeliveryNodeV2;
  readonly plan: ValidatedModuleDeliveryPlan;
};
export type ModuleDeliveryNodeLookupRequest = {
  readonly plan: ValidatedModuleDeliveryPlan;
  readonly taskId: string;
};

export function authenticateModuleDeliverySourceCommit(
  request: AuthenticateModuleDeliverySourceCommitRequest,
): string {
  const repositoryRoot = realpathSync(request.repositoryRoot);
  const rootRequest = {
    cwd: repositoryRoot,
    args: ['rev-parse', '--show-toplevel'],
    allowFailure: true,
  };
  const rootResult = runModuleDeliveryGit(rootRequest);
  if (
    rootResult.exitCode !== 0 ||
    realpathSync(gitText(rootResult)) !== repositoryRoot
  )
    throw new Error('Module delivery repository root is not canonical.');
  const commitRequest = {
    cwd: repositoryRoot,
    args: ['cat-file', '-e', `${request.sourceCommit}^{commit}`],
    allowFailure: true,
  };
  if (runModuleDeliveryGit(commitRequest).exitCode !== 0)
    throw new Error('Module delivery source commit is not authenticated.');
  return repositoryRoot;
}

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

export function frozenModuleDeliveryResources(
  request: FrozenModuleDeliveryResourcesRequest,
): ModuleDeliveryResourceClaims {
  const evidenceReads =
    request.node.kind === ModuleDeliveryTaskKind.EvidenceSynthesis
      ? []
      : request.node.dependencies.flatMap((taskId) => {
          const lookupRequest: ModuleDeliveryNodeLookupRequest = {
            plan: request.plan,
            taskId,
          };
          const provider = moduleDeliveryNode(lookupRequest);
          return provider.kind === ModuleDeliveryTaskKind.ReadOnly
            ? provider.resources.evidenceSurface
            : [];
        });
  const resources: ModuleDeliveryResourceClaims = {
    read: Object.freeze([
      ...new Set([...request.node.resources.read, ...evidenceReads]),
    ]),
    write: Object.freeze([...request.node.resources.write]),
    evidenceSurface: Object.freeze([...request.node.resources.evidenceSurface]),
  };
  return Object.freeze(resources);
}

export function moduleDeliveryNode(
  request: ModuleDeliveryNodeLookupRequest,
): ModuleDeliveryNodeV2 {
  const node = request.plan.plan.nodes.find(
    (candidate) => candidate.taskId === request.taskId,
  );
  if (!node)
    throw new Error(`Validated plan is missing task ${request.taskId}.`);
  return node;
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
export function assertEvidenceBound(
  identities: readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[],
): void {
  if (identities.length > MAX_EXPANDED_PROVIDER_EVIDENCE_IDENTITIES)
    throw new Error('Accepted provider evidence ancestry is too large.');
  const pending = [...identities];
  const seen = new Set<ModuleDeliveryAcceptedProviderEvidenceIdentity>();
  for (const current of pending) {
    if (seen.has(current))
      throw new Error('Accepted provider evidence ancestry is cyclic.');
    seen.add(current);
    if (
      pending.length + current.acceptedProviderEvidence.length >
      MAX_EXPANDED_PROVIDER_EVIDENCE_IDENTITIES
    )
      throw new Error('Accepted provider evidence ancestry is too large.');
    pending.push(...current.acceptedProviderEvidence);
  }
}

export function freezeProviderEvidenceIdentity(
  identity: ModuleDeliveryAcceptedProviderEvidenceIdentity,
): ModuleDeliveryAcceptedProviderEvidenceIdentity {
  assertEvidenceBound([identity]);
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

export function freezeModuleDeliveryAdmissionSelection(
  request: Readonly<ModuleDeliveryAdmissionSelection>,
): ModuleDeliveryAdmissionSelection {
  const selection: ModuleDeliveryAdmissionSelection = {
    ...request,
    admissions: Object.freeze([...request.admissions]),
    pendingTaskIds: Object.freeze([...request.pendingTaskIds]),
    blockedTaskIds: Object.freeze([...request.blockedTaskIds]),
  };
  return Object.freeze(selection);
}

export function copyModuleDeliveryAdmission(
  admission: ModuleDeliveryAdmission,
): ModuleDeliveryAttemptLease {
  const resources: ModuleDeliveryResourceClaims = {
    read: Object.freeze([...admission.resources.read]),
    write: Object.freeze([...admission.resources.write]),
    evidenceSurface: Object.freeze([...admission.resources.evidenceSurface]),
  };
  const parentLineage: AgentAttemptParent = { ...admission.parentLineage };
  return {
    ...admission,
    resources: Object.freeze(resources),
    parentLineage: Object.freeze(parentLineage),
    acceptanceRequirements: Object.freeze([
      ...admission.acceptanceRequirements,
    ]),
    authorizedProviderEvidence: Object.freeze([
      ...admission.authorizedProviderEvidence,
    ]),
  };
}

export function createAcceptedModuleDeliveryEvidenceRegistry(): AcceptedModuleDeliveryEvidenceRegistry {
  const authorities = new WeakMap<
    AcceptedModuleDeliveryEvidence,
    ModuleDeliveryGenerationAuthority
  >();
  const closures = new WeakMap<
    ModuleDeliveryGenerationAuthority,
    Map<string, readonly string[]>
  >();
  const evidenceFreshAtHead = (request: EvidenceFreshnessRequest): boolean => {
    const closure = closures
      .get(request.authority)
      ?.get(JSON.stringify(request.identity));
    if (!closure) return false;
    const laterWrites = request.integratedWrites.filter(
      ({ taskId }) => !closure.includes(taskId),
    );
    const claims: ResourceClaimPair = {
      first: request.identity.claimIdentities.map(({ claim }) => claim),
      second: laterWrites.flatMap(({ claims }) => claims),
    };
    return (
      (request.identity.verifiedHeadCommit === request.headCommit ||
        (laterWrites.length > 0 && !claimsOverlap(claims))) &&
      request.identity.acceptedProviderEvidence.every((identity) => {
        const nestedRequest: EvidenceFreshnessRequest = {
          authority: request.authority,
          identity,
          headCommit: request.headCommit,
          integratedWrites: request.integratedWrites,
        };
        return evidenceFreshAtHead(nestedRequest);
      })
    );
  };
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
    request: AcceptedModuleDeliveryEvidenceRegistration,
  ): void => {
    freezeProviderEvidenceIdentity(request.evidence);
    if (authorities.has(request.evidence))
      throw new Error(
        'Accepted module delivery evidence is already registered.',
      );
    authorities.set(request.evidence, request.authority);
    const key = JSON.stringify(identity(request.evidence));
    const authorityClosures = closures.get(request.authority) ?? new Map();
    const existing = authorityClosures.get(key);
    if (
      existing &&
      JSON.stringify(existing) !== JSON.stringify(request.integratedTaskIds)
    ) {
      authorities.delete(request.evidence);
      throw new Error('Accepted evidence integration closure is inconsistent.');
    }
    authorityClosures.set(key, Object.freeze([...request.integratedTaskIds]));
    closures.set(request.authority, authorityClosures);
  };
  const collect = (
    request: AcceptedModuleDeliveryEvidenceCollectionRequest,
  ): AcceptedModuleDeliveryEvidenceCollection => {
    assertEvidenceBound(request.entries);
    const seen = new Set<string>();
    const accepted = request.entries.map((evidence) => {
      const inspection: AcceptedModuleDeliveryEvidenceInspection = {
        authority: request.authority,
        evidence,
      };
      assert(inspection);
      const acceptedIdentity = identity(evidence);
      const freshnessRequest: EvidenceFreshnessRequest = {
        authority: request.authority,
        identity: acceptedIdentity,
        headCommit: request.headCommit,
        integratedWrites: request.integratedWrites,
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
