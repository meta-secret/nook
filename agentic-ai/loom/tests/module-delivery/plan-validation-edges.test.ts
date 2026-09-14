import { describe, expect, test } from 'bun:test';

import {
  ModuleDeliveryBaselineKind,
  ModuleDeliveryExecutionPrecedenceReason,
  ModuleDeliveryIssueCode,
  ModuleDeliveryValidationStatus,
} from '../../src/module-delivery/index.ts';
import type {
  ModuleDeliveryEdgeContract,
  ModuleDeliveryExecutionPrecedence,
  ModuleDeliveryNodeV2,
  ModuleDeliveryWriteNodeV2,
} from '../../src/module-delivery/index.ts';

import {
  ModuleDeliveryPlanValidationScenario,
  CORE_ROOT,
} from './plan-validation.fixture.ts';
import type {
  EdgeFixture,
  PlanFixture,
  WriteNodeFixture,
} from './plan-validation.fixture.ts';

const WEB_ROOT = 'nook-app/nook-web/nook-web-app';

const CORE_FIXTURE: WriteNodeFixture = {
  taskId: 'core-provider',
  expert: 'core_expert',
  moduleRoot: CORE_ROOT,
  dependencies: [],
  read: [`${CORE_ROOT}/**`],
  write: [`${CORE_ROOT}/**`],
};

const CORE_NODE = ModuleDeliveryPlanValidationScenario.writeNode(CORE_FIXTURE);

const WASM_FIXTURE: WriteNodeFixture = {
  taskId: 'wasm-adapter',
  expert: 'internal_api_expert',
  moduleRoot: 'nook-app/nook-platform/nook-wasm',
  dependencies: ['core-provider'],
  read: [`${CORE_ROOT}/**`],
  write: ['nook-app/nook-platform/nook-wasm/**'],
};

const WASM_NODE = ModuleDeliveryPlanValidationScenario.writeNode(WASM_FIXTURE);

const WEB_FIXTURE: WriteNodeFixture = {
  taskId: 'web-consumer',
  expert: 'web_expert',
  moduleRoot: WEB_ROOT,
  dependencies: ['wasm-adapter'],
  read: ['nook-app/nook-platform/nook-wasm/**'],
  write: [`${WEB_ROOT}/**`],
};

const WEB_NODE = ModuleDeliveryPlanValidationScenario.writeNode(WEB_FIXTURE);

const CORE_WASM_EDGE = ModuleDeliveryPlanValidationScenario.edgeContract({
  providerTaskId: 'core-provider',
  consumerTaskId: 'wasm-adapter',
});

const WASM_WEB_EDGE = ModuleDeliveryPlanValidationScenario.edgeContract({
  providerTaskId: 'wasm-adapter',
  consumerTaskId: 'web-consumer',
});

describe('dependency edges and resource safety', () => {
  test('requires exact edge contracts for fan-in and multiple consumers', () => {
    const secondConsumerFixture: WriteNodeFixture = {
      taskId: 'web-second',
      expert: 'web_expert',
      moduleRoot: WEB_ROOT,
      dependencies: ['core-provider'],
      read: [`${CORE_ROOT}/**`],
      write: [`${WEB_ROOT}/src/second/**`],
    };
    const secondConsumer = ModuleDeliveryPlanValidationScenario.writeNode(
      secondConsumerFixture,
    );
    const fanInConsumer: ModuleDeliveryWriteNodeV2 = {
      ...WEB_NODE,
      dependencies: ['core-provider', 'wasm-adapter'],
      baseline: {
        kind: ModuleDeliveryBaselineKind.IntegratedDependencies,
        providerTaskIds: ['core-provider', 'wasm-adapter'],
      },
      resources: {
        ...WEB_NODE.resources,
        write: [`${WEB_ROOT}/src/first/**`],
      },
    };
    const coreWebFixture: EdgeFixture = {
      providerTaskId: 'core-provider',
      consumerTaskId: 'web-consumer',
    };
    const coreSecondFixture: EdgeFixture = {
      providerTaskId: 'core-provider',
      consumerTaskId: 'web-second',
    };
    const completeEdges: readonly ModuleDeliveryEdgeContract[] = [
      CORE_WASM_EDGE,
      WASM_WEB_EDGE,
      ModuleDeliveryPlanValidationScenario.edgeContract(coreWebFixture),
      ModuleDeliveryPlanValidationScenario.edgeContract(coreSecondFixture),
    ];
    const nodes: readonly ModuleDeliveryNodeV2[] = [
      CORE_NODE,
      WASM_NODE,
      fanInConsumer,
      secondConsumer,
    ];
    const completeFixture: PlanFixture = {
      nodes,
      edgeContracts: completeEdges,
    };
    expect(
      ModuleDeliveryPlanValidationScenario.validate(
        ModuleDeliveryPlanValidationScenario.plan(completeFixture),
      ).status,
    ).toBe(ModuleDeliveryValidationStatus.Accepted);

    const missingFixture: PlanFixture = {
      nodes,
      edgeContracts: completeEdges.slice(1),
    };
    expect(
      ModuleDeliveryPlanValidationScenario.codes(
        ModuleDeliveryPlanValidationScenario.validate(
          ModuleDeliveryPlanValidationScenario.plan(missingFixture),
        ),
      ),
    ).toContain(ModuleDeliveryIssueCode.MissingEdgeContract);

    const unexpectedFixtureValue: EdgeFixture = {
      providerTaskId: 'web-consumer',
      consumerTaskId: 'core-provider',
    };
    const unexpectedEdges = [
      ...completeEdges,
      ModuleDeliveryPlanValidationScenario.edgeContract(unexpectedFixtureValue),
    ];
    const unexpectedFixture: PlanFixture = {
      nodes,
      edgeContracts: unexpectedEdges,
    };
    expect(
      ModuleDeliveryPlanValidationScenario.codes(
        ModuleDeliveryPlanValidationScenario.validate(
          ModuleDeliveryPlanValidationScenario.plan(unexpectedFixture),
        ),
      ),
    ).toContain(ModuleDeliveryIssueCode.UnexpectedEdgeContract);
  });

  test('serializes concurrent overlap and permits ordered overlap', () => {
    const siblingFixture: WriteNodeFixture = {
      ...CORE_FIXTURE,
      taskId: 'core-sibling',
    };
    const sibling =
      ModuleDeliveryPlanValidationScenario.writeNode(siblingFixture);
    const concurrentFixture: PlanFixture = {
      nodes: [CORE_NODE, sibling],
      edgeContracts: [],
    };
    const concurrent = ModuleDeliveryPlanValidationScenario.validate(
      ModuleDeliveryPlanValidationScenario.plan(concurrentFixture),
    );
    if (concurrent.status !== ModuleDeliveryValidationStatus.Accepted)
      throw new Error(JSON.stringify(concurrent.issues));
    const precedence: ModuleDeliveryExecutionPrecedence = {
      predecessorTaskId: 'core-provider',
      successorTaskId: 'core-sibling',
      reason: ModuleDeliveryExecutionPrecedenceReason.ResourceConflict,
      requiresIntegratedWriterFrontier: true,
    };
    expect(concurrent.executionPrecedence).toContainEqual(precedence);

    const orderedSibling: ModuleDeliveryWriteNodeV2 = {
      ...sibling,
      dependencies: ['core-provider'],
      baseline: {
        kind: ModuleDeliveryBaselineKind.IntegratedDependencies,
        providerTaskIds: ['core-provider'],
      },
    };
    const orderedEdgeFixture: EdgeFixture = {
      providerTaskId: 'core-provider',
      consumerTaskId: 'core-sibling',
    };
    const orderedFixture: PlanFixture = {
      nodes: [orderedSibling, CORE_NODE],
      edgeContracts: [
        ModuleDeliveryPlanValidationScenario.edgeContract(orderedEdgeFixture),
      ],
    };
    expect(
      ModuleDeliveryPlanValidationScenario.validate(
        ModuleDeliveryPlanValidationScenario.plan(orderedFixture),
      ).status,
    ).toBe(ModuleDeliveryValidationStatus.Accepted);
  });

  test('rejects missing, self, cyclic dependencies and protected writes', () => {
    const missing: ModuleDeliveryWriteNodeV2 = {
      ...CORE_NODE,
      dependencies: ['missing-provider'],
    };
    const missingFixture: PlanFixture = { nodes: [missing], edgeContracts: [] };
    expect(
      ModuleDeliveryPlanValidationScenario.codes(
        ModuleDeliveryPlanValidationScenario.validate(
          ModuleDeliveryPlanValidationScenario.plan(missingFixture),
        ),
      ),
    ).toContain(ModuleDeliveryIssueCode.MissingDependency);

    const self: ModuleDeliveryWriteNodeV2 = {
      ...CORE_NODE,
      dependencies: ['core-provider'],
    };
    const selfFixture: PlanFixture = { nodes: [self], edgeContracts: [] };
    expect(
      ModuleDeliveryPlanValidationScenario.codes(
        ModuleDeliveryPlanValidationScenario.validate(
          ModuleDeliveryPlanValidationScenario.plan(selfFixture),
        ),
      ),
    ).toContain(ModuleDeliveryIssueCode.SelfDependency);

    const cyclicCore: ModuleDeliveryWriteNodeV2 = {
      ...CORE_NODE,
      dependencies: ['wasm-adapter'],
    };
    const cycleFixture: PlanFixture = {
      nodes: [cyclicCore, WASM_NODE],
      edgeContracts: [CORE_WASM_EDGE, WASM_WEB_EDGE],
    };
    expect(
      ModuleDeliveryPlanValidationScenario.codes(
        ModuleDeliveryPlanValidationScenario.validate(
          ModuleDeliveryPlanValidationScenario.plan(cycleFixture),
        ),
      ),
    ).toContain(ModuleDeliveryIssueCode.DependencyCycle);

    const protectedWrite: ModuleDeliveryWriteNodeV2 = {
      ...CORE_NODE,
      resources: { ...CORE_NODE.resources, write: ['Cargo.lock'] },
    };
    const protectedFixture: PlanFixture = {
      nodes: [protectedWrite],
      edgeContracts: [],
    };
    expect(
      ModuleDeliveryPlanValidationScenario.codes(
        ModuleDeliveryPlanValidationScenario.validate(
          ModuleDeliveryPlanValidationScenario.plan(protectedFixture),
        ),
      ),
    ).toContain(ModuleDeliveryIssueCode.ParentOwnedWrite);
  });
});
