import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import {
  runExecutableSkillPackageGate,
  type ExecutableSkillCommandRequest,
} from '../src/executable-skills/package-gate.ts';
import { readTrackedRepositoryFiles } from '../src/executable-skills/repository.ts';
import { isRunnableConfiguration } from './skill-provider-config-runtime.ts';

const REPOSITORY_ROOT = join(import.meta.dir, '../../..');
const TASKFILE_PATH = join(REPOSITORY_ROOT, '.task', 'agentic-ai.yml');
const CANONICAL_SCRIPTS = join(
  REPOSITORY_ROOT,
  '.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts',
);
const CREATE_OPTIONS = { recursive: true } as const;
const REMOVE_OPTIONS = { recursive: true, force: true } as const;

type FixturePackage = {
  readonly ownerRoot: string;
  readonly slug: string;
};

type WritePackageRequest = FixturePackage & {
  readonly repoRoot: string;
};

const FIXTURE_PACKAGES: readonly FixturePackage[] = [
  { ownerRoot: '.cortex/teams/ai', slug: 'first-skill' },
  { ownerRoot: '.cortex/teams/security', slug: 'second-skill' },
];

async function writePackage(request: WritePackageRequest): Promise<string> {
  const { repoRoot, ...fixture } = request;
  const packageRoot = `${fixture.ownerRoot}/dynamic-skills/${fixture.slug}`;
  const scriptsRoot = `${packageRoot}/scripts`;
  await mkdir(join(repoRoot, scriptsRoot, 'src'), CREATE_OPTIONS);
  await mkdir(join(repoRoot, scriptsRoot, 'tests'), CREATE_OPTIONS);
  const packageDocument = {
    name: `@nook/${fixture.slug}-skill`,
    private: true,
    version: '0.1.0',
    type: 'module',
    packageManager: 'bun@1.3.14',
    scripts: {
      check: 'tsc --noEmit',
      lint: 'eslint .',
      format:
        'prettier --write "src/**/*.ts" "tests/**/*.ts" executable-skill.json "*.{json,md}" eslint.config.js .prettierrc',
      'format:check':
        'prettier --check "src/**/*.ts" "tests/**/*.ts" executable-skill.json "*.{json,md}" eslint.config.js .prettierrc',
      test: 'bun test tests',
      verify:
        'bun run format:check && bun run lint && bun run check && bun test tests',
    },
    devDependencies: { typescript: '6.0.3' },
  } as const;
  const manifest = {
    schemaVersion: 1,
    id: fixture.slug,
    executionKind: 'in-process-read-only',
    requestKind: `${fixture.slug}-request-v1`,
    resultKind: `${fixture.slug}-result-v1`,
    policyPaths: [`${packageRoot}/SKILL.md`],
    limits: { requestBytes: 1024, resultBytes: 1024 },
  } as const;
  const lock = {
    lockfileVersion: 1,
    configVersion: 1,
    workspaces: {
      '': {
        name: packageDocument.name,
        devDependencies: packageDocument.devDependencies,
      },
    },
    packages: {},
  } as const;
  const sharedConfigs = await Promise.all(
    ['.prettierrc', 'tsconfig.json', 'eslint.config.js'].map(async (name) => ({
      name,
      source: await readFile(join(CANONICAL_SCRIPTS, name), 'utf8'),
    })),
  );
  await Promise.all([
    writeFile(
      join(repoRoot, packageRoot, 'SKILL.md'),
      `---\nname: ${fixture.slug}\ndescription: Fixture skill.\n---\n`,
    ),
    writeFile(join(repoRoot, scriptsRoot, '.gitignore'), 'node_modules/\n'),
    writeFile(
      join(repoRoot, scriptsRoot, 'package.json'),
      JSON.stringify(packageDocument),
    ),
    writeFile(
      join(repoRoot, scriptsRoot, 'executable-skill.json'),
      JSON.stringify(manifest),
    ),
    writeFile(join(repoRoot, scriptsRoot, 'bun.lock'), JSON.stringify(lock)),
    writeFile(join(repoRoot, scriptsRoot, 'src/index.ts'), 'export {};\n'),
    writeFile(
      join(repoRoot, scriptsRoot, 'tests/index.test.ts'),
      'export {};\n',
    ),
    ...sharedConfigs.map((config) =>
      writeFile(join(repoRoot, scriptsRoot, config.name), config.source),
    ),
  ]);
  return scriptsRoot;
}

async function fixtureRepository(): Promise<{
  readonly packageRoots: readonly string[];
  readonly repoRoot: string;
}> {
  const repoRoot = await mkdtemp(join(tmpdir(), 'skills-task-loop-'));
  const packageRoots: string[] = [];
  for (const fixture of FIXTURE_PACKAGES) {
    const request: WritePackageRequest = { ...fixture, repoRoot };
    packageRoots.push(await writePackage(request));
  }
  const initOptions = { cmd: ['git', 'init', '-q'], cwd: repoRoot };
  const init = Bun.spawnSync(initOptions);
  if (init.exitCode !== 0) throw new Error('Fixture git init failed.');
  const addOptions = { cmd: ['git', 'add', '--', '.'], cwd: repoRoot };
  const add = Bun.spawnSync(addOptions);
  if (add.exitCode !== 0) throw new Error('Fixture git add failed.');
  return { packageRoots, repoRoot };
}

test('skills tasks delegate discovery and execution to the canonical gate', async () => {
  const taskfile = await readFile(TASKFILE_PATH, 'utf8');
  expect(taskfile).not.toContain('SKILL_APPLICATION_DIRS');
  for (const action of ['install', 'format', 'verify']) {
    expect(taskfile).toContain(`package-gate-cli.ts" ${action}`);
  }
  expect(taskfile).toContain('deps: [skills:install]');
  expect(taskfile.match(/src\/cli\.ts/gu)).toHaveLength(2);
  expect(taskfile).toContain('"--request-yaml=$NOOK_SKILL_REQUEST_YAML"');
  expect(taskfile).toContain('NOOK_SKILL_REQUEST_YAML:');
  expect(taskfile).toContain('--tools-list');
  const consumers: string[] = [];
  for (const file of readTrackedRepositoryFiles(REPOSITORY_ROOT)) {
    if (!isRunnableConfiguration(file.path)) continue;
    const source = await readFile(join(REPOSITORY_ROOT, file.path), 'utf8');
    if (/skills:(?:run|tools-list)/u.test(source)) consumers.push(file.path);
  }
  expect(consumers).toEqual(['.task/agentic-ai.yml']);
});

test('verify runs every discovered package in deterministic order', async () => {
  const fixture = await fixtureRepository();
  try {
    const requests: ExecutableSkillCommandRequest[] = [];
    const request = {
      action: 'verify',
      repoRoot: fixture.repoRoot,
      runner: (command: ExecutableSkillCommandRequest) => {
        requests.push(command);
        return 0;
      },
    } as const;
    runExecutableSkillPackageGate(request);
    expect(requests.map((request) => request.cwd)).toEqual(
      fixture.packageRoots.map((root) => join(fixture.repoRoot, root)),
    );
    expect(requests.map((request) => request.arguments)).toEqual([
      ['run', 'verify'],
      ['run', 'verify'],
    ]);
  } finally {
    await rm(fixture.repoRoot, REMOVE_OPTIONS);
  }
});

test('install keeps the frozen lockfile contract', async () => {
  const fixture = await fixtureRepository();
  try {
    const requests: ExecutableSkillCommandRequest[] = [];
    const request = {
      action: 'install',
      repoRoot: fixture.repoRoot,
      runner: (command: ExecutableSkillCommandRequest) => {
        requests.push(command);
        return 0;
      },
    } as const;
    runExecutableSkillPackageGate(request);
    expect(requests.map((command) => command.arguments)).toEqual([
      ['install', '--frozen-lockfile'],
      ['install', '--frozen-lockfile'],
    ]);
  } finally {
    await rm(fixture.repoRoot, REMOVE_OPTIONS);
  }
});

test('a failing discovered package stops the gate', async () => {
  const fixture = await fixtureRepository();
  try {
    const requests: ExecutableSkillCommandRequest[] = [];
    const request = {
      action: 'verify',
      repoRoot: fixture.repoRoot,
      runner: (command: ExecutableSkillCommandRequest) => {
        requests.push(command);
        return 23;
      },
    } as const;
    expect(() => runExecutableSkillPackageGate(request)).toThrow('status 23');
    expect(requests).toHaveLength(1);
  } finally {
    await rm(fixture.repoRoot, REMOVE_OPTIONS);
  }
});

test('structural findings fail before any package command runs', async () => {
  const fixture = await fixtureRepository();
  try {
    await writeFile(
      join(fixture.repoRoot, fixture.packageRoots[1] ?? '', 'package.json'),
      '{}',
    );
    const requests: ExecutableSkillCommandRequest[] = [];
    const request = {
      action: 'verify',
      repoRoot: fixture.repoRoot,
      runner: (command: ExecutableSkillCommandRequest) => {
        requests.push(command);
        return 0;
      },
    } as const;
    expect(() => runExecutableSkillPackageGate(request)).toThrow('findings');
    expect(requests).toEqual([]);
  } finally {
    await rm(fixture.repoRoot, REMOVE_OPTIONS);
  }
});

test('a symlinked package path fails before execution', async () => {
  const fixture = await fixtureRepository();
  const packageRoot = join(
    fixture.repoRoot,
    '.cortex/teams/security/dynamic-skills/second-skill',
  );
  const movedRoot = join(fixture.repoRoot, 'moved-second-skill');
  try {
    await rename(packageRoot, movedRoot);
    await symlink(movedRoot, packageRoot);
    const requests: ExecutableSkillCommandRequest[] = [];
    const request = {
      action: 'verify',
      repoRoot: fixture.repoRoot,
      runner: (command: ExecutableSkillCommandRequest) => {
        requests.push(command);
        return 0;
      },
    } as const;
    expect(() => runExecutableSkillPackageGate(request)).toThrow(
      'real directories',
    );
    expect(requests).toEqual([]);
  } finally {
    await rm(fixture.repoRoot, REMOVE_OPTIONS);
  }
});
