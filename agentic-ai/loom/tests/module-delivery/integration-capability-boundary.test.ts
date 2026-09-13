import { expect, test } from 'bun:test';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ModuleIntegrationCapabilityRegistry } from '../../src/module-delivery/integration-capabilities.ts';

import type { ModuleDeliveryGenerationAuthority } from '../../src/module-delivery/admission.ts';
import type { ModuleDeliveryIntegratedWriterFrontierCapability } from '../../src/module-delivery/integration-contracts.ts';

const CAPABILITY_MODULE_PATH = fileURLToPath(
  new URL('../../src/module-delivery/integration-capabilities.ts', import.meta.url),
);
const AUTHORITY_MODULE_PATH = fileURLToPath(
  new URL(
    '../../src/module-delivery/integration-capability-authority.ts',
    import.meta.url,
  ),
);
const INTEGRATION_MODULE_PATH = fileURLToPath(
  new URL('../../src/module-delivery/integration.ts', import.meta.url),
);
const ADMISSION_AUTHORITY_MODULE_PATH = fileURLToPath(
  new URL('../../src/module-delivery/admission-authority.ts', import.meta.url),
);

test('keeps the integration capability runtime graph acyclic', () => {
  const authoritySource = readFileSync(AUTHORITY_MODULE_PATH, 'utf8');
  const capabilitySource = readFileSync(CAPABILITY_MODULE_PATH, 'utf8');
  const integrationSource = readFileSync(INTEGRATION_MODULE_PATH, 'utf8');
  const admissionAuthoritySource = readFileSync(
    ADMISSION_AUTHORITY_MODULE_PATH,
    'utf8',
  );

  expect(authoritySource).not.toMatch(/\bfrom\s+['"][^'"]+['"]/u);
  expect(authoritySource).not.toContain('CAPABILITY_MINT_AUTHORITY_TOKEN');
  expect(authoritySource).not.toContain('new WeakSet<object>()');
  expect(authoritySource).not.toMatch(/export\s+(?:function|const|class)\s+/u);
  expect(capabilitySource).not.toContain("from './integration.ts'");
  expect(capabilitySource).not.toContain(
    "from './integration-capability-authority.ts'",
  );
  expect(admissionAuthoritySource).not.toContain("from './integration.ts'");
  expect(integrationSource).not.toContain('CAPABILITY_MINT_AUTHORITY_TOKEN');
  expect(integrationSource).not.toContain('new WeakSet<object>()');
  expect(integrationSource).not.toContain(
    "from './integration-capability-authority.ts'",
  );
  expect(admissionAuthoritySource).toContain(
    "from './integration-capabilities.ts'",
  );
});

test('keeps capability minting behind the coordinator boundary', async () => {
  const capabilitySource = readFileSync(CAPABILITY_MODULE_PATH, 'utf8');
  const authoritySource = readFileSync(AUTHORITY_MODULE_PATH, 'utf8');
  const integrationSource = readFileSync(INTEGRATION_MODULE_PATH, 'utf8');
  expect(capabilitySource).not.toMatch(
    /static\s+(?:mintIntegratedWriterFrontier|canonicalEvidenceTransition)\s*\(/u,
  );
  expect(capabilitySource).not.toMatch(/\bregister(?:Integrated|Canonical)/u);
  expect(authoritySource).not.toMatch(
    /createModuleIntegrationCapabilityMintAuthority|CAPABILITY_MINT_AUTHORITY_TOKEN/u,
  );
  expect(integrationSource).not.toMatch(
    /ModuleIntegrationCapabilityMintAuthority|createModuleIntegrationCapabilityMintAuthority/u,
  );

  const directModule = await import(
    '../../src/module-delivery/integration-capabilities.ts'
  );
  const directAuthority = await import(
    '../../src/module-delivery/integration-capability-authority.ts'
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
      directAuthority,
      'createModuleIntegrationCapabilityMintAuthority',
    ),
  ).toBe(false);
  expect(
    Object.hasOwn(directAuthority, 'CAPABILITY_MINT_AUTHORITY_TOKEN'),
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
