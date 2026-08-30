import { afterAll, describe, expect, test } from 'bun:test';
import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';
import { TeamKey } from '../../src/team-agents/catalog.ts';
import {
  assertAcceptedModuleDeliveryEvidence,
  moduleDeliveryAcceptedEvidenceIdentity,
  moduleDeliveryAuthorityPlan,
} from '../../src/module-delivery/admission.ts';
import { moduleDeliveryEvidenceClaimIdentities } from '../../src/module-delivery/evidence.ts';
import {
  createGitFixture,
  disposeGitFixture,
  fixtureGit,
  writeFixtureFile,
} from './worktree-test-support.ts';
import type { FixtureFileWrite } from './worktree-test-support.ts';

import {
  REQUIRED_PARENT_OWNED_RESOURCES,
  ModuleDeliveryAdmissionSelectionStatus,
  ModuleDeliveryAttemptDispositionKind,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryEvidenceVerdict,
  ModuleDeliveryGenerationFenceKind,
  ModuleDeliveryJoinKind,
  ModuleDeliveryTaskKind,
  ModuleDeliveryValidationStatus,
  ModuleDeliveryWorkspaceKind,
  ModuleDeliveryProviderSubmissionKind,
  createModuleDeliveryAdmissionState,
  createModuleDeliveryGenerationAuthority,
  decodeAndValidateModuleDeliveryPlan,
  moduleDeliveryEvidenceArtifactDigest,
  recordModuleDeliveryAttemptDisposition,
  recordModuleDeliveryAttemptLeases,
  restartModuleDeliveryGeneration,
  selectModuleDeliveryAdmissions,
  verifyModuleDeliveryEvidenceSubmission,
} from '../../src/module-delivery/index.ts';

import type {
  AcceptedModuleDeliveryEvidence,
  CreateModuleDeliveryAdmissionStateRequest,
  CreateModuleDeliveryGenerationAuthorityRequest,
  ModuleDeliveryAdmissionState,
  ModuleDeliveryAttemptLease,
  ModuleDeliveryEdgeContract,
  ModuleDeliveryEvidenceArtifactDigestRequest,
  ModuleDeliveryExpectedLineage,
  ModuleDeliveryGenerationAuthority,
  ModuleDeliveryPlanV2,
  ModuleDeliveryReadOnlyEvidenceSubmission,
  ModuleDeliveryReadOnlyNodeV2,
  ModuleDeliveryWriteNodeV2,
  RecordModuleDeliveryAttemptDispositionRequest,
  RecordModuleDeliveryAttemptLeasesRequest,
  RestartModuleDeliveryGenerationRequest,
  SelectModuleDeliveryAdmissionsRequest,
  ValidatedModuleDeliveryPlan,
} from '../../src/module-delivery/index.ts';
import type {
  ModuleDeliveryEvidenceDigestRequest,
  ModuleDeliveryEvidenceSubmissionVerification,
} from '../../src/module-delivery/evidence.ts';

const fixture = createGitFixture();
const SOURCE = fixture.baselineCommit;
const replacementWrite: FixtureFileWrite = {
  fixture,
  relativePath: 'module/replacement.txt',
  contents: 'replacement\n',
};
writeFixtureFile(replacementWrite);
fixtureGit(fixture)(['add', '--all']);
fixtureGit(fixture)(['commit', '--quiet', '-m', 'replacement']);
const REPLACEMENT_SOURCE = fixtureGit(fixture)(['rev-parse', 'HEAD']);
const foreignFixture = createGitFixture();
const foreignWrite: FixtureFileWrite = {
  fixture: foreignFixture,
  relativePath: 'module/foreign.txt',
  contents: 'foreign\n',
};
writeFixtureFile(foreignWrite);
fixtureGit(foreignFixture)(['add', '--all']);
fixtureGit(foreignFixture)(['commit', '--quiet', '-m', 'foreign']);
const FOREIGN_SOURCE = fixtureGit(foreignFixture)(['rev-parse', 'HEAD']);
const ROOT = 'nook-app/nook-platform/nook-core';
type Runtime = {
  readonly accepted: ValidatedModuleDeliveryPlan;
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly state: ModuleDeliveryAdmissionState;
};
type WriteNodeRequest = {
  readonly taskId: string;
  readonly dependencies: readonly string[];
  readonly path: string;
};
type LeaseRequest = {
  readonly runtime: Runtime;
  readonly taskId: string;
};
type GenerationPlanRequest = {
  readonly sourceCommit: string;
  readonly generation: number;
  readonly includeGamma: boolean;
};
type CancelledLeaseRequest = Readonly<{
  runtime: Runtime;
  lease: ModuleDeliveryAttemptLease;
}>;
type GenerationRestartRequest = {
  readonly runtime: Runtime;
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
};
type GenerationPlanUpdate = {
  readonly generation: number;
  readonly nodes: ModuleDeliveryPlanV2['nodes'];
};
type PlanConcurrencyUpdate = { readonly maxConcurrency: number };
type EvidenceSubmissionRequest = {
  readonly runtime: Runtime;
  readonly lease: ModuleDeliveryAttemptLease;
  readonly acceptedEvidence: readonly AcceptedModuleDeliveryEvidence[];
};
type AcceptedEvidenceResult = Readonly<{
  evidence: AcceptedModuleDeliveryEvidence;
  state: ModuleDeliveryAdmissionState;
}>;

function writeNode(request: WriteNodeRequest): ModuleDeliveryWriteNodeV2 {
  const { taskId, dependencies, path } = request;
  return {
    kind: ModuleDeliveryTaskKind.Write,
    taskId,
    team: TeamKey.DevelopmentCore,
    functionalOwner: TeamKey.Ai,
    acceptanceOwner: TeamKey.Ai,
    parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
    expert: 'core_expert',
    moduleRoot: ROOT,
    consumerOutcome: `${taskId} publishes a capability.`,
    baseline:
      dependencies.length === 0
        ? {
            kind: ModuleDeliveryBaselineKind.SourceCommit,
            sourceCommit: SOURCE,
          }
        : {
            kind: ModuleDeliveryBaselineKind.IntegratedDependencies,
            providerTaskIds: dependencies,
          },
    agentDepthLimit: 2,
    dependencies,
    resources: {
      read: [`${ROOT}/${path}/**`],
      write: [`${ROOT}/${path}/**`],
      evidenceSurface: [],
    },
    parentOwnedExclusions: REQUIRED_PARENT_OWNED_RESOURCES,
    acceptance: {
      commands: [`task ${taskId}:test`],
      evidence: [`${taskId} passed`],
    },
    workspace: {
      kind: ModuleDeliveryWorkspaceKind.IsolatedWorktree,
      expectedCommitHandoff: true,
    },
  };
}

const alphaRequest: WriteNodeRequest = {
  taskId: 'alpha',
  dependencies: [],
  path: 'alpha',
};
const betaRequest: WriteNodeRequest = {
  taskId: 'beta',
  dependencies: [],
  path: 'beta',
};
const gammaRequest: WriteNodeRequest = {
  taskId: 'gamma',
  dependencies: [],
  path: 'gamma',
};
const consumerRequest: WriteNodeRequest = {
  taskId: 'consumer',
  dependencies: ['alpha'],
  path: 'consumer',
};
const alpha = writeNode(alphaRequest);
const beta = writeNode(betaRequest);
const gamma = writeNode(gammaRequest);
const consumer = writeNode(consumerRequest);
const edge: ModuleDeliveryEdgeContract = {
  providerTaskId: 'alpha',
  consumerTaskId: 'consumer',
  capability: 'alpha capability',
  publicTypes: ['AlphaResult'],
  errors: ['AlphaError'],
  behaviorInvariants: ['Deterministic behavior.'],
  securityInvariants: ['Provider-owned state.'],
  compatibilityExpectations: ['Compatible consumer.'],
  owningTests: ['alpha contract test'],
};
const PLAN: ModuleDeliveryPlanV2 = {
  version: 2,
  generation: 1,
  sourceCommit: SOURCE,
  maxConcurrency: 2,
  maxAgentDepth: 3,
  maxAttempts: 2,
  parentOwnedResources: REQUIRED_PARENT_OWNED_RESOURCES,
  parentJoin: {
    kind: ModuleDeliveryJoinKind.OrderedCommitHandoffs,
    owner: 'delivery-owner',
    validationCommands: ['task loom:verify'],
  },
  nodes: [consumer, gamma, beta, alpha],
  edgeContracts: [edge],
};

function planAt(sourceCommit: string): ModuleDeliveryPlanV2 {
  const plan = structuredClone(PLAN);
  const source = { sourceCommit };
  Object.assign(plan, source);
  for (const node of plan.nodes)
    if (node.baseline.kind === ModuleDeliveryBaselineKind.SourceCommit)
      Object.assign(node.baseline, source);
  return plan;
}

function generationPlan(request: GenerationPlanRequest): ModuleDeliveryPlanV2 {
  const plan = structuredClone(planAt(request.sourceCommit));
  const nodes = request.includeGamma
    ? plan.nodes
    : plan.nodes.filter(({ taskId }) => taskId !== gamma.taskId);
  const update: GenerationPlanUpdate = {
    generation: request.generation,
    nodes,
  };
  Object.assign(plan, update);
  return plan;
}

function validate(plan: ModuleDeliveryPlanV2): ValidatedModuleDeliveryPlan {
  const result = decodeAndValidateModuleDeliveryPlan(JSON.stringify(plan));
  if (result.status !== ModuleDeliveryValidationStatus.Accepted)
    throw new Error(JSON.stringify(result.issues));
  return result;
}

function lineage(
  plan: ValidatedModuleDeliveryPlan,
): readonly ModuleDeliveryExpectedLineage[] {
  return plan.plan.nodes.map((node) => ({
    taskId: node.taskId,
    parentLineage: node.parentLineage,
  }));
}

function authorityRequest(
  plan: ValidatedModuleDeliveryPlan,
): CreateModuleDeliveryGenerationAuthorityRequest {
  return {
    acceptedPlan: plan,
    expectedLineage: lineage(plan),
    repositoryRoot: fixture.sourceRoot,
  };
}

function runtime(plan: ValidatedModuleDeliveryPlan): Runtime {
  const authority = createModuleDeliveryGenerationAuthority(
    authorityRequest(plan),
  );
  const stateRequest: CreateModuleDeliveryAdmissionStateRequest = {
    authority,
    acceptedPlan: plan,
    headCommit: SOURCE,
    integratedWriterFrontiers: [],
    acceptedEvidence: [],
  };
  const state = createModuleDeliveryAdmissionState(stateRequest);
  return { accepted: plan, authority, state };
}

function select(active: Runtime) {
  const request: SelectModuleDeliveryAdmissionsRequest = {
    authority: active.authority,
    acceptedPlan: active.accepted,
    state: active.state,
  };
  return selectModuleDeliveryAdmissions(request);
}

function lease(request: LeaseRequest): ModuleDeliveryAttemptLease {
  const { runtime: active, taskId } = request;
  const admission = select(active).admissions.find(
    (entry) => entry.taskId === taskId,
  );
  if (!admission) throw new Error(`Admission ${taskId} is missing.`);
  const recordingRequest: RecordModuleDeliveryAttemptLeasesRequest = {
    authority: active.authority,
    state: active.state,
    admissions: [admission],
  };
  const recording = recordModuleDeliveryAttemptLeases(recordingRequest);
  const leased = recording.leases[0];
  if (!leased) throw new Error(`Lease ${taskId} is missing.`);
  return leased;
}

function cancelledLease(
  request: CancelledLeaseRequest,
): RecordModuleDeliveryAttemptDispositionRequest {
  return {
    authority: request.runtime.authority,
    state: request.runtime.state,
    lease: request.lease,
    outcome: {
      kind: ModuleDeliveryAttemptDispositionKind.FinalUnusable,
      conclusion: ModuleDeliveryGenerationFenceKind.Cancelled,
    },
  };
}

function restartRequest(
  request: GenerationRestartRequest,
): RestartModuleDeliveryGenerationRequest {
  return {
    authority: request.runtime.authority,
    previousState: request.runtime.state,
    acceptedPlan: request.acceptedPlan,
    expectedLineage: lineage(request.acceptedPlan),
  };
}

function evidenceSubmission(
  request: EvidenceSubmissionRequest,
): ModuleDeliveryReadOnlyEvidenceSubmission {
  const node = request.runtime.accepted.plan.nodes.find(
    ({ taskId }) => taskId === request.lease.taskId,
  );
  if (!node || node.kind === ModuleDeliveryTaskKind.Write)
    throw new Error('Evidence node is missing.');
  const acceptedProviderEvidence = request.acceptedEvidence.map(
    moduleDeliveryAcceptedEvidenceIdentity,
  );
  const claimRequest: ModuleDeliveryEvidenceDigestRequest = {
    repositoryRoot: fixture.sourceRoot,
    sourceCommit: request.lease.startingFrontier,
    evidenceSurface: node.resources.evidenceSurface,
  };
  const claimIdentities =
    node.kind === ModuleDeliveryTaskKind.EvidenceSynthesis
      ? []
      : moduleDeliveryEvidenceClaimIdentities(claimRequest);
  const artifactIdentity = `evidence/${node.taskId}.json`;
  const evidence = [`${node.taskId} reviewed.`];
  const digestRequest: ModuleDeliveryEvidenceArtifactDigestRequest = {
    artifactIdentity,
    evidence,
    acceptanceRequirements: request.lease.acceptanceRequirements,
    acceptedProviderEvidence,
  };
  return {
    kind: ModuleDeliveryProviderSubmissionKind.ReadOnlyEvidence,
    schemaVersion: 1,
    taskId: node.taskId,
    attempt: request.lease.attempt,
    generation: request.lease.generation,
    planDigest: request.lease.planDigest,
    sourceCommit: request.lease.startingFrontier,
    producerTeam: request.lease.team,
    functionalOwner: request.lease.functionalOwner,
    acceptanceOwner: request.lease.acceptanceOwner,
    acceptanceRequirements: request.lease.acceptanceRequirements,
    claimIdentities,
    acceptedProviderEvidence,
    artifactIdentity,
    artifactDigest: moduleDeliveryEvidenceArtifactDigest(digestRequest),
    verdict: ModuleDeliveryEvidenceVerdict.TerminalSuccess,
    evidence,
  };
}

function acceptEvidence(
  request: EvidenceSubmissionRequest,
): AcceptedEvidenceResult {
  const submission = evidenceSubmission(request);
  const verification: ModuleDeliveryEvidenceSubmissionVerification = {
    authority: request.runtime.authority,
    acceptedPlan: request.runtime.accepted,
    repositoryRoot: fixture.sourceRoot,
    state: request.runtime.state,
    submission,
    lease: request.lease,
    authorizedProviderEvidence: request.acceptedEvidence,
  };
  const evidence = verifyModuleDeliveryEvidenceSubmission(verification);
  const stateRequest: CreateModuleDeliveryAdmissionStateRequest = {
    authority: request.runtime.authority,
    acceptedPlan: request.runtime.accepted,
    headCommit: request.runtime.state.headCommit,
    integratedWriterFrontiers: [],
    acceptedEvidence: [...request.acceptedEvidence, evidence],
  };
  const state = createModuleDeliveryAdmissionState(stateRequest);
  const dispositionRequest: RecordModuleDeliveryAttemptDispositionRequest = {
    authority: request.runtime.authority,
    state,
    lease: request.lease,
    outcome: {
      kind: ModuleDeliveryAttemptDispositionKind.Accepted,
      conclusion: ModuleDeliveryGenerationFenceKind.Accepted,
    },
  };
  recordModuleDeliveryAttemptDisposition(dispositionRequest);
  return { evidence, state };
}

describe('module delivery admission authority', () => {
  test('selects the maximal safe set and rejects unproven writer frontiers', () => {
    const active = runtime(validate(PLAN));
    const first = select(active);
    expect(first.admissions.map(({ taskId }) => taskId)).toEqual([
      'alpha',
      'beta',
    ]);
    const forgedFrontier = {
      taskId: 'alpha',
      attempt: 1,
      generation: 1,
      planDigest: active.accepted.planDigest,
      headCommit: '89abcdef0123456789abcdef0123456789abcdef',
      integratedTaskIds: ['alpha'],
    } as never;
    const unrelatedFrontier = {
      taskId: 'beta',
      attempt: 1,
      generation: 1,
      planDigest: active.accepted.planDigest,
      headCommit: 'f'.repeat(40),
      integratedTaskIds: ['beta'],
    } as never;
    const advancedStateRequest: CreateModuleDeliveryAdmissionStateRequest = {
      authority: active.authority,
      acceptedPlan: active.accepted,
      headCommit: '89abcdef0123456789abcdef0123456789abcdef',
      integratedWriterFrontiers: [forgedFrontier, unrelatedFrontier],
      acceptedEvidence: [],
    };
    expect(() =>
      createModuleDeliveryAdmissionState(advancedStateRequest),
    ).toThrow('capability is invalid');
    const arbitraryHeadRequest = {
      ...advancedStateRequest,
      integratedWriterFrontiers: [],
    };
    expect(() =>
      createModuleDeliveryAdmissionState(arbitraryHeadRequest),
    ).toThrow('lacks integration authority');
  });

  test('snapshots validated metadata and rejects forged plans and lineage', () => {
    const accepted = validate(PLAN);
    const active = runtime(accepted);
    const sourceNode = accepted.plan.nodes.find(
      ({ taskId }) => taskId === 'alpha',
    );
    if (!sourceNode) throw new Error('Alpha node is missing.');
    (sourceNode.resources.read as string[]).push(`${ROOT}/forged/**`);
    const planRequest = {
      authority: active.authority,
      acceptedPlan: accepted,
    };
    const exposedNode = moduleDeliveryAuthorityPlan(
      planRequest,
    ).plan.nodes.find(({ taskId }) => taskId === 'alpha');
    if (!exposedNode) throw new Error('Exposed alpha node is missing.');
    (exposedNode.resources.read as string[]).push(`${ROOT}/exposed/**`);
    const admission = select(active).admissions.find(
      ({ taskId }) => taskId === 'alpha',
    );
    expect(admission?.resources.read).not.toContain(`${ROOT}/forged/**`);
    expect(admission?.resources.read).not.toContain(`${ROOT}/exposed/**`);

    const forged: ValidatedModuleDeliveryPlan = {
      ...validate(PLAN),
      topologicalOrder: ['consumer', 'alpha', 'beta'],
    };
    const forgedAuthorityRequest = authorityRequest(forged);
    expect(() =>
      createModuleDeliveryGenerationAuthority(forgedAuthorityRequest),
    ).toThrow('metadata is inconsistent');

    for (const sourceCommit of [
      'f'.repeat(40),
      fixtureGit(fixture)(['rev-parse', `${SOURCE}:module/seed.txt`]),
    ]) {
      const sourceAuthorityRequest = authorityRequest(
        validate(planAt(sourceCommit)),
      );
      expect(() =>
        createModuleDeliveryGenerationAuthority(sourceAuthorityRequest),
      ).toThrow('source commit is not authenticated');
    }
    const noncanonicalRootRequest: CreateModuleDeliveryGenerationAuthorityRequest =
      {
        ...authorityRequest(validate(PLAN)),
        repositoryRoot: `${fixture.sourceRoot}/module`,
      };
    expect(() =>
      createModuleDeliveryGenerationAuthority(noncanonicalRootRequest),
    ).toThrow('repository root is not canonical');

    const wrongLineage = lineage(validate(PLAN)).map(({ taskId }) => ({
      taskId,
      parentLineage: {
        kind: AgentAttemptParentKind.AgentAttempt,
        task: 'forged-task',
        agent: 'forged-agent',
        attempt: 2,
      },
    }));
    const wrongLineageAuthorityRequest = {
      ...authorityRequest(validate(PLAN)),
      expectedLineage: wrongLineage,
    };
    expect(() =>
      createModuleDeliveryGenerationAuthority(wrongLineageAuthorityRequest),
    ).toThrow('Expected lineage is invalid');
  });

  test('rejects forged states, admissions, attempts, and conflicts atomically', () => {
    const active = runtime(validate(PLAN));
    const admission = select(active).admissions[0];
    if (!admission) throw new Error('Admission is missing.');
    const forgedState: ModuleDeliveryAdmissionState = { ...active.state };
    const forgedSelectionRequest: SelectModuleDeliveryAdmissionsRequest = {
      authority: active.authority,
      acceptedPlan: active.accepted,
      state: forgedState,
    };
    expect(() =>
      selectModuleDeliveryAdmissions(forgedSelectionRequest),
    ).toThrow('authority is invalid');
    const exactLeaseRequest: RecordModuleDeliveryAttemptLeasesRequest = {
      authority: active.authority,
      state: active.state,
      admissions: [admission],
    };
    const forgedAdmission = { ...admission, taskId: 'beta', attempt: 4 };
    const invalidAdmissions = [[admission, admission], [forgedAdmission]];
    for (const admissions of invalidAdmissions) {
      const invalidRequest = { ...exactLeaseRequest, admissions };
      expect(() => recordModuleDeliveryAttemptLeases(invalidRequest)).toThrow(
        'capability is invalid',
      );
    }
    expect(
      recordModuleDeliveryAttemptLeases(exactLeaseRequest).leases,
    ).toHaveLength(1);
  });

  test('retains lease history through disposition and reports exhausted closure', () => {
    const exhaustionPlan: ModuleDeliveryPlanV2 = {
      ...PLAN,
      maxConcurrency: 1,
    };
    const active = runtime(validate(exhaustionPlan));
    const firstLeaseRequest: LeaseRequest = {
      runtime: active,
      taskId: 'alpha',
    };
    const firstLease = lease(firstLeaseRequest);
    const dispositionRequest: RecordModuleDeliveryAttemptDispositionRequest = {
      authority: active.authority,
      state: active.state,
      lease: firstLease,
      outcome: {
        kind: ModuleDeliveryAttemptDispositionKind.FinalUnusable,
        conclusion: ModuleDeliveryGenerationFenceKind.Cancelled,
      },
    };
    const dispositionState =
      recordModuleDeliveryAttemptDisposition(dispositionRequest);
    const retryRuntime: Runtime = {
      ...active,
      state: dispositionState,
    };
    const retry = select(retryRuntime).admissions.find(
      ({ taskId }) => taskId === 'alpha',
    );
    expect(retry?.startingFrontier).toBe(firstLease.startingFrontier);

    const secondLeaseRequest = { runtime: retryRuntime, taskId: 'alpha' };
    const secondLease = lease(secondLeaseRequest);
    const secondDispositionRequest: RecordModuleDeliveryAttemptDispositionRequest =
      { ...dispositionRequest, state: dispositionState, lease: secondLease };
    const exhaustedState = recordModuleDeliveryAttemptDisposition(
      secondDispositionRequest,
    );
    const exhaustedRuntime: Runtime = {
      ...retryRuntime,
      state: exhaustedState,
    };
    const exhaustedSelection = select(exhaustedRuntime);
    const selected = ModuleDeliveryAdmissionSelectionStatus.Selected;
    expect(exhaustedSelection.status).toBe(selected);
    expect(exhaustedSelection.blockedTaskIds).toEqual(['alpha', 'consumer']);
    const betaLeaseRequest: LeaseRequest = {
      runtime: exhaustedRuntime,
      taskId: 'beta',
    };
    lease(betaLeaseRequest);
    const ongoingSelection = select(exhaustedRuntime);
    expect(ongoingSelection.status).toBe(selected);
    expect(ongoingSelection.admissions).toEqual([]);
    expect(ongoingSelection.pendingTaskIds).toEqual(['gamma']);
  });

  test('rejects replacement failures transactionally and keeps the prior generation usable', () => {
    const firstPlanRequest: GenerationPlanRequest = {
      sourceCommit: SOURCE,
      generation: 1,
      includeGamma: false,
    };
    const active = runtime(validate(generationPlan(firstPlanRequest)));
    const assertPriorGenerationUsable = (): void => {
      const current = select(active);
      expect(current.admissions.map(({ generation }) => generation)).toEqual([
        1, 1,
      ]);
    };
    const replacementPlanRequest: GenerationPlanRequest = {
      sourceCommit: REPLACEMENT_SOURCE,
      generation: 2,
      includeGamma: true,
    };
    const replacement = validate(generationPlan(replacementPlanRequest));
    const sameGenerationRequest: GenerationRestartRequest = {
      runtime: active,
      acceptedPlan: active.accepted,
    };
    expect(() =>
      restartModuleDeliveryGeneration(restartRequest(sameGenerationRequest)),
    ).toThrow('newer immutable generation');
    assertPriorGenerationUsable();

    const forged: ValidatedModuleDeliveryPlan = {
      ...replacement,
      executionPrecedence: [],
    };
    const forgedRequest: GenerationRestartRequest = {
      runtime: active,
      acceptedPlan: forged,
    };
    expect(() =>
      restartModuleDeliveryGeneration(restartRequest(forgedRequest)),
    ).toThrow('metadata is inconsistent');
    assertPriorGenerationUsable();

    const blob = fixtureGit(fixture)([
      'rev-parse',
      `${SOURCE}:module/seed.txt`,
    ]);
    for (const sourceCommit of ['f'.repeat(40), blob, FOREIGN_SOURCE]) {
      const invalidPlanRequest: GenerationPlanRequest = {
        sourceCommit,
        generation: 2,
        includeGamma: true,
      };
      const invalidRestartRequest: GenerationRestartRequest = {
        runtime: active,
        acceptedPlan: validate(generationPlan(invalidPlanRequest)),
      };
      expect(() =>
        restartModuleDeliveryGeneration(restartRequest(invalidRestartRequest)),
      ).toThrow('source commit is not authenticated');
      assertPriorGenerationUsable();
    }

    const validRestartRequest: GenerationRestartRequest = {
      runtime: active,
      acceptedPlan: replacement,
    };
    const wrongLineageRequest = restartRequest(validRestartRequest);
    const wrongLineage: RestartModuleDeliveryGenerationRequest = {
      ...wrongLineageRequest,
      expectedLineage: wrongLineageRequest.expectedLineage.map(
        ({ taskId }) => ({
          taskId,
          parentLineage: {
            kind: AgentAttemptParentKind.AgentAttempt,
            task: 'forged-task',
            agent: 'forged-agent',
            attempt: 2,
          },
        }),
      ),
    };
    expect(() => restartModuleDeliveryGeneration(wrongLineage)).toThrow(
      'Expected lineage is invalid',
    );
    assertPriorGenerationUsable();

    const alphaLeaseRequest: LeaseRequest = {
      runtime: active,
      taskId: alpha.taskId,
    };
    const leasedAlpha = lease(alphaLeaseRequest);
    const blockedRestartRequest: GenerationRestartRequest = {
      runtime: active,
      acceptedPlan: replacement,
    };
    expect(() =>
      restartModuleDeliveryGeneration(restartRequest(blockedRestartRequest)),
    ).toThrow('terminal release evidence');
    expect(select(active).admissions.map(({ taskId }) => taskId)).toEqual([
      beta.taskId,
    ]);
    const cancellationRequest: CancelledLeaseRequest = {
      runtime: active,
      lease: leasedAlpha,
    };
    recordModuleDeliveryAttemptDisposition(cancelledLease(cancellationRequest));
    assertPriorGenerationUsable();
  });

  test('restarts with a clean immutable generation and monotonic surviving attempts', () => {
    const firstPlanRequest: GenerationPlanRequest = {
      sourceCommit: SOURCE,
      generation: 1,
      includeGamma: false,
    };
    const active = runtime(validate(generationPlan(firstPlanRequest)));
    const oldSelection = select(active);
    const alphaAdmission = oldSelection.admissions.find(
      ({ taskId }) => taskId === alpha.taskId,
    );
    if (!alphaAdmission) throw new Error('Alpha admission is missing.');
    const alphaLeaseRequest: LeaseRequest = {
      runtime: active,
      taskId: alpha.taskId,
    };
    const alphaLease = lease(alphaLeaseRequest);
    const cancellationRequest: CancelledLeaseRequest = {
      runtime: active,
      lease: alphaLease,
    };
    recordModuleDeliveryAttemptDisposition(cancelledLease(cancellationRequest));
    const replacementPlanRequest: GenerationPlanRequest = {
      sourceCommit: REPLACEMENT_SOURCE,
      generation: 2,
      includeGamma: true,
    };
    const replacementPlan = generationPlan(replacementPlanRequest);
    const concurrencyUpdate: PlanConcurrencyUpdate = { maxConcurrency: 3 };
    Object.assign(replacementPlan, concurrencyUpdate);
    const replacement = validate(replacementPlan);
    const generationRestartRequest: GenerationRestartRequest = {
      runtime: active,
      acceptedPlan: replacement,
    };
    const restarted = restartModuleDeliveryGeneration(
      restartRequest(generationRestartRequest),
    );
    const expectedState: ModuleDeliveryAdmissionState = {
      generation: 2,
      planDigest: replacement.planDigest,
      headCommit: REPLACEMENT_SOURCE,
      integratedWriterFrontiers: [],
      acceptedProviderEvidence: [],
    };
    expect(restarted).toEqual(expectedState);
    expect(Object.isFrozen(restarted)).toBe(true);
    expect(Object.isFrozen(restarted.integratedWriterFrontiers)).toBe(true);
    expect(Object.isFrozen(restarted.acceptedProviderEvidence)).toBe(true);
    const restartedRuntime: Runtime = {
      accepted: replacement,
      authority: active.authority,
      state: restarted,
    };
    const admissions = select(restartedRuntime).admissions;
    expect(
      admissions.map(({ taskId, attempt, startingFrontier }) => ({
        taskId,
        attempt,
        startingFrontier,
      })),
    ).toEqual([
      {
        taskId: alpha.taskId,
        attempt: 2,
        startingFrontier: REPLACEMENT_SOURCE,
      },
      {
        taskId: beta.taskId,
        attempt: 1,
        startingFrontier: REPLACEMENT_SOURCE,
      },
      {
        taskId: gamma.taskId,
        attempt: 1,
        startingFrontier: REPLACEMENT_SOURCE,
      },
    ]);
    expect(() => select(active)).toThrow('invalid or superseded');
    const staleLeaseRequest: RecordModuleDeliveryAttemptLeasesRequest = {
      authority: active.authority,
      state: active.state,
      admissions: [alphaAdmission],
    };
    expect(() => recordModuleDeliveryAttemptLeases(staleLeaseRequest)).toThrow(
      'authority is invalid',
    );
  });

  test('retires accepted evidence authority across immutable generations', () => {
    const provider: ModuleDeliveryReadOnlyNodeV2 = {
      kind: ModuleDeliveryTaskKind.ReadOnly,
      taskId: 'provider-evidence',
      team: TeamKey.DevelopmentCore,
      functionalOwner: TeamKey.Ai,
      acceptanceOwner: TeamKey.Ai,
      parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
      expert: 'core_expert',
      moduleRoot: ROOT,
      consumerOutcome: 'AI receives accepted provider evidence.',
      baseline: {
        kind: ModuleDeliveryBaselineKind.SourceCommit,
        sourceCommit: SOURCE,
      },
      agentDepthLimit: 2,
      dependencies: [],
      resources: {
        read: [`${ROOT}/**`],
        write: [],
        evidenceSurface: [`${ROOT}/**`],
      },
      parentOwnedExclusions: REQUIRED_PARENT_OWNED_RESOURCES,
      acceptance: alpha.acceptance,
    };
    const firstPlan: ModuleDeliveryPlanV2 = {
      ...PLAN,
      nodes: [provider],
      edgeContracts: [],
    };
    const first = runtime(validate(firstPlan));
    const firstLeaseRequest: LeaseRequest = {
      runtime: first,
      taskId: provider.taskId,
    };
    const firstLease = lease(firstLeaseRequest);
    const firstSubmissionRequest: EvidenceSubmissionRequest = {
      runtime: first,
      lease: firstLease,
      acceptedEvidence: [],
    };
    const acceptedFirst = acceptEvidence(firstSubmissionRequest);
    const terminalFirst: Runtime = { ...first, state: acceptedFirst.state };
    const secondPlan = structuredClone(firstPlan);
    const secondPlanUpdate = {
      generation: 2,
      sourceCommit: REPLACEMENT_SOURCE,
    };
    Object.assign(secondPlan, secondPlanUpdate);
    const secondProvider = secondPlan.nodes.find(
      ({ taskId }) => taskId === provider.taskId,
    );
    if (
      !secondProvider ||
      secondProvider.baseline.kind !== ModuleDeliveryBaselineKind.SourceCommit
    )
      throw new Error('Second-generation provider is missing.');
    const secondBaselineUpdate = { sourceCommit: REPLACEMENT_SOURCE };
    Object.assign(secondProvider.baseline, secondBaselineUpdate);
    const acceptedSecondPlan = validate(secondPlan);
    const generationRestartRequest: GenerationRestartRequest = {
      runtime: terminalFirst,
      acceptedPlan: acceptedSecondPlan,
    };
    const restartedState = restartModuleDeliveryGeneration(
      restartRequest(generationRestartRequest),
    );
    const evidenceInspection = {
      authority: first.authority,
      evidence: acceptedFirst.evidence,
    };
    expect(() =>
      assertAcceptedModuleDeliveryEvidence(evidenceInspection),
    ).toThrow('evidence authority is invalid');
    expect(() =>
      moduleDeliveryAcceptedEvidenceIdentity(acceptedFirst.evidence),
    ).toThrow('evidence is forged');
    const staleStateRequest: CreateModuleDeliveryAdmissionStateRequest = {
      authority: first.authority,
      acceptedPlan: acceptedSecondPlan,
      headCommit: REPLACEMENT_SOURCE,
      integratedWriterFrontiers: [],
      acceptedEvidence: [acceptedFirst.evidence],
    };
    expect(() => createModuleDeliveryAdmissionState(staleStateRequest)).toThrow(
      'evidence authority is invalid',
    );
    const second: Runtime = {
      accepted: acceptedSecondPlan,
      authority: first.authority,
      state: restartedState,
    };
    const secondLeaseRequest: LeaseRequest = {
      runtime: second,
      taskId: provider.taskId,
    };
    const secondLease = lease(secondLeaseRequest);
    const secondSubmissionRequest: EvidenceSubmissionRequest = {
      runtime: second,
      lease: secondLease,
      acceptedEvidence: [],
    };
    const secondSubmission = evidenceSubmission(secondSubmissionRequest);
    const staleAuthorization: ModuleDeliveryEvidenceSubmissionVerification = {
      authority: second.authority,
      acceptedPlan: second.accepted,
      repositoryRoot: fixture.sourceRoot,
      state: second.state,
      submission: secondSubmission,
      lease: secondLease,
      authorizedProviderEvidence: [acceptedFirst.evidence],
    };
    expect(() =>
      verifyModuleDeliveryEvidenceSubmission(staleAuthorization),
    ).toThrow('evidence authority is invalid');
  });

  test('carries attempt exhaustion across generations and propagates blocked closure', () => {
    const firstPlanRequest: GenerationPlanRequest = {
      sourceCommit: SOURCE,
      generation: 1,
      includeGamma: false,
    };
    const firstPlan = generationPlan(firstPlanRequest);
    const concurrencyUpdate: PlanConcurrencyUpdate = { maxConcurrency: 1 };
    Object.assign(firstPlan, concurrencyUpdate);
    const active = runtime(validate(firstPlan));
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const alphaLeaseRequest: LeaseRequest = {
        runtime: active,
        taskId: alpha.taskId,
      };
      const alphaLease = lease(alphaLeaseRequest);
      expect(alphaLease.attempt).toBe(attempt);
      const cancellationRequest: CancelledLeaseRequest = {
        runtime: active,
        lease: alphaLease,
      };
      recordModuleDeliveryAttemptDisposition(
        cancelledLease(cancellationRequest),
      );
    }
    const replacementPlanRequest: GenerationPlanRequest = {
      sourceCommit: REPLACEMENT_SOURCE,
      generation: 2,
      includeGamma: true,
    };
    const replacement = validate(generationPlan(replacementPlanRequest));
    const generationRestartRequest: GenerationRestartRequest = {
      runtime: active,
      acceptedPlan: replacement,
    };
    const state = restartModuleDeliveryGeneration(
      restartRequest(generationRestartRequest),
    );
    const restarted: Runtime = {
      accepted: replacement,
      authority: active.authority,
      state,
    };
    const selection = select(restarted);
    expect(selection.status).toBe(
      ModuleDeliveryAdmissionSelectionStatus.Selected,
    );
    expect(selection.blockedTaskIds).toEqual([alpha.taskId, consumer.taskId]);
    expect(
      selection.admissions.map(({ taskId, attempt }) => ({
        taskId,
        attempt,
      })),
    ).toEqual([
      { taskId: beta.taskId, attempt: 1 },
      { taskId: gamma.taskId, attempt: 1 },
    ]);
  });
});

afterAll(() => {
  disposeGitFixture(fixture);
  disposeGitFixture(foreignFixture);
});
