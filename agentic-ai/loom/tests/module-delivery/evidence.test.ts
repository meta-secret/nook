import { expect, test } from 'bun:test';
import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';
import { TeamKey } from '../../src/team-agents/catalog.ts';
import * as evidenceAuthority from '../../src/module-delivery/authority.ts';

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
  AcceptedModuleDeliveryEvidenceInspection,
  CreateModuleDeliveryAdmissionStateRequest,
  CreateModuleDeliveryGenerationAuthorityRequest,
  ModuleDeliveryAdmissionState,
  ModuleDeliveryAcceptedProviderEvidenceIdentity,
  ModuleDeliveryAttemptLease,
  ModuleDeliveryEdgeContract,
  ModuleDeliveryEvidenceArtifactDigestRequest,
  ModuleDeliveryEvidenceDigestRequest,
  ModuleDeliveryEvidenceSynthesisNodeV2,
  ModuleDeliveryEvidenceSubmissionVerification,
  ModuleDeliveryGenerationAuthority,
  ModuleDeliveryPlanV2,
  ModuleDeliveryReadOnlyEvidenceSubmission,
  ModuleDeliveryReadOnlyNodeV2,
  RecordModuleDeliveryAttemptDispositionRequest,
  RecordModuleDeliveryAttemptLeasesRequest,
  SelectModuleDeliveryAdmissionsRequest,
  ValidatedModuleDeliveryPlan,
} from '../../src/module-delivery/index.ts';
import type { FixtureFileWrite, GitFixture } from './worktree-test-support.ts';

const CORE_ROOT = 'nook-app/nook-platform/nook-core';
const WEB_ROOT = 'nook-app/nook-web/nook-web-app';

type Runtime = {
  readonly fixture: GitFixture;
  readonly accepted: ValidatedModuleDeliveryPlan;
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly state: ModuleDeliveryAdmissionState;
  readonly provider: ModuleDeliveryReadOnlyNodeV2;
  readonly providerB: ModuleDeliveryReadOnlyNodeV2;
  readonly synthesis: ModuleDeliveryEvidenceSynthesisNodeV2;
};

type EvidenceEdgeRequest = {
  readonly providerTaskId: string;
  readonly consumerTaskId: string;
};

type AdmittedLeaseRequest = {
  readonly runtime: Runtime;
  readonly taskId: string;
};

type EvidenceSubmissionRequest = {
  readonly runtime: Runtime;
  readonly lease: ModuleDeliveryAttemptLease;
  readonly acceptedProviderEvidence: readonly AcceptedModuleDeliveryEvidence[];
};

type EvidenceVerificationRequest = EvidenceSubmissionRequest & {
  readonly candidate: ModuleDeliveryReadOnlyEvidenceSubmission;
};

type ExpectedEvidenceIdentity = {
  readonly taskId: string;
  readonly attempt: number;
  readonly planDigest: string;
  readonly verdict: ModuleDeliveryEvidenceVerdict;
};

type MutableProviderEvidenceIdentity = Omit<
  ModuleDeliveryAcceptedProviderEvidenceIdentity,
  'acceptedProviderEvidence'
> & { acceptedProviderEvidence: MutableProviderEvidenceIdentity[] };

function edge(request: EvidenceEdgeRequest): ModuleDeliveryEdgeContract {
  const { providerTaskId, consumerTaskId } = request;
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
  const providerB: ModuleDeliveryReadOnlyNodeV2 = {
    ...provider,
    taskId: 'web-evidence',
    team: TeamKey.WebDevelopment,
    expert: 'web_expert',
    moduleRoot: WEB_ROOT,
    resources: { read: [WEB_ROOT], write: [], evidenceSurface: [WEB_ROOT] },
    acceptance: {
      commands: ['task web:evidence'],
      evidence: ['Web evidence is complete.'],
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
      providerTaskIds: [provider.taskId, providerB.taskId],
    },
    agentDepthLimit: 2,
    dependencies: [provider.taskId, providerB.taskId],
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
        {
          taskId: providerB.taskId,
          team: providerB.team,
          functionalOwner: providerB.functionalOwner,
          acceptanceOwner: providerB.acceptanceOwner,
        },
      ],
    },
  };
  const edgeRequest: EvidenceEdgeRequest = {
    providerTaskId: provider.taskId,
    consumerTaskId: synthesis.taskId,
  };
  const edgeBRequest: EvidenceEdgeRequest = {
    providerTaskId: providerB.taskId,
    consumerTaskId: synthesis.taskId,
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
    nodes: [synthesis, providerB, provider],
    edgeContracts: [edge(edgeRequest), edge(edgeBRequest)],
  };
  const result = decodeAndValidateModuleDeliveryPlan(JSON.stringify(plan));
  if (result.status !== ModuleDeliveryValidationStatus.Accepted)
    throw new Error(JSON.stringify(result.issues));
  const authorityRequest: CreateModuleDeliveryGenerationAuthorityRequest = {
    acceptedPlan: result,
    expectedLineage: result.plan.nodes.map((node) => ({
      taskId: node.taskId,
      parentLineage: node.parentLineage,
    })),
  };
  const authority = createModuleDeliveryGenerationAuthority(authorityRequest);
  const stateRequest: CreateModuleDeliveryAdmissionStateRequest = {
    authority,
    acceptedPlan: result,
    headCommit: fixture.baselineCommit,
    integratedWriterFrontiers: [],
    acceptedEvidence: [],
  };
  const state = createModuleDeliveryAdmissionState(stateRequest);
  return {
    fixture,
    accepted: result,
    authority,
    state,
    provider,
    providerB,
    synthesis,
  };
}

function admittedLease(
  request: AdmittedLeaseRequest,
): ModuleDeliveryAttemptLease {
  const { runtime, taskId } = request;
  const selectionRequest: SelectModuleDeliveryAdmissionsRequest = {
    authority: runtime.authority,
    acceptedPlan: runtime.accepted,
    state: runtime.state,
  };
  const selection = selectModuleDeliveryAdmissions(selectionRequest);
  const admission = selection.admissions.find(
    (entry) => entry.taskId === taskId,
  );
  if (!admission) throw new Error(`Admission ${taskId} is missing.`);
  const leaseRequest: RecordModuleDeliveryAttemptLeasesRequest = {
    authority: runtime.authority,
    state: runtime.state,
    admissions: [admission],
  };
  const lease = recordModuleDeliveryAttemptLeases(leaseRequest).leases[0];
  if (!lease) throw new Error(`Lease ${taskId} is missing.`);
  return lease;
}

function submission(
  request: EvidenceSubmissionRequest,
): ModuleDeliveryReadOnlyEvidenceSubmission {
  const { runtime, lease, acceptedProviderEvidence } = request;
  const node = runtime.accepted.plan.nodes.find(
    ({ taskId }) => taskId === lease.taskId,
  );
  if (!node || node.kind === ModuleDeliveryTaskKind.Write)
    throw new Error('Evidence node is missing.');
  const identities = acceptedProviderEvidence.map(
    moduleDeliveryAcceptedEvidenceIdentity,
  );
  const claimRequest: ModuleDeliveryEvidenceDigestRequest = {
    repositoryRoot: runtime.fixture.sourceRoot,
    sourceCommit: lease.startingFrontier,
    evidenceSurface: node.resources.evidenceSurface,
  };
  const claimIdentities =
    node.kind === ModuleDeliveryTaskKind.EvidenceSynthesis
      ? []
      : moduleDeliveryEvidenceClaimIdentities(claimRequest);
  const artifactIdentity = `evidence/${node.taskId}.json`;
  const evidence = [`${node.taskId} reviewed.`];
  const artifactDigestRequest: ModuleDeliveryEvidenceArtifactDigestRequest = {
    artifactIdentity,
    evidence,
    acceptanceRequirements: lease.acceptanceRequirements,
    acceptedProviderEvidence: identities,
  };
  const artifactDigest = moduleDeliveryEvidenceArtifactDigest(
    artifactDigestRequest,
  );
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
  request: EvidenceVerificationRequest,
): AcceptedModuleDeliveryEvidence {
  const { runtime, lease, candidate, acceptedProviderEvidence } = request;
  const verification: ModuleDeliveryEvidenceSubmissionVerification = {
    authority: runtime.authority,
    acceptedPlan: runtime.accepted,
    repositoryRoot: runtime.fixture.sourceRoot,
    state: runtime.state,
    submission: candidate,
    lease,
    authorizedProviderEvidence: acceptedProviderEvidence,
  };
  return verifyModuleDeliveryEvidenceSubmission(verification);
}

test('accepts exact repository evidence and releases its lease only after accepted disposition', () => {
  const active = runtime();
  try {
    const leaseRequest: AdmittedLeaseRequest = {
      runtime: active,
      taskId: active.provider.taskId,
    };
    const lease = admittedLease(leaseRequest);
    const submissionRequest: EvidenceSubmissionRequest = {
      runtime: active,
      lease,
      acceptedProviderEvidence: [],
    };
    const candidate = submission(submissionRequest);
    const verificationRequest: EvidenceVerificationRequest = {
      ...submissionRequest,
      candidate,
    };
    const accepted = verify(verificationRequest);
    expect(Object.isFrozen(accepted)).toBe(true);
    const expectedIdentity: ExpectedEvidenceIdentity = {
      taskId: active.provider.taskId,
      attempt: 1,
      planDigest: active.accepted.planDigest,
      verdict: ModuleDeliveryEvidenceVerdict.TerminalSuccess,
    };
    expect(moduleDeliveryAcceptedEvidenceIdentity(accepted)).toMatchObject(
      expectedIdentity,
    );
    const activeSelectionRequest: SelectModuleDeliveryAdmissionsRequest = {
      authority: active.authority,
      acceptedPlan: active.accepted,
      state: active.state,
    };
    expect(
      selectModuleDeliveryAdmissions(activeSelectionRequest).admissions,
    ).toEqual([]);
    const prematureDispositionRequest: RecordModuleDeliveryAttemptDispositionRequest =
      {
        authority: active.authority,
        state: active.state,
        lease,
        outcome: {
          kind: ModuleDeliveryAttemptDispositionKind.Accepted,
          conclusion: ModuleDeliveryGenerationFenceKind.Accepted,
        },
      };
    expect(() =>
      recordModuleDeliveryAttemptDisposition(prematureDispositionRequest),
    ).toThrow('lease capability');

    const evidenceStateRequest: CreateModuleDeliveryAdmissionStateRequest = {
      authority: active.authority,
      acceptedPlan: active.accepted,
      headCommit: active.fixture.baselineCommit,
      integratedWriterFrontiers: [],
      acceptedEvidence: [accepted],
    };
    const evidenceState =
      createModuleDeliveryAdmissionState(evidenceStateRequest);
    const acceptedDispositionRequest: RecordModuleDeliveryAttemptDispositionRequest =
      {
        authority: active.authority,
        state: evidenceState,
        lease,
        outcome: {
          kind: ModuleDeliveryAttemptDispositionKind.Accepted,
          conclusion: ModuleDeliveryGenerationFenceKind.Accepted,
        },
      };
    recordModuleDeliveryAttemptDisposition(acceptedDispositionRequest);
    const synthesisSelectionRequest: SelectModuleDeliveryAdmissionsRequest = {
      authority: active.authority,
      acceptedPlan: active.accepted,
      state: evidenceState,
    };
    const synthesis = selectModuleDeliveryAdmissions(synthesisSelectionRequest);
    expect(synthesis.admissions.map(({ taskId }) => taskId)).toEqual([
      active.providerB.taskId,
    ]);
    const advancedStateRequest: CreateModuleDeliveryAdmissionStateRequest = {
      ...evidenceStateRequest,
      headCommit: 'f'.repeat(40),
    };
    expect(() =>
      createModuleDeliveryAdmissionState(advancedStateRequest),
    ).toThrow('Accepted evidence is invalid');
  } finally {
    disposeGitFixture(active.fixture);
  }
});

test('rejects forged metadata, evidence capabilities, and authority-owned stale frontier', () => {
  const active = runtime();
  try {
    const leaseRequest: AdmittedLeaseRequest = {
      runtime: active,
      taskId: active.provider.taskId,
    };
    const lease = admittedLease(leaseRequest);
    const submissionRequest: EvidenceSubmissionRequest = {
      runtime: active,
      lease,
      acceptedProviderEvidence: [],
    };
    const exact = submission(submissionRequest);
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
    for (const candidate of mutations) {
      const mutationVerificationRequest: EvidenceVerificationRequest = {
        ...submissionRequest,
        candidate,
      };
      expect(() => verify(mutationVerificationRequest)).toThrow();
    }

    const forgedEvidence: AcceptedModuleDeliveryEvidence = {
      ...exact,
      sourceProvenanceDigest: 'f'.repeat(64),
      verifiedHeadCommit: active.fixture.baselineCommit,
    };
    const isolatedRegistry =
      evidenceAuthority.createAcceptedModuleDeliveryEvidenceRegistry();
    const isolatedRegistration: AcceptedModuleDeliveryEvidenceInspection = {
      authority: active.authority,
      evidence: forgedEvidence,
    };
    isolatedRegistry.register(isolatedRegistration);
    expect('registerAcceptedModuleDeliveryEvidence' in evidenceAuthority).toBe(
      false,
    );
    const forgedStateRequest: CreateModuleDeliveryAdmissionStateRequest = {
      authority: active.authority,
      acceptedPlan: active.accepted,
      headCommit: active.fixture.baselineCommit,
      integratedWriterFrontiers: [],
      acceptedEvidence: [forgedEvidence],
    };
    expect(() =>
      createModuleDeliveryAdmissionState(forgedStateRequest),
    ).toThrow('evidence authority is invalid');

    const fileWrite: FixtureFileWrite = {
      fixture: active.fixture,
      relativePath: `${CORE_ROOT}/changed.rs`,
      contents: 'changed\n',
    };
    writeFixtureFile(fileWrite);
    const git = fixtureGit(active.fixture);
    git(['add', '--all']);
    git(['commit', '--quiet', '-m', 'change evidence surface']);
    const advancedCommit = git(['rev-parse', 'HEAD']);
    const staleStateRequest: CreateModuleDeliveryAdmissionStateRequest = {
      authority: active.authority,
      acceptedPlan: active.accepted,
      headCommit: advancedCommit,
      integratedWriterFrontiers: [],
      acceptedEvidence: [],
    };
    const staleState = createModuleDeliveryAdmissionState(staleStateRequest);
    const staleRuntime: Runtime = { ...active, state: staleState };
    const staleVerificationRequest: EvidenceVerificationRequest = {
      ...submissionRequest,
      runtime: staleRuntime,
      candidate: exact,
    };
    expect(() => verify(staleVerificationRequest)).toThrow('stale');
    const invalidAuthorityVerificationRequest: EvidenceVerificationRequest = {
      ...submissionRequest,
      candidate: exact,
    };
    expect(() => verify(invalidAuthorityVerificationRequest)).toThrow(
      'authority is invalid or stale',
    );
  } finally {
    disposeGitFixture(active.fixture);
  }
});

test('synthesis requires exact nonempty accepted provider evidence identities', () => {
  const active = runtime();
  try {
    const activeSelectionRequest: SelectModuleDeliveryAdmissionsRequest = {
      authority: active.authority,
      acceptedPlan: active.accepted,
      state: active.state,
    };
    expect(
      selectModuleDeliveryAdmissions(activeSelectionRequest).admissions.map(
        ({ taskId }) => taskId,
      ),
    ).toEqual([active.provider.taskId]);
    const providerLeaseRequest: AdmittedLeaseRequest = {
      runtime: active,
      taskId: active.provider.taskId,
    };
    const providerLease = admittedLease(providerLeaseRequest);
    const providerSubmissionRequest: EvidenceSubmissionRequest = {
      runtime: active,
      lease: providerLease,
      acceptedProviderEvidence: [],
    };
    const providerCandidate = submission(providerSubmissionRequest);
    const providerVerificationRequest: EvidenceVerificationRequest = {
      ...providerSubmissionRequest,
      candidate: providerCandidate,
    };
    const providerEvidence = verify(providerVerificationRequest);
    const evidenceStateRequest: CreateModuleDeliveryAdmissionStateRequest = {
      authority: active.authority,
      acceptedPlan: active.accepted,
      headCommit: active.fixture.baselineCommit,
      integratedWriterFrontiers: [],
      acceptedEvidence: [providerEvidence],
    };
    const evidenceState =
      createModuleDeliveryAdmissionState(evidenceStateRequest);
    const providerDispositionRequest: RecordModuleDeliveryAttemptDispositionRequest =
      {
        authority: active.authority,
        state: evidenceState,
        lease: providerLease,
        outcome: {
          kind: ModuleDeliveryAttemptDispositionKind.Accepted,
          conclusion: ModuleDeliveryGenerationFenceKind.Accepted,
        },
      };
    recordModuleDeliveryAttemptDisposition(providerDispositionRequest);
    const providerRuntime: Runtime = { ...active, state: evidenceState };
    const providerBLeaseRequest: AdmittedLeaseRequest = {
      runtime: providerRuntime,
      taskId: active.providerB.taskId,
    };
    const providerBLease = admittedLease(providerBLeaseRequest);
    const providerBSubmissionRequest: EvidenceSubmissionRequest = {
      runtime: providerRuntime,
      lease: providerBLease,
      acceptedProviderEvidence: [],
    };
    const providerBVerificationRequest: EvidenceVerificationRequest = {
      ...providerBSubmissionRequest,
      candidate: submission(providerBSubmissionRequest),
    };
    const providerBEvidence = verify(providerBVerificationRequest);
    const completeStateRequest: CreateModuleDeliveryAdmissionStateRequest = {
      authority: active.authority,
      acceptedPlan: active.accepted,
      headCommit: active.fixture.baselineCommit,
      integratedWriterFrontiers: [],
      acceptedEvidence: [providerEvidence, providerBEvidence],
    };
    const completeState =
      createModuleDeliveryAdmissionState(completeStateRequest);
    const providerBDispositionRequest: RecordModuleDeliveryAttemptDispositionRequest =
      {
        authority: active.authority,
        state: completeState,
        lease: providerBLease,
        outcome: {
          kind: ModuleDeliveryAttemptDispositionKind.Accepted,
          conclusion: ModuleDeliveryGenerationFenceKind.Accepted,
        },
      };
    recordModuleDeliveryAttemptDisposition(providerBDispositionRequest);
    const synthesisRuntime: Runtime = { ...active, state: completeState };
    const synthesisLeaseRequest: AdmittedLeaseRequest = {
      runtime: synthesisRuntime,
      taskId: active.synthesis.taskId,
    };
    const synthesisLease = admittedLease(synthesisLeaseRequest);
    const synthesisSubmissionRequest: EvidenceSubmissionRequest = {
      runtime: synthesisRuntime,
      lease: synthesisLease,
      acceptedProviderEvidence: [providerEvidence, providerBEvidence],
    };
    expect(Object.values(synthesisLease.resources).flat()).toEqual([]);
    const exact = submission(synthesisSubmissionRequest);
    const missingInputsVerificationRequest: EvidenceVerificationRequest = {
      runtime: synthesisRuntime,
      lease: synthesisLease,
      candidate: exact,
      acceptedProviderEvidence: [],
    };
    expect(() => verify(missingInputsVerificationRequest)).toThrow(
      'synthesis inputs',
    );
    const reversedSubmissionRequest: EvidenceSubmissionRequest = {
      ...synthesisSubmissionRequest,
      acceptedProviderEvidence: [providerBEvidence, providerEvidence],
    };
    const reversedVerificationRequest: EvidenceVerificationRequest = {
      ...reversedSubmissionRequest,
      candidate: submission(reversedSubmissionRequest),
    };
    expect(() => verify(reversedVerificationRequest)).toThrow(
      'synthesis inputs',
    );
    const mutableIdentities = structuredClone(
      exact.acceptedProviderEvidence,
    ) as MutableProviderEvidenceIdentity[];
    const mutableExact: ModuleDeliveryReadOnlyEvidenceSubmission = {
      ...exact,
      acceptedProviderEvidence: mutableIdentities,
    };
    const synthesisVerificationRequest: EvidenceVerificationRequest = {
      ...synthesisSubmissionRequest,
      candidate: mutableExact,
    };
    const synthesisEvidence = verify(synthesisVerificationRequest);
    const retained = mutableIdentities[0];
    const nested = mutableIdentities[1];
    const stored = synthesisEvidence.acceptedProviderEvidence[0];
    if (!retained || !nested || !stored)
      throw new Error('Nested synthesis evidence is missing.');
    retained.acceptedProviderEvidence.push(nested);
    expect(Object.isFrozen(stored.acceptedProviderEvidence)).toBe(true);
    expect(stored.acceptedProviderEvidence).toEqual([]);
    expect(() => verify(synthesisVerificationRequest)).toThrow(
      'metadata is invalid',
    );
    const staleSynthesisStateRequest: CreateModuleDeliveryAdmissionStateRequest =
      {
        authority: active.authority,
        acceptedPlan: active.accepted,
        headCommit: 'f'.repeat(40),
        integratedWriterFrontiers: [],
        acceptedEvidence: [synthesisEvidence],
      };
    expect(() =>
      createModuleDeliveryAdmissionState(staleSynthesisStateRequest),
    ).toThrow('Accepted evidence is invalid');
  } finally {
    disposeGitFixture(active.fixture);
  }
});
