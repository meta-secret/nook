import { expect, test } from 'bun:test';

import type { ModuleDeliveryGenerationAuthority } from '../../src/module-delivery/admission.ts';
import type { ModuleDeliveryIntegratedWriterFrontierCapability } from '../../src/module-delivery/integration-contracts.ts';

const capabilityModuleUrl = new URL(
  '../../src/module-delivery/integration-capabilities.ts',
  import.meta.url,
);
const integrationModuleUrl = new URL(
  '../../src/module-delivery/integration.ts',
  import.meta.url,
);

test('pre-importing capability assertions cannot preempt coordinator minting', async () => {
  const preimport = await import(capabilityModuleUrl.href);
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

  const coordinator = await import(integrationModuleUrl.href);
  expect(coordinator.ModuleIntegrationCoordinator).toBeDefined();

  const capability: ModuleDeliveryIntegratedWriterFrontierCapability = {
    taskId: 'preimport-forged-task',
    attempt: 1,
    generation: 1,
    planDigest: 'preimport-forged-plan',
    headCommit: 'preimport-forged-head',
    integratedTaskIds: Object.freeze([]),
  };
  const authority = {} as ModuleDeliveryGenerationAuthority;
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
});
