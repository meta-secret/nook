import { describe, expect, test } from 'bun:test';
import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';
import {
  REQUIRED_PARENT_OWNED_RESOURCES,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryIssueCode,
  ModuleDeliveryJoinKind,
  ModuleDeliveryEvidenceInputSchema,
  ModuleDeliveryTaskKind,
  ModuleDeliveryValidationStatus,
  ModuleDeliveryWorkspaceKind,
  decodeAndValidateModuleDeliveryPlan,
} from '../../src/module-delivery/index.ts';
import type {
  LegacyModuleDeliveryPlan,
  LegacyModuleDeliveryNode,
  ModuleDeliveryEdgeContract,
  ModuleDeliveryEvidenceSynthesisNodeV2,
  ModuleDeliveryExecutionPrecedence,
  ModuleDeliveryBaseline,
  ModuleDeliveryNodeV2,
  ModuleDeliveryPlan,
  ModuleDeliveryPlanV2,
  ModuleDeliveryPlanValidation,
  ModuleDeliveryReadOnlyNodeV2,
  ModuleDeliveryWriteNodeV2,
} from '../../src/module-delivery/index.ts';
import { TeamKey } from '../../src/team-agents/catalog.ts';

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
  readonly nodes: readonly ModuleDeliveryNodeV2[];
  readonly edgeContracts: readonly ModuleDeliveryEdgeContract[];
};

type LegacySynthesisNode = Omit<LegacyModuleDeliveryNode, 'kind'> & {
  readonly kind: ModuleDeliveryTaskKind.EvidenceSynthesis;
};

type LegacyOwnerHybridNode = LegacyModuleDeliveryNode & {
  readonly functionalOwner: TeamKey;
};

type LegacyLineageHybridNode = LegacyModuleDeliveryNode & {
  readonly team: TeamKey;
  readonly acceptanceOwner: TeamKey;
  readonly parentLineage: { readonly kind: AgentAttemptParentKind };
};

type LegacyAdversarialNode =
  LegacySynthesisNode | LegacyOwnerHybridNode | LegacyLineageHybridNode;

type LegacyAdversarialPlan = Omit<LegacyModuleDeliveryPlan, 'nodes'> & {
  readonly nodes: readonly LegacyAdversarialNode[];
};

type LegacyInputNode = Extract<
  ModuleDeliveryPlan,
  { readonly version: 1 }
>['nodes'][number];

const LEGACY_INPUT_REJECTS_SYNTHESIS: ModuleDeliveryEvidenceSynthesisNodeV2 extends LegacyInputNode
  ? false
  : true = true;

type NodeFailureFixture = {
  readonly node: ModuleDeliveryWriteNodeV2;
  readonly code: ModuleDeliveryIssueCode;
};

function writeNode(fixture: WriteNodeFixture): ModuleDeliveryWriteNodeV2 {
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
    team:
      fixture.expert === 'web_expert'
        ? TeamKey.WebDevelopment
        : TeamKey.DevelopmentCore,
    functionalOwner: TeamKey.Ai,
    acceptanceOwner: TeamKey.Ai,
    parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
    expert: fixture.expert,
    moduleRoot: fixture.moduleRoot,
    consumerOutcome: `${fixture.taskId} publishes its accepted capability.`,
    baseline,
    agentDepthLimit: 2,
    dependencies: fixture.dependencies,
    resources: {
      read: fixture.read,
      write: fixture.write,
      evidenceSurface: [],
    },
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
): ModuleDeliveryReadOnlyNodeV2 {
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
    team: TeamKey.DevelopmentCore,
    functionalOwner: TeamKey.Ai,
    acceptanceOwner: TeamKey.Ai,
    parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
    expert: fixture.expert,
    moduleRoot: fixture.moduleRoot,
    consumerOutcome: `${fixture.taskId} reports reviewed evidence.`,
    baseline,
    agentDepthLimit: 2,
    dependencies: fixture.dependencies,
    resources: {
      read: [`${fixture.moduleRoot}/**`],
      write: [],
      evidenceSurface: [`${fixture.moduleRoot}/**`],
    },
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

function plan(fixture: PlanFixture): ModuleDeliveryPlanV2 {
  return {
    version: 2,
    generation: 1,
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

function validate(value: ModuleDeliveryPlanV2): ModuleDeliveryPlanValidation {
  return decodeAndValidateModuleDeliveryPlan(JSON.stringify(value));
}

function legacyPlan(): LegacyModuleDeliveryPlan {
  return {
    version: 1,
    sourceCommit: SOURCE_COMMIT,
    maxConcurrency: 1,
    maxAgentDepth: 2,
    maxAttempts: 2,
    parentOwnedResources: PARENT_OWNED_RESOURCES,
    parentJoin: {
      kind: ModuleDeliveryJoinKind.OrderedCommitHandoffs,
      owner: 'delivery-owner',
      validationCommands: ['task loom:verify'],
    },
    nodes: [
      {
        kind: ModuleDeliveryTaskKind.ReadOnly,
        taskId: 'legacy-core-audit',
        expert: 'core_expert',
        moduleRoot: CORE_ROOT,
        consumerOutcome: 'The parent receives reviewed legacy evidence.',
        baseline: {
          kind: ModuleDeliveryBaselineKind.SourceCommit,
          sourceCommit: SOURCE_COMMIT,
        },
        agentDepthLimit: 2,
        dependencies: [],
        resources: { read: [`${CORE_ROOT}/**`], write: [] },
        parentOwnedExclusions: PARENT_OWNED_RESOURCES,
        acceptance: {
          commands: ['task core:audit'],
          evidence: ['Legacy evidence is reviewed.'],
        },
      },
    ],
    edgeContracts: [],
  };
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
const DEFAULT_NODES: readonly ModuleDeliveryNodeV2[] = [
  WEB_NODE,
  CORE_NODE,
  WASM_NODE,
];
const DEFAULT_EDGES: readonly ModuleDeliveryEdgeContract[] = [
  WASM_WEB_EDGE,
  CORE_WASM_EDGE,
];

describe('reviewed module delivery plan', () => {
  test('rejects v2-only task forms and authority fields in v1 input', () => {
    expect(LEGACY_INPUT_REJECTS_SYNTHESIS).toBe(true);
    const legacy = legacyPlan();
    const node = legacy.nodes[0];
    if (!node) throw new Error('Legacy fixture must contain one node.');
    const candidates: readonly LegacyAdversarialPlan[] = [
      {
        ...legacy,
        nodes: [{ ...node, kind: ModuleDeliveryTaskKind.EvidenceSynthesis }],
      },
      { ...legacy, nodes: [{ ...node, functionalOwner: TeamKey.Ai }] },
      {
        ...legacy,
        nodes: [
          {
            ...node,
            team: TeamKey.DevelopmentCore,
            acceptanceOwner: TeamKey.Ai,
            parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
          },
        ],
      },
    ];

    for (const candidate of candidates) {
      const result = decodeAndValidateModuleDeliveryPlan(
        JSON.stringify(candidate),
      );
      expect(result.status).toBe(ModuleDeliveryValidationStatus.Rejected);
      expect(codes(result)).toContain(ModuleDeliveryIssueCode.InvalidField);
    }
  });

  test('retains whether accepted input was authored as v1 or v2', () => {
    const legacy = decodeAndValidateModuleDeliveryPlan(
      JSON.stringify(legacyPlan()),
    );
    const fixture: PlanFixture = {
      nodes: DEFAULT_NODES,
      edgeContracts: DEFAULT_EDGES,
    };
    const current = validate(plan(fixture));
    expect(legacy.status).toBe(ModuleDeliveryValidationStatus.Accepted);
    expect(current.status).toBe(ModuleDeliveryValidationStatus.Accepted);
    if (
      legacy.status !== ModuleDeliveryValidationStatus.Accepted ||
      current.status !== ModuleDeliveryValidationStatus.Accepted
    )
      return;
    expect(legacy.inputVersion).toBe(1);
    expect(current.inputVersion).toBe(2);
    expect(legacy.plan.version).toBe(2);
    expect(current.plan.version).toBe(2);
  });

  test('freezes owner acceptance and typed synthesis producer identities', () => {
    const providerFixture: ReadOnlyNodeFixture = {
      taskId: 'provider-audit',
      expert: 'core_expert',
      moduleRoot: CORE_ROOT,
      dependencies: [],
    };
    const provider = readOnlyNode(providerFixture);
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
      parentOwnedExclusions: PARENT_OWNED_RESOURCES,
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
    const edgeFixture: EdgeFixture = {
      providerTaskId: provider.taskId,
      consumerTaskId: synthesis.taskId,
    };
    const fixture: PlanFixture = {
      nodes: [synthesis, provider],
      edgeContracts: [edgeContract(edgeFixture)],
    };
    expect(validate(plan(fixture)).status).toBe(
      ModuleDeliveryValidationStatus.Accepted,
    );

    const selfAccepted: ModuleDeliveryEvidenceSynthesisNodeV2 = {
      ...synthesis,
      acceptanceOwner: synthesis.team,
    };
    const selfFixture: PlanFixture = {
      nodes: [selfAccepted, provider],
      edgeContracts: [edgeContract(edgeFixture)],
    };
    expect(codes(validate(plan(selfFixture)))).toContain(
      ModuleDeliveryIssueCode.AcceptanceOwnershipMismatch,
    );

    const forgedProducer: ModuleDeliveryEvidenceSynthesisNodeV2 = {
      ...synthesis,
      evidenceInput: {
        ...synthesis.evidenceInput,
        expectedProducers: [
          {
            taskId: provider.taskId,
            team: TeamKey.WebDevelopment,
            functionalOwner: provider.functionalOwner,
            acceptanceOwner: provider.acceptanceOwner,
          },
        ],
      },
    };
    const forgedFixture: PlanFixture = {
      nodes: [forgedProducer, provider],
      edgeContracts: [edgeContract(edgeFixture)],
    };
    expect(codes(validate(plan(forgedFixture)))).toContain(
      ModuleDeliveryIssueCode.EvidenceInputMismatch,
    );
  });

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
    const orderedNode: ModuleDeliveryWriteNodeV2 = {
      ...CORE_NODE,
      acceptance: {
        ...CORE_NODE.acceptance,
        commands: ['task core:first', 'task core:second'],
      },
    };
    const fixture: PlanFixture = { nodes: [orderedNode], edgeContracts: [] };
    const orderedPlan = plan(fixture);
    const reversedNode: ModuleDeliveryWriteNodeV2 = {
      ...orderedNode,
      acceptance: {
        ...orderedNode.acceptance,
        commands: ['task core:second', 'task core:first'],
      },
    };
    const reversedNodePlan: ModuleDeliveryPlanV2 = {
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
  });

  test('keeps agent ancestry depth independent from a long dependency chain', () => {
    const nodes: ModuleDeliveryNodeV2[] = [];
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
    const fixture: PlanFixture = {
      nodes,
      edgeContracts: edges,
    };
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
    const invalidPlan: ModuleDeliveryPlanV2 = {
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
  test('keeps implementation ownership separate from expert routing', () => {
    expect(WASM_NODE.expert).toBe('internal_api_expert');
    expect(WASM_NODE.team).toBe(TeamKey.DevelopmentCore);
    const acceptedFixture: PlanFixture = {
      nodes: [CORE_NODE, WASM_NODE],
      edgeContracts: [CORE_WASM_EDGE],
    };
    expect(validate(plan(acceptedFixture)).status).toBe(
      ModuleDeliveryValidationStatus.Accepted,
    );

    const expertOwnedWasm: ModuleDeliveryWriteNodeV2 = {
      ...WASM_NODE,
      team: TeamKey.Ai,
    };
    const rejectedFixture: PlanFixture = {
      nodes: [CORE_NODE, expertOwnedWasm],
      edgeContracts: [CORE_WASM_EDGE],
    };
    expect(codes(validate(plan(rejectedFixture)))).toContain(
      ModuleDeliveryIssueCode.TeamOwnershipMismatch,
    );
  });

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

    const emptyWrite: ModuleDeliveryWriteNodeV2 = {
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

    const readOnlyWriter: ModuleDeliveryReadOnlyNodeV2 = {
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

  test('accepts evidence claims contained by broader repository reads', () => {
    const auditFixture: ReadOnlyNodeFixture = {
      taskId: 'core-audit',
      expert: 'core_expert',
      moduleRoot: CORE_ROOT,
      dependencies: [],
    };
    const audit = readOnlyNode(auditFixture);
    const containedCases: readonly ModuleDeliveryReadOnlyNodeV2[] = [
      {
        ...audit,
        resources: {
          ...audit.resources,
          read: [`${CORE_ROOT}/**`],
          evidenceSurface: [`${CORE_ROOT}/src/lib.rs`],
        },
      },
      {
        ...audit,
        resources: {
          ...audit.resources,
          read: [`${CORE_ROOT}/src/*`],
          evidenceSurface: [`${CORE_ROOT}/src/*.rs`],
        },
      },
      {
        ...audit,
        resources: {
          ...audit.resources,
          read: ['**/*'],
          evidenceSurface: ['**/*.rs'],
        },
      },
    ];

    for (const node of containedCases) {
      const fixture: PlanFixture = { nodes: [node], edgeContracts: [] };
      expect(validate(plan(fixture)).status).toBe(
        ModuleDeliveryValidationStatus.Accepted,
      );
    }
  });

  test('rejects evidence claims not contained by declared repository reads', () => {
    const auditFixture: ReadOnlyNodeFixture = {
      taskId: 'core-audit',
      expert: 'core_expert',
      moduleRoot: CORE_ROOT,
      dependencies: [],
    };
    const audit = readOnlyNode(auditFixture);
    const uncoveredCases: readonly ModuleDeliveryReadOnlyNodeV2[] = [
      {
        ...audit,
        resources: {
          ...audit.resources,
          read: [`${CORE_ROOT}/src/**`],
          evidenceSurface: [`${CORE_ROOT}/tests/**`],
        },
      },
      {
        ...audit,
        resources: {
          ...audit.resources,
          read: [`${CORE_ROOT}/src/*.rs`],
          evidenceSurface: [`${CORE_ROOT}/src/*`],
        },
      },
    ];

    for (const node of uncoveredCases) {
      const fixture: PlanFixture = { nodes: [node], edgeContracts: [] };
      expect(codes(validate(plan(fixture)))).toContain(
        ModuleDeliveryIssueCode.EvidenceSurfaceMismatch,
      );
    }
  });

  test('fails closed on expert module roots, internal API scope, and task baselines', () => {
    const wrongRoot: ModuleDeliveryWriteNodeV2 = {
      ...WASM_NODE,
      moduleRoot: CORE_ROOT,
      resources: { ...WASM_NODE.resources, write: [`${CORE_ROOT}/**`] },
    };
    const escapedWrite: ModuleDeliveryWriteNodeV2 = {
      ...WASM_NODE,
      resources: { ...WASM_NODE.resources, write: [`${WEB_ROOT}/**`] },
    };
    const wrongBaseline: ModuleDeliveryWriteNodeV2 = {
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
    const sourceBasedDependent: ModuleDeliveryWriteNodeV2 = {
      ...WASM_NODE,
      baseline: {
        kind: ModuleDeliveryBaselineKind.SourceCommit,
        sourceCommit: SOURCE_COMMIT,
      },
    };
    const wrongProviders: ModuleDeliveryWriteNodeV2 = {
      ...WASM_NODE,
      baseline: {
        kind: ModuleDeliveryBaselineKind.IntegratedDependencies,
        providerTaskIds: ['web-consumer'],
      },
    };
    const excessiveDepth: ModuleDeliveryWriteNodeV2 = {
      ...CORE_NODE,
      agentDepthLimit: 4,
    };
    const cases: readonly ModuleDeliveryWriteNodeV2[] = [
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
  test('rejects stale source baselines for derived evidence predecessors', () => {
    const auditFixture: ReadOnlyNodeFixture = {
      taskId: 'core-audit',
      expert: 'core_expert',
      moduleRoot: CORE_ROOT,
      dependencies: [],
    };
    const staleAudit = readOnlyNode(auditFixture);
    const staleFixture: PlanFixture = {
      nodes: [staleAudit, CORE_NODE],
      edgeContracts: [],
    };
    expect(codes(validate(plan(staleFixture)))).toContain(
      ModuleDeliveryIssueCode.BaselineMismatch,
    );
  });

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
    const fanInConsumer: ModuleDeliveryWriteNodeV2 = {
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
    const nodes: readonly ModuleDeliveryNodeV2[] = [
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

  test('serializes concurrent overlap and permits ordered overlap', () => {
    const siblingFixture: WriteNodeFixture = {
      ...CORE_FIXTURE,
      taskId: 'core-sibling',
    };
    const sibling = writeNode(siblingFixture);
    const concurrentFixture: PlanFixture = {
      nodes: [CORE_NODE, sibling],
      edgeContracts: [],
    };
    const concurrent = validate(plan(concurrentFixture));
    if (concurrent.status !== ModuleDeliveryValidationStatus.Accepted)
      throw new Error(JSON.stringify(concurrent.issues));
    const precedence: ModuleDeliveryExecutionPrecedence = {
      predecessorTaskId: 'core-provider',
      successorTaskId: 'core-sibling',
    };
    expect(concurrent.executionPrecedence).toContainEqual(precedence);

    const orderedSibling: ModuleDeliveryWriteNodeV2 = {
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
    const missing: ModuleDeliveryWriteNodeV2 = {
      ...CORE_NODE,
      dependencies: ['missing-provider'],
    };
    const missingFixture: PlanFixture = { nodes: [missing], edgeContracts: [] };
    expect(codes(validate(plan(missingFixture)))).toContain(
      ModuleDeliveryIssueCode.MissingDependency,
    );

    const self: ModuleDeliveryWriteNodeV2 = {
      ...CORE_NODE,
      dependencies: ['core-provider'],
    };
    const selfFixture: PlanFixture = { nodes: [self], edgeContracts: [] };
    expect(codes(validate(plan(selfFixture)))).toContain(
      ModuleDeliveryIssueCode.SelfDependency,
    );

    const cyclicCore: ModuleDeliveryWriteNodeV2 = {
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

    const protectedWrite: ModuleDeliveryWriteNodeV2 = {
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
