import { describe, expect, test } from 'bun:test';
import {
  REQUIRED_PARENT_OWNED_RESOURCES,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryIssueCode,
  ModuleDeliveryJoinKind,
  ModuleDeliveryTaskKind,
  ModuleDeliveryValidationStatus,
  ModuleDeliveryWorkspaceKind,
  decodeAndValidateModuleDeliveryPlan,
} from '../../src/module-delivery/index.ts';
import type {
  ModuleDeliveryEdgeContract,
  ModuleDeliveryBaseline,
  ModuleDeliveryNode,
  ModuleDeliveryPlan,
  ModuleDeliveryPlanValidation,
  ReadOnlyModuleDeliveryNode,
  WriteModuleDeliveryNode,
} from '../../src/module-delivery/index.ts';

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const PARENT_OWNED_RESOURCES: readonly string[] = [
  ...REQUIRED_PARENT_OWNED_RESOURCES,
];

type WriteNodeFixture = {
  readonly taskId: string;
  readonly expert: string;
  readonly moduleRoot: string;
  readonly dependencies: readonly string[];
  readonly read: readonly string[];
  readonly write: readonly string[];
};

type ReadOnlyNodeFixture = {
  readonly taskId: string;
  readonly expert: string;
  readonly moduleRoot: string;
  readonly dependencies: readonly string[];
};

type EdgeFixture = {
  readonly providerTaskId: string;
  readonly consumerTaskId: string;
};

type PlanFixture = {
  readonly nodes: readonly ModuleDeliveryNode[];
  readonly edgeContracts: readonly ModuleDeliveryEdgeContract[];
};

type NodeFailureFixture = {
  readonly node: WriteModuleDeliveryNode;
  readonly code: ModuleDeliveryIssueCode;
};

function writeNode(fixture: WriteNodeFixture): WriteModuleDeliveryNode {
  const baseline: ModuleDeliveryBaseline =
    fixture.dependencies.length === 0
      ? {
          kind: ModuleDeliveryBaselineKind.SourceCommit,
          sourceCommit: SOURCE_COMMIT,
        }
      : {
          kind: ModuleDeliveryBaselineKind.IntegratedDependencies,
          providerTaskIds: fixture.dependencies,
        };
  return {
    kind: ModuleDeliveryTaskKind.Write,
    taskId: fixture.taskId,
    expert: fixture.expert,
    moduleRoot: fixture.moduleRoot,
    consumerOutcome: `${fixture.taskId} publishes its accepted capability.`,
    baseline,
    agentDepthLimit: 2,
    dependencies: fixture.dependencies,
    resources: { read: fixture.read, write: fixture.write },
    parentOwnedExclusions: PARENT_OWNED_RESOURCES,
    acceptance: {
      commands: [`task ${fixture.taskId}:test`],
      evidence: [`${fixture.taskId} behavior passes`],
    },
    workspace: {
      kind: ModuleDeliveryWorkspaceKind.IsolatedWorktree,
      expectedCommitHandoff: true,
    },
  };
}

function readOnlyNode(
  fixture: ReadOnlyNodeFixture,
): ReadOnlyModuleDeliveryNode {
  const baseline: ModuleDeliveryBaseline =
    fixture.dependencies.length === 0
      ? {
          kind: ModuleDeliveryBaselineKind.SourceCommit,
          sourceCommit: SOURCE_COMMIT,
        }
      : {
          kind: ModuleDeliveryBaselineKind.IntegratedDependencies,
          providerTaskIds: fixture.dependencies,
        };
  return {
    kind: ModuleDeliveryTaskKind.ReadOnly,
    taskId: fixture.taskId,
    expert: fixture.expert,
    moduleRoot: fixture.moduleRoot,
    consumerOutcome: `${fixture.taskId} reports reviewed evidence.`,
    baseline,
    agentDepthLimit: 2,
    dependencies: fixture.dependencies,
    resources: { read: [`${fixture.moduleRoot}/**`], write: [] },
    parentOwnedExclusions: PARENT_OWNED_RESOURCES,
    acceptance: {
      commands: [`task ${fixture.taskId}:audit`],
      evidence: [`${fixture.taskId} review is complete`],
    },
  };
}

function edgeContract(fixture: EdgeFixture): ModuleDeliveryEdgeContract {
  return {
    providerTaskId: fixture.providerTaskId,
    consumerTaskId: fixture.consumerTaskId,
    capability: `${fixture.providerTaskId} capability`,
    publicTypes: [`${fixture.providerTaskId}Request`],
    errors: [`${fixture.providerTaskId}Error`],
    behaviorInvariants: ['Behavior is deterministic.'],
    securityInvariants: ['Protected material remains provider-owned.'],
    compatibilityExpectations: ['Existing consumers remain compatible.'],
    owningTests: [`${fixture.providerTaskId} contract test`],
  };
}

function plan(fixture: PlanFixture): ModuleDeliveryPlan {
  return {
    version: 1,
    sourceCommit: SOURCE_COMMIT,
    maxConcurrency: 3,
    maxAgentDepth: 3,
    maxAttempts: 2,
    parentOwnedResources: PARENT_OWNED_RESOURCES,
    parentJoin: {
      kind: ModuleDeliveryJoinKind.OrderedCommitHandoffs,
      owner: 'delivery-owner',
      validationCommands: ['task loom:verify'],
    },
    nodes: fixture.nodes,
    edgeContracts: fixture.edgeContracts,
  };
}

function validate(value: ModuleDeliveryPlan): ModuleDeliveryPlanValidation {
  return decodeAndValidateModuleDeliveryPlan(JSON.stringify(value));
}

function codes(
  result: ModuleDeliveryPlanValidation,
): readonly ModuleDeliveryIssueCode[] {
  if (result.status === ModuleDeliveryValidationStatus.Accepted) return [];
  return result.issues.map((entry) => entry.code);
}

const CORE_ROOT = 'nook-app/nook-platform/nook-core';
const WASM_ROOT = 'nook-app/nook-platform/nook-wasm';
const WEB_ROOT = 'nook-app/nook-web/nook-web-app';

const CORE_FIXTURE: WriteNodeFixture = {
  taskId: 'core-provider',
  expert: 'core_expert',
  moduleRoot: CORE_ROOT,
  dependencies: [],
  read: [`${CORE_ROOT}/**`],
  write: [`${CORE_ROOT}/**`],
};
const CORE_NODE = writeNode(CORE_FIXTURE);
const WASM_FIXTURE: WriteNodeFixture = {
  taskId: 'wasm-adapter',
  expert: 'internal_api_expert',
  moduleRoot: WASM_ROOT,
  dependencies: ['core-provider'],
  read: [`${CORE_ROOT}/**`],
  write: [`${WASM_ROOT}/**`],
};
const WASM_NODE = writeNode(WASM_FIXTURE);
const WEB_FIXTURE: WriteNodeFixture = {
  taskId: 'web-consumer',
  expert: 'web_expert',
  moduleRoot: WEB_ROOT,
  dependencies: ['wasm-adapter'],
  read: [`${WASM_ROOT}/**`],
  write: [`${WEB_ROOT}/**`],
};
const WEB_NODE = writeNode(WEB_FIXTURE);
const CORE_WASM_EDGE_FIXTURE: EdgeFixture = {
  providerTaskId: 'core-provider',
  consumerTaskId: 'wasm-adapter',
};
const WASM_WEB_EDGE_FIXTURE: EdgeFixture = {
  providerTaskId: 'wasm-adapter',
  consumerTaskId: 'web-consumer',
};
const CORE_WASM_EDGE = edgeContract(CORE_WASM_EDGE_FIXTURE);
const WASM_WEB_EDGE = edgeContract(WASM_WEB_EDGE_FIXTURE);
const DEFAULT_NODES: readonly ModuleDeliveryNode[] = [
  WEB_NODE,
  CORE_NODE,
  WASM_NODE,
];
const DEFAULT_EDGES: readonly ModuleDeliveryEdgeContract[] = [
  WASM_WEB_EDGE,
  CORE_WASM_EDGE,
];

describe('reviewed module delivery plan', () => {
  test('accepts the bottom-up graph and returns deterministic order and digest', () => {
    const fixture: PlanFixture = {
      nodes: DEFAULT_NODES,
      edgeContracts: DEFAULT_EDGES,
    };
    const result = validate(plan(fixture));
    expect(result.status).toBe(ModuleDeliveryValidationStatus.Accepted);
    if (result.status !== ModuleDeliveryValidationStatus.Accepted) return;
    const expectedOrder = ['core-provider', 'wasm-adapter', 'web-consumer'];
    expect(result.topologicalOrder).toEqual(expectedOrder);
    expect(result.planDigest).toMatch(/^[0-9a-f]{64}$/u);

    const reorderedFixture: PlanFixture = {
      nodes: [WASM_NODE, WEB_NODE, CORE_NODE],
      edgeContracts: [CORE_WASM_EDGE, WASM_WEB_EDGE],
    };
    const reordered = validate(plan(reorderedFixture));
    expect(reordered.status).toBe(ModuleDeliveryValidationStatus.Accepted);
    if (reordered.status !== ModuleDeliveryValidationStatus.Accepted) return;
    expect(reordered.planDigest).toBe(result.planDigest);
    expect(reordered.waves).toEqual(result.waves);
  });

  test('keeps validation command order in the plan digest', () => {
    const orderedNode: WriteModuleDeliveryNode = {
      ...CORE_NODE,
      acceptance: {
        ...CORE_NODE.acceptance,
        commands: ['task core:first', 'task core:second'],
      },
    };
    const fixture: PlanFixture = { nodes: [orderedNode], edgeContracts: [] };
    const orderedPlan = plan(fixture);
    const reversedNode: WriteModuleDeliveryNode = {
      ...orderedNode,
      acceptance: {
        ...orderedNode.acceptance,
        commands: ['task core:second', 'task core:first'],
      },
    };
    const reversedNodePlan: ModuleDeliveryPlan = {
      ...orderedPlan,
      nodes: [reversedNode],
    };
    const ordered = validate(orderedPlan);
    const reversedNodeResult = validate(reversedNodePlan);
    expect(ordered.status).toBe(ModuleDeliveryValidationStatus.Accepted);
    expect(reversedNodeResult.status).toBe(
      ModuleDeliveryValidationStatus.Accepted,
    );
    if (
      ordered.status !== ModuleDeliveryValidationStatus.Accepted ||
      reversedNodeResult.status !== ModuleDeliveryValidationStatus.Accepted
    )
      return;
    expect(reversedNodeResult.planDigest).not.toBe(ordered.planDigest);

    const twoJoinCommands: ModuleDeliveryPlan = {
      ...orderedPlan,
      parentJoin: {
        ...orderedPlan.parentJoin,
        validationCommands: ['task join:first', 'task join:second'],
      },
    };
    const reversedJoinCommands: ModuleDeliveryPlan = {
      ...twoJoinCommands,
      parentJoin: {
        ...twoJoinCommands.parentJoin,
        validationCommands: ['task join:second', 'task join:first'],
      },
    };
    const joinOrdered = validate(twoJoinCommands);
    const joinReversed = validate(reversedJoinCommands);
    if (
      joinOrdered.status !== ModuleDeliveryValidationStatus.Accepted ||
      joinReversed.status !== ModuleDeliveryValidationStatus.Accepted
    )
      return;
    expect(joinReversed.planDigest).not.toBe(joinOrdered.planDigest);
  });

  test('keeps agent ancestry depth independent from a long dependency chain', () => {
    const nodes: ModuleDeliveryNode[] = [];
    const edges: ModuleDeliveryEdgeContract[] = [];
    for (let index = 0; index < 5; index += 1) {
      const taskId = `core-stage-${index}`;
      const previous = index === 0 ? '' : `core-stage-${index - 1}`;
      const dependencies = previous === '' ? [] : [previous];
      const fixture: WriteNodeFixture = {
        taskId,
        expert: 'core_expert',
        moduleRoot: CORE_ROOT,
        dependencies,
        read: [`${CORE_ROOT}/**`],
        write: [`${CORE_ROOT}/**`],
      };
      nodes.push(writeNode(fixture));
      if (previous !== '') {
        const edgeFixture: EdgeFixture = {
          providerTaskId: previous,
          consumerTaskId: taskId,
        };
        edges.push(edgeContract(edgeFixture));
      }
    }
    const fixture: PlanFixture = { nodes, edgeContracts: edges };
    const result = validate(plan(fixture));
    expect(result.status).toBe(ModuleDeliveryValidationStatus.Accepted);
    if (result.status !== ModuleDeliveryValidationStatus.Accepted) return;
    expect(result.waves).toHaveLength(5);
  });

  test('rejects malformed transport before semantic validation', () => {
    const result = decodeAndValidateModuleDeliveryPlan('{');
    expect(codes(result)).toContain(ModuleDeliveryIssueCode.MalformedTransport);
  });

  test('rejects non-exact commits and execution limits above policy', () => {
    const fixture: PlanFixture = {
      nodes: DEFAULT_NODES,
      edgeContracts: DEFAULT_EDGES,
    };
    const validPlan = plan(fixture);
    const invalidPlan: ModuleDeliveryPlan = {
      ...validPlan,
      sourceCommit: 'main',
      maxConcurrency: 17,
      maxAgentDepth: 4,
      maxAttempts: 6,
    };
    const result = validate(invalidPlan);
    expect(codes(result)).toContain(ModuleDeliveryIssueCode.InvalidField);
    expect(codes(result)).toContain(ModuleDeliveryIssueCode.LimitExceeded);
  });
});

describe('task execution and canonical ownership', () => {
  test('permits empty writes only for an explicitly read-only task', () => {
    const auditFixture: ReadOnlyNodeFixture = {
      taskId: 'core-audit',
      expert: 'core_expert',
      moduleRoot: CORE_ROOT,
      dependencies: [],
    };
    const audit = readOnlyNode(auditFixture);
    const acceptedFixture: PlanFixture = { nodes: [audit], edgeContracts: [] };
    expect(validate(plan(acceptedFixture)).status).toBe(
      ModuleDeliveryValidationStatus.Accepted,
    );

    const emptyWrite: WriteModuleDeliveryNode = {
      ...CORE_NODE,
      resources: { ...CORE_NODE.resources, write: [] },
    };
    const emptyFixture: PlanFixture = {
      nodes: [emptyWrite],
      edgeContracts: [],
    };
    expect(codes(validate(plan(emptyFixture)))).toContain(
      ModuleDeliveryIssueCode.InvalidField,
    );

    const readOnlyWriter: ReadOnlyModuleDeliveryNode = {
      ...audit,
      resources: { ...audit.resources, write: [`${CORE_ROOT}/**`] },
    };
    const writerFixture: PlanFixture = {
      nodes: [readOnlyWriter],
      edgeContracts: [],
    };
    expect(codes(validate(plan(writerFixture)))).toContain(
      ModuleDeliveryIssueCode.InvalidField,
    );
  });

  test('fails closed on expert module roots, internal API scope, and task baselines', () => {
    const wrongRoot: WriteModuleDeliveryNode = {
      ...WASM_NODE,
      moduleRoot: CORE_ROOT,
      resources: { ...WASM_NODE.resources, write: [`${CORE_ROOT}/**`] },
    };
    const escapedWrite: WriteModuleDeliveryNode = {
      ...WASM_NODE,
      resources: { ...WASM_NODE.resources, write: [`${WEB_ROOT}/**`] },
    };
    const wrongBaseline: WriteModuleDeliveryNode = {
      ...CORE_NODE,
      baseline: {
        kind: ModuleDeliveryBaselineKind.SourceCommit,
        sourceCommit: 'fedcba9876543210fedcba9876543210fedcba98',
      },
    };
    const cases: readonly NodeFailureFixture[] = [
      {
        node: wrongRoot,
        code: ModuleDeliveryIssueCode.ModuleOwnershipMismatch,
      },
      {
        node: escapedWrite,
        code: ModuleDeliveryIssueCode.WriteScopeMismatch,
      },
      {
        node: wrongBaseline,
        code: ModuleDeliveryIssueCode.BaselineMismatch,
      },
    ];
    for (const failure of cases) {
      const fixture: PlanFixture = {
        nodes: [failure.node],
        edgeContracts: [],
      };
      expect(codes(validate(plan(fixture)))).toContain(failure.code);
    }
  });

  test('validates dependency baseline policy and inherited agent depth', () => {
    const sourceBasedDependent: WriteModuleDeliveryNode = {
      ...WASM_NODE,
      baseline: {
        kind: ModuleDeliveryBaselineKind.SourceCommit,
        sourceCommit: SOURCE_COMMIT,
      },
    };
    const wrongProviders: WriteModuleDeliveryNode = {
      ...WASM_NODE,
      baseline: {
        kind: ModuleDeliveryBaselineKind.IntegratedDependencies,
        providerTaskIds: ['web-consumer'],
      },
    };
    const excessiveDepth: WriteModuleDeliveryNode = {
      ...CORE_NODE,
      agentDepthLimit: 4,
    };
    const cases: readonly WriteModuleDeliveryNode[] = [
      sourceBasedDependent,
      wrongProviders,
      excessiveDepth,
    ];
    for (const node of cases) {
      const nodes = node.taskId === 'wasm-adapter' ? [CORE_NODE, node] : [node];
      const edges = node.taskId === 'wasm-adapter' ? [CORE_WASM_EDGE] : [];
      const fixture: PlanFixture = { nodes, edgeContracts: edges };
      const result = validate(plan(fixture));
      const expected =
        node === excessiveDepth
          ? ModuleDeliveryIssueCode.LimitExceeded
          : ModuleDeliveryIssueCode.BaselineMismatch;
      expect(codes(result)).toContain(expected);
    }
  });

  test('rejects web generated binding and catalog-excluded writes', () => {
    const sharedRoot = 'nook-app/nook-web/nook-web-shared';
    const generatedRoot = `${sharedRoot}/src/vault-app/lib/nook-wasm`;
    const fixture: WriteNodeFixture = {
      taskId: 'generated-writer',
      expert: 'web_expert',
      moduleRoot: sharedRoot,
      dependencies: [],
      read: [`${sharedRoot}/**`],
      write: [`${generatedRoot}/**`],
    };
    const generatedWriter = writeNode(fixture);
    const planFixture: PlanFixture = {
      nodes: [generatedWriter],
      edgeContracts: [],
    };
    expect(codes(validate(plan(planFixture)))).toContain(
      ModuleDeliveryIssueCode.WriteScopeMismatch,
    );
  });
});

describe('dependency edges and resource safety', () => {
  test('requires exact edge contracts for fan-in and multiple consumers', () => {
    const secondConsumerFixture: WriteNodeFixture = {
      taskId: 'web-second',
      expert: 'web_expert',
      moduleRoot: WEB_ROOT,
      dependencies: ['core-provider'],
      read: [`${CORE_ROOT}/**`],
      write: [`${WEB_ROOT}/src/second/**`],
    };
    const secondConsumer = writeNode(secondConsumerFixture);
    const fanInConsumer: WriteModuleDeliveryNode = {
      ...WEB_NODE,
      dependencies: ['core-provider', 'wasm-adapter'],
      baseline: {
        kind: ModuleDeliveryBaselineKind.IntegratedDependencies,
        providerTaskIds: ['core-provider', 'wasm-adapter'],
      },
      resources: {
        ...WEB_NODE.resources,
        write: [`${WEB_ROOT}/src/first/**`],
      },
    };
    const coreWebFixture: EdgeFixture = {
      providerTaskId: 'core-provider',
      consumerTaskId: 'web-consumer',
    };
    const coreSecondFixture: EdgeFixture = {
      providerTaskId: 'core-provider',
      consumerTaskId: 'web-second',
    };
    const completeEdges: readonly ModuleDeliveryEdgeContract[] = [
      CORE_WASM_EDGE,
      WASM_WEB_EDGE,
      edgeContract(coreWebFixture),
      edgeContract(coreSecondFixture),
    ];
    const nodes: readonly ModuleDeliveryNode[] = [
      CORE_NODE,
      WASM_NODE,
      fanInConsumer,
      secondConsumer,
    ];
    const completeFixture: PlanFixture = {
      nodes,
      edgeContracts: completeEdges,
    };
    expect(validate(plan(completeFixture)).status).toBe(
      ModuleDeliveryValidationStatus.Accepted,
    );

    const missingFixture: PlanFixture = {
      nodes,
      edgeContracts: completeEdges.slice(1),
    };
    expect(codes(validate(plan(missingFixture)))).toContain(
      ModuleDeliveryIssueCode.MissingEdgeContract,
    );

    const unexpectedFixtureValue: EdgeFixture = {
      providerTaskId: 'web-consumer',
      consumerTaskId: 'core-provider',
    };
    const unexpectedEdges = [
      ...completeEdges,
      edgeContract(unexpectedFixtureValue),
    ];
    const unexpectedFixture: PlanFixture = {
      nodes,
      edgeContracts: unexpectedEdges,
    };
    expect(codes(validate(plan(unexpectedFixture)))).toContain(
      ModuleDeliveryIssueCode.UnexpectedEdgeContract,
    );
  });

  test('rejects concurrent overlap but permits ordered overlap', () => {
    const siblingFixture: WriteNodeFixture = {
      ...CORE_FIXTURE,
      taskId: 'core-sibling',
    };
    const sibling = writeNode(siblingFixture);
    const concurrentFixture: PlanFixture = {
      nodes: [CORE_NODE, sibling],
      edgeContracts: [],
    };
    expect(codes(validate(plan(concurrentFixture)))).toContain(
      ModuleDeliveryIssueCode.ResourceConflict,
    );

    const orderedSibling: WriteModuleDeliveryNode = {
      ...sibling,
      dependencies: ['core-provider'],
      baseline: {
        kind: ModuleDeliveryBaselineKind.IntegratedDependencies,
        providerTaskIds: ['core-provider'],
      },
    };
    const orderedEdgeFixture: EdgeFixture = {
      providerTaskId: 'core-provider',
      consumerTaskId: 'core-sibling',
    };
    const orderedFixture: PlanFixture = {
      nodes: [orderedSibling, CORE_NODE],
      edgeContracts: [edgeContract(orderedEdgeFixture)],
    };
    expect(validate(plan(orderedFixture)).status).toBe(
      ModuleDeliveryValidationStatus.Accepted,
    );
  });

  test('rejects missing, self, cyclic dependencies and protected writes', () => {
    const missing: WriteModuleDeliveryNode = {
      ...CORE_NODE,
      dependencies: ['missing-provider'],
    };
    const missingFixture: PlanFixture = { nodes: [missing], edgeContracts: [] };
    expect(codes(validate(plan(missingFixture)))).toContain(
      ModuleDeliveryIssueCode.MissingDependency,
    );

    const self: WriteModuleDeliveryNode = {
      ...CORE_NODE,
      dependencies: ['core-provider'],
    };
    const selfFixture: PlanFixture = { nodes: [self], edgeContracts: [] };
    expect(codes(validate(plan(selfFixture)))).toContain(
      ModuleDeliveryIssueCode.SelfDependency,
    );

    const cyclicCore: WriteModuleDeliveryNode = {
      ...CORE_NODE,
      dependencies: ['wasm-adapter'],
    };
    const cycleFixture: PlanFixture = {
      nodes: [cyclicCore, WASM_NODE],
      edgeContracts: [CORE_WASM_EDGE, WASM_WEB_EDGE],
    };
    expect(codes(validate(plan(cycleFixture)))).toContain(
      ModuleDeliveryIssueCode.DependencyCycle,
    );

    const protectedWrite: WriteModuleDeliveryNode = {
      ...CORE_NODE,
      resources: { ...CORE_NODE.resources, write: ['Cargo.lock'] },
    };
    const protectedFixture: PlanFixture = {
      nodes: [protectedWrite],
      edgeContracts: [],
    };
    expect(codes(validate(plan(protectedFixture)))).toContain(
      ModuleDeliveryIssueCode.ParentOwnedWrite,
    );
  });
});
