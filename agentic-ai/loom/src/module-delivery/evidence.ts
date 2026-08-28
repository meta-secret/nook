/* eslint-disable max-params, loom/no-raw-object-arguments */
import { taskResourcePatternsOverlap } from '../agent-workflow/domain.ts';
import {
  assertModuleDeliveryAttemptLeaseAuthority,
  assertModuleDeliveryAdmissionStateAuthority,
  assertModuleDeliveryGenerationAuthority,
  moduleDeliveryAuthorityPlan,
} from './admission.ts';
import { ModuleDeliveryTaskKind } from './domain.ts';
import { runModuleDeliveryGit } from './git-command.ts';
import {
  MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION,
  ModuleDeliveryEvidenceVerdict,
  ModuleDeliveryProviderSubmissionKind,
  moduleDeliveryEvidenceSha256,
} from './integration-provenance.ts';

import type { TaskResourcePatternPair } from '../agent-workflow/domain.ts';
import type { TeamKey } from '../team-agents/catalog.ts';
import type {
  ModuleDeliveryAttemptLease,
  ModuleDeliveryAdmissionState,
  ModuleDeliveryGenerationAuthority,
} from './admission.ts';
import type {
  ModuleDeliveryNodeV2,
  ValidatedModuleDeliveryPlan,
} from './domain.ts';
import type { GitCommandRequest } from './git-command.ts';
import type {
  AcceptedModuleDeliveryEvidence,
  AcceptedModuleDeliveryEvidenceInspection,
  ModuleDeliveryReadOnlyEvidenceSubmission,
} from './integration-provenance.ts';

export type ModuleDeliveryEvidenceDigestRequest = {
  readonly repositoryRoot: string;
  readonly sourceCommit: string;
  readonly evidenceSurface: readonly string[];
};

export type ModuleDeliveryEvidenceClaimIdentity = Readonly<{
  claim: string;
  contentDigest: string;
}>;

export type ModuleDeliveryEvidenceArtifactDigestRequest = {
  readonly artifactIdentity: string;
  readonly evidence: readonly string[];
  readonly acceptanceRequirements: readonly string[];
  readonly acceptedProviderEvidence: readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[];
};

export type ModuleDeliveryAcceptedProviderEvidenceIdentity = Readonly<{
  schemaVersion: typeof MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION;
  generation: number;
  planDigest: string;
  taskId: string;
  attempt: number;
  producerTeam: TeamKey;
  functionalOwner: TeamKey;
  acceptanceOwner: TeamKey;
  sourceCommit: string;
  artifactIdentity: string;
  artifactDigest: string;
  sourceProvenanceDigest: string;
  verdict: ModuleDeliveryEvidenceVerdict.TerminalSuccess;
  claimIdentities: readonly ModuleDeliveryEvidenceClaimIdentity[];
  acceptanceRequirements: readonly string[];
}>;

export type ModuleDeliveryEvidenceSubmissionVerification = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
  readonly repositoryRoot: string;
  readonly state: ModuleDeliveryAdmissionState;
  readonly submission: ModuleDeliveryReadOnlyEvidenceSubmission;
  readonly lease: ModuleDeliveryAttemptLease;
  readonly authorizedProviderEvidence: readonly AcceptedModuleDeliveryEvidence[];
};

type GitTreeEntry = Readonly<{ metadata: string; path: string }>;
type EvidenceArtifactDigestContent = Readonly<{
  artifactIdentity: string;
  evidence: readonly string[];
  acceptanceRequirements: readonly string[];
  acceptedProviderEvidence: readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[];
}>;
type EvidenceSourceProvenanceContent = Readonly<{
  sourceCommit: string;
  generation: number;
  planDigest: string;
  taskId: string;
  attempt: number;
  producerTeam: TeamKey;
  functionalOwner: TeamKey;
  acceptanceOwner: TeamKey;
  verdict: ModuleDeliveryEvidenceVerdict;
  claimIdentities: readonly ModuleDeliveryEvidenceClaimIdentity[];
  acceptanceRequirements: readonly string[];
  acceptedProviderEvidence: readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[];
}>;

const acceptedEvidenceAuthorities = new WeakMap<
  AcceptedModuleDeliveryEvidence,
  ModuleDeliveryGenerationAuthority
>();
const COMMIT = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

export function moduleDeliveryEvidenceSurfaceDigest(
  request: ModuleDeliveryEvidenceDigestRequest,
): string {
  return treeDigest(gitTreeEntries(request), request.evidenceSurface);
}

export function moduleDeliveryEvidenceClaimIdentities(
  request: ModuleDeliveryEvidenceDigestRequest,
): readonly ModuleDeliveryEvidenceClaimIdentity[] {
  const entries = gitTreeEntries(request);
  return Object.freeze(
    request.evidenceSurface.map((claim) =>
      Object.freeze({ claim, contentDigest: treeDigest(entries, [claim]) }),
    ),
  );
}

export function moduleDeliveryEvidenceArtifactDigest(
  request: ModuleDeliveryEvidenceArtifactDigestRequest,
): string {
  return digest({
    artifactIdentity: request.artifactIdentity,
    evidence: request.evidence,
    acceptanceRequirements: request.acceptanceRequirements,
    acceptedProviderEvidence: request.acceptedProviderEvidence,
  });
}

export function verifyModuleDeliveryEvidenceSubmission(
  verification: ModuleDeliveryEvidenceSubmissionVerification,
): AcceptedModuleDeliveryEvidence {
  const acceptedPlan = moduleDeliveryAuthorityPlan(
    verification.authority,
    verification.acceptedPlan,
  );
  assertModuleDeliveryGenerationAuthority({
    authority: verification.authority,
    generation: acceptedPlan.plan.generation,
    planDigest: acceptedPlan.planDigest,
  });
  assertModuleDeliveryAttemptLeaseAuthority({
    authority: verification.authority,
    lease: verification.lease,
  });
  assertModuleDeliveryAdmissionStateAuthority({
    authority: verification.authority,
    state: verification.state,
  });
  const node = nodeFor(acceptedPlan, verification.lease.taskId);
  assertSubmissionMetadata(verification, acceptedPlan, node);
  const authorized = authorizedIdentities(
    verification.authority,
    verification.authorizedProviderEvidence,
  );
  if (node.kind === ModuleDeliveryTaskKind.EvidenceSynthesis) {
    assertSynthesisInputs(node, verification.submission, authorized);
  } else {
    assertRepositoryEvidence(verification, node);
    if (
      authorized.length > 0 ||
      verification.submission.acceptedProviderEvidence.length > 0
    )
      throw new Error(
        `Repository evidence cannot bind provider inputs for ${node.taskId}.`,
      );
  }
  const artifactRequest: ModuleDeliveryEvidenceArtifactDigestRequest = {
    artifactIdentity: verification.submission.artifactIdentity,
    evidence: verification.submission.evidence,
    acceptanceRequirements: verification.submission.acceptanceRequirements,
    acceptedProviderEvidence: verification.submission.acceptedProviderEvidence,
  };
  if (
    moduleDeliveryEvidenceArtifactDigest(artifactRequest) !==
    verification.submission.artifactDigest
  )
    throw new Error(`Evidence artifact digest is invalid for ${node.taskId}.`);
  const accepted = freezeAcceptedEvidence(
    verification.submission,
    sourceProvenanceDigest(verification.submission),
  );
  acceptedEvidenceAuthorities.set(accepted, verification.authority);
  return accepted;
}

export function assertAcceptedModuleDeliveryEvidence(
  inspection: AcceptedModuleDeliveryEvidenceInspection,
): void {
  if (
    acceptedEvidenceAuthorities.get(inspection.evidence) !==
    inspection.authority
  )
    throw new Error('Accepted module delivery evidence authority is invalid.');
}

export function moduleDeliveryAcceptedEvidenceIdentity(
  evidence: AcceptedModuleDeliveryEvidence,
): ModuleDeliveryAcceptedProviderEvidenceIdentity {
  if (!acceptedEvidenceAuthorities.has(evidence))
    throw new Error('Accepted module delivery evidence is forged.');
  return Object.freeze({
    schemaVersion: evidence.schemaVersion,
    generation: evidence.generation,
    planDigest: evidence.planDigest,
    taskId: evidence.taskId,
    attempt: evidence.attempt,
    producerTeam: evidence.producerTeam,
    functionalOwner: evidence.functionalOwner,
    acceptanceOwner: evidence.acceptanceOwner,
    sourceCommit: evidence.sourceCommit,
    artifactIdentity: evidence.artifactIdentity,
    artifactDigest: evidence.artifactDigest,
    sourceProvenanceDigest: evidence.sourceProvenanceDigest,
    verdict: evidence.verdict,
    claimIdentities: frozenClaims(evidence.claimIdentities),
    acceptanceRequirements: Object.freeze([...evidence.acceptanceRequirements]),
  });
}

function assertSubmissionMetadata(
  verification: ModuleDeliveryEvidenceSubmissionVerification,
  acceptedPlan: ValidatedModuleDeliveryPlan,
  node: ModuleDeliveryNodeV2,
): void {
  const submission = verification.submission;
  const lease = verification.lease;
  if (
    node.kind === ModuleDeliveryTaskKind.Write ||
    submission.kind !== ModuleDeliveryProviderSubmissionKind.ReadOnlyEvidence ||
    submission.schemaVersion !== MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION ||
    submission.taskId !== node.taskId ||
    submission.taskId !== lease.taskId ||
    submission.attempt !== lease.attempt ||
    submission.generation !== lease.generation ||
    submission.generation !== acceptedPlan.plan.generation ||
    submission.planDigest !== lease.planDigest ||
    submission.planDigest !== acceptedPlan.planDigest ||
    submission.sourceCommit !== lease.startingFrontier ||
    submission.producerTeam !== lease.team ||
    submission.functionalOwner !== lease.functionalOwner ||
    submission.acceptanceOwner !== lease.acceptanceOwner ||
    submission.producerTeam !== node.team ||
    submission.functionalOwner !== node.functionalOwner ||
    submission.acceptanceOwner !== node.acceptanceOwner ||
    submission.verdict !== ModuleDeliveryEvidenceVerdict.TerminalSuccess ||
    !COMMIT.test(submission.sourceCommit) ||
    !validIdentity(submission.artifactIdentity) ||
    !DIGEST.test(submission.artifactDigest) ||
    !validEvidenceEntries(submission.evidence) ||
    JSON.stringify(submission.acceptanceRequirements) !==
      JSON.stringify(lease.acceptanceRequirements) ||
    JSON.stringify(submission.acceptanceRequirements) !==
      JSON.stringify(node.acceptance.evidence)
  )
    throw new Error(`Evidence metadata is invalid for ${node.taskId}.`);
}

function assertRepositoryEvidence(
  verification: ModuleDeliveryEvidenceSubmissionVerification,
  node: ModuleDeliveryNodeV2,
): void {
  if (!COMMIT.test(verification.state.headCommit))
    throw new Error('Current evidence frontier must be an exact commit.');
  const sourceRequest: ModuleDeliveryEvidenceDigestRequest = {
    repositoryRoot: verification.repositoryRoot,
    sourceCommit: verification.submission.sourceCommit,
    evidenceSurface: node.resources.evidenceSurface,
  };
  const currentRequest: ModuleDeliveryEvidenceDigestRequest = {
    ...sourceRequest,
    sourceCommit: verification.state.headCommit,
  };
  const source = moduleDeliveryEvidenceClaimIdentities(sourceRequest);
  const current = moduleDeliveryEvidenceClaimIdentities(currentRequest);
  if (
    JSON.stringify(source) !== JSON.stringify(current) ||
    JSON.stringify(source) !==
      JSON.stringify(verification.submission.claimIdentities)
  )
    throw new Error(`Repository evidence is stale for ${node.taskId}.`);
}

function assertSynthesisInputs(
  node: Extract<
    ModuleDeliveryNodeV2,
    { kind: ModuleDeliveryTaskKind.EvidenceSynthesis }
  >,
  submission: ModuleDeliveryReadOnlyEvidenceSubmission,
  authorized: readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[],
): void {
  if (
    node.evidenceInput.expectedProducers.length === 0 ||
    submission.claimIdentities.length !== 0 ||
    authorized.length !== node.evidenceInput.expectedProducers.length ||
    JSON.stringify(submission.acceptedProviderEvidence) !==
      JSON.stringify(authorized)
  )
    throw new Error(
      `Evidence synthesis inputs are invalid for ${node.taskId}.`,
    );
  for (const producer of node.evidenceInput.expectedProducers) {
    const identity = authorized.find(
      ({ taskId }) => taskId === producer.taskId,
    );
    if (
      !identity ||
      identity.producerTeam !== producer.team ||
      identity.functionalOwner !== producer.functionalOwner ||
      identity.acceptanceOwner !== producer.acceptanceOwner ||
      identity.generation !== submission.generation ||
      identity.planDigest !== submission.planDigest
    )
      throw new Error(
        `Evidence synthesis producer is invalid for ${node.taskId}.`,
      );
  }
}

function authorizedIdentities(
  authority: ModuleDeliveryGenerationAuthority,
  evidence: readonly AcceptedModuleDeliveryEvidence[],
): readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[] {
  const seen = new Set<string>();
  return Object.freeze(
    evidence.map((entry) => {
      assertAcceptedModuleDeliveryEvidence({ authority, evidence: entry });
      const identity = moduleDeliveryAcceptedEvidenceIdentity(entry);
      if (seen.has(identity.taskId))
        throw new Error(`Duplicate accepted evidence for ${identity.taskId}.`);
      seen.add(identity.taskId);
      return identity;
    }),
  );
}

function sourceProvenanceDigest(
  submission: ModuleDeliveryReadOnlyEvidenceSubmission,
): string {
  return digest({
    sourceCommit: submission.sourceCommit,
    generation: submission.generation,
    planDigest: submission.planDigest,
    taskId: submission.taskId,
    attempt: submission.attempt,
    producerTeam: submission.producerTeam,
    functionalOwner: submission.functionalOwner,
    acceptanceOwner: submission.acceptanceOwner,
    verdict: submission.verdict,
    claimIdentities: submission.claimIdentities,
    acceptanceRequirements: submission.acceptanceRequirements,
    acceptedProviderEvidence: submission.acceptedProviderEvidence,
  });
}

function freezeAcceptedEvidence(
  submission: ModuleDeliveryReadOnlyEvidenceSubmission,
  provenance: string,
): AcceptedModuleDeliveryEvidence {
  return Object.freeze({
    ...submission,
    acceptanceRequirements: Object.freeze([
      ...submission.acceptanceRequirements,
    ]),
    claimIdentities: frozenClaims(submission.claimIdentities),
    acceptedProviderEvidence: Object.freeze(
      submission.acceptedProviderEvidence.map((identity) =>
        Object.freeze({
          ...identity,
          claimIdentities: frozenClaims(identity.claimIdentities),
          acceptanceRequirements: Object.freeze([
            ...identity.acceptanceRequirements,
          ]),
        }),
      ),
    ),
    evidence: Object.freeze([...submission.evidence]),
    sourceProvenanceDigest: provenance,
  });
}

function frozenClaims(
  claims: readonly ModuleDeliveryEvidenceClaimIdentity[],
): readonly ModuleDeliveryEvidenceClaimIdentity[] {
  return Object.freeze(claims.map((claim) => Object.freeze({ ...claim })));
}

function gitTreeEntries(
  request: ModuleDeliveryEvidenceDigestRequest,
): readonly GitTreeEntry[] {
  const gitRequest: GitCommandRequest = {
    cwd: request.repositoryRoot,
    args: ['ls-tree', '-r', '-z', '--full-tree', request.sourceCommit],
  };
  const output = runModuleDeliveryGit(gitRequest).stdout;
  if (output.length === 0) return [];
  if (output.at(-1) !== 0)
    throw new Error('Evidence tree listing requires NUL termination.');
  return output
    .subarray(0, -1)
    .toString('utf8')
    .split('\0')
    .map((record) => {
      const separator = record.indexOf('\t');
      if (separator < 1) throw new Error('Evidence tree entry is malformed.');
      return Object.freeze({
        metadata: record.slice(0, separator),
        path: record.slice(separator + 1),
      });
    });
}

function treeDigest(
  entries: readonly GitTreeEntry[],
  claims: readonly string[],
): string {
  const matching = entries
    .filter((entry) =>
      claims.some((claim) => {
        const pair: TaskResourcePatternPair = {
          first: claim,
          second: entry.path,
        };
        return taskResourcePatternsOverlap(pair);
      }),
    )
    .map((entry) => `${entry.path}\0${entry.metadata}`)
    .sort();
  return moduleDeliveryEvidenceSha256(
    matching.map((entry) => `${entry}\0`).join(''),
  );
}

function nodeFor(
  plan: ValidatedModuleDeliveryPlan,
  taskId: string,
): ModuleDeliveryNodeV2 {
  const node = plan.plan.nodes.find((candidate) => candidate.taskId === taskId);
  if (!node) throw new Error(`Validated plan is missing task ${taskId}.`);
  return node;
}

function validIdentity(identity: string): boolean {
  return (
    identity.length > 0 &&
    identity.length <= 256 &&
    /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/u.test(identity)
  );
}

function validEvidenceEntries(entries: readonly string[]): boolean {
  return (
    entries.length > 0 &&
    entries.length <= 128 &&
    entries.every(
      (entry) =>
        entry.trim().length > 0 &&
        entry.length <= 4096 &&
        [...entry].every((character) => {
          const code = character.charCodeAt(0);
          return code > 31 && code !== 127;
        }),
    )
  );
}

type DigestValue =
  EvidenceArtifactDigestContent | EvidenceSourceProvenanceContent;

function digest(value: DigestValue): string {
  return moduleDeliveryEvidenceSha256(JSON.stringify(value));
}
