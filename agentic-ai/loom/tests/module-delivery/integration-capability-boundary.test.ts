import { expect, test } from 'bun:test';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ModuleIntegrationCapabilityRegistry } from '../../src/module-delivery/integration-capabilities.ts';

import type { ModuleDeliveryGenerationAuthority } from '../../src/module-delivery/admission.ts';
import type { ModuleDeliveryIntegratedWriterFrontierCapability } from '../../src/module-delivery/integration-contracts.ts';
import type { ModuleIntegrationCoordinator } from '../../src/module-delivery/integration.ts';

const CAPABILITY_MODULE_PATH = fileURLToPath(
  new URL('../../src/module-delivery/integration-capabilities.ts', import.meta.url),
);

test('keeps capability minting behind the coordinator boundary', async () => {
  const capabilitySource = readFileSync(CAPABILITY_MODULE_PATH, 'utf8');
  expect(capabilitySource).not.toMatch(
    /static\s+(?:mintIntegratedWriterFrontier|canonicalEvidenceTransition)\s*\(/u,
  );

  const directModule = await import(
    '../../src/module-delivery/integration-capabilities.ts'
  );
  expect(Object.hasOwn(directModule, 'mintIntegratedWriterFrontier')).toBe(
    false,
  );
  expect(
    Object.hasOwn(
      directModule.ModuleIntegrationCapabilityRegistry,
      'mintIntegratedWriterFrontier',
    ),
  ).toBe(false);
  expect(
    Object.hasOwn(
      directModule.ModuleIntegrationCapabilityRegistry,
      'canonicalEvidenceTransition',
    ),
  ).toBe(false);

  const rawCapability: ModuleDeliveryIntegratedWriterFrontierCapability = {
    taskId: 'raw-task',
    attempt: 1,
    generation: 1,
    planDigest: 'raw-plan',
    headCommit: 'raw-head',
    integratedTaskIds: Object.freeze([]),
  };
  const rawAuthority = {} as ModuleIntegrationCoordinator;
  expect(() =>
    ModuleIntegrationCapabilityRegistry.registerIntegratedWriterFrontier({
      authority: rawAuthority,
      capability: Object.freeze(rawCapability),
      provenance: Object.freeze({
        ...rawCapability,
        authority: {} as ModuleDeliveryGenerationAuthority,
      }),
    }),
  ).toThrow('mint authority');

  expect(() =>
    ModuleIntegrationCapabilityRegistry.registerCanonicalEvidenceTransition({
      authority: rawAuthority,
      transition: Object.freeze({
        previousHeadCommit: 'raw-previous-head',
        canonicalHeadCommit: 'raw-canonical-head',
        integratedTaskIds: Object.freeze([]),
      }),
      provenance: Object.freeze({
        authority: {} as ModuleDeliveryGenerationAuthority,
        previousHeadCommit: 'raw-previous-head',
        canonicalHeadCommit: 'raw-canonical-head',
        integratedTaskIds: Object.freeze([]),
      }),
    }),
  ).toThrow('mint authority');
});
