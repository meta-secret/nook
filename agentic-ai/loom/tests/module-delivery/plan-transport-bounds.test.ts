import { expect, test } from 'bun:test';
import {
  MAX_MODULE_DELIVERY_PLAN_AGGREGATE_NODES,
  MAX_MODULE_DELIVERY_PLAN_AGGREGATE_STRING_CODE_UNITS,
  MAX_MODULE_DELIVERY_PLAN_DEPTH,
  MAX_MODULE_DELIVERY_PLAN_OBJECT_KEYS,
  ModuleDeliveryCompatibilityStatus,
  ModuleDeliveryIssueCode,
  ModuleDeliveryPlanSchema,
} from '../../src/module-delivery/index.ts';
import { ModuleDeliveryPlanValidationScenario } from './plan-validation.fixture.ts';

const basePlan = ModuleDeliveryPlanValidationScenario.plan({
  nodes: [],
  edgeContracts: [],
});

const expectTransportLimit = (serialized: string): void => {
  const result =
    ModuleDeliveryPlanSchema.decodeCompatibleModuleDeliveryPlan(serialized);
  expect(result.status).toBe(ModuleDeliveryCompatibilityStatus.Rejected);
  if (result.status !== ModuleDeliveryCompatibilityStatus.Rejected) return;
  expect(result.issues[0]?.code).toBe(ModuleDeliveryIssueCode.LimitExceeded);
};

test('rejects deeply nested module-plan transport before boundary conversion', () => {
  let deeplyNested: unknown = 'safe';
  for (let depth = 0; depth <= MAX_MODULE_DELIVERY_PLAN_DEPTH; depth += 1)
    deeplyNested = [deeplyNested];
  expectTransportLimit(
    JSON.stringify({ ...basePlan, parentOwnedResources: [deeplyNested] }),
  );
});

test('rejects module-plan objects with too many keys before boundary conversion', () => {
  const oversizedObject = Object.fromEntries(
    Array.from({ length: MAX_MODULE_DELIVERY_PLAN_OBJECT_KEYS + 1 }, (_, index) => [
      `extra-${index}`,
      true,
    ]),
  );
  expectTransportLimit(
    JSON.stringify({ ...basePlan, parentJoin: oversizedObject }),
  );
});

test('rejects aggregate module-plan nodes before boundary conversion', () => {
  const nestedArrays = Array.from({ length: 128 }, () =>
    Array.from({ length: 128 }, () => [false, false]),
  );
  expectTransportLimit(
    JSON.stringify({ ...basePlan, parentOwnedResources: nestedArrays }),
  );
  expect(MAX_MODULE_DELIVERY_PLAN_AGGREGATE_NODES).toBeGreaterThan(0);
});

test('rejects aggregate module-plan strings before boundary conversion', () => {
  const stringLength = Math.ceil(
    (MAX_MODULE_DELIVERY_PLAN_AGGREGATE_STRING_CODE_UNITS + 1) / 128,
  );
  expectTransportLimit(
    JSON.stringify({
      ...basePlan,
      parentOwnedResources: Array.from({ length: 128 }, () =>
        'x'.repeat(stringLength),
      ),
    }),
  );
});
