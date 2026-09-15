import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import {
  LoomSourcePolicy,
  LoomSourcePolicyViolationKind,
} from '../src/commands/loom-source-policy.ts';

test('accepts the complete Loom source and test inventory', () => {
  const report = LoomSourcePolicy.audit({
    root: join(import.meta.dir, '..'),
    ownershipPaths: [],
  });
  expect(report.violations).toEqual([]);
});

test('accepts structural result schema factories with their semantic owner', () => {
  const root = join(import.meta.dir, '..');
  const report = LoomSourcePolicy.audit({
    root,
    ownershipPaths: [
      join(root, 'src', 'agent-workflow', 'structural-result-values.ts'),
    ],
  });
  expect(report.violations).toEqual([]);
});

test('wires canonical state and Cortex gates into Loom check', async () => {
  const repositoryRoot = join(import.meta.dir, '..', '..', '..');
  const packageJson = await readFile(
    join(import.meta.dir, '..', 'package.json'),
    'utf8',
  );
  expect(packageJson).toContain('"check": "tsc --noEmit"');
  expect(packageJson).toContain(
    '"precheck": "bun run source-policy && bun run cortex-audit"',
  );
  expect(packageJson).toContain(
    '"source-policy": "bun run src/commands/loom-source-policy.ts . --ownership-from \\"$LOOM_OWNERSHIP_FROM\\""',
  );
  const taskfile = await readFile(
    join(repositoryRoot, '.task', 'static-checks.yml'),
    'utf8',
  );
  expect(taskfile).toContain('bun run --cwd "$directory" check');
  const workflow = await readFile(
    join(repositoryRoot, '.github', 'workflows', 'repository-policy.yml'),
    'utf8',
  );
  expect(workflow).toContain('fetch-depth: 0');
  expect(workflow).toContain(
    'LOOM_OWNERSHIP_FROM: ${{ github.event.pull_request.base.sha || github.event.before }}',
  );
  expect(workflow).not.toContain('sudo -n apt-get');
  const rustSetup =
    '      - uses: actions-rust-lang/setup-rust-toolchain@v2\n' +
    '        with:\n' +
    '          toolchain: stable\n' +
    '          cache: false';
  expect(workflow).toContain(rustSetup);
  expect(workflow).toContain(
    '      - run: task loom:repository-policy:setup-native-toolchain',
  );
  expect(workflow).not.toContain('run: |');
  expect(workflow).not.toContain('run: bun ');
  expect(workflow).not.toContain('run: bash ');
  expect(workflow.indexOf(rustSetup)).toBeLessThan(
    workflow.indexOf('      - run: task tooling:static'),
  );
  const agenticTaskfile = await readFile(
    join(repositoryRoot, '.task', 'agentic-ai.yml'),
    'utf8',
  );
  expect(agenticTaskfile).toContain(
    'loom:repository-policy:setup-native-toolchain:',
  );
  expect(agenticTaskfile).toContain('repository-policy-toolchain.ts" setup');
  const toolchain = await readFile(
    join(
      repositoryRoot,
      'agentic-ai',
      'loom',
      'src',
      'commands',
      'repository-policy-toolchain.ts',
    ),
    'utf8',
  );
  for (const required of [
    '0.15.2',
    'c8f9d6c8055442bc7e9c121b2498e6f0e3fb670f4665e6ee577f1897f7665cf6',
    '02aa270f183da276e5b5920b1dac44a63f1a49e55050ebde3aecc9eb82f93239',
    'c70d2b5e2828f4c90c36a3b9185b5d4405b0751e9fc7c43231c78711e047a306',
    'busybox_UNXZ',
    'unxz',
    'x86_64-unknown-linux-gnu',
    'x86_64-linux-gnu',
    'GITHUB_PATH',
    'GITHUB_ENV',
  ]) {
    expect(toolchain).toContain(required);
  }
  const preflightTaskfile = await readFile(
    join(repositoryRoot, 'preflight', 'Taskfile.yml'),
    'utf8',
  );
  expect(preflightTaskfile).toContain('LOOM_OWNERSHIP_FROM=$baseline');
  const preflightDockerfile = await readFile(
    join(repositoryRoot, 'preflight', 'Dockerfile'),
    'utf8',
  );
  expect(preflightDockerfile).toContain('ARG LOOM_OWNERSHIP_FROM');
  expect(preflightDockerfile).toContain(
    'LOOM_OWNERSHIP_FROM=$LOOM_OWNERSHIP_FROM',
  );
  const readme = await readFile(
    join(import.meta.dir, '..', 'README.md'),
    'utf8',
  );
  expect(readme).toContain(
    'runtime failures return `neverthrow` `Result` values with concrete',
  );
  expect(readme).not.toContain('runtime failures throw `LoomFailure`');
});

test('rejects reusable unowned functions in a reviewed source file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'loom-source-policy-'));
  try {
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'tests'), { recursive: true });
    await writeFile(
      join(root, 'src', 'invalid.ts'),
      [
        'function loose() { return 1; }',
        'function outer() {',
        '  const reusable = () => 1;',
        '  function nested() { return 2; }',
        '  return run(() => nested());',
        '}',
      ].join('\n'),
    );
    const report = LoomSourcePolicy.audit({
      root,
      ownershipPaths: [join(root, 'src', 'invalid.ts')],
    });
    expect(report.violations.map(({ kind }) => kind)).toEqual([
      LoomSourcePolicyViolationKind.UnownedFunction,
      LoomSourcePolicyViolationKind.UnownedFunction,
      LoomSourcePolicyViolationKind.UnownedFunction,
      LoomSourcePolicyViolationKind.UnownedFunction,
    ]);
    expect(report.violations.map(({ line }) => line)).toEqual([1, 2, 3, 4]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('allows class methods and immediately invoked callbacks', () => {
  const root = join(import.meta.dir, '..');
  const report = LoomSourcePolicy.audit({
    root,
    ownershipPaths: [join(root, 'tests', 'loom-source-policy.test.ts')],
  });
  expect(report.violations).toEqual([]);
});
