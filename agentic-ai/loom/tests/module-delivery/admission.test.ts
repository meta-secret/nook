import { describe, expect, test } from 'bun:test';

import {
  REQUIRED_PARENT_OWNED_RESOURCES,
  AgentAttemptParentKind,
  ModuleDeliveryAdmissionSelectionStatus,
  ModuleDeliveryAttemptDispositionKind,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryGenerationFenceKind,
  ModuleDeliveryJoinKind,
  ModuleDeliveryTaskKind,
  ModuleDeliveryValidationStatus,
  ModuleDeliveryWorkspaceKind,
  TeamKey,
  createModuleDeliveryAdmissionState,
  createModuleDeliveryGenerationAuthority,
  decodeAndValidateModuleDeliveryPlan,
  recordModuleDeliveryAttemptDisposition,
  recordModuleDeliveryAttemptLeases,
  restartModuleDeliveryGeneration,
  selectModuleDeliveryAdmissions,
} from '../../src/module-delivery/index.ts';

import type {
  AcceptedModuleDeliveryPlan,
  CreateModuleDeliveryAdmissionStateRequest,
  ModuleDeliveryAdmissionState,
  ModuleDeliveryAttemptLease,
  ModuleDeliveryEdgeContract,
  ModuleDeliveryGenerationAuthority,
  ModuleDeliveryLeaseRecording,
  ModuleDeliveryPlanV2,
  RecordModuleDeliveryAttemptDispositionRequest,
  RecordModuleDeliveryAttemptLeasesRequest,
  RestartModuleDeliveryGenerationRequest,
  SelectModuleDeliveryAdmissionsRequest,
  ModuleDeliveryWriteNodeV2,
} from '../../src/module-delivery/index.ts';

const SOURCE = '0123456789abcdef0123456789abcdef01234567';
const ROOT = 'nook-app/nook-platform/nook-core';
const SHARED = `${ROOT}/shared/**`;
const PARENT: readonly string[] = REQUIRED_PARENT_OWNED_RESOURCES;

type NodeInput = {
  readonly taskId: string;
  readonly dependencies: readonly string[];
  readonly read: readonly string[];
  readonly write: readonly string[];
};
type NodeAtSourceInput = {
  readonly node: NodeInput;
  readonly sourceCommit: string;
};
type AdmissionRuntime = {
  readonly accepted: AcceptedModuleDeliveryPlan;
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly state: ModuleDeliveryAdmissionState;
};
type LeasedAdmissionRuntime = {
  readonly context: AdmissionRuntime;
  readonly recording: ModuleDeliveryLeaseRecording;
  readonly lease: ModuleDeliveryAttemptLease;
};
type LeaseDispositionRequest = {
  readonly leased: LeasedAdmissionRuntime;
  readonly conclusion: ModuleDeliveryGenerationFenceKind;
};

function nodeAtSource(input: NodeAtSourceInput): ModuleDeliveryWriteNodeV2 {
  return {
    kind: ModuleDeliveryTaskKind.Write,
    taskId: input.node.taskId,
    team: TeamKey.DevelopmentCore,
    functionalOwner: TeamKey.Ai,
    acceptanceOwner: TeamKey.Ai,
    parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
    expert: 'core_expert',
    moduleRoot: ROOT,
    consumerOutcome: `${input.node.taskId} publishes its capability.`,
    baseline:
      input.node.dependencies.length === 0
        ? {
            kind: ModuleDeliveryBaselineKind.SourceCommit,
            sourceCommit: input.sourceCommit,
          }
        : {
            kind: ModuleDeliveryBaselineKind.IntegratedDependencies,
            providerTaskIds: input.node.dependencies,
          },
    agentDepthLimit: 2,
    dependencies: input.node.dependencies,
    resources: {
      read: input.node.read,
      write: input.node.write,
      evidenceSurface: [],
    },
    parentOwnedExclusions: PARENT,
    acceptance: {
      commands: [`task ${input.node.taskId}:test`],
      evidence: [`${input.node.taskId} passed`],
    },
    workspace: {
      kind: ModuleDeliveryWorkspaceKind.IsolatedWorktree,
      expectedCommitHandoff: true,
    },
  };
}

function node(input: NodeInput): ModuleDeliveryWriteNodeV2 {
  const request: NodeAtSourceInput = { node: input, sourceCommit: SOURCE };
  return nodeAtSource(request);
}

const alphaInput: NodeInput = {
  taskId: 'alpha',
  dependencies: [],
  read: [SHARED],
  write: [SHARED],
};
const betaInput: NodeInput = {
  taskId: 'beta',
  dependencies: [],
  read: [SHARED],
  write: [SHARED],
};
const consumerInput: NodeInput = {
  taskId: 'consumer',
  dependencies: ['alpha'],
  read: [SHARED],
  write: [`${ROOT}/consumer/**`],
};
const alpha = node(alphaInput);
const beta = node(betaInput);
const consumer = node(consumerInput);
const alphaConsumerEdge: ModuleDeliveryEdgeContract = {
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
const plan: ModuleDeliveryPlanV2 = {
  version: 2,
  generation: 1,
  sourceCommit: SOURCE,
  maxConcurrency: 2,
  maxAgentDepth: 3,
  maxAttempts: 2,
  parentOwnedResources: PARENT,
  parentJoin: {
    kind: ModuleDeliveryJoinKind.OrderedCommitHandoffs,
    owner: 'delivery-owner',
    validationCommands: ['task loom:verify'],
  },
  nodes: [consumer, beta, alpha],
  edgeContracts: [alphaConsumerEdge],
};

function validate(candidate: ModuleDeliveryPlanV2): AcceptedModuleDeliveryPlan {
  const result = decodeAndValidateModuleDeliveryPlan(JSON.stringify(candidate));
  if (result.status !== ModuleDeliveryValidationStatus.Accepted)
    throw new Error(JSON.stringify(result.issues));
  return result;
}

const FIRST = validate(plan);
const secondPlan: ModuleDeliveryPlanV2 = { ...plan, generation: 2 };
const SECOND = validate(secondPlan);

function context(): AdmissionRuntime {
  const authority = createModuleDeliveryGenerationAuthority(FIRST);
  const request: CreateModuleDeliveryAdmissionStateRequest = {
    authority,
    acceptedPlan: FIRST,
  };
  return {
    accepted: FIRST,
    authority,
    state: createModuleDeliveryAdmissionState(request),
  };
}

function selection(input: AdmissionRuntime) {
  const request: SelectModuleDeliveryAdmissionsRequest = {
    authority: input.authority,
    acceptedPlan: input.accepted,
    state: input.state,
  };
  return selectModuleDeliveryAdmissions(request);
}

function leased(input: AdmissionRuntime): LeasedAdmissionRuntime {
  const admission = selection(input).admissions.find(
    ({ taskId }) => taskId === alpha.taskId,
  );
  if (!admission) throw new Error('Alpha admission is missing.');
  const request: RecordModuleDeliveryAttemptLeasesRequest = {
    authority: input.authority,
    state: input.state,
    admissions: [admission],
  };
  const recording = recordModuleDeliveryAttemptLeases(request);
  const lease = recording.leases[0];
  if (!lease) throw new Error('Alpha lease is missing.');
  return { context: input, recording, lease };
}

function dispose(input: LeaseDispositionRequest): ModuleDeliveryAdmissionState {
  const request: RecordModuleDeliveryAttemptDispositionRequest = {
    authority: input.leased.context.authority,
    state: input.leased.recording.state,
    lease: input.leased.lease,
    outcome: {
      kind: ModuleDeliveryAttemptDispositionKind.FinalUnusable,
      conclusion: input.conclusion,
    },
  };
  return recordModuleDeliveryAttemptDisposition(request);
}

describe('module delivery admission', () => {
  test('deep-freezes admitted claims and isolates leases from later mutation', () => {
    const localPlan: ModuleDeliveryPlanV2 = { ...plan };
    const accepted = validate(localPlan);
    const authority = createModuleDeliveryGenerationAuthority(accepted);
    const stateRequest: CreateModuleDeliveryAdmissionStateRequest = {
      authority,
      acceptedPlan: accepted,
    };
    const active: AdmissionRuntime = {
      accepted,
      authority,
      state: createModuleDeliveryAdmissionState(stateRequest),
    };
    const admission = selection(active).admissions[0];
    if (!admission) throw new Error('Admission is missing.');
    const sourceNode = active.accepted.plan.nodes.find(
      ({ taskId }) => taskId === admission.taskId,
    );
    if (!sourceNode) throw new Error('Source node is missing.');
    const sourceReads = sourceNode.resources.read as string[];
    sourceReads.push(`${ROOT}/late-mutation/**`);
    expect(admission.resources.read).not.toContain(`${ROOT}/late-mutation/**`);
    expect(Object.isFrozen(admission.resources)).toBe(true);
    expect(Object.isFrozen(admission.resources.read)).toBe(true);
    expect(() =>
      (admission.resources.read as string[]).push(`${ROOT}/forged/**`),
    ).toThrow();
    const request: RecordModuleDeliveryAttemptLeasesRequest = {
      authority: active.authority,
      state: active.state,
      admissions: [admission],
    };
    const lease = recordModuleDeliveryAttemptLeases(request).leases[0];
    if (!lease) throw new Error('Lease is missing.');
    expect(lease.resources.read).not.toContain(`${ROOT}/late-mutation/**`);
    expect(Object.isFrozen(lease.resources.read)).toBe(true);
  });

  test('restarts only at a newer immutable generation and rejects fabricated fences', () => {
    const active = context();
    const recording = leased(active);
    const blocked: RestartModuleDeliveryGenerationRequest = {
      authority: active.authority,
      previousState: recording.recording.state,
      acceptedPlan: SECOND,
    };
    expect(() => restartModuleDeliveryGeneration(blocked)).toThrow(
      'terminal release evidence',
    );
    const fabricated: ModuleDeliveryAttemptLease = {
      ...recording.lease,
      attempt: recording.lease.attempt + 1,
    };
    const fence: RecordModuleDeliveryAttemptDispositionRequest = {
      authority: active.authority,
      state: recording.recording.state,
      lease: fabricated,
      outcome: {
        kind: ModuleDeliveryAttemptDispositionKind.FinalUnusable,
        conclusion: ModuleDeliveryGenerationFenceKind.Cancelled,
      },
    };
    expect(() => recordModuleDeliveryAttemptDisposition(fence)).toThrow(
      'lease capability',
    );
    const disposition: LeaseDispositionRequest = {
      leased: recording,
      conclusion: ModuleDeliveryGenerationFenceKind.Cancelled,
    };
    const terminalState = dispose(disposition);
    const restart: RestartModuleDeliveryGenerationRequest = {
      authority: active.authority,
      previousState: terminalState,
      acceptedPlan: SECOND,
    };
    expect(restartModuleDeliveryGeneration(restart).generation).toBe(2);
    const stale: SelectModuleDeliveryAdmissionsRequest = {
      authority: active.authority,
      acceptedPlan: active.accepted,
      state: active.state,
    };
    expect(() => selectModuleDeliveryAdmissions(stale)).toThrow('superseded');
  });

  for (const conclusion of [
    ModuleDeliveryGenerationFenceKind.Rejected,
    ModuleDeliveryGenerationFenceKind.Cancelled,
  ]) {
    test(`retries a ${conclusion} attempt and blocks only after maxAttempts`, () => {
      const active = context();
      const firstLease = leased(active);
      const firstDisposition: LeaseDispositionRequest = {
        leased: firstLease,
        conclusion,
      };
      const retryContext: AdmissionRuntime = {
        ...active,
        state: dispose(firstDisposition),
      };
      const retry = selection(retryContext);
      expect(retry.status).toBe(
        ModuleDeliveryAdmissionSelectionStatus.Selected,
      );
      expect(retry.blockedTaskIds).toEqual([]);
      expect(retry.admissions).toHaveLength(1);
      expect(retry.admissions[0]?.taskId).toBe(alpha.taskId);
      expect(retry.admissions[0]?.attempt).toBe(2);
      expect(retry.admissions[0]?.startingFrontier).toBe(SOURCE);

      const secondLease = leased(retryContext);
      const secondDisposition: LeaseDispositionRequest = {
        leased: secondLease,
        conclusion,
      };
      const exhaustedContext: AdmissionRuntime = {
        ...active,
        state: dispose(secondDisposition),
      };
      const exhausted = selection(exhaustedContext);
      expect(exhausted.status).toBe(
        ModuleDeliveryAdmissionSelectionStatus.Blocked,
      );
      expect(exhausted.admissions).toEqual([]);
      expect(exhausted.blockedTaskIds).toEqual(['alpha', 'beta', 'consumer']);
    });
  }
});
