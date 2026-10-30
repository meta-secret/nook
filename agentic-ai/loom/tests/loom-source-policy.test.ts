import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import {
  LoomSourcePolicy,
  LoomSourcePolicyViolationKind,
} from '../src/commands/loom-source-policy.ts';

test('accepts the complete Loom source and test inventory', async () => {
  const report = await LoomSourcePolicy.audit({
    root: join(import.meta.dir, '..'),
    ownershipPaths: [],
  });
  expect(report.violations).toEqual([]);
});

test('accepts structural result schema factories with their semantic owner', async () => {
  const root = join(import.meta.dir, '..');
  const report = await LoomSourcePolicy.audit({
    root,
    ownershipPaths: [
      join(root, 'src', 'agent-workflow', 'structural-result-values.ts'),
    ],
  });
  expect(report.violations).toEqual([]);
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
    const report = await LoomSourcePolicy.audit({
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

test('allows class methods and immediately invoked callbacks', async () => {
  const root = join(import.meta.dir, '..');
  const report = await LoomSourcePolicy.audit({
    root,
    ownershipPaths: [join(root, 'tests', 'loom-source-policy.test.ts')],
  });
  expect(report.violations).toEqual([]);
});
