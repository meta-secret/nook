import { expect, test } from 'bun:test';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const LOOM_ROOT = join(import.meta.dir, '../..');

const TRUSTED_HANDOFF_SURFACES = [
  'src/module-experts/invoke.ts',
  'src/module-experts/trusted-runtime.ts',
  'src/structural-experts/invoke.ts',
  'src/structural-experts/parent-context.ts',
  'src/structural-experts/trusted-runtime.ts',
] as const;

const REMOVED_INTERNAL_SECURITY_MODULES = [
  'src/module-experts/isolation-receipt.ts',
  'src/module-experts/parent-authorization.ts',
  'src/structural-experts/isolation-receipt.ts',
  'src/structural-experts/parent-authorization.ts',
] as const;

test('keeps same-thread expert handoffs plain and boundary checks explicit', async () => {
  const sources = await Promise.all(
    TRUSTED_HANDOFF_SURFACES.map(async (relativePath) => ({
      relativePath,
      source: await readFile(join(LOOM_ROOT, relativePath), 'utf8'),
    })),
  );
  const prohibitedInternalSecurityLayers = [
    /node:crypto/u,
    /\bWeakMap\b/u,
    /\bWeakSet\b/u,
    /AgentAttemptReplay/u,
    /AgentAttemptTransport/u,
    /IsolationReceipt/u,
    /ParentAuthorization/u,
    /verifyModuleExpertInvocationResult/u,
    /\b(?:one[- ]shot|one[- ]use)\b/iu,
  ] as const;
  for (const surface of sources) {
    for (const prohibited of prohibitedInternalSecurityLayers) {
      expect(surface.source).not.toMatch(prohibited);
    }
  }

  const moduleRuntime = sources.find(
    (surface) =>
      surface.relativePath === 'src/module-experts/trusted-runtime.ts',
  );
  const structuralRuntime = sources.find(
    (surface) =>
      surface.relativePath === 'src/structural-experts/trusted-runtime.ts',
  );
  const structuralParentContext = sources.find(
    (surface) =>
      surface.relativePath === 'src/structural-experts/parent-context.ts',
  );
  if (!moduleRuntime || !structuralRuntime || !structuralParentContext) {
    throw new Error('Trusted expert handoff source inventory is incomplete.');
  }
  expect(moduleRuntime.source).toContain(
    'ModuleExpertCodexSdkAgentRuntime.executeIsolated',
  );
  expect(structuralRuntime.source).toContain(
    'ReadOnlyExpertCodexRuntime.executeIsolated',
  );
  expect(structuralParentContext.source).toContain(
    'VerifiedAttemptArtifacts.readVerifiedBarrierAttempt',
  );

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

test('keeps trusted-handoff documentation and failure kinds current', async () => {
  const readme = await readFile(join(LOOM_ROOT, 'README.md'), 'utf8');
  for (const staleReference of [
    'moduleExpertAuthorizations',
    'structuralExpertAuthorizations',
    'exact authorization',
    'exact typed child authorization',
    'exact depth-two authorization',
    'parent authorization freezes',
  ]) {
    expect(readme).not.toContain(staleReference);
  }

  const runtime = await readFile(
    join(LOOM_ROOT, 'src/agent-workflow/runtime.ts'),
    'utf8',
  );
  expect(runtime).not.toContain('IsolationReceipt');
  expect(runtime).not.toContain('isolationReceipt');
});
