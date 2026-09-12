import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';

import {
  REQUIRED_PARENT_OWNED_RESOURCES,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryIssueCode,
  ModuleDeliveryJoinKind,
  ModuleDeliveryTaskKind,
  ModuleDeliveryValidationStatus,
  ModuleDeliveryWorkspaceKind,
  ModuleDeliveryPlanDecoder,
} from '../../src/module-delivery/index.ts';

import type {
  LegacyModuleDeliveryPlan,
  ModuleDeliveryEdgeContract,
  ModuleDeliveryBaseline,
  ModuleDeliveryNodeV2,
  ModuleDeliveryPlanV2,
  ModuleDeliveryPlanValidation,
  ModuleDeliveryReadOnlyNodeV2,
  ModuleDeliveryWriteNodeV2,
} from '../../src/module-delivery/index.ts';

import { TeamKey } from '../../src/team-agents/catalog.ts';
export class ModuleDeliveryPlanValidationScenario {
  private constructor(private readonly request: PlanFixture) {}

  static writeNode(fixture: WriteNodeFixture): ModuleDeliveryWriteNodeV2 {
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
        kind: ModuleDeliveryWorkspaceKind.SharedCheckout,
        expectedCommitHandoff: true,
      },
    };
  }

  static readOnlyNode(
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

  static edgeContract(fixture: EdgeFixture): ModuleDeliveryEdgeContract {
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

  static plan(fixture: PlanFixture): ModuleDeliveryPlanV2 {
    return new ModuleDeliveryPlanValidationScenario(fixture).execute();
  }

  private execute(): ModuleDeliveryPlanV2 {
    const fixture = this.request;
    return {
      version: 2,
      generation: 1,
      sourceCommit: SOURCE_COMMIT,
      maxConcurrency: 3,
      maxAgentDepth: 3,
      maxAttempts: 2,
      parentOwnedResources: PARENT_OWNED_RESOURCES,
      parentJoin: {
        kind: ModuleDeliveryJoinKind.DirectCommits,
        owner: 'delivery-owner',
        validationCommands: ['task loom:verify'],
      },
      nodes: fixture.nodes,
      edgeContracts: fixture.edgeContracts,
    };
  }

  static validate(value: ModuleDeliveryPlanV2): ModuleDeliveryPlanValidation {
    return ModuleDeliveryPlanDecoder.decodeAndValidate(JSON.stringify(value));
  }

  static legacyPlan(): LegacyModuleDeliveryPlan {
    return {
      version: 1,
      sourceCommit: SOURCE_COMMIT,
      maxConcurrency: 1,
      maxAgentDepth: 2,
      maxAttempts: 2,
      parentOwnedResources: PARENT_OWNED_RESOURCES,
      parentJoin: {
        kind: ModuleDeliveryJoinKind.DirectCommits,
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

  static codes(
    result: ModuleDeliveryPlanValidation,
  ): readonly ModuleDeliveryIssueCode[] {
    if (result.status === ModuleDeliveryValidationStatus.Accepted) return [];
    return result.issues.map((entry) => entry.code);
  }
}

export const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

export const PARENT_OWNED_RESOURCES: readonly string[] = [
  ...REQUIRED_PARENT_OWNED_RESOURCES,
];

export type WriteNodeFixture = {
  readonly taskId: string;
  readonly expert: string;
  readonly moduleRoot: string;
  readonly dependencies: readonly string[];
  readonly read: readonly string[];
  readonly write: readonly string[];
};

export type ReadOnlyNodeFixture = {
  readonly taskId: string;
  readonly expert: string;
  readonly moduleRoot: string;
  readonly dependencies: readonly string[];
};

export type EdgeFixture = {
  readonly providerTaskId: string;
  readonly consumerTaskId: string;
};

export type PlanFixture = {
  readonly nodes: readonly ModuleDeliveryNodeV2[];
  readonly edgeContracts: readonly ModuleDeliveryEdgeContract[];
};

export const CORE_ROOT = 'nook-app/nook-platform/nook-core';
