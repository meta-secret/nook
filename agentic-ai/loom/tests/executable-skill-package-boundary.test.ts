import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'bun:test';
import { ExecutableSkillRegistryFindingCode } from '../src/executable-skills/domain.ts';
import { auditExecutableSkillRegistry } from '../src/executable-skills/registry.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../../..');
const POLICY_PATH = '.cortex/dynamic-skills/cortex-article-structure.md';
const REMOVE_TREE_OPTIONS = { recursive: true, force: true } as const;
const CREATE_TREE_OPTIONS = { recursive: true } as const;

test('registry rejects every external runtime package module form', async () => {
  const sources = [
    "import 'runtime-package';\n",
    "import value from '@scope/runtime/subpath';\nvoid value;\n",
    "export { value } from 'runtime-package';\n",
    "export * from '@scope/runtime/subpath';\n",
    "import runtime = require('runtime-package');\nvoid runtime;\n",
    "import 'npm:runtime-package@1';\n",
    "import 'jsr:@scope/runtime';\n",
    "import 'file:./runtime.ts';\n",
    "import 'http://example.com/runtime.ts';\n",
    "import 'https://example.com/runtime.ts';\n",
    "import 'data:text/javascript,export default 1';\n",
    "import '#runtime-alias';\n",
  ];
  const repositoryRoot = createAuditRepository();
  try {
    const runnerPath = path.join(
      repositoryRoot,
      '.agents/skills/cortex-article-structure/src/runner.ts',
    );
    for (const source of sources) {
      writeFileSync(runnerPath, source);
      stageRepository(repositoryRoot);
      const findings = await auditExecutableSkillRegistry(
        registryAuditRequest(repositoryRoot),
      );
      expect(findings.map((finding) => finding.code)).toContain(
        ExecutableSkillRegistryFindingCode.UnsafeCapability,
      );
    }
  } finally {
    rmSync(repositoryRoot, REMOVE_TREE_OPTIONS);
  }
});

test('registry rejects declared runtime dependencies even when unimported', async () => {
  const repositoryRoot = createAuditRepository();
  try {
    const packagePath = path.join(
      repositoryRoot,
      '.agents/skills/package.json',
    );
    const packageValue = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      readonly name: string;
    };
    const packageWithRuntimeDependency = {
      ...packageValue,
      dependencies: { 'runtime-package': '1.0.0' },
    };
    writeFileSync(packagePath, JSON.stringify(packageWithRuntimeDependency));
    stageRepository(repositoryRoot);
    const findings = await auditExecutableSkillRegistry(
      registryAuditRequest(repositoryRoot),
    );
    expect(findings.map((finding) => finding.code)).toContain(
      ExecutableSkillRegistryFindingCode.UnsafeCapability,
    );
    expect(findings.map((finding) => finding.message).join('\n')).toContain(
      'forbids declared external runtime packages',
    );
  } finally {
    rmSync(repositoryRoot, REMOVE_TREE_OPTIONS);
  }
});

test('registry permits local runtime imports and external type-only imports', async () => {
  const repositoryRoot = createAuditRepository();
  try {
    const sourceRoot = path.join(
      repositoryRoot,
      '.agents/skills/cortex-article-structure/src',
    );
    writeFileSync(
      path.join(sourceRoot, 'runner.ts'),
      "import type { ExternalType } from 'runtime-package';\n" +
        "export type { OtherType } from '@scope/runtime-types';\n" +
        "import { value } from './local.ts';\n" +
        'export type LocalAlias = ExternalType;\n' +
        'void value;\n',
    );
    writeFileSync(
      path.join(sourceRoot, 'local.ts'),
      'export const value = 1;\n',
    );
    stageRepository(repositoryRoot);
    expect(
      await auditExecutableSkillRegistry(registryAuditRequest(repositoryRoot)),
    ).toEqual([]);
  } finally {
    rmSync(repositoryRoot, REMOVE_TREE_OPTIONS);
  }
});

function registryAuditRequest(repositoryRoot: string) {
  return {
    deadlineExpiresAt: Date.now() + 30_000,
    repositoryRoot,
    signal: false,
  } as const;
}

function stageRepository(repositoryRoot: string): void {
  const gitOptions = { cwd: repositoryRoot };
  execFileSync('git', ['add', '.'], gitOptions);
}

function createAuditRepository(): string {
  const repositoryRoot = mkdtempSync(
    path.join(tmpdir(), 'executable-skill-package-boundary-'),
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
  const gitOptions = { cwd: repositoryRoot };
  execFileSync('git', ['init', '--quiet'], gitOptions);
  stageRepository(repositoryRoot);
  return repositoryRoot;
}
