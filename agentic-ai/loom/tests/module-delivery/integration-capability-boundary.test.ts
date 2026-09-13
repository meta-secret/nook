import { expect, test } from 'bun:test';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ModuleIntegrationCapabilityRegistry } from '../../src/module-delivery/integration-capabilities.ts';

import type { ModuleDeliveryGenerationAuthority } from '../../src/module-delivery/admission.ts';
import type { ModuleDeliveryIntegratedWriterFrontierCapability } from '../../src/module-delivery/integration-contracts.ts';
import type { ModuleIntegrationCapabilityMintAuthority } from '../../src/module-delivery/integration-capability-authority.ts';

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
  expect(authoritySource).toContain('CAPABILITY_MINT_AUTHORITY_TOKEN');
  expect(authoritySource).toContain('new WeakSet<object>()');
  expect(capabilitySource).not.toContain("from './integration.ts'");
  expect(capabilitySource).toContain(
    "from './integration-capability-authority.ts'",
  );
  expect(admissionAuthoritySource).not.toContain("from './integration.ts'");
  expect(integrationSource).not.toContain('CAPABILITY_MINT_AUTHORITY_TOKEN');
  expect(integrationSource).not.toContain('new WeakSet<object>()');
  expect(integrationSource).toContain(
    "from './integration-capability-authority.ts'",
  );
  expect(admissionAuthoritySource).toContain(
    "from './integration-capabilities.ts'",
  );
});

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
  const rawAuthority = {} as ModuleIntegrationCapabilityMintAuthority;
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
