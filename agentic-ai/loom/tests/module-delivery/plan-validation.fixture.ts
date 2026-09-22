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
  ModuleDeliveryAcceptanceCommand,
  ModuleDeliveryBaseline,
  ModuleDeliveryNodeV2,
  ModuleDeliveryPlanV6,
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
            kind: ModuleDeliveryBaselineKind.FeatureBranch,
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
        commands: [
          {
            selector: `task ${fixture.taskId}:test`,
            read: fixture.read,
            write: fixture.write,
            output: [],
          },
        ],
        evidence: [`${fixture.taskId} behavior passes`],
      },
      workspace: {
        kind: ModuleDeliveryWorkspaceKind.WorkerWorktree,
        workerRole:
          fixture.expert === 'web_expert'
            ? 'typescript-specialist'
            : 'rust-core-developer',
        workerBranch: `codex/child/${fixture.expert === 'web_expert' ? 'web-dev/typescript-specialist' : 'dev-core/rust-core-developer'}/module-delivery-test/${fixture.taskId}-implementation-work`,
        worktreePath: `/tmp/nook-module-delivery/${fixture.taskId}`,
      },
    };
  }

  static readOnlyNode(
    fixture: ReadOnlyNodeFixture,
  ): ModuleDeliveryReadOnlyNodeV2 {
    const baseline: ModuleDeliveryBaseline =
      fixture.dependencies.length === 0
        ? {
            kind: ModuleDeliveryBaselineKind.FeatureBranch,
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
        commands: [
          {
            selector: `task ${fixture.taskId}:audit`,
            read: [`${fixture.moduleRoot}/**`],
            write: [],
            output: [`${fixture.moduleRoot}/**`],
          },
        ],
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

  static plan(fixture: PlanFixture): ModuleDeliveryPlanV6 {
    return new ModuleDeliveryPlanValidationScenario(fixture).execute();
  }

  private execute(): ModuleDeliveryPlanV6 {
    const fixture = this.request;
    return {
      version: 6,
      baseBranch: 'origin/main',
      featureBranch: 'codex/module-delivery-test',
      generation: 1,
      maxAgentDepth: 3,
      maxAttempts: 2,
      parentOwnedResources: PARENT_OWNED_RESOURCES,
      parentJoin: {
        kind: ModuleDeliveryJoinKind.WorkerBranches,
        owner: 'delivery-owner',
        validationCommands: ['task loom:verify'],
      },
      nodes: fixture.nodes,
      edgeContracts: fixture.edgeContracts,
    };
  }

  static validate(value: ModuleDeliveryPlanV6): ModuleDeliveryPlanValidation {
    return ModuleDeliveryPlanDecoder.decodeAndValidate(JSON.stringify(value));
  }

  static acceptanceCommand(
    request: Readonly<{ node: ModuleDeliveryNodeV2; selector: string }>,
  ): ModuleDeliveryAcceptanceCommand {
    return {
      selector: request.selector,
      read: request.node.resources.read,
      write: request.node.resources.write,
      output: request.node.resources.evidenceSurface,
    };
  }

  static emptyAcceptanceCommand(
    selector: string,
  ): ModuleDeliveryAcceptanceCommand {
    return { selector, read: [], write: [], output: [] };
  }

  static acceptsNode(node: ModuleDeliveryNodeV2): boolean {
    return (
      ModuleDeliveryPlanValidationScenario.validate(
        ModuleDeliveryPlanValidationScenario.plan({
          nodes: [node],
          edgeContracts: [],
        }),
      ).status === ModuleDeliveryValidationStatus.Accepted
    );
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
        kind: ModuleDeliveryJoinKind.WorkerBranches,
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
            kind: ModuleDeliveryBaselineKind.FeatureBranch,
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

const SOURCE_COMMIT = '3'.repeat(40);

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
