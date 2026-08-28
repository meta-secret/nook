import { taskResourcePatternsOverlap } from '../agent-workflow/domain.ts';
import { freezeProviderEvidenceIdentity } from './authority.ts';
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
  verifiedHeadCommit: string;
  artifactIdentity: string;
  artifactDigest: string;
  sourceProvenanceDigest: string;
  verdict: ModuleDeliveryEvidenceVerdict.TerminalSuccess;
  claimIdentities: readonly ModuleDeliveryEvidenceClaimIdentity[];
  acceptanceRequirements: readonly string[];
  acceptedProviderEvidence: readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[];
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

export type ModuleDeliveryEvidenceSubmissionValidation = Readonly<{
  verification: ModuleDeliveryEvidenceSubmissionVerification;
  acceptedPlan: ValidatedModuleDeliveryPlan;
  authorized: readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[];
}>;

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
type EvidenceSynthesisNode = Extract<
  ModuleDeliveryNodeV2,
  { kind: ModuleDeliveryTaskKind.EvidenceSynthesis }
>;
type TreeDigestRequest = {
  readonly entries: readonly GitTreeEntry[];
  readonly claims: readonly string[];
};
type SubmissionMetadataRequest = {
  readonly verification: ModuleDeliveryEvidenceSubmissionVerification;
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
  readonly node: ModuleDeliveryNodeV2;
};
type RepositoryEvidenceRequest = {
  readonly verification: ModuleDeliveryEvidenceSubmissionVerification;
  readonly node: ModuleDeliveryNodeV2;
};
type SynthesisInputsRequest = {
  readonly node: EvidenceSynthesisNode;
  readonly submission: ModuleDeliveryReadOnlyEvidenceSubmission;
  readonly authorized: readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[];
};
type FreezeAcceptedEvidenceRequest = {
  readonly submission: ModuleDeliveryReadOnlyEvidenceSubmission;
  readonly provenance: string;
  readonly verificationHeadCommit: string;
};
type EvidenceNodeRequest = {
  readonly plan: ValidatedModuleDeliveryPlan;
  readonly taskId: string;
};

const COMMIT = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

export function moduleDeliveryEvidenceSurfaceDigest(
  request: ModuleDeliveryEvidenceDigestRequest,
): string {
  const digestRequest: TreeDigestRequest = {
    entries: gitTreeEntries(request),
    claims: request.evidenceSurface,
  };
  return treeDigest(digestRequest);
}

export function moduleDeliveryEvidenceClaimIdentities(
  request: ModuleDeliveryEvidenceDigestRequest,
): readonly ModuleDeliveryEvidenceClaimIdentity[] {
  const entries = gitTreeEntries(request);
  return Object.freeze(
    request.evidenceSurface.map((claim) => {
      const digestRequest: TreeDigestRequest = { entries, claims: [claim] };
      const identity: ModuleDeliveryEvidenceClaimIdentity = {
        claim,
        contentDigest: treeDigest(digestRequest),
      };
      return Object.freeze(identity);
    }),
  );
}

export function moduleDeliveryEvidenceArtifactDigest(
  request: ModuleDeliveryEvidenceArtifactDigestRequest,
): string {
  const content: EvidenceArtifactDigestContent = {
    artifactIdentity: request.artifactIdentity,
    evidence: request.evidence,
    acceptanceRequirements: request.acceptanceRequirements,
    acceptedProviderEvidence: request.acceptedProviderEvidence,
  };
  return digest(content);
}

export function validateModuleDeliveryEvidenceSubmission(
  request: ModuleDeliveryEvidenceSubmissionValidation,
): AcceptedModuleDeliveryEvidence {
  const verification = request.verification;
  const acceptedPlan = request.acceptedPlan;
  const nodeRequest: EvidenceNodeRequest = {
    plan: acceptedPlan,
    taskId: verification.lease.taskId,
  };
  const node = nodeFor(nodeRequest);
  const metadataRequest: SubmissionMetadataRequest = {
    verification,
    acceptedPlan,
    node,
  };
  assertSubmissionMetadata(metadataRequest);
  const authorized = request.authorized;
  if (node.kind === ModuleDeliveryTaskKind.EvidenceSynthesis) {
    if (
      JSON.stringify(authorized) !==
      JSON.stringify(verification.lease.authorizedProviderEvidence)
    )
      throw new Error(
        `Evidence synthesis inputs are invalid for ${node.taskId}.`,
      );
    const synthesisRequest: SynthesisInputsRequest = {
      node,
      submission: verification.submission,
      authorized,
    };
    assertSynthesisInputs(synthesisRequest);
  } else {
    const repositoryRequest: RepositoryEvidenceRequest = { verification, node };
    assertRepositoryEvidence(repositoryRequest);
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
  const freezeRequest: FreezeAcceptedEvidenceRequest = {
    submission: verification.submission,
    provenance: sourceProvenanceDigest(verification.submission),
    verificationHeadCommit: verification.state.headCommit,
  };
  return freezeAcceptedEvidence(freezeRequest);
}

function assertSubmissionMetadata(request: SubmissionMetadataRequest): void {
  const submission = request.verification.submission;
  const lease = request.verification.lease;
  const node = request.node;
  if (
    node.kind === ModuleDeliveryTaskKind.Write ||
    submission.kind !== ModuleDeliveryProviderSubmissionKind.ReadOnlyEvidence ||
    submission.schemaVersion !== MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION ||
    submission.taskId !== node.taskId ||
    submission.taskId !== lease.taskId ||
    submission.attempt !== lease.attempt ||
    submission.generation !== lease.generation ||
    submission.generation !== request.acceptedPlan.plan.generation ||
    submission.planDigest !== lease.planDigest ||
    submission.planDigest !== request.acceptedPlan.planDigest ||
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

function assertRepositoryEvidence(request: RepositoryEvidenceRequest): void {
  const verification = request.verification;
  const node = request.node;
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

function assertSynthesisInputs(request: SynthesisInputsRequest): void {
  const node = request.node;
  const submission = request.submission;
  const authorized = request.authorized;
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

function sourceProvenanceDigest(
  submission: ModuleDeliveryReadOnlyEvidenceSubmission,
): string {
  const content: EvidenceSourceProvenanceContent = {
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
  };
  return digest(content);
}

function freezeAcceptedEvidence(
  request: FreezeAcceptedEvidenceRequest,
): AcceptedModuleDeliveryEvidence {
  const submission = request.submission;
  const accepted: AcceptedModuleDeliveryEvidence = {
    ...submission,
    acceptanceRequirements: Object.freeze([
      ...submission.acceptanceRequirements,
    ]),
    claimIdentities: frozenClaims(submission.claimIdentities),
    acceptedProviderEvidence: Object.freeze(
      submission.acceptedProviderEvidence.map(freezeProviderEvidenceIdentity),
    ),
    evidence: Object.freeze([...submission.evidence]),
    sourceProvenanceDigest: request.provenance,
    verifiedHeadCommit: request.verificationHeadCommit,
  };
  return Object.freeze(accepted);
}

function frozenClaims(
  claims: readonly ModuleDeliveryEvidenceClaimIdentity[],
): readonly ModuleDeliveryEvidenceClaimIdentity[] {
  return Object.freeze(
    claims.map((claim) => {
      const copy: ModuleDeliveryEvidenceClaimIdentity = { ...claim };
      return Object.freeze(copy);
    }),
  );
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
      const entry: GitTreeEntry = {
        metadata: record.slice(0, separator),
        path: record.slice(separator + 1),
      };
      return Object.freeze(entry);
    });
}

function treeDigest(request: TreeDigestRequest): string {
  const matching = request.entries
    .filter((entry) =>
      request.claims.some((claim) => {
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

function nodeFor(request: EvidenceNodeRequest): ModuleDeliveryNodeV2 {
  const node = request.plan.plan.nodes.find(
    (candidate) => candidate.taskId === request.taskId,
  );
  if (!node)
    throw new Error(`Validated plan is missing task ${request.taskId}.`);
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
