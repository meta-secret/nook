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
import {
  MODULE_EXPERT_CODEX_OPTIONS,
  moduleExpertThreadOptions,
} from '../../src/module-experts/runtime-contract.ts';
import {
  CargoWorkspaceInventoryKind,
  decodeCargoWorkspaceMetadata,
} from '../../src/module-experts/cargo-workspace.ts';
import type {
  CargoWorkspaceInventory,
  DecodeCargoWorkspaceMetadataArgs,
} from '../../src/module-experts/cargo-workspace.ts';

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
      const hiddenDirectory = join(fixtureRoot, '.codex/agents/hidden/deep');
      const directoryOptions: MakeDirectoryOptions = { recursive: true };
      await mkdir(hiddenDirectory, directoryOptions);
      await writeFile(
        join(hiddenDirectory, 'wasm_expert.toml'),
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

  test('rejects recursively discovered uncataloged roles', async () => {
    const fixtureRoot = await moduleExpertFixture();
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const nestedDirectory = join(
        fixtureRoot,
        '.codex/agents/module-experts/nested',
      );
      const directoryOptions: MakeDirectoryOptions = { recursive: true };
      await mkdir(nestedDirectory, directoryOptions);
      await writeFile(
        join(nestedDirectory, 'shadow_expert.toml'),
        'name = "shadow_expert"\n',
        'utf8',
      );
      const auditArgs: AuditModuleExpertsArgs = { repoRoot: fixtureRoot };
      const report = auditModuleExperts(auditArgs);

      expect(report.findings.map((finding) => finding.code)).toContain(
        'uncataloged-agent-definition',
      );
      expect(report.auditOk).toBe(false);
    } finally {
      await rm(fixtureRoot, removeOptions);
    }
  });

  test('rejects symlinked custom-agent entries', async () => {
    const fixtureRoot = await moduleExpertFixture();
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      await symlink(
        join(fixtureRoot, '.codex/agents/module-experts/core_expert.toml'),
        join(fixtureRoot, '.codex/agents/shadow.toml'),
      );
      const auditArgs: AuditModuleExpertsArgs = { repoRoot: fixtureRoot };
      const report = auditModuleExperts(auditArgs);

      expect(report.findings.map((finding) => finding.code)).toContain(
        'unsafe-agent-definition-entry',
      );
      expect(report.auditOk).toBe(false);
    } finally {
      await rm(fixtureRoot, removeOptions);
    }
  });

  test('uses Cargo workspace identities instead of manifest text matches', () => {
    const liveManifest = join(
      REPO_ROOT,
      'nook-app/nook-platform/live-crate/Cargo.toml',
    );
    const decoyManifest = join(
      REPO_ROOT,
      'nook-app/nook-platform/retired-crate/Cargo.toml',
    );
    const metadata = {
      packages: [
        { id: 'live 1.0.0', manifest_path: liveManifest },
        { id: 'retired 1.0.0', manifest_path: decoyManifest },
      ],
      workspace_members: ['live 1.0.0'],
    };
    const decodeArgs: DecodeCargoWorkspaceMetadataArgs = {
      repoRoot: REPO_ROOT,
      source: JSON.stringify(metadata),
    };

    const expected: CargoWorkspaceInventory = {
      kind: CargoWorkspaceInventoryKind.Complete,
      roots: ['nook-app/nook-platform/live-crate'],
    };
    expect(decodeCargoWorkspaceMetadata(decodeArgs)).toEqual(expected);
  });

  test('uses an isolated non-delegating Codex runtime', () => {
    const threadOptionsArgs = { workingDirectory: REPO_ROOT };
    const threadOptions = moduleExpertThreadOptions(threadOptionsArgs);

    expect(threadOptions.sandboxMode).toBe('read-only');
    expect(threadOptions.approvalPolicy).toBe('never');
    expect(threadOptions.networkAccessEnabled).toBe(false);
    expect(threadOptions.webSearchMode).toBe('disabled');
    expect(MODULE_EXPERT_CODEX_OPTIONS.config.agents.enabled).toBe(false);
    expect(MODULE_EXPERT_CODEX_OPTIONS.config.agents.max_depth).toBe(0);
    expect(MODULE_EXPERT_CODEX_OPTIONS.config.features.multi_agent).toBe(false);
    expect(MODULE_EXPERT_CODEX_OPTIONS.config.features.multi_agent_v2).toBe(
      false,
    );
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
