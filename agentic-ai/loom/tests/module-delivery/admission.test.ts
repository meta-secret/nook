import { describe, expect, test } from 'bun:test';
import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';
import { TeamKey } from '../../src/team-agents/catalog.ts';
import { moduleDeliveryAuthorityPlan } from '../../src/module-delivery/admission.ts';

import {
  REQUIRED_PARENT_OWNED_RESOURCES,
  ModuleDeliveryAttemptDispositionKind,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryGenerationFenceKind,
  ModuleDeliveryJoinKind,
  ModuleDeliveryTaskKind,
  ModuleDeliveryValidationStatus,
  ModuleDeliveryWorkspaceKind,
  createModuleDeliveryAdmissionState,
  createModuleDeliveryGenerationAuthority,
  decodeAndValidateModuleDeliveryPlan,
  recordModuleDeliveryAttemptDisposition,
  recordModuleDeliveryAttemptLeases,
  restartModuleDeliveryGeneration,
  selectModuleDeliveryAdmissions,
} from '../../src/module-delivery/index.ts';

import type {
  CreateModuleDeliveryAdmissionStateRequest,
  CreateModuleDeliveryGenerationAuthorityRequest,
  ModuleDeliveryAdmissionState,
  ModuleDeliveryAttemptLease,
  ModuleDeliveryEdgeContract,
  ModuleDeliveryExpectedLineage,
  ModuleDeliveryGenerationAuthority,
  ModuleDeliveryPlanV2,
  ModuleDeliveryWriteNodeV2,
  RecordModuleDeliveryAttemptDispositionRequest,
  RecordModuleDeliveryAttemptLeasesRequest,
  RestartModuleDeliveryGenerationRequest,
  SelectModuleDeliveryAdmissionsRequest,
  ValidatedModuleDeliveryPlan,
} from '../../src/module-delivery/index.ts';

const SOURCE = '0123456789abcdef0123456789abcdef01234567';
const INTEGRATED = '89abcdef0123456789abcdef0123456789abcdef';
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

type RuntimeCreationRequest = {
  readonly plan: ValidatedModuleDeliveryPlan;
};

type LeaseRequest = {
  readonly runtime: Runtime;
  readonly taskId: string;
};

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
const consumerRequest: WriteNodeRequest = {
  taskId: 'consumer',
  dependencies: ['alpha'],
  path: 'consumer',
};
const alpha = writeNode(alphaRequest);
const beta = writeNode(betaRequest);
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
  nodes: [consumer, beta, alpha],
  edgeContracts: [edge],
};

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

function runtime(request: RuntimeCreationRequest): Runtime {
  const { plan } = request;
  const authorityRequest: CreateModuleDeliveryGenerationAuthorityRequest = {
    acceptedPlan: plan,
    expectedLineage: lineage(plan),
  };
  const authority = createModuleDeliveryGenerationAuthority(authorityRequest);
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

function defaultRuntime(): Runtime {
  const request: RuntimeCreationRequest = { plan: validate(PLAN) };
  return runtime(request);
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

describe('module delivery admission authority', () => {
  test('selects the maximal safe set and rejects unproven writer frontiers', () => {
    const active = defaultRuntime();
    const first = select(active);
    expect(first.admissions.map(({ taskId }) => taskId)).toEqual([
      'alpha',
      'beta',
    ]);
    expect(
      first.admissions.every(({ resources }) =>
        Object.isFrozen(resources.read),
      ),
    ).toBe(true);
    const forgedFrontier = {
      taskId: 'alpha',
      attempt: 1,
      generation: 1,
      planDigest: active.accepted.planDigest,
      headCommit: INTEGRATED,
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
      headCommit: INTEGRATED,
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
    const activeRuntimeRequest: RuntimeCreationRequest = { plan: accepted };
    const active = runtime(activeRuntimeRequest);
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
    const forgedAuthorityRequest: CreateModuleDeliveryGenerationAuthorityRequest =
      {
        acceptedPlan: forged,
        expectedLineage: lineage(forged),
      };
    expect(() =>
      createModuleDeliveryGenerationAuthority(forgedAuthorityRequest),
    ).toThrow('metadata is inconsistent');

    const wrongLineage: readonly ModuleDeliveryExpectedLineage[] = lineage(
      validate(PLAN),
    ).map((entry) =>
      entry.taskId === 'alpha'
        ? {
            taskId: entry.taskId,
            parentLineage: {
              kind: AgentAttemptParentKind.AgentAttempt,
              task: 'forged-task',
              agent: 'forged-agent',
              attempt: 2,
            },
          }
        : entry,
    );
    const wrongLineageAuthorityRequest: CreateModuleDeliveryGenerationAuthorityRequest =
      {
        acceptedPlan: validate(PLAN),
        expectedLineage: wrongLineage,
      };
    expect(() =>
      createModuleDeliveryGenerationAuthority(wrongLineageAuthorityRequest),
    ).toThrow('Expected lineage is invalid');
  });

  test('rejects forged states, admissions, leases, attempts, and duplicates', () => {
    const active = defaultRuntime();
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
    const duplicateLeaseRequest: RecordModuleDeliveryAttemptLeasesRequest = {
      authority: active.authority,
      state: active.state,
      admissions: [admission, admission],
    };
    expect(() =>
      recordModuleDeliveryAttemptLeases(duplicateLeaseRequest),
    ).toThrow('capability is invalid');
    const forgedAdmission = { ...admission, taskId: 'beta', attempt: 4 };
    const forgedLeaseRequest: RecordModuleDeliveryAttemptLeasesRequest = {
      authority: active.authority,
      state: active.state,
      admissions: [forgedAdmission],
    };
    expect(() => recordModuleDeliveryAttemptLeases(forgedLeaseRequest)).toThrow(
      'capability is invalid',
    );
  });

  test('retains lease history through disposition and restarts without stale generation state', () => {
    const active = defaultRuntime();
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
    expect(retry?.attempt).toBe(2);
    expect(retry?.startingFrontier).toBe(firstLease.startingFrontier);

    const secondPlan: ModuleDeliveryPlanV2 = { ...PLAN, generation: 2 };
    const second = validate(secondPlan);
    const forgedSecond: ValidatedModuleDeliveryPlan = { ...second, waves: [] };
    const invalidRestartRequest: RestartModuleDeliveryGenerationRequest = {
      authority: active.authority,
      previousState: dispositionState,
      acceptedPlan: forgedSecond,
      expectedLineage: lineage(second),
    };
    expect(() =>
      restartModuleDeliveryGeneration(invalidRestartRequest),
    ).toThrow('metadata is inconsistent');
    expect(select(retryRuntime).admissions.length).toBeGreaterThan(0);
    const restartRequest: RestartModuleDeliveryGenerationRequest = {
      authority: active.authority,
      previousState: dispositionState,
      acceptedPlan: second,
      expectedLineage: lineage(second),
    };
    const restarted = restartModuleDeliveryGeneration(restartRequest);
    expect(restarted.generation).toBe(2);
    expect(restarted.integratedWriterFrontiers).toEqual([]);
    expect(restarted.acceptedProviderEvidence).toEqual([]);
    const restartedRuntime: Runtime = {
      ...active,
      accepted: second,
      state: restarted,
    };
    expect(select(restartedRuntime).admissions[0]?.attempt).toBe(2);
    expect(() => select(active)).toThrow('superseded');
  });
});
