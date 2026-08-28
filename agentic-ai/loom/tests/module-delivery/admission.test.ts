/* eslint-disable max-params, loom/no-raw-object-arguments */
import { describe, expect, test } from 'bun:test';
import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';
import { TeamKey } from '../../src/team-agents/catalog.ts';

import {
  REQUIRED_PARENT_OWNED_RESOURCES,
  ModuleDeliveryAdmissionSelectionStatus,
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
  ModuleDeliveryAdmissionState,
  ModuleDeliveryAttemptLease,
  ModuleDeliveryEdgeContract,
  ModuleDeliveryExpectedLineage,
  ModuleDeliveryGenerationAuthority,
  ModuleDeliveryPlanV2,
  ModuleDeliveryWriteNodeV2,
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

function writeNode(
  taskId: string,
  dependencies: readonly string[],
  path: string,
): ModuleDeliveryWriteNodeV2 {
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

const alpha = writeNode('alpha', [], 'alpha');
const beta = writeNode('beta', [], 'beta');
const consumer = writeNode('consumer', ['alpha'], 'consumer');
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

function runtime(plan = validate(PLAN)): Runtime {
  const authority = createModuleDeliveryGenerationAuthority({
    acceptedPlan: plan,
    expectedLineage: lineage(plan),
  });
  const state = createModuleDeliveryAdmissionState({
    authority,
    acceptedPlan: plan,
    headCommit: SOURCE,
    integratedWriterFrontiers: [],
    acceptedEvidence: [],
  });
  return { accepted: plan, authority, state };
}

function select(active: Runtime) {
  return selectModuleDeliveryAdmissions({
    authority: active.authority,
    acceptedPlan: active.accepted,
    state: active.state,
  });
}

function lease(active: Runtime, taskId = 'alpha'): ModuleDeliveryAttemptLease {
  const admission = select(active).admissions.find(
    (entry) => entry.taskId === taskId,
  );
  if (!admission) throw new Error(`Admission ${taskId} is missing.`);
  const recording = recordModuleDeliveryAttemptLeases({
    authority: active.authority,
    state: active.state,
    admissions: [admission],
  });
  const leased = recording.leases[0];
  if (!leased) throw new Error(`Lease ${taskId} is missing.`);
  return leased;
}

describe('module delivery admission authority', () => {
  test('selects the deterministic maximal safe set and requires exact integrated frontiers', () => {
    const active = runtime();
    const first = select(active);
    expect(first.status).toBe(ModuleDeliveryAdmissionSelectionStatus.Selected);
    expect(first.admissions.map(({ taskId }) => taskId)).toEqual([
      'alpha',
      'beta',
    ]);
    expect(
      first.admissions.every(
        ({ startingFrontier }) => startingFrontier === SOURCE,
      ),
    ).toBe(true);
    expect(first.admissions.every(Object.isFrozen)).toBe(true);
    expect(
      first.admissions.every(({ resources }) =>
        Object.isFrozen(resources.read),
      ),
    ).toBe(true);
    const alphaAdmission = first.admissions.find(
      ({ taskId }) => taskId === 'alpha',
    );
    if (!alphaAdmission) throw new Error('Alpha admission is missing.');
    const alphaLease = recordModuleDeliveryAttemptLeases({
      authority: active.authority,
      state: active.state,
      admissions: [alphaAdmission],
    }).leases[0];
    if (!alphaLease) throw new Error('Alpha lease is missing.');

    const advancedState = createModuleDeliveryAdmissionState({
      authority: active.authority,
      acceptedPlan: active.accepted,
      headCommit: INTEGRATED,
      integratedWriterFrontiers: [{ taskId: 'alpha', headCommit: INTEGRATED }],
      acceptedEvidence: [],
    });
    expect(() => select(active)).toThrow('stale');
    recordModuleDeliveryAttemptDisposition({
      authority: active.authority,
      state: advancedState,
      lease: alphaLease,
      outcome: {
        kind: ModuleDeliveryAttemptDispositionKind.Accepted,
        conclusion: ModuleDeliveryGenerationFenceKind.Accepted,
      },
    });
    const advanced = select({ ...active, state: advancedState });
    expect(
      advanced.admissions.find(({ taskId }) => taskId === 'consumer')
        ?.startingFrontier,
    ).toBe(INTEGRATED);
    expect(() =>
      createModuleDeliveryAdmissionState({
        authority: active.authority,
        acceptedPlan: active.accepted,
        headCommit: 'f'.repeat(40),
        integratedWriterFrontiers: [
          { taskId: 'alpha', headCommit: INTEGRATED },
        ],
        acceptedEvidence: [],
      }),
    ).toThrow('exact integrated writer frontier');
  });

  test('snapshots validated metadata and rejects forged plans and lineage', () => {
    const accepted = validate(PLAN);
    const active = runtime(accepted);
    const sourceNode = accepted.plan.nodes.find(
      ({ taskId }) => taskId === 'alpha',
    );
    if (!sourceNode) throw new Error('Alpha node is missing.');
    (sourceNode.resources.read as string[]).push(`${ROOT}/forged/**`);
    const admission = select(active).admissions.find(
      ({ taskId }) => taskId === 'alpha',
    );
    expect(admission?.resources.read).not.toContain(`${ROOT}/forged/**`);

    const forged: ValidatedModuleDeliveryPlan = {
      ...validate(PLAN),
      topologicalOrder: ['consumer', 'alpha', 'beta'],
    };
    expect(() =>
      createModuleDeliveryGenerationAuthority({
        acceptedPlan: forged,
        expectedLineage: lineage(forged),
      }),
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
    expect(() =>
      createModuleDeliveryGenerationAuthority({
        acceptedPlan: validate(PLAN),
        expectedLineage: wrongLineage,
      }),
    ).toThrow('Expected lineage is invalid');
  });

  test('rejects forged states, admissions, leases, attempts, and duplicates', () => {
    const active = runtime();
    const admission = select(active).admissions[0];
    if (!admission) throw new Error('Admission is missing.');
    const forgedState: ModuleDeliveryAdmissionState = { ...active.state };
    expect(() =>
      selectModuleDeliveryAdmissions({
        authority: active.authority,
        acceptedPlan: active.accepted,
        state: forgedState,
      }),
    ).toThrow('authority is invalid');
    expect(() =>
      recordModuleDeliveryAttemptLeases({
        authority: active.authority,
        state: active.state,
        admissions: [admission, admission],
      }),
    ).toThrow('capability is invalid');
    const forgedAdmission = { ...admission, taskId: 'beta', attempt: 4 };
    expect(() =>
      recordModuleDeliveryAttemptLeases({
        authority: active.authority,
        state: active.state,
        admissions: [forgedAdmission],
      }),
    ).toThrow('capability is invalid');
  });

  test('retains lease history through disposition and restarts without stale generation state', () => {
    const active = runtime();
    const firstLease = lease(active);
    const dispositionState = recordModuleDeliveryAttemptDisposition({
      authority: active.authority,
      state: active.state,
      lease: firstLease,
      outcome: {
        kind: ModuleDeliveryAttemptDispositionKind.FinalUnusable,
        conclusion: ModuleDeliveryGenerationFenceKind.Cancelled,
      },
    });
    const retry = select({
      ...active,
      state: dispositionState,
    }).admissions.find(({ taskId }) => taskId === 'alpha');
    expect(retry?.attempt).toBe(2);
    expect(() =>
      recordModuleDeliveryAttemptDisposition({
        authority: active.authority,
        state: active.state,
        lease: { ...firstLease, attempt: 2 },
        outcome: {
          kind: ModuleDeliveryAttemptDispositionKind.FinalUnusable,
          conclusion: ModuleDeliveryGenerationFenceKind.Rejected,
        },
      }),
    ).toThrow('lease authority is invalid');

    const secondPlan: ModuleDeliveryPlanV2 = { ...PLAN, generation: 2 };
    const second = validate(secondPlan);
    const restarted = restartModuleDeliveryGeneration({
      authority: active.authority,
      previousState: dispositionState,
      acceptedPlan: second,
      expectedLineage: lineage(second),
    });
    expect(restarted.generation).toBe(2);
    expect(restarted.integratedWriterFrontiers).toEqual([]);
    expect(restarted.acceptedProviderEvidence).toEqual([]);
    expect(() => select(active)).toThrow('superseded');
  });
});
