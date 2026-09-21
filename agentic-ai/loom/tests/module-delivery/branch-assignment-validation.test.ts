import { expect, test } from 'bun:test';

import {
  ModuleDeliveryIssueCode,
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
