import { afterEach, describe, expect, test } from 'bun:test';

import {
  REQUIRED_PARENT_OWNED_RESOURCES,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryJoinKind,
  ModuleDeliveryTaskKind,
  ModuleDeliveryValidationStatus,
  ModuleDeliveryWorkspaceKind,
  cleanupModuleIntegration,
  cleanupModuleWorktree,
  decodeAndValidateModuleDeliveryPlan,
  integrateVerifiedModuleDeliveryWave,
  prepareModuleIntegration,
  prepareModuleWorktree,
  verifyModuleCommitHandoff,
} from '../../src/module-delivery/index.ts';
import {
  createGitFixture,
  disposeGitFixture,
  fixtureGit,
  worktreeFileWriter,
  worktreeGit,
} from './worktree-test-support.ts';

import type {
  AcceptedModuleDeliveryPlan,
  CleanupModuleIntegrationRequest,
  CleanupModuleWorktreeRequest,
  IntegrateVerifiedModuleDeliveryWaveRequest,
  ModuleDeliveryBaseline,
  ModuleDeliveryEdgeContract,
  ModuleDeliveryHandoffSubmission,
  ModuleDeliveryPlan,
  ModuleIntegrationCleanupHandle,
  ModuleIntegrationState,
  ModuleWorktreeHandle,
  PrepareModuleIntegrationRequest,
  PrepareModuleWorktreeRequest,
  VerifyModuleCommitHandoffRequest,
  WriteModuleDeliveryNode,
} from '../../src/module-delivery/index.ts';
import type { GitFixture } from './worktree-test-support.ts';

const CORE_ROOT = 'nook-app/nook-platform/nook-core';
const WASM_MODULE_ROOT = 'nook-app/nook-platform/nook-wasm';
const WASM_ROOT = `${WASM_MODULE_ROOT}/nook-core-wasm`;
const WEB_ROOT = 'nook-app/nook-web/nook-web-shared';
const CORE_OUTPUT = `${CORE_ROOT}/src/module_delivery_pilot.rs`;
const WASM_OUTPUT = `${WASM_ROOT}/src/module_delivery_pilot.rs`;
const WEB_OUTPUT = `${WEB_ROOT}/src/module-delivery-pilot.ts`;
const CORE_CONTENT = 'pub struct PilotCoreCapability;\n';
const WASM_CONTENT = 'pub struct PilotWasmAdapter;\n';
const WEB_CONTENT = 'export const pilotWebConsumer = true;\n';
const PARENT_RESOURCES: readonly string[] = [
  ...REQUIRED_PARENT_OWNED_RESOURCES,
];

type PilotNodeInput = {
  readonly taskId: string;
  readonly expert: string;
  readonly moduleRoot: string;
  readonly sourceCommit: string;
  readonly dependencies: readonly string[];
  readonly readClaims: readonly string[];
  readonly writeClaim: string;
};

type PilotEdgeInput = {
  readonly providerTaskId: string;
  readonly consumerTaskId: string;
  readonly capability: string;
};

type WriterRequest = {
  readonly fixture: GitFixture;
  readonly acceptedPlan: AcceptedModuleDeliveryPlan;
  readonly node: WriteModuleDeliveryNode;
  readonly baselineCommit: string;
};

type WriterCommitRequest = {
  readonly workspace: ModuleWorktreeHandle;
  readonly outputPath: string;
  readonly contents: string;
  readonly message: string;
};

type IntegrateRequest = {
  readonly acceptedPlan: AcceptedModuleDeliveryPlan;
  readonly state: ModuleIntegrationState;
  readonly waveIndex: number;
  readonly workspace: ModuleWorktreeHandle;
  readonly node: WriteModuleDeliveryNode;
};

type SourceProof = {
  readonly head: string;
  readonly indexHash: string;
  readonly status: string;
  readonly refs: string;
};

type SourceCommitInput = {
  readonly sourceCommit: string;
};

type FixtureInput = {
  readonly fixture: GitFixture;
};

type PlanNodeInput = {
  readonly plan: AcceptedModuleDeliveryPlan;
  readonly taskId: string;
};

let fixture: GitFixture | undefined;
let integrationCleanup: ModuleIntegrationCleanupHandle | undefined;
const writerWorkspaces: ModuleWorktreeHandle[] = [];

function cleanupWriters(): void {
  for (const workspace of writerWorkspaces.splice(0).reverse()) {
    const request: CleanupModuleWorktreeRequest = { workspace };
    cleanupModuleWorktree(request);
  }
}

afterEach(() => {
  if (!fixture) return;
  try {
    cleanupWriters();
    if (integrationCleanup) {
      const request: CleanupModuleIntegrationRequest = {
        cleanupHandle: integrationCleanup,
      };
      cleanupModuleIntegration(request);
    }
  } finally {
    disposeGitFixture(fixture);
    fixture = undefined;
    integrationCleanup = undefined;
  }
});

function nodeBaseline(input: PilotNodeInput): ModuleDeliveryBaseline {
  return input.dependencies.length === 0
    ? {
        kind: ModuleDeliveryBaselineKind.SourceCommit,
        sourceCommit: input.sourceCommit,
      }
    : {
        kind: ModuleDeliveryBaselineKind.IntegratedDependencies,
        providerTaskIds: input.dependencies,
      };
}

function pilotNode(input: PilotNodeInput): WriteModuleDeliveryNode {
  return {
    kind: ModuleDeliveryTaskKind.Write,
    taskId: input.taskId,
    expert: input.expert,
    moduleRoot: input.moduleRoot,
    consumerOutcome: `${input.taskId} publishes its layer contract.`,
    baseline: nodeBaseline(input),
    agentDepthLimit: 1,
    dependencies: input.dependencies,
    resources: { read: input.readClaims, write: [input.writeClaim] },
    parentOwnedExclusions: PARENT_RESOURCES,
    acceptance: {
      commands: [`task ${input.taskId}:test`],
      evidence: [`${input.taskId} contract is verified`],
    },
    workspace: {
      kind: ModuleDeliveryWorkspaceKind.IsolatedWorktree,
      expectedCommitHandoff: true,
    },
  };
}

function pilotEdge(input: PilotEdgeInput): ModuleDeliveryEdgeContract {
  return {
    providerTaskId: input.providerTaskId,
    consumerTaskId: input.consumerTaskId,
    capability: input.capability,
    publicTypes: [`${input.capability}Request`],
    errors: [`${input.capability}Error`],
    behaviorInvariants: ['The consumer observes the integrated provider tree.'],
    securityInvariants: ['Protected state remains provider-owned.'],
    compatibilityExpectations: ['The provider contract remains additive.'],
    owningTests: [`${input.providerTaskId} contract test`],
  };
}

function acceptedPilotPlan(
  input: SourceCommitInput,
): AcceptedModuleDeliveryPlan {
  const coreInput: PilotNodeInput = {
    taskId: 'core-provider',
    expert: 'core_expert',
    moduleRoot: CORE_ROOT,
    sourceCommit: input.sourceCommit,
    dependencies: [],
    readClaims: [`${CORE_ROOT}/**`],
    writeClaim: CORE_OUTPUT,
  };
  const wasmInput: PilotNodeInput = {
    taskId: 'wasm-adapter',
    expert: 'internal_api_expert',
    moduleRoot: WASM_MODULE_ROOT,
    sourceCommit: input.sourceCommit,
    dependencies: ['core-provider'],
    readClaims: [`${CORE_ROOT}/**`, `${WASM_ROOT}/**`],
    writeClaim: WASM_OUTPUT,
  };
  const webInput: PilotNodeInput = {
    taskId: 'web-consumer',
    expert: 'web_expert',
    moduleRoot: WEB_ROOT,
    sourceCommit: input.sourceCommit,
    dependencies: ['wasm-adapter'],
    readClaims: [`${CORE_ROOT}/**`, `${WASM_ROOT}/**`, `${WEB_ROOT}/**`],
    writeClaim: WEB_OUTPUT,
  };
  const coreWasmEdge: PilotEdgeInput = {
    providerTaskId: 'core-provider',
    consumerTaskId: 'wasm-adapter',
    capability: 'CoreCapability',
  };
  const wasmWebEdge: PilotEdgeInput = {
    providerTaskId: 'wasm-adapter',
    consumerTaskId: 'web-consumer',
    capability: 'WasmAdapter',
  };
  const plan: ModuleDeliveryPlan = {
    version: 1,
    sourceCommit: input.sourceCommit,
    maxConcurrency: 1,
    maxAgentDepth: 1,
    maxAttempts: 1,
    parentOwnedResources: PARENT_RESOURCES,
    parentJoin: {
      kind: ModuleDeliveryJoinKind.OrderedCommitHandoffs,
      owner: 'delivery-owner',
      validationCommands: ['task module-delivery:pilot'],
    },
    nodes: [pilotNode(webInput), pilotNode(coreInput), pilotNode(wasmInput)],
    edgeContracts: [pilotEdge(wasmWebEdge), pilotEdge(coreWasmEdge)],
  };
  const validation = decodeAndValidateModuleDeliveryPlan(JSON.stringify(plan));
  if (validation.status !== ModuleDeliveryValidationStatus.Accepted) {
    throw new Error(JSON.stringify(validation.issues));
  }
  return validation;
}

function prepareWriter(request: WriterRequest): ModuleWorktreeHandle {
  const preparation: PrepareModuleWorktreeRequest = {
    repositoryRoot: request.fixture.sourceRoot,
    workspaceRoot: request.fixture.workspaceRoot,
    planDigest: request.acceptedPlan.planDigest,
    taskId: request.node.taskId,
    attempt: 1,
    baselineCommit: request.baselineCommit,
  };
  const workspace = prepareModuleWorktree(preparation);
  writerWorkspaces.push(workspace);
  return workspace;
}

function commitWriter(request: WriterCommitRequest): string {
  const write = worktreeFileWriter(request.workspace);
  write([request.outputPath, request.contents]);
  const git = worktreeGit(request.workspace);
  git(['add', '--', request.outputPath]);
  git(['commit', '--quiet', '--no-gpg-sign', '-m', request.message]);
  return git(['rev-parse', 'HEAD']);
}

function integrateWriter(request: IntegrateRequest): ModuleIntegrationState {
  const handoffRequest: VerifyModuleCommitHandoffRequest = {
    workspace: request.workspace,
    baselineCommit: request.state.headCommit,
    allowedWriteClaims: request.node.resources.write,
  };
  const verified = verifyModuleCommitHandoff(handoffRequest);
  const submission: ModuleDeliveryHandoffSubmission = {
    taskId: request.node.taskId,
    attempt: verified.attempt,
    planDigest: verified.planDigest,
    baselineCommit: verified.baselineCommit,
    commit: verified.commit,
    workspace: request.workspace,
  };
  const integrationRequest: IntegrateVerifiedModuleDeliveryWaveRequest = {
    acceptedPlan: request.acceptedPlan,
    state: request.state,
    waveIndex: request.waveIndex,
    handoffs: [submission],
  };
  return integrateVerifiedModuleDeliveryWave(integrationRequest);
}

function sourceProof(input: FixtureInput): SourceProof {
  const git = fixtureGit(input.fixture);
  return {
    head: git(['rev-parse', 'HEAD']),
    indexHash: git(['hash-object', '.git/index']),
    status: git(['status', '--porcelain=v1', '-z']),
    refs: git([
      'for-each-ref',
      '--sort=refname',
      '--format=%(refname)%00%(objectname)%00%(symref)',
    ]),
  };
}

function nonIntegrationRefs(input: FixtureInput): string {
  return fixtureGit(input.fixture)([
    'for-each-ref',
    '--sort=refname',
    '--format=%(refname)%00%(objectname)%00%(symref)',
    '--exclude=refs/nook/module-delivery/**',
  ]);
}

function planNode(input: PlanNodeInput): WriteModuleDeliveryNode {
  const node = input.plan.plan.nodes.find(
    (candidate) => candidate.taskId === input.taskId,
  );
  if (!node || node.kind !== ModuleDeliveryTaskKind.Write) {
    throw new Error(`Missing pilot writer ${input.taskId}.`);
  }
  return node;
}

describe('core to WASM to web module delivery pilot', () => {
  test('hands each integrated commit to the next registered layer', () => {
    const activeFixture = createGitFixture();
    fixture = activeFixture;
    const fixtureInput: FixtureInput = { fixture: activeFixture };
    const before = sourceProof(fixtureInput);
    const sourceInput: SourceCommitInput = {
      sourceCommit: activeFixture.baselineCommit,
    };
    const acceptedPlan = acceptedPilotPlan(sourceInput);
    expect(acceptedPlan.topologicalOrder).toEqual([
      'core-provider',
      'wasm-adapter',
      'web-consumer',
    ]);
    expect(acceptedPlan.waves).toEqual([
      ['core-provider'],
      ['wasm-adapter'],
      ['web-consumer'],
    ]);

    const preparation: PrepareModuleIntegrationRequest = {
      repositoryRoot: activeFixture.sourceRoot,
      workspaceRoot: activeFixture.workspaceRoot,
      acceptedPlan,
    };
    const initialState = prepareModuleIntegration(preparation);
    integrationCleanup = initialState.cleanupHandle;

    const coreNodeInput: PlanNodeInput = {
      plan: acceptedPlan,
      taskId: 'core-provider',
    };
    const coreNode = planNode(coreNodeInput);
    const corePreparation: WriterRequest = {
      fixture: activeFixture,
      acceptedPlan,
      node: coreNode,
      baselineCommit: initialState.headCommit,
    };
    const coreWorkspace = prepareWriter(corePreparation);
    const coreCommit: WriterCommitRequest = {
      workspace: coreWorkspace,
      outputPath: CORE_OUTPUT,
      contents: CORE_CONTENT,
      message: 'pilot core capability',
    };
    commitWriter(coreCommit);
    const coreIntegration: IntegrateRequest = {
      acceptedPlan,
      state: initialState,
      waveIndex: 0,
      workspace: coreWorkspace,
      node: coreNode,
    };
    const coreState = integrateWriter(coreIntegration);

    const wasmNodeInput: PlanNodeInput = {
      plan: acceptedPlan,
      taskId: 'wasm-adapter',
    };
    const wasmNode = planNode(wasmNodeInput);
    const wasmPreparation: WriterRequest = {
      fixture: activeFixture,
      acceptedPlan,
      node: wasmNode,
      baselineCommit: coreState.headCommit,
    };
    const wasmWorkspace = prepareWriter(wasmPreparation);
    const wasmGit = worktreeGit(wasmWorkspace);
    expect(wasmGit(['rev-parse', 'HEAD'])).toBe(coreState.headCommit);
    expect(wasmGit(['show', `HEAD:${CORE_OUTPUT}`])).toBe(CORE_CONTENT.trim());
    const wasmCommit: WriterCommitRequest = {
      workspace: wasmWorkspace,
      outputPath: WASM_OUTPUT,
      contents: WASM_CONTENT,
      message: 'pilot WASM adapter',
    };
    commitWriter(wasmCommit);
    const wasmIntegration: IntegrateRequest = {
      acceptedPlan,
      state: coreState,
      waveIndex: 1,
      workspace: wasmWorkspace,
      node: wasmNode,
    };
    const wasmState = integrateWriter(wasmIntegration);

    const webNodeInput: PlanNodeInput = {
      plan: acceptedPlan,
      taskId: 'web-consumer',
    };
    const webNode = planNode(webNodeInput);
    const webPreparation: WriterRequest = {
      fixture: activeFixture,
      acceptedPlan,
      node: webNode,
      baselineCommit: wasmState.headCommit,
    };
    const webWorkspace = prepareWriter(webPreparation);
    const webGit = worktreeGit(webWorkspace);
    expect(webGit(['rev-parse', 'HEAD'])).toBe(wasmState.headCommit);
    expect(webGit(['show', `HEAD:${CORE_OUTPUT}`])).toBe(CORE_CONTENT.trim());
    expect(webGit(['show', `HEAD:${WASM_OUTPUT}`])).toBe(WASM_CONTENT.trim());
    const webCommit: WriterCommitRequest = {
      workspace: webWorkspace,
      outputPath: WEB_OUTPUT,
      contents: WEB_CONTENT,
      message: 'pilot web consumer',
    };
    commitWriter(webCommit);
    const webIntegration: IntegrateRequest = {
      acceptedPlan,
      state: wasmState,
      waveIndex: 2,
      workspace: webWorkspace,
      node: webNode,
    };
    const finalState = integrateWriter(webIntegration);

    const sourceGit = fixtureGit(activeFixture);
    expect(sourceGit(['show', `${finalState.headCommit}:${CORE_OUTPUT}`])).toBe(
      CORE_CONTENT.trim(),
    );
    expect(sourceGit(['show', `${finalState.headCommit}:${WASM_OUTPUT}`])).toBe(
      WASM_CONTENT.trim(),
    );
    expect(sourceGit(['show', `${finalState.headCommit}:${WEB_OUTPUT}`])).toBe(
      WEB_CONTENT.trim(),
    );
    const ancestry = sourceGit([
      'rev-list',
      '--first-parent',
      '--reverse',
      `${activeFixture.baselineCommit}..${finalState.headCommit}`,
    ]).split('\n');
    expect(ancestry).toEqual([
      coreState.headCommit,
      wasmState.headCommit,
      finalState.headCommit,
    ]);
    expect(
      sourceGit([
        'for-each-ref',
        '--format=%(objectname)',
        'refs/nook/module-delivery/',
      ]),
    ).toBe(finalState.headCommit);
    expect(sourceGit(['rev-parse', 'HEAD'])).toBe(before.head);
    expect(sourceGit(['hash-object', '.git/index'])).toBe(before.indexHash);
    expect(sourceGit(['status', '--porcelain=v1', '-z'])).toBe(before.status);
    expect(nonIntegrationRefs(fixtureInput)).toBe(before.refs);

    cleanupWriters();
    const cleanupRequest: CleanupModuleIntegrationRequest = {
      cleanupHandle: initialState.cleanupHandle,
    };
    expect(cleanupModuleIntegration(cleanupRequest).removed).toBe(true);
    integrationCleanup = undefined;
    expect(sourceProof(fixtureInput)).toEqual(before);
    expect(sourceGit(['worktree', 'list', '--porcelain'])).not.toContain(
      activeFixture.workspaceRoot,
    );
  });
});
