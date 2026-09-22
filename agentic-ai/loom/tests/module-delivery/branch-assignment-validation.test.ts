import { expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ModuleDeliveryIssueCode,
  ModuleDeliveryPlanDecoder,
  ModuleDeliveryValidationStatus,
} from '../../src/module-delivery/index.ts';
import type { ModuleDeliveryWriteNodeV2 } from '../../src/module-delivery/index.ts';
import {
  CORE_ROOT,
  ModuleDeliveryPlanValidationScenario,
} from './plan-validation.fixture.ts';

test('binds every canonical worker branch to its assigned team and feature', () => {
  const node = ModuleDeliveryPlanValidationScenario.writeNode({
    taskId: 'core-provider',
    expert: 'core_expert',
    moduleRoot: CORE_ROOT,
    dependencies: [],
    read: [`${CORE_ROOT}/**`],
    write: [`${CORE_ROOT}/**`],
  });
  const mismatchedWorker: ModuleDeliveryWriteNodeV2 = {
    ...node,
    workspace: {
      ...node.workspace,
      workerBranch:
        'codex/child/sre/provisioning/module-delivery-test/core-provider-implementation-work',
    },
  };
  const result = ModuleDeliveryPlanValidationScenario.validate(
    ModuleDeliveryPlanValidationScenario.plan({
      nodes: [mismatchedWorker],
      edgeContracts: [],
    }),
  );
  expect(result.status).toBe(ModuleDeliveryValidationStatus.Rejected);
  expect(ModuleDeliveryPlanValidationScenario.codes(result)).toContain(
    ModuleDeliveryIssueCode.InvalidField,
  );
});

test('binds every canonical worker branch to its assigned role', () => {
  const node = ModuleDeliveryPlanValidationScenario.writeNode({
    taskId: 'core-provider',
    expert: 'core_expert',
    moduleRoot: CORE_ROOT,
    dependencies: [],
    read: [`${CORE_ROOT}/**`],
    write: [`${CORE_ROOT}/**`],
  });
  const mismatchedWorker: ModuleDeliveryWriteNodeV2 = {
    ...node,
    workspace: {
      ...node.workspace,
      workerBranch:
        'codex/child/dev-core/rust-auth2-developer/module-delivery-test/core-provider-implementation-work',
    },
  };
  const result = ModuleDeliveryPlanValidationScenario.validate(
    ModuleDeliveryPlanValidationScenario.plan({
      nodes: [mismatchedWorker],
      edgeContracts: [],
    }),
  );
  expect(result.status).toBe(ModuleDeliveryValidationStatus.Rejected);
  expect(ModuleDeliveryPlanValidationScenario.codes(result)).toContain(
    ModuleDeliveryIssueCode.InvalidField,
  );
});

test('accepts canonical roles outside the Loom runtime catalog', () => {
  const webNode = ModuleDeliveryPlanValidationScenario.writeNode({
    taskId: 'web-designer',
    expert: 'web_expert',
    moduleRoot: 'nook-app/nook-web/nook-web-app',
    dependencies: [],
    read: ['nook-app/nook-web/nook-web-app/**'],
    write: ['nook-app/nook-web/nook-web-app/**'],
  });
  const assignedWebDesigner: ModuleDeliveryWriteNodeV2 = {
    ...webNode,
    workspace: {
      ...webNode.workspace,
      workerRole: 'web-designer',
      workerBranch:
        'codex/child/web-dev/web-designer/module-delivery-test/web-designer-implementation',
    },
  };
  expect(
    ModuleDeliveryPlanValidationScenario.validate(
      ModuleDeliveryPlanValidationScenario.plan({
        nodes: [assignedWebDesigner],
        edgeContracts: [],
      }),
    ).status,
  ).toBe(ModuleDeliveryValidationStatus.Accepted);
});

test('rejects equivalent normalized worker worktree paths', () => {
  const first = ModuleDeliveryPlanValidationScenario.writeNode({
    taskId: 'core-provider',
    expert: 'core_expert',
    moduleRoot: CORE_ROOT,
    dependencies: [],
    read: [`${CORE_ROOT}/**`],
    write: [`${CORE_ROOT}/provider/**`],
  });
  const second = ModuleDeliveryPlanValidationScenario.writeNode({
    taskId: 'core-consumer',
    expert: 'core_expert',
    moduleRoot: CORE_ROOT,
    dependencies: [],
    read: [`${CORE_ROOT}/**`],
    write: [`${CORE_ROOT}/consumer/**`],
  });
  const result = ModuleDeliveryPlanValidationScenario.validate(
    ModuleDeliveryPlanValidationScenario.plan({
      nodes: [
        first,
        {
          ...second,
          workspace: {
            ...second.workspace,
            worktreePath:
              '/tmp/nook-module-delivery/../nook-module-delivery/core-provider',
          },
        },
      ],
      edgeContracts: [],
    }),
  );
  expect(ModuleDeliveryPlanValidationScenario.codes(result)).toContain(
    ModuleDeliveryIssueCode.InvalidField,
  );
});

test('rejects nested worker worktree paths in either order', () => {
  const first = ModuleDeliveryPlanValidationScenario.writeNode({
    taskId: 'core-provider',
    expert: 'core_expert',
    moduleRoot: CORE_ROOT,
    dependencies: [],
    read: [`${CORE_ROOT}/**`],
    write: [`${CORE_ROOT}/provider/**`],
  });
  const second = ModuleDeliveryPlanValidationScenario.writeNode({
    taskId: 'core-consumer',
    expert: 'core_expert',
    moduleRoot: CORE_ROOT,
    dependencies: [],
    read: [`${CORE_ROOT}/**`],
    write: [`${CORE_ROOT}/consumer/**`],
  });
  const parent = '/tmp/nook-module-delivery/core-provider';
  const child = `${parent}/nested-consumer`;
  for (const [firstPath, secondPath] of [
    [parent, child],
    [child, parent],
  ] as const) {
    const result = ModuleDeliveryPlanValidationScenario.validate(
      ModuleDeliveryPlanValidationScenario.plan({
        nodes: [
          {
            ...first,
            workspace: { ...first.workspace, worktreePath: firstPath },
          },
          {
            ...second,
            workspace: { ...second.workspace, worktreePath: secondPath },
          },
        ],
        edgeContracts: [],
      }),
    );
    expect(ModuleDeliveryPlanValidationScenario.codes(result)).toContain(
      ModuleDeliveryIssueCode.InvalidField,
    );
  }
});

test('rejects trailing-separator and symlink aliases of one worktree', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'nook-worktree-identity-'));
  try {
    const worktree = join(temporaryRoot, 'worker');
    const alias = join(temporaryRoot, 'worker-alias');
    mkdirSync(worktree);
    symlinkSync(worktree, alias);
    const first = ModuleDeliveryPlanValidationScenario.writeNode({
      taskId: 'core-provider',
      expert: 'core_expert',
      moduleRoot: CORE_ROOT,
      dependencies: [],
      read: [`${CORE_ROOT}/**`],
      write: [`${CORE_ROOT}/provider/**`],
    });
    const second = ModuleDeliveryPlanValidationScenario.writeNode({
      taskId: 'core-consumer',
      expert: 'core_expert',
      moduleRoot: CORE_ROOT,
      dependencies: [],
      read: [`${CORE_ROOT}/**`],
      write: [`${CORE_ROOT}/consumer/**`],
    });
    for (const duplicatePath of [`${worktree}/`, alias]) {
      const result = ModuleDeliveryPlanValidationScenario.validate(
        ModuleDeliveryPlanValidationScenario.plan({
          nodes: [
            {
              ...first,
              workspace: { ...first.workspace, worktreePath: worktree },
            },
            {
              ...second,
              workspace: {
                ...second.workspace,
                worktreePath: duplicatePath,
              },
            },
          ],
          edgeContracts: [],
        }),
      );
      expect(ModuleDeliveryPlanValidationScenario.codes(result)).toContain(
        ModuleDeliveryIssueCode.InvalidField,
      );
    }
    expect(realpathSync(alias)).toBe(realpathSync(worktree));
  } finally {
    rmSync(temporaryRoot, { recursive: true });
  }
});

test('rejects nested uncreated worktrees beneath a symlinked parent', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'nook-worktree-parent-'));
  try {
    const realParent = join(temporaryRoot, 'real');
    const alias = join(temporaryRoot, 'alias');
    mkdirSync(realParent);
    symlinkSync(realParent, alias);
    const first = ModuleDeliveryPlanValidationScenario.writeNode({
      taskId: 'core-provider',
      expert: 'core_expert',
      moduleRoot: CORE_ROOT,
      dependencies: [],
      read: [`${CORE_ROOT}/**`],
      write: [`${CORE_ROOT}/provider/**`],
    });
    const second = ModuleDeliveryPlanValidationScenario.writeNode({
      taskId: 'core-consumer',
      expert: 'core_expert',
      moduleRoot: CORE_ROOT,
      dependencies: [],
      read: [`${CORE_ROOT}/**`],
      write: [`${CORE_ROOT}/consumer/**`],
    });
    const result = ModuleDeliveryPlanValidationScenario.validate(
      ModuleDeliveryPlanValidationScenario.plan({
        nodes: [
          {
            ...first,
            workspace: {
              ...first.workspace,
              worktreePath: join(realParent, 'outer'),
            },
          },
          {
            ...second,
            workspace: {
              ...second.workspace,
              worktreePath: join(alias, 'outer', 'nested'),
            },
          },
        ],
        edgeContracts: [],
      }),
    );
    expect(ModuleDeliveryPlanValidationScenario.codes(result)).toContain(
      ModuleDeliveryIssueCode.InvalidField,
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true });
  }
});

test('returns a typed rejection for a retired child feature ref', () => {
  const plan = ModuleDeliveryPlanValidationScenario.plan({
    nodes: [],
    edgeContracts: [],
  });
  const result = ModuleDeliveryPlanDecoder.decodeAndValidate(
    JSON.stringify({
      ...plan,
      featureBranch: 'codex/child/ai/loom-specialist/retired-feature/work',
    }),
  );
  expect(result.status).toBe(ModuleDeliveryValidationStatus.Rejected);
  expect(ModuleDeliveryPlanValidationScenario.codes(result)).toContain(
    ModuleDeliveryIssueCode.InvalidField,
  );
});
