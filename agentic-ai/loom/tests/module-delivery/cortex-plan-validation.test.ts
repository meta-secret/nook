import { describe, expect, test } from 'bun:test';
import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';
import {
  CORTEX_TEAM_WRITER_EXPERT,
  REQUIRED_PARENT_OWNED_RESOURCES,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryEvidenceInputSchema,
  ModuleDeliveryExecutionPrecedenceReason,
  ModuleDeliveryIssueCode,
  ModuleDeliveryJoinKind,
  ModuleDeliveryOwner,
  ModuleDeliveryTaskKind,
  ModuleDeliveryTaskProfile,
  ModuleDeliveryValidationStatus,
  ModuleDeliveryWorkspaceKind,
  decodeAndValidateModuleDeliveryPlan,
} from '../../src/module-delivery/index.ts';
import type {
  ModuleDeliveryExecutionPrecedence,
  ModuleDeliveryEvidenceSynthesisNodeV2,
  ModuleDeliveryNodeV2,
  ModuleDeliveryPlanV3,
  ModuleDeliveryPlanValidation,
  ModuleDeliveryWriteNodeV2,
} from '../../src/module-delivery/index.ts';
import { TeamKey, teamCortexRoot } from '../../src/team-agents/catalog.ts';
import { CORTEX_AUTHORING_SKILL_PATHS } from '../../src/team-agents/context.ts';

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const SRE_SKILL = '.cortex/teams/sre/dynamic-skills/quality.md';

type CortexNodeRequest = {
  readonly taskId: string;
  readonly team: TeamKey;
  readonly write: readonly string[];
  readonly selectedSkillPaths: readonly string[];
  readonly sharedWriteClaims: readonly string[];
};

function cortexNode(request: CortexNodeRequest): ModuleDeliveryWriteNodeV2 {
  return {
    kind: ModuleDeliveryTaskKind.Write,
    taskId: request.taskId,
    team: request.team,
    functionalOwner: request.team,
    acceptanceOwner: request.team,
    parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
    expert: CORTEX_TEAM_WRITER_EXPERT,
    moduleRoot: teamCortexRoot(request.team),
    consumerOutcome: `${request.taskId} Cortex guidance is current.`,
    baseline: {
      kind: ModuleDeliveryBaselineKind.SourceCommit,
      sourceCommit: SOURCE_COMMIT,
    },
    agentDepthLimit: 2,
    dependencies: [],
    resources: {
      read: request.selectedSkillPaths,
      write: request.write,
      evidenceSurface: [],
    },
    cortexAuthoring: {
      selectedSkillPaths: request.selectedSkillPaths,
      sharedWriteClaims: request.sharedWriteClaims,
    },
    parentOwnedExclusions: REQUIRED_PARENT_OWNED_RESOURCES.filter(
      (claim) => claim !== '.cortex/**',
    ),
    acceptance: {
      commands: ['task loom:cortex-audit'],
      evidence: [`${request.taskId} guidance is audited.`],
    },
    workspace: {
      kind: ModuleDeliveryWorkspaceKind.SharedCheckout,
      expectedCommitHandoff: true,
    },
  };
}

function plan(nodes: readonly ModuleDeliveryNodeV2[]): ModuleDeliveryPlanV3 {
  return {
    version: 3,
    generation: 1,
    sourceCommit: SOURCE_COMMIT,
    maxConcurrency: 2,
    maxAgentDepth: 2,
    maxAttempts: 2,
    parentOwnedResources: REQUIRED_PARENT_OWNED_RESOURCES,
    parentJoin: {
      kind: ModuleDeliveryJoinKind.DirectCommits,
      owner: 'gizmo-prime',
      validationCommands: ['task loom:verify'],
    },
    nodes,
    edgeContracts: [],
  };
}

function validate(
  nodes: readonly ModuleDeliveryNodeV2[],
): ModuleDeliveryPlanValidation {
  return decodeAndValidateModuleDeliveryPlan(JSON.stringify(plan(nodes)));
}

function codes(
  result: ModuleDeliveryPlanValidation,
): readonly ModuleDeliveryIssueCode[] {
  if (result.status === ModuleDeliveryValidationStatus.Accepted) return [];
  return result.issues.map((issue) => issue.code);
}

function sreNode(): ModuleDeliveryWriteNodeV2 {
  const request: CortexNodeRequest = {
    taskId: 'sre-cortex-writer',
    team: TeamKey.Sre,
    write: [
      '.cortex/teams/sre/workflows/quality.md',
      '.cortex/shared/product-specs/index.md',
    ],
    selectedSkillPaths: [SRE_SKILL],
    sharedWriteClaims: ['.cortex/shared/product-specs/index.md'],
  };
  return cortexNode(request);
}

function ordinaryDevCoreWrite(): ModuleDeliveryWriteNodeV2 {
  const node = cortexNode({
    taskId: 'dev-core-write',
    team: TeamKey.DevelopmentCore,
    write: ['nook-app/nook-platform/nook-core/src/**'],
    selectedSkillPaths: [],
    sharedWriteClaims: [],
  });
  Reflect.deleteProperty(node, 'cortexAuthoring');
  return {
    ...node,
    functionalOwner: TeamKey.DevelopmentCore,
    acceptanceOwner: TeamKey.DevelopmentCore,
    expert: ModuleDeliveryTaskProfile.Ordinary,
    moduleRoot: 'nook-app/nook-platform/nook-core',
    parentOwnedExclusions: REQUIRED_PARENT_OWNED_RESOURCES,
  };
}

describe('Cortex module-delivery plan validation', () => {
  test('keeps ordinary synthesis and Gizmo ownership fail-closed', () => {
    const write = ordinaryDevCoreWrite();
    expect(validate([write]).status).toBe(
      ModuleDeliveryValidationStatus.Accepted,
    );
    expect(
      validate([
        {
          ...write,
          functionalOwner: ModuleDeliveryOwner.GizmoPrime,
          acceptanceOwner: ModuleDeliveryOwner.GizmoPrime,
        },
      ]).status,
    ).toBe(ModuleDeliveryValidationStatus.Rejected);
    const synthesis: ModuleDeliveryEvidenceSynthesisNodeV2 = {
      ...write,
      kind: ModuleDeliveryTaskKind.EvidenceSynthesis,
      resources: { read: [], write: [], evidenceSurface: [] },
      evidenceInput: {
        schema: ModuleDeliveryEvidenceInputSchema.AcceptedProviderEvidenceV1,
        expectedProducers: [],
      },
    };
    Reflect.deleteProperty(synthesis, 'workspace');
    expect(validate([synthesis]).status).toBe(
      ModuleDeliveryValidationStatus.Rejected,
    );
  });

  test('admits team scope and exact shared-subtree grants', () => {
    const result = validate([sreNode()]);
    expect(result.status).toBe(ModuleDeliveryValidationStatus.Accepted);
    if (result.status !== ModuleDeliveryValidationStatus.Accepted) return;
    expect(result.plan.nodes[0]?.resources.read).toEqual([
      '.cortex/teams/sre/AGENTS.md',
      '.cortex/teams/sre/knowledge-graph.md',
      ...CORTEX_AUTHORING_SKILL_PATHS,
      SRE_SKILL,
    ]);
  });

  test('admits only an exact Gizmo grant owned by Gizmo Prime and written by AI', () => {
    const claim = '.cortex/gizmo/workflows/subagent-delegation.md';
    const gizmo: ModuleDeliveryWriteNodeV2 = {
      ...cortexNode({
        taskId: 'gizmo-workflow',
        team: TeamKey.Ai,
        write: [claim],
        selectedSkillPaths: [],
        sharedWriteClaims: [claim],
      }),
      functionalOwner: ModuleDeliveryOwner.GizmoPrime,
      acceptanceOwner: ModuleDeliveryOwner.GizmoPrime,
    };
    expect(validate([gizmo]).status).toBe(
      ModuleDeliveryValidationStatus.Accepted,
    );
    for (const invalid of [
      { ...gizmo, team: TeamKey.Sre },
      { ...gizmo, acceptanceOwner: TeamKey.Ai },
      {
        ...gizmo,
        resources: { ...gizmo.resources, write: ['.cortex/gizmo/**'] },
        cortexAuthoring: {
          selectedSkillPaths: [],
          sharedWriteClaims: ['.cortex/gizmo/**'],
        },
      },
      {
        ...gizmo,
        resources: {
          ...gizmo.resources,
          write: ['.cortex/gizmo/workflows'],
        },
        cortexAuthoring: {
          selectedSkillPaths: [],
          sharedWriteClaims: ['.cortex/gizmo/workflows'],
        },
      },
    ])
      expect(validate([invalid]).status).toBe(
        ModuleDeliveryValidationStatus.Rejected,
      );
    const forgedOwner = structuredClone(gizmo);
    Object.assign(forgedOwner, { functionalOwner: 'forged-owner' });
    expect(validate([forgedOwner]).status).toBe(
      ModuleDeliveryValidationStatus.Rejected,
    );
  });

  test('rejects foreign, broad, and authority-file grants', () => {
    const foreign: ModuleDeliveryWriteNodeV2 = {
      ...sreNode(),
      resources: {
        ...sreNode().resources,
        write: ['.cortex/teams/security/workflows/quality.md'],
      },
      cortexAuthoring: {
        selectedSkillPaths: [SRE_SKILL],
        sharedWriteClaims: [],
      },
    };
    expect(codes(validate([foreign]))).toContain(
      ModuleDeliveryIssueCode.ParentOwnedWrite,
    );
    const unauthorizedSkillRequest: CortexNodeRequest = {
      taskId: 'unauthorized-skill',
      team: TeamKey.Sre,
      write: ['.cortex/teams/sre/workflows/quality.md'],
      selectedSkillPaths: [
        '.cortex/teams/security/dynamic-skills/security-review.md',
      ],
      sharedWriteClaims: [],
    };
    const unauthorizedSkillNode: ModuleDeliveryWriteNodeV2 = {
      ...cortexNode(unauthorizedSkillRequest),
      resources: {
        read: [],
        write: unauthorizedSkillRequest.write,
        evidenceSurface: [],
      },
    };
    expect(codes(validate([unauthorizedSkillNode]))).toContain(
      ModuleDeliveryIssueCode.InvalidField,
    );
    for (const claim of ['.cortex/shared/**', '.cortex/AGENTS.md']) {
      const invalid: ModuleDeliveryWriteNodeV2 = {
        ...sreNode(),
        resources: { ...sreNode().resources, write: [claim] },
        cortexAuthoring: {
          selectedSkillPaths: [SRE_SKILL],
          sharedWriteClaims: [claim],
        },
      };
      expect(codes(validate([invalid]))).toContain(
        ModuleDeliveryIssueCode.InvalidField,
      );
    }
  });

  test('treats resolved context as a generation read hazard', () => {
    const aiRequest: CortexNodeRequest = {
      taskId: 'zzz-policy-writer',
      team: TeamKey.Ai,
      write: [CORTEX_AUTHORING_SKILL_PATHS[0]],
      selectedSkillPaths: [],
      sharedWriteClaims: [],
    };
    const consumer: ModuleDeliveryWriteNodeV2 = {
      ...sreNode(),
      taskId: 'aaa-consumer',
    };
    const result = validate([cortexNode(aiRequest), consumer]);
    expect(result.status).toBe(ModuleDeliveryValidationStatus.Accepted);
    if (result.status !== ModuleDeliveryValidationStatus.Accepted) return;
    const precedence: ModuleDeliveryExecutionPrecedence = {
      predecessorTaskId: 'zzz-policy-writer',
      successorTaskId: 'aaa-consumer',
      reason: ModuleDeliveryExecutionPrecedenceReason.ResourceConflict,
      requiresIntegratedWriterFrontier: true,
    };
    expect(result.executionPrecedence).toContainEqual(precedence);
    expect(result.waves).toEqual([['zzz-policy-writer'], ['aaa-consumer']]);
  });

  test('rejects authored duplicate and over-capacity composed reads', () => {
    const duplicate: ModuleDeliveryWriteNodeV2 = {
      ...sreNode(),
      resources: {
        ...sreNode().resources,
        read: [SRE_SKILL, SRE_SKILL],
      },
    };
    expect(codes(validate([duplicate]))).toContain(
      ModuleDeliveryIssueCode.InvalidField,
    );

    const authoredReads = [SRE_SKILL];
    for (let index = 0; index < 127; index += 1)
      authoredReads.push(`docs/context-${index}.md`);
    const overCapacity: ModuleDeliveryWriteNodeV2 = {
      ...sreNode(),
      resources: { ...sreNode().resources, read: authoredReads },
    };
    expect(codes(validate([overCapacity]))).toContain(
      ModuleDeliveryIssueCode.InvalidField,
    );
  });
});
