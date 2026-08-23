import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'bun:test';
import { ExecutableSkillRegistryFindingCode } from '../src/executable-skills/domain.ts';
import { auditExecutableSkillRegistry } from '../src/executable-skills/registry.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../../..');
const POLICY_PATH = '.cortex/dynamic-skills/cortex-article-structure.md';
const CREATE_TREE_OPTIONS = { recursive: true } as const;
const REMOVE_TREE_OPTIONS = { recursive: true, force: true } as const;

test('streams the exact 32-manifest allowance past unrelated tree output', async () => {
  const repositoryRoot = createAuditRepository();
  try {
    for (let index = 0; index < 31; index += 1) {
      const writeRequest: WriteUnregisteredManifestRequest = {
        index,
        repositoryRoot,
      };
      writeUnregisteredManifest(writeRequest);
    }
    const unrelatedRoot = path.join(
      repositoryRoot,
      '.agents/skills/cortex-article-structure/tests/unrelated',
    );
    mkdirSync(unrelatedRoot, CREATE_TREE_OPTIONS);
    for (let index = 0; index < 80; index += 1) {
      const filename = `${index.toString().padStart(2, '0')}-${'x'.repeat(230)}.txt`;
      writeFileSync(path.join(unrelatedRoot, filename), 'unrelated');
    }
    const gitOptions = { cwd: repositoryRoot } as const;
    execFileSync('git', ['add', '.'], gitOptions);

    const findings = await auditExecutableSkillRegistry(
      registryAuditRequest(repositoryRoot),
    );
    expect(
      findings.filter(
        (finding) =>
          finding.code ===
          ExecutableSkillRegistryFindingCode.MissingRegistration,
      ).length,
    ).toBe(31);
    expect(findings.map((finding) => finding.code)).not.toContain(
      ExecutableSkillRegistryFindingCode.UnsafeFile,
    );
  } finally {
    rmSync(repositoryRoot, REMOVE_TREE_OPTIONS);
  }
});

test('fails closed when the frozen tree contains a 33rd manifest', async () => {
  const repositoryRoot = createAuditRepository();
  try {
    for (let index = 0; index < 32; index += 1) {
      const writeRequest: WriteUnregisteredManifestRequest = {
        index,
        repositoryRoot,
      };
      writeUnregisteredManifest(writeRequest);
    }
    const gitOptions = { cwd: repositoryRoot } as const;
    execFileSync('git', ['add', '.'], gitOptions);
    const findings = await auditExecutableSkillRegistry(
      registryAuditRequest(repositoryRoot),
    );
    expect(findings.map((finding) => finding.code)).toEqual([
      ExecutableSkillRegistryFindingCode.UnsafeFile,
    ]);
  } finally {
    rmSync(repositoryRoot, REMOVE_TREE_OPTIONS);
  }
});

type WriteUnregisteredManifestRequest = {
  readonly index: number;
  readonly repositoryRoot: string;
};

function writeUnregisteredManifest(
  request: WriteUnregisteredManifestRequest,
): void {
  const skillId = `unregistered-${request.index.toString().padStart(2, '0')}`;
  const skillRoot = path.join(
    request.repositoryRoot,
    '.agents/skills',
    skillId,
  );
  mkdirSync(skillRoot, CREATE_TREE_OPTIONS);
  writeFileSync(path.join(skillRoot, 'executable-skill.json'), '{}');
}

function createAuditRepository(): string {
  const repositoryRoot = mkdtempSync(
    path.join(tmpdir(), 'executable-skill-discovery-'),
  );
  const skillRoot = path.join(
    repositoryRoot,
    '.agents/skills/cortex-article-structure',
  );
  mkdirSync(skillRoot, CREATE_TREE_OPTIONS);
  mkdirSync(
    path.join(repositoryRoot, '.cortex/dynamic-skills'),
    CREATE_TREE_OPTIONS,
  );
  cpSync(
    path.join(
      REPOSITORY_ROOT,
      '.agents/skills/cortex-article-structure/executable-skill.json',
    ),
    path.join(skillRoot, 'executable-skill.json'),
  );
  cpSync(
    path.join(REPOSITORY_ROOT, '.agents/skills/cortex-article-structure/src'),
    path.join(skillRoot, 'src'),
    CREATE_TREE_OPTIONS,
  );
  cpSync(
    path.join(REPOSITORY_ROOT, '.agents/skills/package.json'),
    path.join(repositoryRoot, '.agents/skills/package.json'),
  );
  cpSync(
    path.join(REPOSITORY_ROOT, '.agents/skills/bun.lock'),
    path.join(repositoryRoot, '.agents/skills/bun.lock'),
  );
  writeFileSync(
    path.join(repositoryRoot, POLICY_PATH),
    '# Cortex article structure\n',
  );
  const gitOptions = { cwd: repositoryRoot } as const;
  execFileSync('git', ['init', '--quiet'], gitOptions);
  execFileSync('git', ['add', '.'], gitOptions);
  return repositoryRoot;
}

function registryAuditRequest(repositoryRoot: string) {
  return {
    deadlineExpiresAt: Date.now() + 30_000,
    repositoryRoot,
    signal: false,
  } as const;
}
