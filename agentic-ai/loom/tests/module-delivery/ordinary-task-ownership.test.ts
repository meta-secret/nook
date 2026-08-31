import { expect, test } from 'bun:test';

import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';
import {
  MODULE_DELIVERY_PLAN_VERSION,
  REQUIRED_PARENT_OWNED_RESOURCES,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryJoinKind,
  ModuleDeliveryTaskKind,
  ModuleDeliveryTaskProfile,
  ModuleDeliveryValidationStatus,
  ModuleDeliveryWorkspaceKind,
  TeamKey,
  decodeAndValidateModuleDeliveryPlan,
} from '../../src/module-delivery/index.ts';

import type {
  ModuleDeliveryPlanV2,
  ModuleDeliveryWriteNodeV2,
} from '../../src/module-delivery/index.ts';

const SOURCE_COMMIT = '1'.repeat(40);

function ordinaryWrite(request: {
  readonly team: TeamKey;
  readonly moduleRoot: string;
  readonly write: string;
}): ModuleDeliveryWriteNodeV2 {
  return {
    kind: ModuleDeliveryTaskKind.Write,
    taskId: 'ordinary-writer',
    team: request.team,
    functionalOwner: TeamKey.Ai,
    acceptanceOwner: TeamKey.Ai,
    parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
    expert: ModuleDeliveryTaskProfile.Ordinary,
    moduleRoot: request.moduleRoot,
    consumerOutcome: 'The bounded team-owned change is delivered.',
    baseline: {
      kind: ModuleDeliveryBaselineKind.SourceCommit,
      sourceCommit: SOURCE_COMMIT,
    },
    agentDepthLimit: 1,
    dependencies: [],
    resources: { read: [], write: [request.write], evidenceSurface: [] },
    parentOwnedExclusions: REQUIRED_PARENT_OWNED_RESOURCES,
    acceptance: { commands: ['task test'], evidence: ['tests pass'] },
    workspace: {
      kind: ModuleDeliveryWorkspaceKind.IsolatedWorktree,
      expectedCommitHandoff: true,
    },
  };
}

function accepted(node: ModuleDeliveryWriteNodeV2): boolean {
  const plan: ModuleDeliveryPlanV2 = {
    version: MODULE_DELIVERY_PLAN_VERSION,
    generation: 1,
    sourceCommit: SOURCE_COMMIT,
    maxConcurrency: 1,
    maxAgentDepth: 1,
    maxAttempts: 1,
    parentOwnedResources: REQUIRED_PARENT_OWNED_RESOURCES,
    parentJoin: {
      kind: ModuleDeliveryJoinKind.OrderedCommitHandoffs,
      owner: 'delivery-owner',
      validationCommands: ['task test'],
    },
    nodes: [node],
    edgeContracts: [],
  };
  return (
    decodeAndValidateModuleDeliveryPlan(JSON.stringify(plan)).status ===
    ModuleDeliveryValidationStatus.Accepted
  );
}

test('limits Development Core minds writes to Rust-owned surfaces', () => {
  expect(
    accepted(
      ordinaryWrite({
        team: TeamKey.DevelopmentCore,
        moduleRoot: 'agentic-ai/minds/hive/src',
        write: 'agentic-ai/minds/hive/src/model.rs',
      }),
    ),
  ).toBe(true);
  for (const [moduleRoot, write] of [
    ['agentic-ai/minds', 'agentic-ai/minds/README.md'],
    [
      'agentic-ai/minds/hive/controller',
      'agentic-ai/minds/hive/controller/reaper.ts',
    ],
    [
      'agentic-ai/minds/hive-console',
      'agentic-ai/minds/hive-console/src/App.svelte',
    ],
  ] as const)
    expect(
      accepted(
        ordinaryWrite({ team: TeamKey.DevelopmentCore, moduleRoot, write }),
      ),
    ).toBe(false);
});

test('routes Hive Console writes to Web Development', () => {
  expect(
    accepted(
      ordinaryWrite({
        team: TeamKey.WebDevelopment,
        moduleRoot: 'agentic-ai/minds/hive-console',
        write: 'agentic-ai/minds/hive-console/src/App.svelte',
      }),
    ),
  ).toBe(true);
});
