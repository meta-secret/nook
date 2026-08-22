import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import type { MakeDirectoryOptions, RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { auditModuleExperts } from '../../src/module-experts/audit.ts';
import type { AuditModuleExpertsArgs } from '../../src/module-experts/audit.ts';

const REPO_ROOT = resolve(import.meta.dir, '../../../..');

describe('module expert audit', () => {
  test('accepts the complete read-only project catalog', () => {
    const auditArgs: AuditModuleExpertsArgs = { repoRoot: REPO_ROOT };
    const report = auditModuleExperts(auditArgs);

    expect(report.findings).toEqual([]);
    expect(report.profileCount).toBe(9);
    expect(report.productionModuleCount).toBe(14);
    expect(report.auditOk).toBe(true);
  });

  test('rejects writable roles and a separate WASM expert', async () => {
    const fixtureRoot = await moduleExpertFixture();
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const coreDefinitionPath = join(
        fixtureRoot,
        '.codex/agents/module-experts/core_expert.toml',
      );
      const coreDefinition = await readFile(coreDefinitionPath, 'utf8');
      await writeFile(
        coreDefinitionPath,
        coreDefinition.replace(
          'sandbox_mode = "read-only"',
          'sandbox_mode = "workspace-write"',
        ),
        'utf8',
      );
      await writeFile(
        join(fixtureRoot, '.codex/agents/module-experts/wasm_expert.toml'),
        'name = "wasm_expert"\n',
        'utf8',
      );
      const auditArgs: AuditModuleExpertsArgs = { repoRoot: fixtureRoot };
      const report = auditModuleExperts(auditArgs);
      const codes = report.findings.map((finding) => finding.code);

      expect(codes).toContain('agent-definition-contract-drift');
      expect(codes).toContain('forbidden-wasm-boundary-role');
      expect(report.auditOk).toBe(false);
    } finally {
      await rm(fixtureRoot, removeOptions);
    }
  });
});

async function moduleExpertFixture(): Promise<string> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'loom-module-experts-'));
  const recursiveDirectoryOptions: MakeDirectoryOptions = { recursive: true };
  await mkdir(
    join(fixtureRoot, '.codex/agents/module-experts'),
    recursiveDirectoryOptions,
  );
  await symlink(join(REPO_ROOT, '.cortex'), join(fixtureRoot, '.cortex'));
  await symlink(join(REPO_ROOT, '.agents'), join(fixtureRoot, '.agents'));
  await symlink(join(REPO_ROOT, 'nook-app'), join(fixtureRoot, 'nook-app'));
  const sourceDirectory = join(REPO_ROOT, '.codex/agents/module-experts');
  const definitionNames = await readdir(sourceDirectory);
  for (const definitionName of definitionNames) {
    await copyFile(
      join(sourceDirectory, definitionName),
      join(fixtureRoot, '.codex/agents/module-experts', definitionName),
    );
  }
  return fixtureRoot;
}
