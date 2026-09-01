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
  ModuleDeliveryPlanV3,
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
      kind: ModuleDeliveryWorkspaceKind.SharedCheckout,
      expectedCommitHandoff: true,
    },
  };
}

function accepted(node: ModuleDeliveryWriteNodeV2): boolean {
  const plan: ModuleDeliveryPlanV3 = {
    version: MODULE_DELIVERY_PLAN_VERSION,
    generation: 1,
    sourceCommit: SOURCE_COMMIT,
    maxConcurrency: 1,
    maxAgentDepth: 1,
    maxAttempts: 1,
    parentOwnedResources: REQUIRED_PARENT_OWNED_RESOURCES,
    parentJoin: {
      kind: ModuleDeliveryJoinKind.DirectCommits,
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

test('requires bounded ordinary write claims and admits exact extensionless paths', () => {
  for (const write of ['infra'])
    expect(
      accepted(
        ordinaryWrite({ team: TeamKey.Sre, moduleRoot: 'infra', write }),
      ),
    ).toBe(false);
  for (const write of [
    'infra/**',
    'infra/k0s/**',
    'infra/main.tf',
    'infra/k0s/scripts/k0s-worker-mesh-reconcile',
  ])
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

test('routes the extension deployment verifier exclusively to SRE', () => {
  const write =
    'nook-app/nook-web/nook-web-extension/scripts/verify-deployment.sh';
  expect(
    accepted(ordinaryWrite({ team: TeamKey.Sre, moduleRoot: write, write })),
  ).toBe(true);
  expect(
    accepted(
      ordinaryWrite({
        team: TeamKey.WebDevelopment,
        moduleRoot: 'nook-app/nook-web/nook-web-extension',
        write,
      }),
    ),
  ).toBe(false);
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

test('rejects globs spanning multiple owners', () => {
  for (const team of [TeamKey.Sre, TeamKey.WebDevelopment])
    expect(
      accepted(
        ordinaryWrite({
          team,
          moduleRoot: 'nook-app/nook-web',
          write: 'nook-app/nook-web/**',
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
  expect(
    accepted(
      ordinaryWrite({
        team: TeamKey.Sre,
        moduleRoot: 'infra',
        write: 'infra/*.tf',
      }),
    ),
  ).toBe(true);
});

test('routes app build orchestration exclusively to SRE', () => {
  for (const write of [
    'agentic-ai/minds/Taskfile.yml',
    'nook-app/Taskfile.yml',
    'nook-app/docker-bake.hcl',
    'nook-app/nook-web/nook-web-extension/scripts/hosted-extension.sh',
    'nook-app/nook-web/nook-web-extension/scripts/hosted-extension.test.sh',
    'nook-app/nook-web/nook-web-extension/scripts/run-with-xvfb.sh',
    'nook-app/nook-web/nook-web-extension/scripts/setup-brave-vault.mjs',
    'nook-app/nook-web/nook-web-extension/scripts/setup-brave-vault.sh',
    'nook-app/nook-web/nook-web-extension/scripts/setup-brave-vault.test.sh',
    'nook-app/nook-web/nook-web-extension/scripts/test-e2e.sh',
    'nook-app/nook-web/nook-web-extension/scripts/test-hosted-smoke.sh',
    'nook-app/nook-web/nook-web-extension/scripts/test-hosted-smoke.test.sh',
    'nook-app/nook-web/nook-web-extension/scripts/verify-deployment.sh',
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
          moduleRoot: write,
          write,
        }),
      ),
    ).toBe(false);
  }
});

test('routes AI preflight contracts separately from SRE preflight', () => {
  const contract = {
    moduleRoot: 'preflight/tests/loom_contracts.rs',
    write: 'preflight/tests/loom_contracts.rs',
  } as const;
  expect(accepted(ordinaryWrite({ team: TeamKey.Ai, ...contract }))).toBe(true);
  expect(accepted(ordinaryWrite({ team: TeamKey.Sre, ...contract }))).toBe(
    false,
  );
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

test('keeps exact-file deletion and descendants in separate ownership', () => {
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
  for (const write of [
    '.task/agentic-ai.yml/child.yml',
    '.task/agentic-ai.yml/**',
  ])
    for (const team of [TeamKey.Ai, TeamKey.Sre])
      expect(
        accepted(
          ordinaryWrite({
            team,
            moduleRoot: team === TeamKey.Ai ? '.task/agentic-ai.yml' : '.task',
            write,
          }),
        ),
      ).toBe(false);
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
