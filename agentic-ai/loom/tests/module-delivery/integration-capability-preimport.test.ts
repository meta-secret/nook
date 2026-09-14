import { expect, test } from 'bun:test';

import { ModuleDeliveryWorktreeTestSupportScenario } from './worktree-test-support.ts';

import type { ModuleDeliveryIntegratedWriterFrontierCapability } from '../../src/module-delivery/integration-contracts.ts';
import type { GitFixture } from './worktree-test-support.ts';

test('pre-importing capability assertions cannot preempt coordinator minting', async () => {
  const bridgeKey = Symbol.for(
    'nook.loom.module-integration-capability-bridge',
  );
  const forgedBridge = Object.freeze({
    frontierProvenance: () => ({ authority: {} }),
    transitionProvenance: () => ({ authority: {} }),
  });
  const forgedBridges = [forgedBridge];
  Object.defineProperty(globalThis, bridgeKey, {
    configurable: true,
    enumerable: false,
    value: forgedBridges,
    writable: true,
  });
  let fixture: GitFixture | undefined;
  try {
    const preimport = await import(
      '../../src/module-delivery/integration-capabilities.ts'
    );
    expect(Object.hasOwn(preimport, 'bindMintAuthority')).toBe(false);
    expect(Object.hasOwn(preimport, 'registerIntegratedWriterFrontier')).toBe(
      false,
    );
    expect(
      Object.hasOwn(
        preimport.ModuleIntegrationCapabilityRegistry,
        'bindMintAuthority',
      ),
    ).toBe(false);
    expect(
      Object.hasOwn(
        preimport.ModuleIntegrationCapabilityRegistry,
        'registerIntegratedWriterFrontier',
      ),
    ).toBe(false);

    const coordinator = await import('../../src/module-delivery/integration.ts');
    expect(coordinator.ModuleIntegrationCoordinator).toBeDefined();
    expect(forgedBridges).toHaveLength(1);

    const { ModuleDeliveryEvidenceScenario } = await import(
      './evidence-test-support.ts'
    );
    fixture =
      ModuleDeliveryWorktreeTestSupportScenario.createGitFixture();
    const authority = ModuleDeliveryEvidenceScenario.runtime(fixture).authority;

    const capability: ModuleDeliveryIntegratedWriterFrontierCapability = {
      taskId: 'preimport-forged-task',
      attempt: 1,
      generation: 1,
      planDigest: 'preimport-forged-plan',
      headCommit: 'preimport-forged-head',
      integratedTaskIds: Object.freeze([]),
    };
    expect(() =>
      preimport.ModuleIntegrationCapabilityRegistry.assertModuleDeliveryIntegratedWriterFrontierCapability(
        {
          authority,
          capability: Object.freeze(capability),
          taskId: capability.taskId,
          attempt: capability.attempt,
          generation: capability.generation,
          planDigest: capability.planDigest,
          headCommit: capability.headCommit,
          integratedTaskIds: capability.integratedTaskIds,
        },
      ),
    ).toThrow('capability is invalid');

    forgedBridges.push(forgedBridge);
    expect(() =>
      preimport.ModuleIntegrationCapabilityRegistry.assertModuleDeliveryIntegratedWriterFrontierCapability(
        {
          authority,
          capability: Object.freeze(capability),
          taskId: capability.taskId,
          attempt: capability.attempt,
          generation: capability.generation,
          planDigest: capability.planDigest,
          headCommit: capability.headCommit,
          integratedTaskIds: capability.integratedTaskIds,
        },
      ),
    ).toThrow('capability is invalid');
  } finally {
    Reflect.deleteProperty(globalThis, bridgeKey);
    if (fixture)
      ModuleDeliveryWorktreeTestSupportScenario.disposeGitFixture(fixture);
  }
});
