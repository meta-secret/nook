import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { LoomFailureCode } from '../../src/loom-failure.ts';
import { ExecutableSkillClosureEntryRole } from '../../src/executable-skills/domain.ts';
import type { ExecutableSkillClosurePlan } from '../../src/executable-skills/domain.ts';
import {
  materializeExecutableSkillContext,
  materializeExecutableSkillContextWithDependencies,
  type ExecutableSkillContextDependencies,
  type MaterializeExecutableSkillContextRequest,
  type MaterializeExecutableSkillContextWithDependenciesRequest,
} from '../../src/executable-skills/runtime-context.ts';

test('normalizes execution source metadata for deterministic non-root reads', async () => {
  const content = 'export const value = 1;\n';
  const runnerRelativePath = '.agents/skills/fixture/src/runner.ts';
  const entry = {
    content,
    contentSha256: createHash('sha256').update(content).digest('hex'),
    relativePath: runnerRelativePath,
    role: ExecutableSkillClosureEntryRole.ExecutionSource,
  };
  const closurePlan: ExecutableSkillClosurePlan = {
    closureSha256: 'a'.repeat(64),
    entries: Object.freeze([Object.freeze(entry)]),
    runnerRelativePath,
    sourceTree: 'b'.repeat(40),
  };
  const request: MaterializeExecutableSkillContextRequest = {
    closurePlan,
    deadlineExpiresAt: Date.now() + 30_000,
    signal: false,
  };
  const dependencies: ExecutableSkillContextDependencies = {
    isClosurePlanSealed: () => true,
  };
  const execution: MaterializeExecutableSkillContextWithDependenciesRequest = {
    dependencies,
    request,
  };
  const context =
    await materializeExecutableSkillContextWithDependencies(execution);
  try {
    const runnerPath = path.join(context.directory, runnerRelativePath);
    const runnerDirectory = path.dirname(runnerPath);
    const runnerMetadata = await lstat(runnerPath);
    const directoryMetadata = await lstat(runnerDirectory);
    expect(await readFile(runnerPath, 'utf8')).toBe(content);
    expect(runnerMetadata.mode & 0o777).toBe(0o444);
    expect(directoryMetadata.mode & 0o777).toBe(0o755);
    expect(runnerMetadata.mtimeMs).toBe(0);
    expect(directoryMetadata.mtimeMs).toBe(0);
  } finally {
    await context.dispose();
  }
});

test('rejects a structurally forged closure before filesystem writes', async () => {
  const closurePlan = forgedClosure();
  const request: MaterializeExecutableSkillContextRequest = {
    closurePlan,
    deadlineExpiresAt: Date.now() + 30_000,
    signal: false,
  };
  const expectedFailure = {
    code: LoomFailureCode.ExecutableSkillRuntimeFailed,
    message: expect.stringContaining('closure authority is invalid'),
  };

  await expect(
    materializeExecutableSkillContext(request),
  ).rejects.toMatchObject(expectedFailure);
});

test('rejects aborted and expired materialization before authority work', async () => {
  const closurePlan = forgedClosure();
  const controller = new AbortController();
  controller.abort();
  const abortedRequest: MaterializeExecutableSkillContextRequest = {
    closurePlan,
    deadlineExpiresAt: Date.now() + 30_000,
    signal: controller.signal,
  };
  const expiredRequest: MaterializeExecutableSkillContextRequest = {
    closurePlan,
    deadlineExpiresAt: Date.now() - 1,
    signal: false,
  };
  const expectedAborted = {
    code: LoomFailureCode.ExecutableSkillRuntimeFailed,
    message: expect.stringContaining('materialization was aborted'),
  };
  const expectedExpired = {
    code: LoomFailureCode.ExecutableSkillRuntimeFailed,
    message: expect.stringContaining('materialization deadline expired'),
  };

  await expect(
    materializeExecutableSkillContext(abortedRequest),
  ).rejects.toMatchObject(expectedAborted);
  await expect(
    materializeExecutableSkillContext(expiredRequest),
  ).rejects.toMatchObject(expectedExpired);
});

function forgedClosure(): ExecutableSkillClosurePlan {
  const closureValue: ExecutableSkillClosurePlan = {
    closureSha256: 'a'.repeat(64),
    entries: Object.freeze([]),
    runnerRelativePath: '.agents/skills/fixture/src/runner.ts',
    sourceTree: 'b'.repeat(40),
  };
  return Object.freeze(closureValue);
}
