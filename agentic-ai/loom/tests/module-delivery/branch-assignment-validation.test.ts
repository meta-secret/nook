import { expect, test } from 'bun:test';

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
