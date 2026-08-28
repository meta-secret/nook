/* eslint-disable max-params, loom/no-raw-object-arguments */
import { expect, test } from 'bun:test';
import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';
import { TeamKey } from '../../src/team-agents/catalog.ts';

import {
  REQUIRED_PARENT_OWNED_RESOURCES,
  ModuleDeliveryAttemptDispositionKind,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryEvidenceInputSchema,
  ModuleDeliveryEvidenceVerdict,
  ModuleDeliveryGenerationFenceKind,
  ModuleDeliveryJoinKind,
  ModuleDeliveryProviderSubmissionKind,
  ModuleDeliveryTaskKind,
  ModuleDeliveryValidationStatus,
  createModuleDeliveryAdmissionState,
  createModuleDeliveryGenerationAuthority,
  decodeAndValidateModuleDeliveryPlan,
  moduleDeliveryAcceptedEvidenceIdentity,
  moduleDeliveryEvidenceArtifactDigest,
  moduleDeliveryEvidenceClaimIdentities,
  recordModuleDeliveryAttemptDisposition,
  recordModuleDeliveryAttemptLeases,
  selectModuleDeliveryAdmissions,
  verifyModuleDeliveryEvidenceSubmission,
} from '../../src/module-delivery/index.ts';
import {
  createGitFixture,
  disposeGitFixture,
  fixtureGit,
  writeFixtureFile,
} from './worktree-test-support.ts';

import type {
  AcceptedModuleDeliveryEvidence,
  ModuleDeliveryAdmissionState,
  ModuleDeliveryAttemptLease,
  ModuleDeliveryEdgeContract,
  ModuleDeliveryEvidenceSynthesisNodeV2,
  ModuleDeliveryGenerationAuthority,
  ModuleDeliveryPlanV2,
  ModuleDeliveryReadOnlyEvidenceSubmission,
  ModuleDeliveryReadOnlyNodeV2,
  ValidatedModuleDeliveryPlan,
} from '../../src/module-delivery/index.ts';
import type { GitFixture } from './worktree-test-support.ts';

const CORE_ROOT = 'nook-app/nook-platform/nook-core';

type Runtime = {
  readonly fixture: GitFixture;
  readonly accepted: ValidatedModuleDeliveryPlan;
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly state: ModuleDeliveryAdmissionState;
  readonly provider: ModuleDeliveryReadOnlyNodeV2;
  readonly synthesis: ModuleDeliveryEvidenceSynthesisNodeV2;
};

function edge(
  providerTaskId: string,
  consumerTaskId: string,
): ModuleDeliveryEdgeContract {
  return {
    providerTaskId,
    consumerTaskId,
    capability: 'accepted provider evidence',
    publicTypes: ['AcceptedModuleDeliveryEvidence'],
    errors: ['EvidenceRejected'],
    behaviorInvariants: ['Evidence identity is exact.'],
    securityInvariants: ['Only accepted evidence is synthesized.'],
    compatibilityExpectations: ['Schema v1 remains exact.'],
    owningTests: ['evidence authority tests'],
  };
}

function runtime(): Runtime {
  const fixture = createGitFixture();
  const provider: ModuleDeliveryReadOnlyNodeV2 = {
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
  const synthesis: ModuleDeliveryEvidenceSynthesisNodeV2 = {
    kind: ModuleDeliveryTaskKind.EvidenceSynthesis,
    taskId: 'evidence-synthesis',
    team: TeamKey.DevelopmentCore,
    functionalOwner: TeamKey.Ai,
    acceptanceOwner: TeamKey.Ai,
    parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
    expert: 'core_expert',
    moduleRoot: CORE_ROOT,
    consumerOutcome: 'Accepted provider evidence is synthesized.',
    baseline: {
      kind: ModuleDeliveryBaselineKind.IntegratedDependencies,
      providerTaskIds: [provider.taskId],
    },
    agentDepthLimit: 2,
    dependencies: [provider.taskId],
    resources: { read: [], write: [], evidenceSurface: [] },
    parentOwnedExclusions: REQUIRED_PARENT_OWNED_RESOURCES,
    acceptance: {
      commands: ['task synthesis:test'],
      evidence: ['Synthesis is deterministic.'],
    },
    evidenceInput: {
      schema: ModuleDeliveryEvidenceInputSchema.AcceptedProviderEvidenceV1,
      expectedProducers: [
        {
          taskId: provider.taskId,
          team: provider.team,
          functionalOwner: provider.functionalOwner,
          acceptanceOwner: provider.acceptanceOwner,
        },
      ],
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
    nodes: [synthesis, provider],
    edgeContracts: [edge(provider.taskId, synthesis.taskId)],
  };
  const result = decodeAndValidateModuleDeliveryPlan(JSON.stringify(plan));
  if (result.status !== ModuleDeliveryValidationStatus.Accepted)
    throw new Error(JSON.stringify(result.issues));
  const authority = createModuleDeliveryGenerationAuthority({
    acceptedPlan: result,
    expectedLineage: result.plan.nodes.map((node) => ({
      taskId: node.taskId,
      parentLineage: node.parentLineage,
    })),
  });
  const state = createModuleDeliveryAdmissionState({
    authority,
    acceptedPlan: result,
    headCommit: fixture.baselineCommit,
    integratedWriterFrontiers: [],
    acceptedEvidence: [],
  });
  return { fixture, accepted: result, authority, state, provider, synthesis };
}

function admittedLease(
  runtime: Runtime,
  taskId: string,
): ModuleDeliveryAttemptLease {
  const selection = selectModuleDeliveryAdmissions({
    authority: runtime.authority,
    acceptedPlan: runtime.accepted,
    state: runtime.state,
  });
  const admission = selection.admissions.find(
    (entry) => entry.taskId === taskId,
  );
  if (!admission) throw new Error(`Admission ${taskId} is missing.`);
  const lease = recordModuleDeliveryAttemptLeases({
    authority: runtime.authority,
    state: runtime.state,
    admissions: [admission],
  }).leases[0];
  if (!lease) throw new Error(`Lease ${taskId} is missing.`);
  return lease;
}

function submission(
  runtime: Runtime,
  lease: ModuleDeliveryAttemptLease,
  acceptedProviderEvidence: readonly AcceptedModuleDeliveryEvidence[] = [],
): ModuleDeliveryReadOnlyEvidenceSubmission {
  const node = runtime.accepted.plan.nodes.find(
    ({ taskId }) => taskId === lease.taskId,
  );
  if (!node || node.kind === ModuleDeliveryTaskKind.Write)
    throw new Error('Evidence node is missing.');
  const identities = acceptedProviderEvidence.map(
    moduleDeliveryAcceptedEvidenceIdentity,
  );
  const claimIdentities =
    node.kind === ModuleDeliveryTaskKind.EvidenceSynthesis
      ? []
      : moduleDeliveryEvidenceClaimIdentities({
          repositoryRoot: runtime.fixture.sourceRoot,
          sourceCommit: lease.startingFrontier,
          evidenceSurface: node.resources.evidenceSurface,
        });
  const artifactIdentity = `evidence/${node.taskId}.json`;
  const evidence = [`${node.taskId} reviewed.`];
  const artifactDigest = moduleDeliveryEvidenceArtifactDigest({
    artifactIdentity,
    evidence,
    acceptanceRequirements: lease.acceptanceRequirements,
    acceptedProviderEvidence: identities,
  });
  return {
    kind: ModuleDeliveryProviderSubmissionKind.ReadOnlyEvidence,
    schemaVersion: 1,
    taskId: node.taskId,
    attempt: lease.attempt,
    generation: lease.generation,
    planDigest: lease.planDigest,
    sourceCommit: lease.startingFrontier,
    producerTeam: lease.team,
    functionalOwner: lease.functionalOwner,
    acceptanceOwner: lease.acceptanceOwner,
    acceptanceRequirements: lease.acceptanceRequirements,
    claimIdentities,
    acceptedProviderEvidence: identities,
    artifactIdentity,
    artifactDigest,
    verdict: ModuleDeliveryEvidenceVerdict.TerminalSuccess,
    evidence,
  };
}

function verify(
  runtime: Runtime,
  lease: ModuleDeliveryAttemptLease,
  candidate: ModuleDeliveryReadOnlyEvidenceSubmission,
  acceptedProviderEvidence: readonly AcceptedModuleDeliveryEvidence[] = [],
): AcceptedModuleDeliveryEvidence {
  return verifyModuleDeliveryEvidenceSubmission({
    authority: runtime.authority,
    acceptedPlan: runtime.accepted,
    repositoryRoot: runtime.fixture.sourceRoot,
    state: runtime.state,
    submission: candidate,
    lease,
    authorizedProviderEvidence: acceptedProviderEvidence,
  });
}

test('accepts exact repository evidence and releases its lease only after accepted disposition', () => {
  const active = runtime();
  try {
    const lease = admittedLease(active, active.provider.taskId);
    const accepted = verify(active, lease, submission(active, lease));
    expect(Object.isFrozen(accepted)).toBe(true);
    expect(moduleDeliveryAcceptedEvidenceIdentity(accepted)).toMatchObject({
      taskId: active.provider.taskId,
      attempt: 1,
      planDigest: active.accepted.planDigest,
      verdict: ModuleDeliveryEvidenceVerdict.TerminalSuccess,
    });
    expect(
      selectModuleDeliveryAdmissions({
        authority: active.authority,
        acceptedPlan: active.accepted,
        state: active.state,
      }).admissions,
    ).toEqual([]);
    expect(() =>
      recordModuleDeliveryAttemptDisposition({
        authority: active.authority,
        state: active.state,
        lease,
        outcome: {
          kind: ModuleDeliveryAttemptDispositionKind.Accepted,
          conclusion: ModuleDeliveryGenerationFenceKind.Accepted,
        },
      }),
    ).toThrow('lease capability');

    const evidenceState = createModuleDeliveryAdmissionState({
      authority: active.authority,
      acceptedPlan: active.accepted,
      headCommit: active.fixture.baselineCommit,
      integratedWriterFrontiers: [],
      acceptedEvidence: [accepted],
    });
    recordModuleDeliveryAttemptDisposition({
      authority: active.authority,
      state: evidenceState,
      lease,
      outcome: {
        kind: ModuleDeliveryAttemptDispositionKind.Accepted,
        conclusion: ModuleDeliveryGenerationFenceKind.Accepted,
      },
    });
    const synthesis = selectModuleDeliveryAdmissions({
      authority: active.authority,
      acceptedPlan: active.accepted,
      state: evidenceState,
    });
    expect(synthesis.admissions.map(({ taskId }) => taskId)).toEqual([
      active.synthesis.taskId,
    ]);
  } finally {
    disposeGitFixture(active.fixture);
  }
});

test('rejects forged metadata, evidence capabilities, and authority-owned stale frontier', () => {
  const active = runtime();
  try {
    const lease = admittedLease(active, active.provider.taskId);
    const exact = submission(active, lease);
    const mutations: readonly ModuleDeliveryReadOnlyEvidenceSubmission[] = [
      { ...exact, taskId: 'forged-task' },
      { ...exact, attempt: 2 },
      { ...exact, generation: 2 },
      { ...exact, planDigest: 'f'.repeat(64) },
      { ...exact, producerTeam: TeamKey.WebDevelopment },
      { ...exact, functionalOwner: TeamKey.DevelopmentCore },
      { ...exact, acceptanceOwner: TeamKey.DevelopmentCore },
      { ...exact, sourceCommit: 'f'.repeat(40) },
      { ...exact, artifactDigest: 'f'.repeat(64) },
      { ...exact, verdict: 'forged-success' as ModuleDeliveryEvidenceVerdict },
      { ...exact, acceptanceRequirements: ['forged acceptance'] },
      {
        ...exact,
        claimIdentities: exact.claimIdentities.map((claim) => ({
          ...claim,
          contentDigest: 'f'.repeat(64),
        })),
      },
    ];
    for (const candidate of mutations)
      expect(() => verify(active, lease, candidate)).toThrow();

    const forgedEvidence: AcceptedModuleDeliveryEvidence = {
      ...exact,
      sourceProvenanceDigest: 'f'.repeat(64),
    };
    expect(() =>
      createModuleDeliveryAdmissionState({
        authority: active.authority,
        acceptedPlan: active.accepted,
        headCommit: active.fixture.baselineCommit,
        integratedWriterFrontiers: [],
        acceptedEvidence: [forgedEvidence],
      }),
    ).toThrow('evidence authority is invalid');

    writeFixtureFile({
      fixture: active.fixture,
      relativePath: `${CORE_ROOT}/changed.rs`,
      contents: 'changed\n',
    });
    const git = fixtureGit(active.fixture);
    git(['add', '--all']);
    git(['commit', '--quiet', '-m', 'change evidence surface']);
    const advancedCommit = git(['rev-parse', 'HEAD']);
    const staleState = createModuleDeliveryAdmissionState({
      authority: active.authority,
      acceptedPlan: active.accepted,
      headCommit: advancedCommit,
      integratedWriterFrontiers: [],
      acceptedEvidence: [],
    });
    const staleRuntime: Runtime = { ...active, state: staleState };
    expect(() => verify(staleRuntime, lease, exact)).toThrow('stale');
    expect(() => verify(active, lease, exact)).toThrow(
      'authority is invalid or stale',
    );
  } finally {
    disposeGitFixture(active.fixture);
  }
});

test('synthesis requires exact nonempty accepted provider evidence identities', () => {
  const active = runtime();
  try {
    expect(
      selectModuleDeliveryAdmissions({
        authority: active.authority,
        acceptedPlan: active.accepted,
        state: active.state,
      }).admissions.map(({ taskId }) => taskId),
    ).toEqual([active.provider.taskId]);
    const providerLease = admittedLease(active, active.provider.taskId);
    const providerEvidence = verify(
      active,
      providerLease,
      submission(active, providerLease),
    );
    const evidenceState = createModuleDeliveryAdmissionState({
      authority: active.authority,
      acceptedPlan: active.accepted,
      headCommit: active.fixture.baselineCommit,
      integratedWriterFrontiers: [],
      acceptedEvidence: [providerEvidence],
    });
    recordModuleDeliveryAttemptDisposition({
      authority: active.authority,
      state: evidenceState,
      lease: providerLease,
      outcome: {
        kind: ModuleDeliveryAttemptDispositionKind.Accepted,
        conclusion: ModuleDeliveryGenerationFenceKind.Accepted,
      },
    });
    const synthesisRuntime: Runtime = { ...active, state: evidenceState };
    const synthesisLease = admittedLease(
      synthesisRuntime,
      active.synthesis.taskId,
    );
    const exact = submission(synthesisRuntime, synthesisLease, [
      providerEvidence,
    ]);
    expect(
      verify(synthesisRuntime, synthesisLease, exact, [providerEvidence])
        .taskId,
    ).toBe(active.synthesis.taskId);
    expect(() => verify(synthesisRuntime, synthesisLease, exact, [])).toThrow(
      'synthesis inputs',
    );
    const forgedIdentity = exact.acceptedProviderEvidence.map((identity) => ({
      ...identity,
      sourceProvenanceDigest: 'f'.repeat(64),
    }));
    const forged = { ...exact, acceptedProviderEvidence: forgedIdentity };
    expect(() =>
      verify(synthesisRuntime, synthesisLease, forged, [providerEvidence]),
    ).toThrow('synthesis inputs');
  } finally {
    disposeGitFixture(active.fixture);
  }
});
