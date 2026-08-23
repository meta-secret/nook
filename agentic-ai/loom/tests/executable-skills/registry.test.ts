import { describe, expect, test } from 'bun:test';
import { appendFile, chmod, symlink, unlink } from 'node:fs/promises';
import path from 'node:path';
import type {
  AuditExecutableSkillRegistryRequest,
  ExecutableSkillManifest,
  RegisteredExecutableSkill,
} from '../../src/executable-skills/domain.ts';
import { ExecutableSkillRegistryFindingCode } from '../../src/executable-skills/domain.ts';
import {
  auditExecutableSkillCatalog,
  auditExecutableSkillRegistry,
  ExecutableSkillRegistryInspectionKind,
  inspectExecutableSkillRegistry,
  MAXIMUM_REGISTERED_EXECUTABLE_SKILL_TIMEOUT_MS,
  resolveAuditedExecutableSkill,
} from '../../src/executable-skills/registry.ts';
import { createExecutableSkillRegistry } from '../../src/executable-skills/registration.ts';
import type { AuditedExecutableSkillRegistry } from '../../src/executable-skills/registry.ts';
import type {
  AuditExecutableSkillCatalogRequest,
  ResolveAuditedExecutableSkillRequest,
} from '../../src/executable-skills/registry.ts';
import {
  createExecutableSkillFixture,
  createFixtureFifo,
  deleteFixturePath,
  FIXTURE_REGISTRATION,
  stageAllFixtureFiles,
  stageFixturePath,
  writeFixtureFile,
} from './fixture.ts';

type PolicyFixtureFileRequest = {
  readonly content: string;
  readonly relativePath: string;
  readonly repositoryRoot: string;
};

type PolicyFixturePathRequest = Omit<PolicyFixtureFileRequest, 'content'>;

type RegistryFindingMatch = {
  readonly code: ExecutableSkillRegistryFindingCode;
  readonly path?: string;
  readonly skillId?: string;
};

function auditRequest(
  repositoryRoot: string,
): AuditExecutableSkillRegistryRequest {
  return {
    deadlineExpiresAt: Date.now() + 30_000,
    repositoryRoot,
    signal: false,
  };
}

async function createDefaultFixture() {
  const request = {};
  return createExecutableSkillFixture(request);
}

describe('executable skill registry trust boundary', () => {
  test('keeps the production catalog empty and the provider dormant', async () => {
    expect(MAXIMUM_REGISTERED_EXECUTABLE_SKILL_TIMEOUT_MS).toBe(0);
    const findings = await auditExecutableSkillRegistry(
      auditRequest(pathFromTestRoot()),
    );
    const expectedFinding = {
      code: 'missing-executable-skill-registration',
      path: '.agents/skills/cortex-article-structure/executable-skill.json',
      skillId: 'cortex-article-structure',
    };
    expect(findings).toContainEqual(expect.objectContaining(expectedFinding));
  });

  test('audits a supplied fixture catalog without minting authority', async () => {
    const fixture = await createDefaultFixture();
    try {
      const request: AuditExecutableSkillCatalogRequest = {
        ...auditRequest(fixture.repositoryRoot),
        registrations: [FIXTURE_REGISTRATION],
      };
      const findings = await auditExecutableSkillCatalog(request);
      expect(findings).toEqual([]);
    } finally {
      await fixture.dispose();
    }
  });

  test('deep-freezes a sorted registration snapshot before audit awaits', () => {
    const policyPaths = [...FIXTURE_REGISTRATION.manifest.policyPaths];
    const limits = { ...FIXTURE_REGISTRATION.manifest.limits };
    const manifest: ExecutableSkillManifest = {
      ...FIXTURE_REGISTRATION.manifest,
      policyPaths,
      limits,
    };
    const registration: RegisteredExecutableSkill = {
      ...FIXTURE_REGISTRATION,
      manifest,
    };
    const registryRequest = {
      assertActive: false as const,
      entries: [registration],
    };
    const registry = createExecutableSkillRegistry(registryRequest);
    policyPaths[0] = '.cortex/architecture/rebound.md';
    limits.timeoutMs = 2_000;
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry[0])).toBe(true);
    expect(Object.isFrozen(registry[0]?.manifest)).toBe(true);
    expect(Object.isFrozen(registry[0]?.manifest.limits)).toBe(true);
    expect(Object.isFrozen(registry[0]?.manifest.policyPaths)).toBe(true);
    expect(registry[0]?.manifest).toEqual(FIXTURE_REGISTRATION.manifest);
  });

  test('compares manifests by values instead of property insertion order', async () => {
    const fixture = await createDefaultFixture();
    try {
      const { limits: reorderedLimits, ...remainingManifest } =
        FIXTURE_REGISTRATION.manifest;
      const reordered: ExecutableSkillManifest = {
        limits: reorderedLimits,
        ...remainingManifest,
      };
      const registration: RegisteredExecutableSkill = {
        ...FIXTURE_REGISTRATION,
        manifest: reordered,
      };
      const acceptedRequest: AuditExecutableSkillCatalogRequest = {
        ...auditRequest(fixture.repositoryRoot),
        registrations: [registration],
      };
      expect(await auditExecutableSkillCatalog(acceptedRequest)).toEqual([]);
      const changedManifest: ExecutableSkillManifest = {
        ...reordered,
        limits: { ...reordered.limits, timeoutMs: 2_000 },
      };
      const changedRegistration: RegisteredExecutableSkill = {
        ...registration,
        manifest: changedManifest,
      };
      const rejectedRequest: AuditExecutableSkillCatalogRequest = {
        ...auditRequest(fixture.repositoryRoot),
        registrations: [changedRegistration],
      };
      const expectedFinding = {
        code: ExecutableSkillRegistryFindingCode.InvalidManifest,
        path: FIXTURE_REGISTRATION.manifestPath,
      };
      expect(await auditExecutableSkillCatalog(rejectedRequest)).toContainEqual(
        expect.objectContaining(expectedFinding),
      );
    } finally {
      await fixture.dispose();
    }
  });

  test('reports exact nested source and manifest drift paths', async () => {
    const fixtureRequest = {
      supportSource: "import 'node:util';\nexport const value = 1;\n",
    };
    const fixture = await createExecutableSkillFixture(fixtureRequest);
    try {
      const unsafeRequest: AuditExecutableSkillCatalogRequest = {
        ...auditRequest(fixture.repositoryRoot),
        registrations: [FIXTURE_REGISTRATION],
      };
      const unsafe = await auditExecutableSkillCatalog(unsafeRequest);
      const unsafeFinding = {
        path: '.agents/skills/fixture/src/support.ts',
        skillId: 'fixture',
      };
      expect(unsafe).toContainEqual(expect.objectContaining(unsafeFinding));
      const writeRequest = {
        content: '{}\n',
        relativePath: FIXTURE_REGISTRATION.manifestPath,
        repositoryRoot: fixture.repositoryRoot,
      };
      await writeFixtureFile(writeRequest);
      const driftRequest: AuditExecutableSkillCatalogRequest = {
        ...auditRequest(fixture.repositoryRoot),
        registrations: [FIXTURE_REGISTRATION],
      };
      const drift = await auditExecutableSkillCatalog(driftRequest);
      const driftFinding = {
        code: 'executable-skill-worktree-drift',
        path: FIXTURE_REGISTRATION.manifestPath,
      };
      expect(drift).toContainEqual(expect.objectContaining(driftFinding));
    } finally {
      await fixture.dispose();
    }
  });

  test('rejects duplicate diagnostic registrations at registry root', async () => {
    const fixture = await createDefaultFixture();
    try {
      const request: AuditExecutableSkillCatalogRequest = {
        ...auditRequest(fixture.repositoryRoot),
        registrations: [FIXTURE_REGISTRATION, FIXTURE_REGISTRATION],
      };
      const findings = await auditExecutableSkillCatalog(request);
      const expectedFinding = {
        code: 'duplicate-executable-skill-id',
        path: '.agents/skills',
      };
      expect(findings).toEqual([expect.objectContaining(expectedFinding)]);
    } finally {
      await fixture.dispose();
    }
  });

  test('bounds diagnostic registrations before identity and lifecycle work', async () => {
    const fixture = await createDefaultFixture();
    const registrations = new Array<RegisteredExecutableSkill>(33).fill(
      FIXTURE_REGISTRATION,
    );
    try {
      const request: AuditExecutableSkillCatalogRequest = {
        ...auditRequest(fixture.repositoryRoot),
        registrations,
      };
      const findings = await auditExecutableSkillCatalog(request);
      const expectedFinding = {
        code: ExecutableSkillRegistryFindingCode.InvalidManifest,
        path: '.agents/skills',
        skillId: 'registry',
      };
      expect(findings).toEqual([expect.objectContaining(expectedFinding)]);
      const controller = new AbortController();
      controller.abort();
      const cancelledRequest: AuditExecutableSkillCatalogRequest = {
        ...request,
        signal: controller.signal,
      };
      await expect(
        auditExecutableSkillCatalog(cancelledRequest),
      ).rejects.toThrow('cancelled');
      const expiredRequest: AuditExecutableSkillCatalogRequest = {
        ...request,
        deadlineExpiresAt: Date.now(),
      };
      await expect(auditExecutableSkillCatalog(expiredRequest)).rejects.toThrow(
        'deadline',
      );
    } finally {
      await fixture.dispose();
    }
  });

  test('binds registration identity to the exact manifest and package root', async () => {
    const fixture = await createDefaultFixture();
    try {
      const mismatches = [
        {
          ...FIXTURE_REGISTRATION,
          manifest: { ...FIXTURE_REGISTRATION.manifest, id: 'other' },
        },
        {
          ...FIXTURE_REGISTRATION,
          manifestPath: '.agents/skills/other/executable-skill.json',
        },
        {
          ...FIXTURE_REGISTRATION,
          runnerPath: '.agents/skills/other/src/runner.ts',
        },
      ];
      for (const registration of mismatches) {
        const request: AuditExecutableSkillCatalogRequest = {
          ...auditRequest(fixture.repositoryRoot),
          registrations: [registration],
        };
        const findings = await auditExecutableSkillCatalog(request);
        const expectedFinding: RegistryFindingMatch = {
          code: ExecutableSkillRegistryFindingCode.InvalidManifest,
          skillId: 'fixture',
        };
        expect(findings).toEqual([expect.objectContaining(expectedFinding)]);
      }
    } finally {
      await fixture.dispose();
    }
  });

  test('binds policy mode and bytes through one bounded no-follow descriptor', async () => {
    for (const mutation of [
      'drift',
      'executable',
      'overflow',
      'symlink',
      'fifo',
      'growing',
    ]) {
      const fixture = await createDefaultFixture();
      let growth: ReturnType<typeof setInterval> | false = false;
      try {
        const relativePath = '.cortex/architecture/fixture.md';
        const absolutePath = path.join(fixture.repositoryRoot, relativePath);
        if (mutation === 'drift') {
          const writeRequest: PolicyFixtureFileRequest = {
            content: '# Worktree drift\n',
            relativePath,
            repositoryRoot: fixture.repositoryRoot,
          };
          await writeFixtureFile(writeRequest);
        } else if (mutation === 'executable') {
          await chmod(absolutePath, 0o755);
          const stageRequest: PolicyFixturePathRequest = {
            relativePath,
            repositoryRoot: fixture.repositoryRoot,
          };
          stageFixturePath(stageRequest);
        } else if (mutation === 'overflow') {
          const writeRequest: PolicyFixtureFileRequest = {
            content: 'x'.repeat(256 * 1024 + 1),
            relativePath,
            repositoryRoot: fixture.repositoryRoot,
          };
          await writeFixtureFile(writeRequest);
          const stageRequest: PolicyFixturePathRequest = {
            relativePath,
            repositoryRoot: fixture.repositoryRoot,
          };
          stageFixturePath(stageRequest);
        } else if (mutation === 'symlink') {
          await unlink(absolutePath);
          await symlink(
            '/tmp/outside-executable-skill-policy.md',
            absolutePath,
          );
        } else if (mutation === 'fifo') {
          await unlink(absolutePath);
          const fifoRequest: PolicyFixturePathRequest = {
            relativePath,
            repositoryRoot: fixture.repositoryRoot,
          };
          createFixtureFifo(fifoRequest);
        } else {
          growth = setInterval(
            () => void appendFile(absolutePath, 'growth'),
            0,
          );
        }
        const request: AuditExecutableSkillCatalogRequest = {
          ...auditRequest(fixture.repositoryRoot),
          registrations: [FIXTURE_REGISTRATION],
        };
        const findings = await auditExecutableSkillCatalog(request);
        const expectedFinding: RegistryFindingMatch = {
          code: ExecutableSkillRegistryFindingCode.UnsafeFile,
          path: relativePath,
        };
        expect(findings).toContainEqual(
          expect.objectContaining(expectedFinding),
        );
      } finally {
        if (growth !== false) clearInterval(growth);
        await fixture.dispose();
      }
    }
  });

  test('accepts exactly 32 frozen manifests and rejects the 33rd', async () => {
    const fixture = await createDefaultFixture();
    try {
      for (let index = 1; index < 32; index += 1) {
        const skillId = `fixture-${String(index).padStart(2, '0')}`;
        const relativePath = `.agents/skills/${skillId}/executable-skill.json`;
        const writeRequest = {
          content: '{}\n',
          relativePath,
          repositoryRoot: fixture.repositoryRoot,
        };
        await writeFixtureFile(writeRequest);
        const stageRequest = {
          relativePath,
          repositoryRoot: fixture.repositoryRoot,
        };
        stageFixturePath(stageRequest);
      }
      const accepted = await auditExecutableSkillRegistry(
        auditRequest(fixture.repositoryRoot),
      );
      expect(accepted).toHaveLength(32);
      const overflowPath =
        '.agents/skills/fixture-overflow/executable-skill.json';
      const writeRequest = {
        content: '{}\n',
        relativePath: overflowPath,
        repositoryRoot: fixture.repositoryRoot,
      };
      await writeFixtureFile(writeRequest);
      const stageRequest = {
        relativePath: overflowPath,
        repositoryRoot: fixture.repositoryRoot,
      };
      stageFixturePath(stageRequest);
      const overflow = await auditExecutableSkillRegistry(
        auditRequest(fixture.repositoryRoot),
      );
      const expectedOverflow = {
        code: 'unsafe-executable-skill-file',
        path: '.agents/skills',
      };
      expect(overflow).toEqual([expect.objectContaining(expectedOverflow)]);
    } finally {
      await fixture.dispose();
    }
  });

  test('bounds manifest descriptor reads and rejects nonregular paths', async () => {
    for (const mutation of ['exact', 'overflow', 'symlink', 'fifo']) {
      const fixture = await createDefaultFixture();
      try {
        const absolutePath = path.join(
          fixture.repositoryRoot,
          FIXTURE_REGISTRATION.manifestPath,
        );
        if (mutation === 'exact' || mutation === 'overflow') {
          const writeRequest = {
            content: ' '.repeat(16 * 1024 + (mutation === 'overflow' ? 1 : 0)),
            relativePath: FIXTURE_REGISTRATION.manifestPath,
            repositoryRoot: fixture.repositoryRoot,
          };
          await writeFixtureFile(writeRequest);
        } else if (mutation === 'symlink') {
          await unlink(absolutePath);
          await symlink('/tmp/outside-skill-manifest.json', absolutePath);
        } else {
          await unlink(absolutePath);
          const fifoRequest = {
            relativePath: FIXTURE_REGISTRATION.manifestPath,
            repositoryRoot: fixture.repositoryRoot,
          };
          createFixtureFifo(fifoRequest);
        }
        const request: AuditExecutableSkillCatalogRequest = {
          ...auditRequest(fixture.repositoryRoot),
          registrations: [FIXTURE_REGISTRATION],
        };
        const findings = await auditExecutableSkillCatalog(request);
        const codes = findings.map((finding) => finding.code);
        expect(codes).toContain(
          ExecutableSkillRegistryFindingCode.WorktreeDrift,
        );
      } finally {
        await fixture.dispose();
      }
    }
  });

  test('deadline interrupts bounded frozen-tree discovery', async () => {
    const fixture = await createDefaultFixture();
    try {
      for (let index = 0; index < 100; index += 1) {
        const writeRequest = {
          content: 'unrelated\n',
          relativePath: `.agents/skills/fixture/tests/${index}-${'x'.repeat(180)}.txt`,
          repositoryRoot: fixture.repositoryRoot,
        };
        await writeFixtureFile(writeRequest);
      }
      stageAllFixtureFiles(fixture.repositoryRoot);
      const request: AuditExecutableSkillRegistryRequest = {
        deadlineExpiresAt: Date.now() + 2,
        repositoryRoot: fixture.repositoryRoot,
        signal: false,
      };
      await expect(auditExecutableSkillRegistry(request)).rejects.toThrow(
        'deadline',
      );
    } finally {
      await fixture.dispose();
    }
  });

  test('keeps the empty production authority opaque and capability-neutral', async () => {
    const fixture = await createDefaultFixture();
    try {
      const deleteRequest = {
        relativePath: FIXTURE_REGISTRATION.manifestPath,
        repositoryRoot: fixture.repositoryRoot,
      };
      await deleteFixturePath(deleteRequest);
      const inspection = await inspectExecutableSkillRegistry(
        auditRequest(fixture.repositoryRoot),
      );
      expect(inspection.kind).toBe(
        ExecutableSkillRegistryInspectionKind.Verified,
      );
      if (inspection.kind !== ExecutableSkillRegistryInspectionKind.Verified) {
        throw new Error('Expected verified empty registry fixture.');
      }
      const resolveRequest: ResolveAuditedExecutableSkillRequest = {
        authority: inspection.authority,
        deadlineExpiresAt: Date.now() + 30_000,
        signal: false,
        skillId: 'fixture',
      };
      expect(() => resolveAuditedExecutableSkill(resolveRequest)).toThrow(
        'Unregistered executable skill',
      );
      const writeRequest = {
        content: 'export const value = 2;\n',
        relativePath: '.agents/skills/fixture/src/support.ts',
        repositoryRoot: fixture.repositoryRoot,
      };
      await writeFixtureFile(writeRequest);
      const stageRequest = {
        relativePath: '.agents/skills/fixture/src/support.ts',
        repositoryRoot: fixture.repositoryRoot,
      };
      stageFixturePath(stageRequest);
      expect(() => resolveAuditedExecutableSkill(resolveRequest)).toThrow(
        'Unregistered executable skill',
      );
      const forged: AuditedExecutableSkillRegistry = { auditId: 'forged' };
      const forgedRequest: ResolveAuditedExecutableSkillRequest = {
        authority: forged,
        deadlineExpiresAt: Date.now() + 30_000,
        signal: false,
        skillId: 'fixture',
      };
      expect(() => resolveAuditedExecutableSkill(forgedRequest)).toThrow(
        'authority is invalid',
      );
    } finally {
      await fixture.dispose();
    }
  });

  test('fails closed on a pre-aborted registry audit', async () => {
    const fixture = await createDefaultFixture();
    const controller = new AbortController();
    controller.abort();
    try {
      const request: AuditExecutableSkillRegistryRequest = {
        ...auditRequest(fixture.repositoryRoot),
        signal: controller.signal,
      };
      await expect(auditExecutableSkillRegistry(request)).rejects.toThrow(
        'cancelled',
      );
    } finally {
      await fixture.dispose();
    }
  });
});

function pathFromTestRoot(): string {
  return new URL('../../../..', import.meta.url).pathname.replace(/\/$/u, '');
}
