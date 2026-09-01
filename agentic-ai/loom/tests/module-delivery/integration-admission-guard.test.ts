import { describe, expect, test } from 'bun:test';
import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';
import {
  REQUIRED_PARENT_OWNED_RESOURCES,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryCompatibilityStatus,
  ModuleDeliveryExecutionPrecedenceReason,
  ModuleDeliveryIssueCode,
  ModuleDeliveryJoinKind,
  ModuleDeliveryTaskKind,
  ModuleDeliveryValidationStatus,
  ModuleDeliveryWorkspaceKind,
  decodeAndValidateModuleDeliveryPlan,
  decodeCompatibleModuleDeliveryPlan,
} from '../../src/module-delivery/index.ts';
import { uncoveredEvidenceClaims } from '../../src/module-delivery/resource-claim-containment.ts';
import { TeamKey } from '../../src/team-agents/catalog.ts';
import type {
  LegacyModuleDeliveryPlan,
  ModuleDeliveryEdgeContract,
  ModuleDeliveryNodeV2,
  ModuleDeliveryPlanV2,
  ModuleDeliveryPlanValidation,
  ModuleDeliveryReadOnlyNodeV2,
  ModuleDeliveryWriteNodeV2,
  ValidatedModuleDeliveryPlan,
} from '../../src/module-delivery/index.ts';

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const CORE_ROOT = 'nook-app/nook-platform/nook-core';

type ReadNodeFixture = {
  readonly taskId: string;
  readonly dependencies: readonly string[];
  readonly evidenceSurface: readonly string[];
};

type WriteNodeFixture = {
  readonly taskId: string;
  readonly dependencies: readonly string[];
};

type PlanFixture = {
  readonly sourceCommit: string;
  readonly nodes: readonly ModuleDeliveryNodeV2[];
  readonly edgeContracts: readonly ModuleDeliveryEdgeContract[];
};

type EdgeFixture = {
  readonly providerTaskId: string;
  readonly consumerTaskId: string;
};

function baseline(dependencies: readonly string[]) {
  return dependencies.length === 0
    ? {
        kind: ModuleDeliveryBaselineKind.SourceCommit as const,
        sourceCommit: SOURCE_COMMIT,
      }
    : {
        kind: ModuleDeliveryBaselineKind.IntegratedDependencies as const,
        providerTaskIds: dependencies,
      };
}

function readNode(fixture: ReadNodeFixture): ModuleDeliveryReadOnlyNodeV2 {
  return {
    kind: ModuleDeliveryTaskKind.ReadOnly,
    taskId: fixture.taskId,
    team: TeamKey.DevelopmentCore,
    functionalOwner: TeamKey.Ai,
    acceptanceOwner: TeamKey.Ai,
    parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
    expert: 'core_expert',
    moduleRoot: CORE_ROOT,
    consumerOutcome: `${fixture.taskId} reports evidence.`,
    baseline: baseline(fixture.dependencies),
    agentDepthLimit: 2,
    dependencies: fixture.dependencies,
    resources: {
      read: [`${CORE_ROOT}/**`],
      write: [],
      evidenceSurface: fixture.evidenceSurface,
    },
    parentOwnedExclusions: REQUIRED_PARENT_OWNED_RESOURCES,
    acceptance: {
      commands: [`task ${fixture.taskId}:audit`],
      evidence: [`${fixture.taskId} is reviewed.`],
    },
  };
}

function writeNode(fixture: WriteNodeFixture): ModuleDeliveryWriteNodeV2 {
  return {
    kind: ModuleDeliveryTaskKind.Write,
    taskId: fixture.taskId,
    team: TeamKey.DevelopmentCore,
    functionalOwner: TeamKey.Ai,
    acceptanceOwner: TeamKey.Ai,
    parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
    expert: 'core_expert',
    moduleRoot: CORE_ROOT,
    consumerOutcome: `${fixture.taskId} publishes implementation.`,
    baseline: baseline(fixture.dependencies),
    agentDepthLimit: 2,
    dependencies: fixture.dependencies,
    resources: {
      read: [`${CORE_ROOT}/**`],
      write: [`${CORE_ROOT}/src/**`],
      evidenceSurface: [],
    },
    parentOwnedExclusions: REQUIRED_PARENT_OWNED_RESOURCES,
    acceptance: {
      commands: [`task ${fixture.taskId}:test`],
      evidence: [`${fixture.taskId} passes.`],
    },
    workspace: {
      kind: ModuleDeliveryWorkspaceKind.SharedCheckout,
      expectedCommitHandoff: true,
    },
  };
}

function edge(fixture: EdgeFixture) {
  const value: ModuleDeliveryEdgeContract = {
    providerTaskId: fixture.providerTaskId,
    consumerTaskId: fixture.consumerTaskId,
    capability: `${fixture.providerTaskId} capability`,
    publicTypes: [`${fixture.providerTaskId}Result`],
    errors: [`${fixture.providerTaskId}Error`],
    behaviorInvariants: ['The capability is deterministic.'],
    securityInvariants: ['Provider state remains protected.'],
    compatibilityExpectations: ['The consumer accepts the capability.'],
    owningTests: [`${fixture.providerTaskId} contract test`],
  };
  return value;
}

function plan(fixture: PlanFixture): ModuleDeliveryPlanV2 {
  return {
    version: 2,
    generation: 1,
    sourceCommit: fixture.sourceCommit,
    maxConcurrency: 3,
    maxAgentDepth: 3,
    maxAttempts: 2,
    parentOwnedResources: REQUIRED_PARENT_OWNED_RESOURCES,
    parentJoin: {
      kind: ModuleDeliveryJoinKind.DirectCommits,
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

function validated(value: ModuleDeliveryPlanV2): ValidatedModuleDeliveryPlan {
  const result = validate(value);
  if (result.status !== ModuleDeliveryValidationStatus.Accepted) {
    throw new Error(JSON.stringify(result.issues));
  }
  return result;
}

function issueCodes(
  value: ModuleDeliveryPlanValidation,
): readonly ModuleDeliveryIssueCode[] {
  return value.status === ModuleDeliveryValidationStatus.Rejected
    ? value.issues.map(({ code }) => code)
    : [];
}

function legacyPlan(): LegacyModuleDeliveryPlan {
  return {
    version: 1,
    sourceCommit: SOURCE_COMMIT,
    maxConcurrency: 1,
    maxAgentDepth: 2,
    maxAttempts: 2,
    parentOwnedResources: REQUIRED_PARENT_OWNED_RESOURCES,
    parentJoin: {
      kind: ModuleDeliveryJoinKind.DirectCommits,
      owner: 'delivery-owner',
      validationCommands: ['task loom:verify'],
    },
    nodes: [
      {
        kind: ModuleDeliveryTaskKind.ReadOnly,
        taskId: 'legacy-audit',
        expert: 'core_expert',
        moduleRoot: CORE_ROOT,
        consumerOutcome: 'Compatibility evidence is decoded only.',
        baseline: {
          kind: ModuleDeliveryBaselineKind.SourceCommit,
          sourceCommit: SOURCE_COMMIT,
        },
        agentDepthLimit: 2,
        dependencies: [],
        resources: { read: [`${CORE_ROOT}/**`], write: [] },
        parentOwnedExclusions: REQUIRED_PARENT_OWNED_RESOURCES,
        acceptance: {
          commands: ['task legacy:audit'],
          evidence: ['Legacy evidence is present.'],
        },
      },
    ],
    edgeContracts: [],
  };
}

describe('validation-only runtime boundary', () => {
  test('keeps direct glob evidence containment single-segment', () => {
    const recursiveRoot = {
      read: [`${CORE_ROOT}/*`],
      evidenceSurface: [`${CORE_ROOT}/**`],
    };
    const recursiveSubdirectory = {
      read: [`${CORE_ROOT}/src/*`],
      evidenceSurface: [`${CORE_ROOT}/src/**`],
    };
    const extensionAgainstSubtree = {
      read: [`${CORE_ROOT}/*.rs`],
      evidenceSurface: [`${CORE_ROOT}/**`],
    };
    expect(uncoveredEvidenceClaims(recursiveRoot)).toEqual(
      recursiveRoot.evidenceSurface,
    );
    expect(uncoveredEvidenceClaims(recursiveSubdirectory)).toEqual(
      recursiveSubdirectory.evidenceSurface,
    );
    expect(uncoveredEvidenceClaims(extensionAgainstSubtree)).toEqual(
      extensionAgainstSubtree.evidenceSurface,
    );

    const narrowerDirectGlob = {
      read: [`${CORE_ROOT}/src/*`],
      evidenceSurface: [`${CORE_ROOT}/src/*.rs`],
    };
    const narrowerExactPath = {
      read: [`${CORE_ROOT}/src/*.rs`],
      evidenceSurface: [`${CORE_ROOT}/src/lib.rs`],
    };
    expect(uncoveredEvidenceClaims(narrowerDirectGlob)).toEqual([]);
    expect(uncoveredEvidenceClaims(narrowerExactPath)).toEqual([]);
  });

  test('keeps compatibility decode separate from canonical validation', () => {
    const serialized = JSON.stringify(legacyPlan());
    const compatibility = decodeCompatibleModuleDeliveryPlan(serialized);
    expect(compatibility.status).toBe(
      ModuleDeliveryCompatibilityStatus.Decoded,
    );
    const canonical = decodeAndValidateModuleDeliveryPlan(serialized);
    expect(canonical.status).toBe(ModuleDeliveryValidationStatus.Rejected);
    expect(issueCodes(canonical)).toContain(
      ModuleDeliveryIssueCode.InvalidField,
    );
  });

  test('derives evidence hazards without semantic edges or plan mutation', () => {
    const writerFixture: WriteNodeFixture = {
      taskId: 'writer',
      dependencies: [],
    };
    const writer = writeNode(writerFixture);
    const auditFixture: ReadNodeFixture = {
      taskId: 'audit',
      dependencies: [],
      evidenceSurface: [`${CORE_ROOT}/src/**`],
    };
    const audit = readNode(auditFixture);
    const planFixture: PlanFixture = {
      sourceCommit: SOURCE_COMMIT,
      nodes: [audit, writer],
      edgeContracts: [],
    };
    const value = plan(planFixture);
    const result = validated(value);
    expect(result.topologicalOrder).toEqual(['writer', 'audit']);
    expect(result.plan).toEqual(value);
    expect(result.plan.edgeContracts).toEqual([]);
    const expected = {
      predecessorTaskId: 'writer',
      successorTaskId: 'audit',
      reason: ModuleDeliveryExecutionPrecedenceReason.EvidenceHazard,
      requiresIntegratedWriterFrontier: true,
    };
    expect(result.executionPrecedence).toContainEqual(expected);
  });

  test('rejects evidence-before-writer cycles in the combined graph', () => {
    const auditFixture: ReadNodeFixture = {
      taskId: 'audit',
      dependencies: [],
      evidenceSurface: [`${CORE_ROOT}/src/**`],
    };
    const writerFixture: WriteNodeFixture = {
      taskId: 'writer',
      dependencies: ['audit'],
    };
    const audit = readNode(auditFixture);
    const writer = writeNode(writerFixture);
    const edgeFixture: EdgeFixture = {
      providerTaskId: 'audit',
      consumerTaskId: 'writer',
    };
    const planFixture: PlanFixture = {
      sourceCommit: SOURCE_COMMIT,
      nodes: [audit, writer],
      edgeContracts: [edge(edgeFixture)],
    };
    const value = plan(planFixture);
    expect(issueCodes(validate(value))).toContain(
      ModuleDeliveryIssueCode.DependencyCycle,
    );
  });

  test('records deterministic conflict and non-writer frontier semantics', () => {
    const firstFixture: WriteNodeFixture = {
      taskId: 'writer-a',
      dependencies: [],
    };
    const secondFixture: WriteNodeFixture = {
      taskId: 'writer-b',
      dependencies: [],
    };
    const firstWriter = writeNode(firstFixture);
    const secondWriter = writeNode(secondFixture);
    const conflictFixture: PlanFixture = {
      sourceCommit: SOURCE_COMMIT,
      nodes: [secondWriter, firstWriter],
      edgeContracts: [],
    };
    const conflictValue = plan(conflictFixture);
    const conflict = validated(conflictValue);
    const expectedConflict = {
      predecessorTaskId: 'writer-a',
      successorTaskId: 'writer-b',
      reason: ModuleDeliveryExecutionPrecedenceReason.ResourceConflict,
      requiresIntegratedWriterFrontier: true,
    };
    expect(conflict.executionPrecedence).toContainEqual(expectedConflict);

    const providerFixture: ReadNodeFixture = {
      taskId: 'audit-a',
      dependencies: [],
      evidenceSurface: [`${CORE_ROOT}/src/a/**`],
    };
    const consumerFixture: ReadNodeFixture = {
      taskId: 'audit-b',
      dependencies: ['audit-a'],
      evidenceSurface: [`${CORE_ROOT}/src/b/**`],
    };
    const provider = readNode(providerFixture);
    const consumer = readNode(consumerFixture);
    const edgeFixture: EdgeFixture = {
      providerTaskId: 'audit-a',
      consumerTaskId: 'audit-b',
    };
    const declaredFixture: PlanFixture = {
      sourceCommit: SOURCE_COMMIT,
      nodes: [consumer, provider],
      edgeContracts: [edge(edgeFixture)],
    };
    const declaredValue = plan(declaredFixture);
    const declared = validated(declaredValue);
    const expectedDeclared = {
      predecessorTaskId: 'audit-a',
      successorTaskId: 'audit-b',
      reason: ModuleDeliveryExecutionPrecedenceReason.DeclaredDependency,
      requiresIntegratedWriterFrontier: false,
    };
    expect(declared.executionPrecedence).toContainEqual(expectedDeclared);
  });

  test('rejects nested lineage until trusted admission binds context', () => {
    const rootFixture: ReadNodeFixture = {
      taskId: 'nested-audit',
      dependencies: [],
      evidenceSurface: [`${CORE_ROOT}/src/**`],
    };
    const root = readNode(rootFixture);
    const nested: ModuleDeliveryReadOnlyNodeV2 = {
      ...root,
      parentLineage: {
        kind: AgentAttemptParentKind.AgentAttempt,
        task: 'parent-task',
        agent: 'parent-agent',
        attempt: 1,
      },
    };
    const planFixture: PlanFixture = {
      sourceCommit: SOURCE_COMMIT,
      nodes: [nested],
      edgeContracts: [],
    };
    const value = plan(planFixture);
    expect(issueCodes(validate(value))).toContain(
      ModuleDeliveryIssueCode.ParentLineageMismatch,
    );
  });
});
