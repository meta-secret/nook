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

test('wires canonical state and Cortex gates into Loom check', async () => {
  const packageJson = await readFile(
    join(import.meta.dir, '..', 'package.json'),
    'utf8',
  );
  expect(packageJson).toContain('"check": "tsc --noEmit"');
  expect(packageJson).toContain(
    '"precheck": "bun run source-policy && bun run cortex-audit"',
  );
  expect(packageJson).toContain(
    '"source-policy": "bun run src/commands/loom-source-policy.ts . --ownership-from HEAD^"',
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
