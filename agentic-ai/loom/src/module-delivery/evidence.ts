import { createHash } from 'node:crypto';
import { taskResourcePatternsOverlap } from '../agent-workflow/domain.ts';
import { ModuleDeliveryTaskKind } from './domain.ts';
import { runModuleDeliveryGit } from './git-command.ts';
import {
  MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION,
  ModuleDeliveryEvidenceVerdict,
} from './integration-provenance.ts';
import { EXACT_GIT_COMMIT } from './workspace-paths.ts';
import type { TaskResourcePatternPair } from '../agent-workflow/domain.ts';
import type { ModuleDeliveryAttemptLease } from './admission.ts';
import type { TeamKey } from '../team-agents/catalog.ts';
import type {
  AcceptedModuleDeliveryPlan,
  ModuleDeliveryNodeV2,
} from './domain.ts';
import type { GitCommandRequest } from './git-command.ts';
import type {
  AcceptedModuleDeliveryEvidence,
  ModuleDeliveryReadOnlyEvidenceSubmission,
} from './integration-provenance.ts';
import type { ModuleIntegrationState } from './integration.ts';
export type ModuleDeliveryEvidenceDigestRequest = {
  readonly repositoryRoot: string;
  readonly sourceCommit: string;
  readonly evidenceSurface: readonly string[];
};
export type ModuleDeliveryEvidenceClaimIdentity = {
  readonly claim: string;
  readonly contentDigest: string;
};
export type ModuleDeliveryEvidenceClaimIdentityRequest =
  ModuleDeliveryEvidenceDigestRequest;
export type ModuleDeliveryEvidenceArtifactDigestRequest = {
  readonly artifactIdentity: string;
  readonly evidence: readonly string[];
  readonly acceptanceRequirements: readonly string[];
  readonly acceptedProviderEvidence: readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[];
};
type ModuleDeliveryEvidenceArtifactContent = {
  readonly artifactIdentity: string;
  readonly evidence: readonly string[];
  readonly acceptanceRequirements: readonly string[];
  readonly acceptedProviderEvidence: readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[];
};
export type ModuleDeliveryAcceptedProviderEvidenceIdentity = {
  readonly schemaVersion: typeof MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION;
  readonly generation: number;
  readonly taskId: string;
  readonly attempt: number;
  readonly producerTeam: TeamKey;
  readonly functionalOwner: TeamKey;
  readonly acceptanceOwner: TeamKey;
  readonly sourceCommit: string;
  readonly artifactIdentity: string;
  readonly artifactDigest: string;
  readonly sourceProvenanceDigest: string;
};
type GitTreeEntry = {
  readonly metadata: string;
  readonly path: string;
};
type ModuleDeliveryEvidenceTreeDigestRequest = {
  readonly entries: readonly GitTreeEntry[];
  readonly evidenceSurface: readonly string[];
};
type ModuleDeliveryEvidenceTreeIdentityRequest = {
  readonly entries: readonly GitTreeEntry[];
  readonly evidenceSurface: readonly string[];
};
function gitTreeEntries(
  request: ModuleDeliveryEvidenceDigestRequest,
): readonly GitTreeEntry[] {
  const gitRequest: GitCommandRequest = {
    cwd: request.repositoryRoot,
    args: ['ls-tree', '-r', '-z', '--full-tree', request.sourceCommit],
  };
  const bytes = runModuleDeliveryGit(gitRequest).stdout;
  if (bytes.length > 0 && bytes.at(-1) !== 0) {
    throw new Error('Evidence tree listing requires NUL termination.');
  }
  if (bytes.length === 0) return [];
  return bytes
    .subarray(0, -1)
    .toString('utf8')
    .split('\0')
    .map((record) => {
      const separator = record.indexOf('\t');
      if (separator < 1) throw new Error('Evidence tree entry is malformed.');
      return {
        metadata: record.slice(0, separator),
        path: record.slice(separator + 1),
      };
    });
}
export function moduleDeliveryEvidenceSurfaceDigest(
  request: ModuleDeliveryEvidenceDigestRequest,
): string {
  const digestRequest: ModuleDeliveryEvidenceTreeDigestRequest = {
    entries: gitTreeEntries(request),
    evidenceSurface: request.evidenceSurface,
  };
  return moduleDeliveryEvidenceTreeDigest(digestRequest);
}
function moduleDeliveryEvidenceTreeDigest(
  request: ModuleDeliveryEvidenceTreeDigestRequest,
): string {
  const matching = request.entries
    .filter((entry) =>
      request.evidenceSurface.some((claim) => {
        const pair: TaskResourcePatternPair = {
          first: claim,
          second: entry.path,
        };
        return taskResourcePatternsOverlap(pair);
      }),
    )
    .map((entry) => `${entry.path}\0${entry.metadata}`)
    .sort();
  const hash = createHash('sha256');
  for (const entry of matching) {
    hash.update(entry);
    hash.update('\0');
  }
  return hash.digest('hex');
}
export function moduleDeliveryEvidenceClaimIdentities(
  request: ModuleDeliveryEvidenceClaimIdentityRequest,
): readonly ModuleDeliveryEvidenceClaimIdentity[] {
  if (request.evidenceSurface.length === 0) return [];
  const identityRequest: ModuleDeliveryEvidenceTreeIdentityRequest = {
    entries: gitTreeEntries(request),
    evidenceSurface: request.evidenceSurface,
  };
  return moduleDeliveryEvidenceTreeClaimIdentities(identityRequest);
}
function moduleDeliveryEvidenceTreeClaimIdentities(
  request: ModuleDeliveryEvidenceTreeIdentityRequest,
): readonly ModuleDeliveryEvidenceClaimIdentity[] {
  return request.evidenceSurface.map((claim) => {
    const digestRequest: ModuleDeliveryEvidenceTreeDigestRequest = {
      entries: request.entries,
      evidenceSurface: [claim],
    };
    return {
      claim,
      contentDigest: moduleDeliveryEvidenceTreeDigest(digestRequest),
    };
  });
}
export function moduleDeliveryEvidenceArtifactDigest(
  request: ModuleDeliveryEvidenceArtifactDigestRequest,
): string {
  const content: ModuleDeliveryEvidenceArtifactContent = {
    artifactIdentity: request.artifactIdentity,
    evidence: request.evidence,
    acceptanceRequirements: request.acceptanceRequirements,
    acceptedProviderEvidence: request.acceptedProviderEvidence,
  };
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

export type ModuleDeliveryEvidenceSubmissionVerification = {
  readonly acceptedPlan: AcceptedModuleDeliveryPlan;
  readonly state: ModuleIntegrationState;
  readonly node: ModuleDeliveryNodeV2;
  readonly submission: ModuleDeliveryReadOnlyEvidenceSubmission;
  readonly lease: ModuleDeliveryAttemptLease;
  readonly authorizedProviderEvidence: readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[];
};
export function verifyModuleDeliveryEvidenceSubmission(
  verification: ModuleDeliveryEvidenceSubmissionVerification,
): AcceptedModuleDeliveryEvidence {
  const submission = verification.submission;
  if (
    verification.node.kind === ModuleDeliveryTaskKind.Write ||
    submission.schemaVersion !== MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION ||
    submission.taskId !== verification.node.taskId ||
    submission.generation !== verification.acceptedPlan.plan.generation ||
    submission.planDigest !== verification.acceptedPlan.planDigest ||
    submission.producerTeam !== verification.node.team ||
    submission.functionalOwner !== verification.node.functionalOwner ||
    submission.acceptanceOwner !== verification.node.acceptanceOwner ||
    (submission.producerTeam !== submission.functionalOwner &&
      submission.acceptanceOwner === submission.producerTeam) ||
    submission.attempt !== verification.lease.attempt ||
    submission.generation !== verification.lease.generation ||
    submission.planDigest !== verification.lease.planDigest ||
    submission.taskId !== verification.lease.taskId ||
    submission.sourceCommit !== verification.lease.startingFrontier ||
    !EXACT_GIT_COMMIT.test(submission.sourceCommit) ||
    submission.verdict !== ModuleDeliveryEvidenceVerdict.TerminalSuccess ||
    !validEvidenceArtifactIdentity(submission.artifactIdentity) ||
    !/^[0-9a-f]{64}$/u.test(submission.artifactDigest) ||
    !validEvidenceEntries(submission.evidence) ||
    JSON.stringify(submission.acceptanceRequirements) !==
      JSON.stringify(verification.node.acceptance.evidence)
  )
    throw new Error(
      `Read-only evidence metadata is invalid for ${verification.node.taskId}.`,
    );
  if (verification.node.kind === ModuleDeliveryTaskKind.EvidenceSynthesis) {
    verifySynthesisInputs(verification);
    return verifiedEvidenceArtifact(verification);
  }
  if (submission.acceptedProviderEvidence.length !== 0) {
    throw new Error(
      `Repository evidence cannot bind provider inputs for ${verification.node.taskId}.`,
    );
  }
  const sourceRequest: ModuleDeliveryEvidenceClaimIdentityRequest = {
    repositoryRoot: verification.state.workspace.sourceRepositoryRoot,
    sourceCommit: submission.sourceCommit,
    evidenceSurface: verification.node.resources.evidenceSurface,
  };
  const currentRequest: ModuleDeliveryEvidenceClaimIdentityRequest = {
    ...sourceRequest,
    sourceCommit: verification.state.headCommit,
  };
  const sourceEntries = gitTreeEntries(sourceRequest);
  const currentEntries =
    sourceRequest.sourceCommit === currentRequest.sourceCommit
      ? sourceEntries
      : gitTreeEntries(currentRequest);
  const sourceIdentityRequest: ModuleDeliveryEvidenceTreeIdentityRequest = {
    entries: sourceEntries,
    evidenceSurface: sourceRequest.evidenceSurface,
  };
  const currentIdentityRequest: ModuleDeliveryEvidenceTreeIdentityRequest = {
    entries: currentEntries,
    evidenceSurface: currentRequest.evidenceSurface,
  };
  const sourceIdentities = moduleDeliveryEvidenceTreeClaimIdentities(
    sourceIdentityRequest,
  );
  const currentIdentities = moduleDeliveryEvidenceTreeClaimIdentities(
    currentIdentityRequest,
  );
  const artifactRequest: ModuleDeliveryEvidenceArtifactDigestRequest = {
    artifactIdentity: submission.artifactIdentity,
    evidence: submission.evidence,
    acceptanceRequirements: submission.acceptanceRequirements,
    acceptedProviderEvidence: submission.acceptedProviderEvidence,
  };
  if (
    JSON.stringify(sourceIdentities) !==
      JSON.stringify(submission.claimIdentities) ||
    JSON.stringify(currentIdentities) !==
      JSON.stringify(submission.claimIdentities) ||
    moduleDeliveryEvidenceArtifactDigest(artifactRequest) !==
      submission.artifactDigest
  )
    throw new Error(
      `Read-only evidence is stale for ${verification.node.taskId}.`,
    );
  return submission;
}

function verifySynthesisInputs(
  verification: ModuleDeliveryEvidenceSubmissionVerification,
): void {
  if (verification.node.kind !== ModuleDeliveryTaskKind.EvidenceSynthesis) {
    throw new Error('Evidence synthesis verification requires its typed node.');
  }
  const submission = verification.submission;
  if (
    submission.claimIdentities.length !== 0 ||
    submission.acceptedProviderEvidence.length === 0 ||
    JSON.stringify(submission.acceptedProviderEvidence) !==
      JSON.stringify(verification.authorizedProviderEvidence)
  ) {
    throw new Error(
      `Evidence synthesis inputs are invalid for ${verification.node.taskId}.`,
    );
  }
  const expected = verification.node.evidenceInput.expectedProducers;
  if (
    expected.length !== submission.acceptedProviderEvidence.length ||
    expected.some((producer) => {
      const identity = submission.acceptedProviderEvidence.find(
        ({ taskId }) => taskId === producer.taskId,
      );
      return (
        !identity ||
        identity.producerTeam !== producer.team ||
        identity.functionalOwner !== producer.functionalOwner ||
        identity.acceptanceOwner !== producer.acceptanceOwner ||
        identity.generation !== verification.acceptedPlan.plan.generation ||
        identity.attempt < 1 ||
        !EXACT_GIT_COMMIT.test(identity.sourceCommit) ||
        !validEvidenceArtifactIdentity(identity.artifactIdentity) ||
        !/^[0-9a-f]{64}$/u.test(identity.artifactDigest) ||
        !/^[0-9a-f]{64}$/u.test(identity.sourceProvenanceDigest)
      );
    })
  ) {
    throw new Error(
      `Evidence synthesis producer identity is invalid for ${verification.node.taskId}.`,
    );
  }
}

function verifiedEvidenceArtifact(
  verification: ModuleDeliveryEvidenceSubmissionVerification,
): AcceptedModuleDeliveryEvidence {
  const submission = verification.submission;
  const artifactRequest: ModuleDeliveryEvidenceArtifactDigestRequest = {
    artifactIdentity: submission.artifactIdentity,
    evidence: submission.evidence,
    acceptanceRequirements: submission.acceptanceRequirements,
    acceptedProviderEvidence: submission.acceptedProviderEvidence,
  };
  if (
    moduleDeliveryEvidenceArtifactDigest(artifactRequest) !==
    submission.artifactDigest
  ) {
    throw new Error(
      `Evidence artifact digest is invalid for ${verification.node.taskId}.`,
    );
  }
  return submission;
}

function validEvidenceArtifactIdentity(identity: string): boolean {
  return (
    identity.length > 0 &&
    identity.length <= 256 &&
    /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/u.test(identity)
  );
}
function validEvidenceEntries(evidence: readonly string[]): boolean {
  return (
    evidence.length > 0 &&
    evidence.length <= 128 &&
    evidence.every(
      (entry) =>
        entry.trim().length > 0 &&
        entry.length <= 4096 &&
        !hasControlCharacter(entry),
    )
  );
}
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}
