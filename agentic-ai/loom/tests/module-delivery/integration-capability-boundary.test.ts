import { expect, test } from 'bun:test';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ModuleIntegrationCapabilityRegistry } from '../../src/module-delivery/integration-capabilities.ts';

import type { ModuleDeliveryGenerationAuthority } from '../../src/module-delivery/admission.ts';
import type { ModuleDeliveryIntegratedWriterFrontierCapability } from '../../src/module-delivery/integration-contracts.ts';

const CAPABILITY_MODULE_PATH = fileURLToPath(
  new URL('../../src/module-delivery/integration-capabilities.ts', import.meta.url),
);
const INTEGRATION_MODULE_PATH = fileURLToPath(
  new URL('../../src/module-delivery/integration.ts', import.meta.url),
);
const ADMISSION_AUTHORITY_MODULE_PATH = fileURLToPath(
  new URL('../../src/module-delivery/admission-authority.ts', import.meta.url),
);

test('keeps the integration capability runtime graph acyclic', () => {
  const capabilitySource = readFileSync(CAPABILITY_MODULE_PATH, 'utf8');
  const integrationSource = readFileSync(INTEGRATION_MODULE_PATH, 'utf8');
  const admissionAuthoritySource = readFileSync(
    ADMISSION_AUTHORITY_MODULE_PATH,
    'utf8',
  );

  expect(capabilitySource).toContain('new WeakMap');
  expect(capabilitySource).toContain('new WeakSet');
  expect(capabilitySource).not.toContain('Object.getOwnPropertySymbols');
  expect(capabilitySource).not.toContain("from './integration.ts'");
  expect(admissionAuthoritySource).not.toContain("from './integration.ts'");
  expect(integrationSource).not.toContain('CAPABILITY_MINT_AUTHORITY_TOKEN');
  expect(integrationSource).not.toContain('Object.getOwnPropertySymbols');
  expect(admissionAuthoritySource).toContain(
    "from './integration-capabilities.ts'",
  );
});

test('keeps capability minting behind the coordinator boundary', async () => {
  const capabilitySource = readFileSync(CAPABILITY_MODULE_PATH, 'utf8');
  const integrationSource = readFileSync(INTEGRATION_MODULE_PATH, 'utf8');
  expect(capabilitySource).not.toMatch(
    /static\s+(?:mintIntegratedWriterFrontier|canonicalEvidenceTransition)\s*\(/u,
  );
  expect(capabilitySource).not.toMatch(/\bregister(?:Integrated|Canonical)/u);
  expect(integrationSource).not.toMatch(
    /ModuleIntegrationCapabilityMintAuthority|createModuleIntegrationCapabilityMintAuthority|CAPABILITY_AUTHORITY_PROOF/u,
  );

  const directModule = await import(
    '../../src/module-delivery/integration-capabilities.ts'
  );
  const directCoordinator = await import(
    '../../src/module-delivery/integration.ts'
  );
  const directIndex = await import('../../src/module-delivery/index.ts');
  expect(Object.hasOwn(directModule, 'mintIntegratedWriterFrontier')).toBe(false);
  expect(Object.hasOwn(directModule, 'registerIntegratedWriterFrontier')).toBe(
    false,
  );
  expect(
    Object.hasOwn(directModule, 'registerCanonicalEvidenceTransition'),
  ).toBe(false);
  expect(
    Object.hasOwn(
      directModule.ModuleIntegrationCapabilityRegistry,
      'registerIntegratedWriterFrontier',
    ),
  ).toBe(false);
  expect(
    Object.hasOwn(
      directModule.ModuleIntegrationCapabilityRegistry,
      'registerCanonicalEvidenceTransition',
    ),
  ).toBe(false);
  expect(
    Object.hasOwn(
      directCoordinator.ModuleIntegrationCoordinator,
      'mintIntegratedWriterFrontier',
    ),
  ).toBe(false);
  expect(
    Object.hasOwn(
      directCoordinator.ModuleIntegrationCoordinator,
      'canonicalEvidenceTransition',
    ),
  ).toBe(false);
  expect(() =>
    directModule.ModuleIntegrationCapabilityRegistry.bindMintAuthority({}),
  ).toThrow('mint authority is bound');
  expect(
    Object.hasOwn(directIndex, 'createModuleIntegrationCapabilityMintAuthority'),
  ).toBe(false);
  expect(Object.hasOwn(directIndex, 'registerIntegratedWriterFrontier')).toBe(
    false,
  );

  const rawCapability: ModuleDeliveryIntegratedWriterFrontierCapability = {
    taskId: 'raw-task',
    attempt: 1,
    generation: 1,
    planDigest: 'raw-plan',
    headCommit: 'raw-head',
    integratedTaskIds: Object.freeze([]),
  };
  const rawAuthority = {} as ModuleDeliveryGenerationAuthority;
  expect(() =>
    ModuleIntegrationCapabilityRegistry.assertModuleDeliveryIntegratedWriterFrontierCapability({
      authority: rawAuthority,
      capability: Object.freeze(rawCapability),
      taskId: rawCapability.taskId,
      attempt: rawCapability.attempt,
      generation: rawCapability.generation,
      planDigest: rawCapability.planDigest,
      headCommit: rawCapability.headCommit,
      integratedTaskIds: rawCapability.integratedTaskIds,
    }),
  ).toThrow('capability is invalid');

  const reflectiveClone = Object.freeze({
    ...rawCapability,
    [Symbol('module-integration-capability-authority-proof')]: Object.freeze(
      {},
    ),
  });
  expect(() =>
    ModuleIntegrationCapabilityRegistry.assertModuleDeliveryIntegratedWriterFrontierCapability({
      authority: rawAuthority,
      capability: reflectiveClone,
      taskId: rawCapability.taskId,
      attempt: rawCapability.attempt,
      generation: rawCapability.generation,
      planDigest: rawCapability.planDigest,
      headCommit: rawCapability.headCommit,
      integratedTaskIds: rawCapability.integratedTaskIds,
    }),
  ).toThrow('capability is invalid');

  expect(() =>
    ModuleIntegrationCapabilityRegistry.assertModuleDeliveryCanonicalEvidenceTransition(
      {
        authority: rawAuthority,
        transition: Object.freeze({
          previousHeadCommit: 'raw-previous-head',
          canonicalHeadCommit: 'raw-canonical-head',
          integratedTaskIds: Object.freeze([]),
        }),
        previousHeadCommit: 'raw-previous-head',
        canonicalHeadCommit: 'raw-canonical-head',
        integratedTaskIds: Object.freeze([]),
      },
    ),
  ).toThrow('transition is invalid');
});
