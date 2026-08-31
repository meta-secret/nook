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

test('requires recursive or file-shaped ordinary write claims', () => {
  for (const write of ['infra', 'infra/k0s'])
    expect(
      accepted(
        ordinaryWrite({ team: TeamKey.Sre, moduleRoot: 'infra', write }),
      ),
    ).toBe(false);
  for (const write of ['infra/**', 'infra/k0s/**', 'infra/main.tf'])
    expect(
      accepted(
        ordinaryWrite({ team: TeamKey.Sre, moduleRoot: 'infra', write }),
      ),
    ).toBe(true);
  expect(
    accepted(
      ordinaryWrite({
        team: TeamKey.DevelopmentCore,
        moduleRoot: 'agentic-ai/minds/Cargo.lock',
        write: 'agentic-ai/minds/Cargo.lock',
      }),
    ),
  ).toBe(true);
});

test('routes the web Docker subtree exclusively to SRE', () => {
  const request = {
    moduleRoot: 'nook-app/nook-web/docker',
    write: 'nook-app/nook-web/docker/web.Dockerfile',
  } as const;
  expect(accepted(ordinaryWrite({ team: TeamKey.Sre, ...request }))).toBe(true);
  expect(
    accepted(ordinaryWrite({ team: TeamKey.WebDevelopment, ...request })),
  ).toBe(false);
});

test('routes web Taskfile orchestration exclusively to SRE', () => {
  for (const write of [
    'nook-app/nook-web/Taskfile.yml',
    'nook-app/nook-web/docker/Taskfile.yml',
    'nook-app/nook-web/nook-web-extension/Taskfile.yml',
  ]) {
    expect(
      accepted(ordinaryWrite({ team: TeamKey.Sre, moduleRoot: write, write })),
    ).toBe(true);
    expect(
      accepted(
        ordinaryWrite({
          team: TeamKey.WebDevelopment,
          moduleRoot: 'nook-app/nook-web',
          write,
        }),
      ),
    ).toBe(false);
  }
});

test('rejects globs that overlap a more-specific foreign root', () => {
  expect(
    accepted(
      ordinaryWrite({
        team: TeamKey.WebDevelopment,
        moduleRoot: 'nook-app/nook-web/nook-web-app',
        write: 'nook-app/nook-web/nook-web-app/*',
      }),
    ),
  ).toBe(false);
  expect(
    accepted(
      ordinaryWrite({
        team: TeamKey.WebDevelopment,
        moduleRoot: 'nook-app/nook-web/nook-web-app',
        write: 'nook-app/nook-web/nook-web-app/src/*.ts',
      }),
    ),
  ).toBe(true);
});

test('routes app Docker build definitions exclusively to SRE', () => {
  for (const write of [
    'nook-app/nook-web/nook-web-app/Dockerfile',
    'nook-app/nook-web/nook-web-app/docker-bake.hcl',
  ]) {
    expect(
      accepted(ordinaryWrite({ team: TeamKey.Sre, moduleRoot: write, write })),
    ).toBe(true);
    expect(
      accepted(
        ordinaryWrite({
          team: TeamKey.WebDevelopment,
          moduleRoot: 'nook-app/nook-web/nook-web-app',
          write,
        }),
      ),
    ).toBe(false);
  }
});

test('separates portable platform Rust from operational ownership', () => {
  const rust = {
    moduleRoot: 'nook-app/nook-platform/nook-core',
    write: 'nook-app/nook-platform/nook-core/src/lib.rs',
  } as const;
  expect(
    accepted(ordinaryWrite({ team: TeamKey.DevelopmentCore, ...rust })),
  ).toBe(true);
  for (const request of [
    {
      moduleRoot: 'nook-app/nook-platform/fuzz/.cargo/audit.toml',
      write: 'nook-app/nook-platform/fuzz/.cargo/audit.toml',
    },
    {
      moduleRoot: 'nook-app/nook-platform/nook-core/docker-bake.hcl',
      write: 'nook-app/nook-platform/nook-core/docker-bake.hcl',
    },
    {
      moduleRoot: 'nook-app/nook-platform/docker',
      write: 'nook-app/nook-platform/docker/sccache-report.sh',
    },
    { moduleRoot: 'preflight', write: 'preflight/tests/infra.rs' },
  ] as const) {
    expect(
      accepted(ordinaryWrite({ team: TeamKey.DevelopmentCore, ...request })),
    ).toBe(false);
    expect(accepted(ordinaryWrite({ team: TeamKey.Sre, ...request }))).toBe(
      true,
    );
  }
});

test('keeps the AI task registry out of broad SRE task ownership', () => {
  const aiRegistry = {
    moduleRoot: '.task/agentic-ai.yml',
    write: '.task/agentic-ai.yml',
  } as const;
  expect(accepted(ordinaryWrite({ team: TeamKey.Ai, ...aiRegistry }))).toBe(
    true,
  );
  expect(accepted(ordinaryWrite({ team: TeamKey.Sre, ...aiRegistry }))).toBe(
    false,
  );
  expect(
    accepted(
      ordinaryWrite({
        team: TeamKey.Sre,
        moduleRoot: '.task',
        write: '.task/ci-workflows.yml',
      }),
    ),
  ).toBe(true);
});
