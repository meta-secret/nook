import { expect, test } from 'bun:test';
import { moduleDeliveryEvidenceClaimIdentities } from '../../src/module-delivery/index.ts';
import {
  REQUIRED_PARENT_OWNED_RESOURCES,
  AgentAttemptParentKind,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryJoinKind,
  ModuleDeliveryProviderSubmissionKind,
  ModuleDeliveryEvidenceVerdict,
  ModuleDeliveryTaskKind,
  ModuleDeliveryValidationStatus,
  TeamKey,
  decodeAndValidateModuleDeliveryPlan,
  moduleDeliveryEvidenceArtifactDigest,
  verifyModuleDeliveryEvidenceSubmission,
} from '../../src/module-delivery/index.ts';
import {
  createGitFixture,
  disposeGitFixture,
} from './worktree-test-support.ts';

import type {
  AcceptedModuleDeliveryPlan,
  ModuleDeliveryAttemptLease,
  ModuleDeliveryEvidenceArtifactDigestRequest,
  ModuleDeliveryEvidenceClaimIdentityRequest,
  ModuleDeliveryEvidenceSubmissionVerification,
  ModuleDeliveryPlanV2,
  ModuleDeliveryReadOnlyEvidenceSubmission,
  ModuleDeliveryReadOnlyNodeV2,
  ModuleIntegrationState,
} from '../../src/module-delivery/index.ts';
import type { GitFixture } from './worktree-test-support.ts';

const CORE_ROOT = 'nook-app/nook-platform/nook-core';

type EvidenceRuntime = {
  readonly fixture: GitFixture;
  readonly acceptedPlan: AcceptedModuleDeliveryPlan;
  readonly node: ModuleDeliveryReadOnlyNodeV2;
  readonly lease: ModuleDeliveryAttemptLease;
  readonly state: ModuleIntegrationState;
  readonly submission: ModuleDeliveryReadOnlyEvidenceSubmission;
};

type EvidenceSubmissionMutation = (
  submission: ModuleDeliveryReadOnlyEvidenceSubmission,
) => ModuleDeliveryReadOnlyEvidenceSubmission;

function evidenceRuntime(): EvidenceRuntime {
  const fixture = createGitFixture();
  const node: ModuleDeliveryReadOnlyNodeV2 = {
    kind: ModuleDeliveryTaskKind.ReadOnly,
    taskId: 'core-evidence',
    team: TeamKey.DevelopmentCore,
    functionalOwner: TeamKey.Ai,
    acceptanceOwner: TeamKey.Ai,
    parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
    expert: 'core_expert',
    moduleRoot: CORE_ROOT,
    consumerOutcome: 'AI receives accepted core evidence.',
    baseline: {
      kind: ModuleDeliveryBaselineKind.SourceCommit,
      sourceCommit: fixture.baselineCommit,
    },
    agentDepthLimit: 2,
    dependencies: [],
    resources: {
      read: [`${CORE_ROOT}/**`],
      write: [],
      evidenceSurface: [`${CORE_ROOT}/**`],
    },
    parentOwnedExclusions: REQUIRED_PARENT_OWNED_RESOURCES,
    acceptance: {
      commands: ['task core:evidence'],
      evidence: ['Core evidence is complete.'],
    },
  };
  const plan: ModuleDeliveryPlanV2 = {
    version: 2,
    generation: 1,
    sourceCommit: fixture.baselineCommit,
    maxConcurrency: 1,
    maxAgentDepth: 2,
    maxAttempts: 2,
    parentOwnedResources: REQUIRED_PARENT_OWNED_RESOURCES,
    parentJoin: {
      kind: ModuleDeliveryJoinKind.OrderedCommitHandoffs,
      owner: 'delivery-owner',
      validationCommands: ['task loom:verify'],
    },
    nodes: [node],
    edgeContracts: [],
  };
  const result = decodeAndValidateModuleDeliveryPlan(JSON.stringify(plan));
  if (result.status !== ModuleDeliveryValidationStatus.Accepted)
    throw new Error(JSON.stringify(result.issues));
  const lease: ModuleDeliveryAttemptLease = {
    taskId: node.taskId,
    attempt: 1,
    generation: result.plan.generation,
    planDigest: result.planDigest,
    startingFrontier: fixture.baselineCommit,
    resources: node.resources,
    team: node.team,
    functionalOwner: node.functionalOwner,
    acceptanceOwner: node.acceptanceOwner,
    parentLineage: node.parentLineage,
    acceptanceRequirements: node.acceptance.evidence,
  };
  const state: ModuleIntegrationState = {
    planDigest: result.planDigest,
    sourceCommit: fixture.baselineCommit,
    topologicalOrder: result.topologicalOrder,
    waves: result.waves,
    completedWaveCount: 0,
    integratedTaskIds: [],
    headCommit: fixture.baselineCommit,
    workspace: {
      sourceRepositoryRoot: fixture.sourceRoot,
      ownedWorkspaceRoot: fixture.workspaceRoot,
      worktreePath: fixture.sourceRoot,
      worktreeAdminDirectory: fixture.sourceRoot,
      gitCommonDirectory: fixture.sourceRoot,
      worktreeId: 'evidence-verification',
      planDigest: result.planDigest,
      taskId: 'module-delivery-integration',
      attempt: 1,
      baselineCommit: fixture.baselineCommit,
    },
    cleanupHandle: { sessionId: 'evidence-verification' },
  };
  const identityRequest: ModuleDeliveryEvidenceClaimIdentityRequest = {
    repositoryRoot: fixture.sourceRoot,
    sourceCommit: fixture.baselineCommit,
    evidenceSurface: node.resources.evidenceSurface,
  };
  const claimIdentities =
    moduleDeliveryEvidenceClaimIdentities(identityRequest);
  const digestRequest: ModuleDeliveryEvidenceArtifactDigestRequest = {
    artifactIdentity: 'evidence/core-review.json',
    evidence: ['Core review passed.'],
    acceptanceRequirements: node.acceptance.evidence,
    acceptedProviderEvidence: [],
  };
  const submission: ModuleDeliveryReadOnlyEvidenceSubmission = {
    kind: ModuleDeliveryProviderSubmissionKind.ReadOnlyEvidence,
    schemaVersion: 1,
    taskId: node.taskId,
    attempt: lease.attempt,
    generation: result.plan.generation,
    planDigest: result.planDigest,
    sourceCommit: lease.startingFrontier,
    producerTeam: node.team,
    functionalOwner: node.functionalOwner,
    acceptanceOwner: node.acceptanceOwner,
    acceptanceRequirements: node.acceptance.evidence,
    claimIdentities,
    acceptedProviderEvidence: [],
    artifactIdentity: digestRequest.artifactIdentity,
    artifactDigest: moduleDeliveryEvidenceArtifactDigest(digestRequest),
    verdict: ModuleDeliveryEvidenceVerdict.TerminalSuccess,
    evidence: digestRequest.evidence,
  };
  return { fixture, acceptedPlan: result, node, lease, state, submission };
}

function disposeEvidenceRuntime(runtime: EvidenceRuntime): void {
  disposeGitFixture(runtime.fixture);
}

test('accepts exact owner-reviewed repository evidence', () => {
  const runtime = evidenceRuntime();
  try {
    const verification: ModuleDeliveryEvidenceSubmissionVerification = {
      acceptedPlan: runtime.acceptedPlan,
      state: runtime.state,
      node: runtime.node,
      submission: runtime.submission,
      lease: runtime.lease,
      authorizedProviderEvidence: [],
    };
    expect(verifyModuleDeliveryEvidenceSubmission(verification)).toEqual(
      runtime.submission,
    );
  } finally {
    disposeEvidenceRuntime(runtime);
  }
});

test('rejects forged, stale, wrong-team, wrong-owner, and wrong-attempt evidence', () => {
  const runtime = evidenceRuntime();
  try {
    const staleClaims = runtime.submission.claimIdentities.map((identity) => ({
      ...identity,
      contentDigest: 'f'.repeat(64),
    }));
    const mutations: readonly EvidenceSubmissionMutation[] = [
      (submission) => ({ ...submission, planDigest: 'f'.repeat(64) }),
      (submission) => ({ ...submission, claimIdentities: staleClaims }),
      (submission) => ({
        ...submission,
        producerTeam: TeamKey.WebDevelopment,
      }),
      (submission) => ({
        ...submission,
        acceptanceOwner: runtime.node.team,
      }),
      (submission) => ({ ...submission, artifactDigest: 'f'.repeat(64) }),
      (submission) => ({ ...submission, sourceCommit: 'f'.repeat(40) }),
      (submission) => ({ ...submission, generation: 2 }),
      (submission) => ({ ...submission, attempt: 2 }),
      (submission) => ({
        ...submission,
        acceptanceRequirements: ['Provider accepts itself.'],
      }),
    ];
    for (const mutation of mutations) {
      const verification: ModuleDeliveryEvidenceSubmissionVerification = {
        acceptedPlan: runtime.acceptedPlan,
        state: runtime.state,
        node: runtime.node,
        submission: mutation(runtime.submission),
        lease: runtime.lease,
        authorizedProviderEvidence: [],
      };
      expect(() =>
        verifyModuleDeliveryEvidenceSubmission(verification),
      ).toThrow();
    }
  } finally {
    disposeEvidenceRuntime(runtime);
  }
});
