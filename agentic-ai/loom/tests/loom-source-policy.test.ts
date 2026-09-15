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
  const zigSetup = '      - name: Install rootless Zig toolchain';
  expect(workflow).toContain(zigSetup);
  expect(workflow).not.toContain('sudo -n apt-get');
  expect(workflow).toContain('exec zig cc "${args[@]}"');
  expect(workflow).toContain('exec zig c++ "${args[@]}"');
  expect(workflow).toContain('exec zig ar "$@"');
  expect(workflow).toContain('echo "$toolchain_dir" >> "$GITHUB_PATH"');
  expect(workflow).toContain('echo "CC=$toolchain_dir/cc"');
  expect(workflow).toContain('echo "CXX=$toolchain_dir/c++"');
  expect(workflow).toContain('echo "AR=$toolchain_dir/ar"');
  const rustSetup =
    '      - uses: actions-rust-lang/setup-rust-toolchain@v2\n' +
    '        with:\n' +
    '          toolchain: stable\n' +
    '          cache: false';
  expect(workflow).toContain(rustSetup);
  expect(workflow.indexOf(zigSetup)).toBeLessThan(workflow.indexOf(rustSetup));
  expect(
    workflow.indexOf('      - name: Configure rootless native compiler'),
  ).toBeLessThan(workflow.indexOf('      - run: task tooling:static'));
  expect(workflow.indexOf(rustSetup)).toBeLessThan(
    workflow.indexOf('      - run: task tooling:static'),
  );
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

test('extracts Zig without delegating XZ decoding to runner tar', async () => {
  const repositoryRoot = join(import.meta.dir, '..', '..', '..');
  const workflow = await readFile(
    join(repositoryRoot, '.github', 'workflows', 'repository-policy.yml'),
    'utf8',
  );
  const extractionStart = workflow.indexOf(
    '      - name: Install rootless Zig toolchain',
  );
  const extractionEnd = workflow.indexOf(
    '      - name: Configure rootless native compiler',
    extractionStart,
  );
  const extraction = workflow.slice(extractionStart, extractionEnd);

  expect(extraction).not.toContain('mlugg/setup-zig');
  expect(extraction).toContain(
    'https://ziglang.org/download/0.15.2/zig-x86_64-linux-0.15.2.tar.xz',
  );
  expect(extraction).toContain(
    'https://busybox.net/downloads/binaries/1.35.0-x86_64-linux-musl/busybox_UNXZ',
  );
  expect(extraction).toContain(
    "printf '02aa270f183da276e5b5920b1dac44a63f1a49e55050ebde3aecc9eb82f93239  %s\\n'",
  );
  expect(extraction).toContain(
    "printf 'c70d2b5e2828f4c90c36a3b9185b5d4405b0751e9fc7c43231c78711e047a306  %s\\n'",
  );
  expect(extraction).toContain('"$zig_archive" |');
  expect(extraction).toContain('"$xz_decoder" |');
  expect(extraction).toContain('sha256sum -c -');
  expect(extraction).toContain('"$xz_decoder" -c "$zig_archive"');
  expect(extraction).toContain('tar -xf "$zig_tar"');
  expect(extraction).not.toContain('tar -xJ');
  expect(extraction).not.toContain('tar --xz');
});

test('translates cc-rs GNU targets for Zig without dropping compiler arguments', async () => {
  const repositoryRoot = join(import.meta.dir, '..', '..', '..');
  const workflow = await readFile(
    join(repositoryRoot, '.github', 'workflows', 'repository-policy.yml'),
    'utf8',
  );
  const compilerStart = workflow.indexOf(
    '      - name: Configure rootless native compiler',
  );
  const compilerEnd = workflow.indexOf(
    '      - uses: actions-rust-lang/setup-rust-toolchain@v2',
    compilerStart,
  );
  const compiler = workflow.slice(compilerStart, compilerEnd);
  expect(
    compiler.split('\n              --target=x86_64-unknown-linux-gnu)').length,
  ).toBe(3);
  expect(
    compiler.split('\n              -target=x86_64-unknown-linux-gnu)').length,
  ).toBe(3);
  expect(compiler.split('--target|-target)').length).toBe(3);
  expect(compiler.split('args+=("--target=x86_64-linux-gnu")').length).toBe(3);
  expect(compiler.split('args+=("-target=x86_64-linux-gnu")').length).toBe(3);
  expect(compiler.split('args+=("x86_64-linux-gnu")').length).toBe(3);
  expect(compiler).toContain('args+=("$1")');
  expect(compiler).toContain('args+=("$2")');
  expect(compiler).not.toContain('sed ');
  expect(compiler).not.toContain('shift 2');
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
