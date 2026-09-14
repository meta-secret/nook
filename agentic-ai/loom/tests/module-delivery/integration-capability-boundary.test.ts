import { expect, test } from 'bun:test';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ModuleIntegrationCapabilityRegistry } from '../../src/module-delivery/integration-capabilities.ts';

import { ModuleDeliveryEvidenceScenario } from './evidence-test-support.ts';
import { ModuleDeliveryWorktreeTestSupportScenario } from './worktree-test-support.ts';

import type { ModuleDeliveryIntegratedWriterFrontierCapability } from '../../src/module-delivery/integration-contracts.ts';

const CAPABILITY_MODULE_PATH = fileURLToPath(
  new URL(
    '../../src/module-delivery/integration-capabilities.ts',
    import.meta.url,
  ),
);
const INTEGRATION_MODULE_PATH = fileURLToPath(
  new URL('../../src/module-delivery/integration.ts', import.meta.url),
);
const ADMISSION_AUTHORITY_MODULE_PATH = fileURLToPath(
  new URL('../../src/module-delivery/admission-authority.ts', import.meta.url),
);

test('keeps capability provenance closure-private across the ESM cycle', () => {
  const capabilitySource = readFileSync(CAPABILITY_MODULE_PATH, 'utf8');
  const integrationSource = readFileSync(INTEGRATION_MODULE_PATH, 'utf8');
  const admissionAuthoritySource = readFileSync(
    ADMISSION_AUTHORITY_MODULE_PATH,
    'utf8',
  );

  expect(capabilitySource).toContain("from './integration.ts'");
  expect(capabilitySource).not.toMatch(
    /\b(?:bindMintAuthority|accept(?:Integrated|Canonical)|register(?:Integrated|Canonical)|mint(?:Integrated|Canonical))/u,
  );
  expect(capabilitySource).not.toMatch(
    /Symbol\.for|globalThis|Object\.defineProperty/u,
  );
  expect(integrationSource).toContain('ModuleIntegrationCapabilityProvenance');
  expect(integrationSource).toContain('ModuleIntegrationCapabilityAssertions');
  expect(integrationSource).not.toMatch(
    /Symbol\.for|globalThis|Object\.defineProperty/u,
  );
  expect(admissionAuthoritySource).toContain(
    'ModuleAdmissionStateCapabilityAuthorities',
  );
  expect(admissionAuthoritySource).toContain(
    "from './admission-state-capability-authorities.ts'",
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
    /ModuleIntegrationCapabilityMintAuthority|createModuleIntegrationCapabilityMintAuthority|CAPABILITY_AUTHORITY_PROOF|bindMintAuthority|CAPABILITY_MINT_AUTHORITY/u,
  );

  const directModule =
    await import('../../src/module-delivery/integration-capabilities.ts');
  const directCoordinator =
    await import('../../src/module-delivery/integration.ts');
  const directIndex = await import('../../src/module-delivery/index.ts');
  expect(Object.hasOwn(directModule, 'mintIntegratedWriterFrontier')).toBe(
    false,
  );
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
  expect(Object.hasOwn(directModule, 'bindMintAuthority')).toBe(false);
  expect(
    Object.hasOwn(
      directModule.ModuleIntegrationCapabilityRegistry,
      'bindMintAuthority',
    ),
  ).toBe(false);
  expect(
    Object.hasOwn(
      directIndex,
      'createModuleIntegrationCapabilityMintAuthority',
    ),
  ).toBe(false);
  expect(Object.hasOwn(directIndex, 'registerIntegratedWriterFrontier')).toBe(
    false,
  );
  expect(
    Object.isFrozen(directCoordinator.ModuleIntegrationCapabilityAssertions),
  ).toBe(true);

  const rawCapability: ModuleDeliveryIntegratedWriterFrontierCapability = {
    taskId: 'raw-task',
    attempt: 1,
    generation: 1,
    planDigest: 'raw-plan',
    headCommit: 'raw-head',
    integratedTaskIds: Object.freeze([]),
  };
  const fixture = ModuleDeliveryWorktreeTestSupportScenario.createGitFixture();
  try {
    const authority = ModuleDeliveryEvidenceScenario.runtime(fixture).authority;
    expect(() =>
      ModuleIntegrationCapabilityRegistry.assertModuleDeliveryIntegratedWriterFrontierCapability(
        {
          authority,
          capability: Object.freeze(rawCapability),
          taskId: rawCapability.taskId,
          attempt: rawCapability.attempt,
          generation: rawCapability.generation,
          planDigest: rawCapability.planDigest,
          headCommit: rawCapability.headCommit,
          integratedTaskIds: rawCapability.integratedTaskIds,
        },
      ),
    ).toThrow('capability is invalid');

    const reflectiveClone = Object.freeze({
      ...rawCapability,
      [Symbol('module-integration-capability-authority-proof')]: Object.freeze(
        {},
      ),
    });
    expect(() =>
      ModuleIntegrationCapabilityRegistry.assertModuleDeliveryIntegratedWriterFrontierCapability(
        {
          authority,
          capability: reflectiveClone,
          taskId: rawCapability.taskId,
          attempt: rawCapability.attempt,
          generation: rawCapability.generation,
          planDigest: rawCapability.planDigest,
          headCommit: rawCapability.headCommit,
          integratedTaskIds: rawCapability.integratedTaskIds,
        },
      ),
    ).toThrow('capability is invalid');

    expect(() =>
      ModuleIntegrationCapabilityRegistry.assertModuleDeliveryCanonicalEvidenceTransition(
        {
          authority,
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
  } finally {
    ModuleDeliveryWorktreeTestSupportScenario.disposeGitFixture(fixture);
  }
});
