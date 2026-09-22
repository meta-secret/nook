import { expect, test } from 'bun:test';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ModuleExpertCommandParser } from '../../src/module-experts/cli.ts';
import { StructuralExpertCommandLine } from '../../src/structural-experts/cli.ts';

const LOOM_ROOT = join(import.meta.dir, '../..');

const RETIRED_HANDOFF_SURFACES = [
  'src/module-experts/invoke.ts',
  'src/structural-experts/invoke.ts',
  'src/structural-experts/parent-context.ts',
  'src/agent-workflow/agent-journal.ts',
  'src/agent-workflow/agent-replay.ts',
  'src/agent-workflow/attempt-codec.ts',
  'src/agent-workflow/attempt-verification.ts',
  'src/agent-workflow/codex-runtime.ts',
  'src/module-experts/trusted-runtime.ts',
  'src/structural-experts/trusted-runtime.ts',
] as const;

const REMOVED_INTERNAL_SECURITY_MODULES = [
  'src/module-experts/isolation-receipt.ts',
  'src/module-experts/parent-authorization.ts',
  'src/structural-experts/isolation-receipt.ts',
  'src/structural-experts/parent-authorization.ts',
] as const;

test('keeps named-expert handoffs on the active harness', async () => {
  for (const relativePath of RETIRED_HANDOFF_SURFACES) {
    await expect(access(join(LOOM_ROOT, relativePath))).rejects.toThrow();
  }
  const externalBoundary = await readFile(
    join(LOOM_ROOT, 'src/module-experts/runtime-contract.ts'),
    'utf8',
  );
  expect(externalBoundary).toContain("from 'node:crypto'");
  expect(externalBoundary).toContain('timingSafeEqual');

  for (const relativePath of REMOVED_INTERNAL_SECURITY_MODULES) {
    await expect(access(join(LOOM_ROOT, relativePath))).rejects.toThrow();
  }
});

test('rejects retired named-expert invocation entrypoints', async () => {
  const invocation = [
    'invoke',
    '--request',
    '/tmp/request.json',
    '--working-directory',
    '/tmp/repository',
  ] as const;
  expect(ModuleExpertCommandParser.parse(invocation)).toBe(false);
  expect(StructuralExpertCommandLine.parse(invocation)).toBe(false);

  const taskfile = await readFile(
    join(LOOM_ROOT, '../../.task/agentic-ai.yml'),
    'utf8',
  );
  expect(taskfile).not.toContain('loom:module-experts:invoke');
  expect(taskfile).not.toContain('loom:structural-experts:invoke');
});

test('keeps trusted-handoff documentation and failure kinds current', async () => {
  const readme = await readFile(join(LOOM_ROOT, 'README.md'), 'utf8');
  for (const staleReference of [
    'moduleExpertAuthorizations',
    'structuralExpertAuthorizations',
    'exact authorization',
    'exact typed child authorization',
    'exact depth-two authorization',
    'parent authorization freezes',
    'delegation journal',
    'attempt journal',
    'module-experts:invoke',
    'structural-experts:invoke',
  ]) {
    expect(readme).not.toContain(staleReference);
  }
});
