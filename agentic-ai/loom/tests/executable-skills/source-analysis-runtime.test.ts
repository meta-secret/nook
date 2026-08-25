import { describe, expect, test } from 'bun:test';
import {
  encodeSourceAnalysisResult,
  MAXIMUM_SEALED_SOURCE_BYTES,
} from '../../src/executable-skills/source-analysis-codec.ts';
import type {
  RunSealedSourceAnalysisContainerRequest,
  SealedSourceAnalysisDockerEnvironment,
} from '../../src/executable-skills/source-analysis-docker.ts';
import {
  type RunExecutableSkillSourceAnalysisRequest,
  type SourceAnalysisContainerExecutor,
  type SourceAnalysisRuntimeDependencies,
  runSourceAnalysisWithDependencies,
} from '../../src/executable-skills/source-analysis-runtime.ts';
import type { ExecutableSkillSourceAnalysis } from '../../src/executable-skills/source-policy.ts';

const DOCKER_ENVIRONMENT: SealedSourceAnalysisDockerEnvironment = {
  contextName: 'explicit-local',
  daemonId: '12345678-1234-1234-1234-123456789abc',
  endpoint: 'unix:///explicit/docker.sock',
};
const MAXIMUM_MODULE_SPECIFIERS = 256;
const MAXIMUM_MODULE_SPECIFIER_BYTES = 4096;

function analysisRequest(
  source: string,
): RunExecutableSkillSourceAnalysisRequest {
  return {
    deadlineExpiresAt: Date.now() + 30_000,
    dockerEnvironment: DOCKER_ENVIRONMENT,
    relativePath: './fixture.ts',
    signal: false,
    source,
  };
}

describe('sealed source analysis runtime', () => {
  test('transports the maximum escaped source and path before launch', async () => {
    let serializedRequestBytes = 0;
    const emptyAnalysis: ExecutableSkillSourceAnalysis = {
      moduleSpecifiers: [],
    };
    const executeContainer: SourceAnalysisContainerExecutor = async (
      request: RunSealedSourceAnalysisContainerRequest,
    ) => {
      serializedRequestBytes = new TextEncoder().encode(
        request.serializedRequest,
      ).byteLength;
      return { serializedResult: encodeSourceAnalysisResult(emptyAnalysis) };
    };
    const dependencies: SourceAnalysisRuntimeDependencies = {
      executeContainer,
    };
    const request: RunExecutableSkillSourceAnalysisRequest = {
      ...analysisRequest('\0'.repeat(MAXIMUM_SEALED_SOURCE_BYTES)),
      relativePath: '\0'.repeat(4096),
    };
    const execution = { dependencies, request };
    await expect(runSourceAnalysisWithDependencies(execution)).resolves.toEqual(
      emptyAnalysis,
    );
    expect(serializedRequestBytes).toBeGreaterThan(6 * 1024 * 1024);
  });

  test('returns the analyzer maximum result capacity through the executor', async () => {
    const specifier = `./${'a'.repeat(MAXIMUM_MODULE_SPECIFIER_BYTES - 5)}.ts`;
    const capacity = { length: MAXIMUM_MODULE_SPECIFIERS };
    const analysis: ExecutableSkillSourceAnalysis = {
      moduleSpecifiers: Array.from(capacity, () => specifier),
    };
    const serializedResult = encodeSourceAnalysisResult(analysis);
    expect(
      new TextEncoder().encode(serializedResult).byteLength,
    ).toBeGreaterThan(256 * 1024);
    const executeContainer: SourceAnalysisContainerExecutor = async () => ({
      serializedResult,
    });
    const dependencies: SourceAnalysisRuntimeDependencies = {
      executeContainer,
    };
    const execution = {
      dependencies,
      request: analysisRequest('export {};'),
    };
    await expect(runSourceAnalysisWithDependencies(execution)).resolves.toEqual(
      analysis,
    );
  });

  test('serializes every analysis through one active container slot', async () => {
    let active = 0;
    let maximumActive = 0;
    const analysis: ExecutableSkillSourceAnalysis = {
      moduleSpecifiers: ['./audit.ts'],
    };
    const serializedResult = encodeSourceAnalysisResult(analysis);
    const executeContainer: SourceAnalysisContainerExecutor = async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Bun.sleep(20);
      active -= 1;
      return { serializedResult };
    };
    const dependencies: SourceAnalysisRuntimeDependencies = {
      executeContainer,
    };
    const firstExecution = {
      dependencies,
      request: analysisRequest("import './audit.ts';"),
    };
    const secondExecution = {
      dependencies,
      request: analysisRequest("import './audit.ts';"),
    };
    const executions = [
      runSourceAnalysisWithDependencies(firstExecution),
      runSourceAnalysisWithDependencies(secondExecution),
    ];
    await expect(Promise.all(executions)).resolves.toEqual([
      analysis,
      analysis,
    ]);
    expect(maximumActive).toBe(1);
  });

  test('aborted slot wait releases its queue position', async () => {
    let releaseFirst = (): void => {};
    const firstWait = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let invocation = 0;
    const emptyAnalysis: ExecutableSkillSourceAnalysis = {
      moduleSpecifiers: [],
    };
    const serializedResult = encodeSourceAnalysisResult(emptyAnalysis);
    const executeContainer: SourceAnalysisContainerExecutor = async (
      _request: RunSealedSourceAnalysisContainerRequest,
    ) => {
      invocation += 1;
      if (invocation === 1) await firstWait;
      return { serializedResult };
    };
    const dependencies: SourceAnalysisRuntimeDependencies = {
      executeContainer,
    };
    const firstExecution = {
      dependencies,
      request: analysisRequest('export {};'),
    };
    const first = runSourceAnalysisWithDependencies(firstExecution);
    await Bun.sleep(5);
    const controller = new AbortController();
    const queuedRequest: RunExecutableSkillSourceAnalysisRequest = {
      ...analysisRequest('export {};'),
      signal: controller.signal,
    };
    const queuedExecution = { dependencies, request: queuedRequest };
    const queued = runSourceAnalysisWithDependencies(queuedExecution);
    controller.abort();
    await expect(queued).rejects.toThrow('aborted');
    releaseFirst();
    await expect(first).resolves.toEqual(emptyAnalysis);

    const finalExecution = {
      dependencies,
      request: analysisRequest('export {};'),
    };
    await expect(
      runSourceAnalysisWithDependencies(finalExecution),
    ).resolves.toEqual(emptyAnalysis);
  });

  test('rejects expired and unbounded total deadlines before queueing', async () => {
    const executeContainer: SourceAnalysisContainerExecutor = async () => {
      throw new Error('executor must remain unreachable');
    };
    const dependencies: SourceAnalysisRuntimeDependencies = {
      executeContainer,
    };
    const invalidDeadlines = [Date.now() - 1, Date.now() + 10 * 60 * 1_000];
    for (const deadlineExpiresAt of invalidDeadlines) {
      const request: RunExecutableSkillSourceAnalysisRequest = {
        ...analysisRequest('export {};'),
        deadlineExpiresAt,
      };
      const execution = { dependencies, request };
      await expect(
        runSourceAnalysisWithDependencies(execution),
      ).rejects.toThrow('total deadline is invalid');
    }
  });
});
