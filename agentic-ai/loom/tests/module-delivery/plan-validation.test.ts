import {
  ModuleDeliveryPlanValidationScenario,
  SOURCE_COMMIT,
  PARENT_OWNED_RESOURCES,
  CORE_ROOT,
} from './plan-validation.fixture.ts';
import type {
  PlanFixture,
  WriteNodeFixture,
  ReadOnlyNodeFixture,
  EdgeFixture,
} from './plan-validation.fixture.ts';
export { ModuleDeliveryPlanValidationScenario } from './plan-validation.fixture.ts';
import { describe, expect, test } from 'bun:test';

import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';

import {
  ModuleDeliveryBaselineKind,
  ModuleDeliveryIssueCode,
  ModuleDeliveryEvidenceInputSchema,
  ModuleDeliveryTaskKind,
  ModuleDeliveryTaskProfile,
  ModuleDeliveryCompatibilityStatus,
  ModuleDeliveryValidationStatus,
  ModuleDeliveryPlanDecoder,
  ModuleDeliveryPlanSchema,
  MAX_MODULE_DELIVERY_EDGE_CONTRACTS,
  MAX_MODULE_DELIVERY_EXPECTED_PRODUCERS,
  MAX_MODULE_DELIVERY_NODES,
} from '../../src/module-delivery/index.ts';

import type {
  LegacyModuleDeliveryPlan,
  LegacyModuleDeliveryNode,
  ModuleDeliveryEdgeContract,
  ModuleDeliveryEvidenceSynthesisNodeV2,
  ModuleDeliveryNodeV2,
  ModuleDeliveryPlan,
  ModuleDeliveryPlanV4,
  ModuleDeliveryPlanV5,
  ModuleDeliveryReadOnlyNodeV2,
  ModuleDeliveryWriteNodeV2,
} from '../../src/module-delivery/index.ts';

import { TeamKey } from '../../src/team-agents/catalog.ts';
import { MAX_MODULE_DELIVERY_STRING_LIST_ENTRIES } from '../../src/module-delivery/evidence-limits.ts';

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

const CORE_NODE = ModuleDeliveryPlanValidationScenario.writeNode(CORE_FIXTURE);

const WASM_FIXTURE: WriteNodeFixture = {
  taskId: 'wasm-adapter',
  expert: 'internal_api_expert',
  moduleRoot: WASM_ROOT,
  dependencies: ['core-provider'],
  read: [`${CORE_ROOT}/**`],
  write: [`${WASM_ROOT}/**`],
};

const WASM_NODE = ModuleDeliveryPlanValidationScenario.writeNode(WASM_FIXTURE);

const WEB_FIXTURE: WriteNodeFixture = {
  taskId: 'web-consumer',
  expert: 'web_expert',
  moduleRoot: WEB_ROOT,
  dependencies: ['wasm-adapter'],
  read: [`${WASM_ROOT}/**`],
  write: [`${WEB_ROOT}/**`],
};

const WEB_NODE = ModuleDeliveryPlanValidationScenario.writeNode(WEB_FIXTURE);

const CORE_WASM_EDGE_FIXTURE: EdgeFixture = {
  providerTaskId: 'core-provider',
  consumerTaskId: 'wasm-adapter',
};

const WASM_WEB_EDGE_FIXTURE: EdgeFixture = {
  providerTaskId: 'wasm-adapter',
  consumerTaskId: 'web-consumer',
};

const CORE_WASM_EDGE = ModuleDeliveryPlanValidationScenario.edgeContract(
  CORE_WASM_EDGE_FIXTURE,
);

const WASM_WEB_EDGE = ModuleDeliveryPlanValidationScenario.edgeContract(
  WASM_WEB_EDGE_FIXTURE,
);

const DEFAULT_NODES: readonly ModuleDeliveryNodeV2[] = [
  WEB_NODE,
  CORE_NODE,
  WASM_NODE,
];

const DEFAULT_EDGES: readonly ModuleDeliveryEdgeContract[] = [
  WASM_WEB_EDGE,
  CORE_WASM_EDGE,
];

type LimitRejectionRequest = {
  readonly serialized: string;
  readonly path: string;
};

class ModuleDeliveryPlanTransportCollectionScenario {
  private constructor() {}

  static expectLimitRejection(request: LimitRejectionRequest): void {
    const result = ModuleDeliveryPlanSchema.decodeCompatibleModuleDeliveryPlan(
      request.serialized,
    );
    expect(result.status).toBe(ModuleDeliveryCompatibilityStatus.Rejected);
    if (result.status !== ModuleDeliveryCompatibilityStatus.Rejected) return;
    expect(result.issues[0]?.code).toBe(ModuleDeliveryIssueCode.LimitExceeded);
    expect(result.issues[0]?.path).toBe(request.path);
  }
}

describe('reviewed module delivery plan', () => {
  test('admits ordinary team tasks and rejects forged identity, profile, and scope', () => {
    const accepted = (node: ModuleDeliveryNodeV2) =>
      ModuleDeliveryPlanValidationScenario.validate(
        ModuleDeliveryPlanValidationScenario.plan({
          nodes: [node],
          edgeContracts: [],
        }),
      ).status === ModuleDeliveryValidationStatus.Accepted;
    const security: ModuleDeliveryReadOnlyNodeV2 = {
      ...ModuleDeliveryPlanValidationScenario.readOnlyNode({
        taskId: 'security-review',
        expert: ModuleDeliveryTaskProfile.Ordinary,
        moduleRoot: '.cortex/teams/security',
        dependencies: [],
      }),
      team: TeamKey.Security,
      functionalOwner: TeamKey.Ai,
      acceptanceOwner: TeamKey.Ai,
    };
    for (const team of [TeamKey.Security, TeamKey.Sre])
      expect(accepted({ ...security, team })).toBe(true);
    const sreWrite = {
      ...ModuleDeliveryPlanValidationScenario.writeNode({
        ...CORE_FIXTURE,
        expert: ModuleDeliveryTaskProfile.Ordinary,
        moduleRoot: 'infra',
        write: ['infra/**'],
      }),
      team: TeamKey.Sre,
      functionalOwner: TeamKey.Ai,
      acceptanceOwner: TeamKey.Ai,
    };
    expect(accepted(sreWrite)).toBe(true);
    const forgedTeam = structuredClone(security);
    Object.assign(forgedTeam, { team: 'forged-team' });
    const sharedRoot = 'nook-app/nook-web/nook-web-shared';
    const root = `${sharedRoot}/src/vault-app/lib/nook-wasm`;
    const generated = structuredClone(sreWrite);
    Object.assign(generated, { team: TeamKey.WebDevelopment });
    Object.assign(generated, { moduleRoot: root });
    Object.assign(generated.resources, { write: [`${root}/**`] });
    for (const invalid of [
      forgedTeam,
      { ...security, expert: 'forged-profile' },
      { ...security, moduleRoot: '../forged-scope' },
      { ...sreWrite, team: TeamKey.Security },
      generated,
    ])
      expect(accepted(invalid)).toBe(false);
  });

  test('rejects v2-only task forms and authority fields in v1 input', () => {
    expect(LEGACY_INPUT_REJECTS_SYNTHESIS).toBe(true);
    const legacy = ModuleDeliveryPlanValidationScenario.legacyPlan();
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
      const result = ModuleDeliveryPlanDecoder.decodeAndValidate(
        JSON.stringify(candidate),
      );
      expect(result.status).toBe(ModuleDeliveryValidationStatus.Rejected);
      expect(ModuleDeliveryPlanValidationScenario.codes(result)).toContain(
        ModuleDeliveryIssueCode.InvalidField,
      );
    }
  });

  test('decodes the historical v2 root without upgrading it to v4', () => {
    const historical = ModuleDeliveryPlanValidationScenario.historicalV2Plan({
      nodes: [CORE_NODE],
      edgeContracts: [],
    });
    const compatibility =
      ModuleDeliveryPlanSchema.decodeCompatibleModuleDeliveryPlan(
        JSON.stringify(historical),
      );
    expect(compatibility.status).toBe(
      ModuleDeliveryCompatibilityStatus.Decoded,
    );
    if (compatibility.status === ModuleDeliveryCompatibilityStatus.Decoded) {
      expect(compatibility.inputVersion).toBe(2);
      expect(compatibility.plan).toEqual(historical);
      expect(Object.hasOwn(compatibility.plan, 'originMainSha')).toBe(false);
      expect(Object.hasOwn(compatibility.plan, 'pinnedLocalDevSha')).toBe(
        false,
      );
    }
    const canonical = ModuleDeliveryPlanDecoder.decodeAndValidate(
      JSON.stringify(historical),
    );
    expect(canonical.status).toBe(ModuleDeliveryValidationStatus.Rejected);
    expect(ModuleDeliveryPlanValidationScenario.codes(canonical)).toContain(
      ModuleDeliveryIssueCode.InvalidField,
    );
  });

  test('decodes and migrates the historical v3 root without mutating it', () => {
    const historical = ModuleDeliveryPlanValidationScenario.historicalV3Plan({
      nodes: [CORE_NODE],
      edgeContracts: [],
    });
    const before = structuredClone(historical);
    const compatibility =
      ModuleDeliveryPlanSchema.decodeCompatibleModuleDeliveryPlan(
        JSON.stringify(historical),
      );
    expect(compatibility.status).toBe(
      ModuleDeliveryCompatibilityStatus.Decoded,
    );
    if (compatibility.status === ModuleDeliveryCompatibilityStatus.Decoded) {
      expect(compatibility.inputVersion).toBe(3);
      expect(compatibility.plan).toEqual(historical);
      expect(Object.hasOwn(compatibility.plan, 'featureHeadSha')).toBe(false);
    }
    const historicalV4: ModuleDeliveryPlanV4 = {
      ...historical,
      version: 4,
      featureHeadSha: '4'.repeat(40),
    };
    const historicalV4Before = structuredClone(historicalV4);
    const migrated = ModuleDeliveryPlanSchema.migrateModuleDeliveryPlan(
      historicalV4,
      'codex/module-delivery-test',
    );
    expect(historical).toEqual(before);
    expect(historicalV4).toEqual(historicalV4Before);
    expect(migrated.version).toBe(5);
    expect(migrated.featureBranch).toBe('codex/module-delivery-test');
    expect(Object.hasOwn(migrated, 'featureHeadSha')).toBe(false);
    const canonical = ModuleDeliveryPlanDecoder.decodeAndValidate(
      JSON.stringify(historical),
    );
    expect(canonical.status).toBe(ModuleDeliveryValidationStatus.Rejected);
    expect(ModuleDeliveryPlanValidationScenario.codes(canonical)).toContain(
      ModuleDeliveryIssueCode.InvalidField,
    );
  });

  test('freezes owner acceptance and typed synthesis producer identities', () => {
    const providerFixture: ReadOnlyNodeFixture = {
      taskId: 'provider-audit',
      expert: 'core_expert',
      moduleRoot: CORE_ROOT,
      dependencies: [],
    };
    const provider =
      ModuleDeliveryPlanValidationScenario.readOnlyNode(providerFixture);
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
      edgeContracts: [
        ModuleDeliveryPlanValidationScenario.edgeContract(edgeFixture),
      ],
    };
    expect(
      ModuleDeliveryPlanValidationScenario.validate(
        ModuleDeliveryPlanValidationScenario.plan(fixture),
      ).status,
    ).toBe(ModuleDeliveryValidationStatus.Accepted);

    const selfAccepted: ModuleDeliveryEvidenceSynthesisNodeV2 = {
      ...synthesis,
      acceptanceOwner: synthesis.team,
    };
    const selfFixture: PlanFixture = {
      nodes: [selfAccepted, provider],
      edgeContracts: [
        ModuleDeliveryPlanValidationScenario.edgeContract(edgeFixture),
      ],
    };
    expect(
      ModuleDeliveryPlanValidationScenario.codes(
        ModuleDeliveryPlanValidationScenario.validate(
          ModuleDeliveryPlanValidationScenario.plan(selfFixture),
        ),
      ),
    ).toContain(ModuleDeliveryIssueCode.AcceptanceOwnershipMismatch);

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
      edgeContracts: [
        ModuleDeliveryPlanValidationScenario.edgeContract(edgeFixture),
      ],
    };
    expect(
      ModuleDeliveryPlanValidationScenario.codes(
        ModuleDeliveryPlanValidationScenario.validate(
          ModuleDeliveryPlanValidationScenario.plan(forgedFixture),
        ),
      ),
    ).toContain(ModuleDeliveryIssueCode.EvidenceInputMismatch);
  });

  test('accepts the bottom-up graph and returns deterministic order and digest', () => {
    const fixture: PlanFixture = {
      nodes: DEFAULT_NODES,
      edgeContracts: DEFAULT_EDGES,
    };
    const result = ModuleDeliveryPlanValidationScenario.validate(
      ModuleDeliveryPlanValidationScenario.plan(fixture),
    );
    expect(result.status).toBe(ModuleDeliveryValidationStatus.Accepted);
    if (result.status !== ModuleDeliveryValidationStatus.Accepted) return;
    const expectedOrder = ['core-provider', 'wasm-adapter', 'web-consumer'];
    expect(result.topologicalOrder).toEqual(expectedOrder);
    expect(result.planDigest).toMatch(/^[0-9a-f]{64}$/u);

    const reorderedFixture: PlanFixture = {
      nodes: [WASM_NODE, WEB_NODE, CORE_NODE],
      edgeContracts: [CORE_WASM_EDGE, WASM_WEB_EDGE],
    };
    const reordered = ModuleDeliveryPlanValidationScenario.validate(
      ModuleDeliveryPlanValidationScenario.plan(reorderedFixture),
    );
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
    const orderedPlan = ModuleDeliveryPlanValidationScenario.plan(fixture);
    const reversedNode: ModuleDeliveryWriteNodeV2 = {
      ...orderedNode,
      acceptance: {
        ...orderedNode.acceptance,
        commands: ['task core:second', 'task core:first'],
      },
    };
    const reversedNodePlan: ModuleDeliveryPlanV5 = {
      ...orderedPlan,
      nodes: [reversedNode],
    };
    const ordered = ModuleDeliveryPlanValidationScenario.validate(orderedPlan);
    const reversedNodeResult =
      ModuleDeliveryPlanValidationScenario.validate(reversedNodePlan);
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
      nodes.push(ModuleDeliveryPlanValidationScenario.writeNode(fixture));
      if (previous !== '') {
        const edgeFixture: EdgeFixture = {
          providerTaskId: previous,
          consumerTaskId: taskId,
        };
        edges.push(
          ModuleDeliveryPlanValidationScenario.edgeContract(edgeFixture),
        );
      }
    }
    const fixture: PlanFixture = {
      nodes,
      edgeContracts: edges,
    };
    const result = ModuleDeliveryPlanValidationScenario.validate(
      ModuleDeliveryPlanValidationScenario.plan(fixture),
    );
    expect(result.status).toBe(ModuleDeliveryValidationStatus.Accepted);
    if (result.status !== ModuleDeliveryValidationStatus.Accepted) return;
    expect(result.waves).toHaveLength(5);
  });

  test('rejects malformed transport before semantic validation', () => {
    const result = ModuleDeliveryPlanDecoder.decodeAndValidate('{');
    expect(ModuleDeliveryPlanValidationScenario.codes(result)).toContain(
      ModuleDeliveryIssueCode.MalformedTransport,
    );
  });

  test('rejects non-exact commits and execution limits above policy', () => {
    const fixture: PlanFixture = {
      nodes: DEFAULT_NODES,
      edgeContracts: DEFAULT_EDGES,
    };
    const validPlan = ModuleDeliveryPlanValidationScenario.plan(fixture);
    const invalidPlan: ModuleDeliveryPlanV5 = {
      ...validPlan,
      sourceCommit: 'main',
      maxAgentDepth: 4,
      maxAttempts: 6,
    };
    const result = ModuleDeliveryPlanValidationScenario.validate(invalidPlan);
    expect(ModuleDeliveryPlanValidationScenario.codes(result)).toContain(
      ModuleDeliveryIssueCode.InvalidField,
    );
    expect(ModuleDeliveryPlanValidationScenario.codes(result)).toContain(
      ModuleDeliveryIssueCode.LimitExceeded,
    );
  });

  test('rejects numeric capacity from the plan boundary', () => {
    const fixture: PlanFixture = {
      nodes: DEFAULT_NODES,
      edgeContracts: DEFAULT_EDGES,
    };
    const validPlan = ModuleDeliveryPlanValidationScenario.plan(fixture);
    const capacityPlan = Object.assign(validPlan, { maxConcurrency: 17 });
    const result = ModuleDeliveryPlanValidationScenario.validate(capacityPlan);
    expect(ModuleDeliveryPlanValidationScenario.codes(result)).toContain(
      ModuleDeliveryIssueCode.InvalidField,
    );
  });
});

describe('bounded module delivery plan transport collections', () => {
  const basePlan = ModuleDeliveryPlanValidationScenario.plan({
    nodes: [CORE_NODE],
    edgeContracts: [],
  });

  test('rejects an oversized root node list before node decoding', () => {
    const serialized = JSON.stringify({
      ...basePlan,
      nodes: Array.from(
        { length: MAX_MODULE_DELIVERY_NODES + 1 },
        () => CORE_NODE,
      ),
    });
    ModuleDeliveryPlanTransportCollectionScenario.expectLimitRejection({
      serialized,
      path: '$.nodes',
    });
  });

  test('rejects an oversized edge contract list before edge decoding', () => {
    const serialized = JSON.stringify({
      ...basePlan,
      edgeContracts: Array.from(
        { length: MAX_MODULE_DELIVERY_EDGE_CONTRACTS + 1 },
        () => ({}),
      ),
    });
    ModuleDeliveryPlanTransportCollectionScenario.expectLimitRejection({
      serialized,
      path: '$.edgeContracts',
    });
  });

  test('rejects oversized expected producers before producer decoding', () => {
    const { workspace: _workspace, ...synthesisBase } = CORE_NODE;
    const serialized = JSON.stringify({
      ...basePlan,
      nodes: [
        {
          ...synthesisBase,
          kind: ModuleDeliveryTaskKind.EvidenceSynthesis,
          resources: { read: [], write: [], evidenceSurface: [] },
          evidenceInput: {
            schema:
              ModuleDeliveryEvidenceInputSchema.AcceptedProviderEvidenceV1,
            expectedProducers: Array.from(
              { length: MAX_MODULE_DELIVERY_EXPECTED_PRODUCERS + 1 },
              () => ({}),
            ),
          },
        },
      ],
    });
    ModuleDeliveryPlanTransportCollectionScenario.expectLimitRejection({
      serialized,
      path: '$.nodes[0].evidenceInput.expectedProducers',
    });
  });

  test('rejects oversized nested string arrays before entry decoding', () => {
    const serialized = JSON.stringify({
      ...basePlan,
      parentJoin: {
        ...basePlan.parentJoin,
        validationCommands: Array.from({
          length: MAX_MODULE_DELIVERY_STRING_LIST_ENTRIES + 1,
        }).fill('task validation'),
      },
    });
    ModuleDeliveryPlanTransportCollectionScenario.expectLimitRejection({
      serialized,
      path: '$.parentJoin.validationCommands',
    });
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
    expect(
      ModuleDeliveryPlanValidationScenario.validate(
        ModuleDeliveryPlanValidationScenario.plan(acceptedFixture),
      ).status,
    ).toBe(ModuleDeliveryValidationStatus.Accepted);

    const expertOwnedWasm: ModuleDeliveryWriteNodeV2 = {
      ...WASM_NODE,
      team: TeamKey.Ai,
    };
    const rejectedFixture: PlanFixture = {
      nodes: [CORE_NODE, expertOwnedWasm],
      edgeContracts: [CORE_WASM_EDGE],
    };
    expect(
      ModuleDeliveryPlanValidationScenario.codes(
        ModuleDeliveryPlanValidationScenario.validate(
          ModuleDeliveryPlanValidationScenario.plan(rejectedFixture),
        ),
      ),
    ).toContain(ModuleDeliveryIssueCode.TeamOwnershipMismatch);
  });

  test('permits empty writes only for an explicitly read-only task', () => {
    const auditFixture: ReadOnlyNodeFixture = {
      taskId: 'core-audit',
      expert: 'core_expert',
      moduleRoot: CORE_ROOT,
      dependencies: [],
    };
    const audit =
      ModuleDeliveryPlanValidationScenario.readOnlyNode(auditFixture);
    const acceptedFixture: PlanFixture = { nodes: [audit], edgeContracts: [] };
    expect(
      ModuleDeliveryPlanValidationScenario.validate(
        ModuleDeliveryPlanValidationScenario.plan(acceptedFixture),
      ).status,
    ).toBe(ModuleDeliveryValidationStatus.Accepted);

    const emptyWrite: ModuleDeliveryWriteNodeV2 = {
      ...CORE_NODE,
      resources: { ...CORE_NODE.resources, write: [] },
    };
    const emptyFixture: PlanFixture = {
      nodes: [emptyWrite],
      edgeContracts: [],
    };
    expect(
      ModuleDeliveryPlanValidationScenario.codes(
        ModuleDeliveryPlanValidationScenario.validate(
          ModuleDeliveryPlanValidationScenario.plan(emptyFixture),
        ),
      ),
    ).toContain(ModuleDeliveryIssueCode.InvalidField);

    const readOnlyWriter: ModuleDeliveryReadOnlyNodeV2 = {
      ...audit,
      resources: { ...audit.resources, write: [`${CORE_ROOT}/**`] },
    };
    const writerFixture: PlanFixture = {
      nodes: [readOnlyWriter],
      edgeContracts: [],
    };
    expect(
      ModuleDeliveryPlanValidationScenario.codes(
        ModuleDeliveryPlanValidationScenario.validate(
          ModuleDeliveryPlanValidationScenario.plan(writerFixture),
        ),
      ),
    ).toContain(ModuleDeliveryIssueCode.InvalidField);
  });

  test('accepts evidence claims contained by broader repository reads', () => {
    const auditFixture: ReadOnlyNodeFixture = {
      taskId: 'core-audit',
      expert: 'core_expert',
      moduleRoot: CORE_ROOT,
      dependencies: [],
    };
    const audit =
      ModuleDeliveryPlanValidationScenario.readOnlyNode(auditFixture);
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
      expect(
        ModuleDeliveryPlanValidationScenario.validate(
          ModuleDeliveryPlanValidationScenario.plan(fixture),
        ).status,
      ).toBe(ModuleDeliveryValidationStatus.Accepted);
    }
  });

  test('rejects evidence claims not contained by declared repository reads', () => {
    const auditFixture: ReadOnlyNodeFixture = {
      taskId: 'core-audit',
      expert: 'core_expert',
      moduleRoot: CORE_ROOT,
      dependencies: [],
    };
    const audit =
      ModuleDeliveryPlanValidationScenario.readOnlyNode(auditFixture);
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
      expect(
        ModuleDeliveryPlanValidationScenario.codes(
          ModuleDeliveryPlanValidationScenario.validate(
            ModuleDeliveryPlanValidationScenario.plan(fixture),
          ),
        ),
      ).toContain(ModuleDeliveryIssueCode.EvidenceSurfaceMismatch);
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
      expect(
        ModuleDeliveryPlanValidationScenario.codes(
          ModuleDeliveryPlanValidationScenario.validate(
            ModuleDeliveryPlanValidationScenario.plan(fixture),
          ),
        ),
      ).toContain(failure.code);
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
      const result = ModuleDeliveryPlanValidationScenario.validate(
        ModuleDeliveryPlanValidationScenario.plan(fixture),
      );
      const expected =
        node === excessiveDepth
          ? ModuleDeliveryIssueCode.LimitExceeded
          : ModuleDeliveryIssueCode.BaselineMismatch;
      expect(ModuleDeliveryPlanValidationScenario.codes(result)).toContain(
        expected,
      );
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
    const generatedWriter =
      ModuleDeliveryPlanValidationScenario.writeNode(fixture);
    const planFixture: PlanFixture = {
      nodes: [generatedWriter],
      edgeContracts: [],
    };
    expect(
      ModuleDeliveryPlanValidationScenario.codes(
        ModuleDeliveryPlanValidationScenario.validate(
          ModuleDeliveryPlanValidationScenario.plan(planFixture),
        ),
      ),
    ).toContain(ModuleDeliveryIssueCode.WriteScopeMismatch);
  });
});
