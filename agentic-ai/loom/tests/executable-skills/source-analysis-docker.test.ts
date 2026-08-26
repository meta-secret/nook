import { describe, expect, test } from 'bun:test';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import type { RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findRepoRoot } from '../../src/lib/repo.ts';
import { encodeSourceAnalysisResult } from '../../src/executable-skills/source-analysis-codec.ts';
import {
  createContainerCommand,
  resetSourceAnalysisImageCacheForTest,
  resolveSealedSourceAnalysisContainerOutput,
  runSealedSourceAnalysisWithDependencies,
  type RunSealedSourceAnalysisContainerRequest,
  SOURCE_ANALYSIS_CONTAINER_LABEL,
  SOURCE_ANALYSIS_IMAGE_INPUTS,
  SOURCE_ANALYSIS_IMAGE_LABEL,
  type SealedSourceAnalysisDockerEnvironment,
  type SealedSourceAnalysisContainerOutput,
  type SourceAnalysisDockerDependencies,
  type SourceAnalysisDockerProcessExecutor,
  sourceAnalysisBuildIdentity,
} from '../../src/executable-skills/source-analysis-docker.ts';
import type {
  BoundedProcessOutput,
  RunBoundedProcessRequest,
} from '../../src/executable-skills/source-analysis-process.ts';
import { readSourceAnalysisSnapshot } from '../../src/executable-skills/source-analysis-snapshot.ts';
import type { ExecutableSkillSourceAnalysis } from '../../src/executable-skills/source-policy.ts';

enum FakeDockerMode {
  ConfigurationDrift = 'configurationDrift',
  Normal = 'normal',
  Oom = 'oom',
  Preexisting = 'preexisting',
  StartFailure = 'startFailure',
  TeardownAuthorityFailure = 'teardownAuthorityFailure',
  TeardownFailure = 'teardownFailure',
}

type FakeDockerState = {
  active: boolean;
  buildIdentity: string;
  readonly commands: string[][];
  readonly deadlines: number[];
  imageInspectFailures: number;
  readonly mode: FakeDockerMode;
  removals: number;
  repoRoot: string;
  snapshotMutation: FakeSourceMutation | false;
};

type FakeSourceMutation = {
  contextMatchedSnapshot: boolean;
  readonly originalContents: string;
  readonly relativePath: string;
  readonly replacementContents: string;
};

const REPO_ROOT = findRepoRoot();
const DOCKER_EXECUTABLE = '/trusted/docker';
const IMAGE_ID = `sha256:${'a'.repeat(64)}`;
const DOCKER_ENVIRONMENT: SealedSourceAnalysisDockerEnvironment = {
  daemonId: '12345678-1234-1234-1234-123456789abc',
  endpoint: 'unix:///explicit/docker.sock',
};

function successfulOutput(stdout: string): BoundedProcessOutput {
  return { exitCode: 0, stderr: '', stdout };
}

function failedOutput(stderr: string): BoundedProcessOutput {
  return { exitCode: 1, stderr, stdout: '' };
}

function staticContainerReceipt(): string {
  return [
    IMAGE_ID,
    '65532:65532',
    'none',
    'true',
    'false',
    'false',
    'false',
    String(512 * 1024 * 1024),
    String(512 * 1024 * 1024),
    '64',
    '["ALL"]',
    '["no-new-privileges","seccomp=builtin"]',
    '{"/tmp":"rw,noexec,nosuid,size=16m"}',
    '0',
    '0',
    '0',
    'runc',
    'private',
    '',
    '',
    '',
    'private',
    '',
    'none',
    'no',
  ].join('|');
}

function fakeDockerExecutor(
  state: FakeDockerState,
): SourceAnalysisDockerProcessExecutor {
  return async (request: RunBoundedProcessRequest) => {
    const command = [...request.command];
    state.commands.push(command);
    state.deadlines.push(request.deadlineExpiresAt);
    const joined = command.join(' ');
    if (joined.includes(' info --format ')) {
      if (
        state.mode === FakeDockerMode.TeardownAuthorityFailure &&
        state.active
      ) {
        return failedOutput('authority probe timed out');
      }
      return successfulOutput(
        `${DOCKER_ENVIRONMENT.daemonId}|linux|runc|["name=seccomp,profile=builtin","name=cgroupns"]|2\n`,
      );
    }
    if (joined.includes(' container ls ')) {
      if (state.mode === FakeDockerMode.Preexisting || state.active) {
        return successfulOutput('existing-container\n');
      }
      return successfulOutput('');
    }
    if (joined.includes(' build ')) {
      const iidIndex = command.indexOf('--iidfile');
      const buildIdentityIndex = command.indexOf('--build-arg');
      const iidFile = command[iidIndex + 1] ?? '';
      const buildArgument = command[buildIdentityIndex + 1] ?? '';
      state.buildIdentity = buildArgument.slice(
        'SOURCE_ANALYSIS_BUILD_ID='.length,
      );
      if (state.snapshotMutation !== false) {
        const contextRoot = command.at(-1) ?? '';
        const contextPath = path.join(
          contextRoot,
          state.snapshotMutation.relativePath,
        );
        state.snapshotMutation.contextMatchedSnapshot =
          (await readFile(contextPath, 'utf8')) ===
          state.snapshotMutation.originalContents;
        await writeFile(
          path.join(state.repoRoot, state.snapshotMutation.relativePath),
          state.snapshotMutation.replacementContents,
        );
      }
      await writeFile(iidFile, IMAGE_ID);
      return successfulOutput('built\n');
    }
    if (joined.includes(' image inspect ')) {
      if (state.imageInspectFailures > 0) {
        state.imageInspectFailures -= 1;
        return failedOutput('Error: No such image');
      }
      const environment = JSON.stringify([
        'PATH=/usr/bin',
        'NOOK_SEALED_SOURCE_ANALYZER=1',
      ]);
      return successfulOutput(
        `${IMAGE_ID}\n65532:65532\n["bun","run","src/executable-skills/source-analysis-worker.ts"]\n/opt/nook-source-analysis\n${state.buildIdentity}\n${environment}\n`,
      );
    }
    if (joined.includes(' create ')) {
      state.active = true;
      return successfulOutput('container-id\n');
    }
    if (
      joined.includes(' container inspect ') &&
      joined.includes('ReadonlyRootfs')
    ) {
      const receipt = staticContainerReceipt();
      return successfulOutput(
        state.mode === FakeDockerMode.ConfigurationDrift
          ? receipt.replace('|none|', '|bridge|')
          : receipt,
      );
    }
    if (joined.includes(' start --attach ')) {
      if (state.mode === FakeDockerMode.StartFailure) {
        return failedOutput('worker failed');
      }
      const analysis: ExecutableSkillSourceAnalysis = { moduleSpecifiers: [] };
      return successfulOutput(encodeSourceAnalysisResult(analysis));
    }
    if (joined.includes('OOMKilled')) {
      return successfulOutput(
        state.mode === FakeDockerMode.Oom ? 'true|137\n' : 'false|0\n',
      );
    }
    if (joined.includes(' rm --force ')) {
      state.removals += 1;
      if (state.mode !== FakeDockerMode.TeardownFailure) state.active = false;
      return state.active
        ? failedOutput('remove failed')
        : successfulOutput('container-id\n');
    }
    if (joined.includes(' container inspect ') && joined.includes('{{.Id}}')) {
      return state.active
        ? successfulOutput('container-id\n')
        : failedOutput('Error: No such container: fixture');
    }
    return failedOutput(`unexpected command: ${joined}`);
  };
}

function fakeDependencies(
  state: FakeDockerState,
): SourceAnalysisDockerDependencies {
  return {
    dockerExecutable: DOCKER_EXECUTABLE,
    executeProcess: fakeDockerExecutor(state),
    readImageInputs: readSourceAnalysisSnapshot,
    repoRoot: state.repoRoot,
    uniqueId: () => 'fixture-id',
  };
}

function fakeState(mode: FakeDockerMode): FakeDockerState {
  return {
    active: false,
    buildIdentity: '',
    commands: [],
    deadlines: [],
    imageInspectFailures: 0,
    mode,
    removals: 0,
    repoRoot: REPO_ROOT,
    snapshotMutation: false,
  };
}

function executionRequest(): RunSealedSourceAnalysisContainerRequest {
  return {
    deadlineExpiresAt: Date.now() + 30_000,
    dockerEnvironment: DOCKER_ENVIRONMENT,
    serializedRequest: '{"relativePath":"./x.ts","source":"export {};"}',
    signal: false,
  };
}

describe('sealed source analysis Docker boundary', () => {
  test('rejects candidates that did not pass the production seal', () => {
    const output: SealedSourceAnalysisContainerOutput = {
      analysisId: 'forged',
    };
    const request = { output };
    expect(() => resolveSealedSourceAnalysisContainerOutput(request)).toThrow(
      'authority is invalid',
    );
  });

  test('builds the exact static containment command without mounts or privilege', () => {
    const request = {
      containerName: 'fixture',
      endpoint: DOCKER_ENVIRONMENT.endpoint,
      executable: DOCKER_EXECUTABLE,
      imageId: IMAGE_ID,
    };
    const command = createContainerCommand(request);
    expect(command).toEqual([
      DOCKER_EXECUTABLE,
      '--host',
      DOCKER_ENVIRONMENT.endpoint,
      'create',
      '--interactive',
      '--name',
      'fixture',
      '--label',
      SOURCE_ANALYSIS_CONTAINER_LABEL,
      '--network',
      'none',
      '--read-only',
      '--user',
      '65532:65532',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--security-opt',
      'seccomp=builtin',
      '--log-driver',
      'none',
      '--restart',
      'no',
      '--pids-limit',
      '64',
      '--memory',
      '512m',
      '--memory-swap',
      '512m',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=16m',
      '--runtime',
      'runc',
      '--ipc',
      'private',
      '--cgroupns',
      'private',
      IMAGE_ID,
    ]);
    expect(command).not.toContain('--privileged');
    expect(command).not.toContain('--volume');
    expect(
      command.filter((argument) => argument === DOCKER_ENVIRONMENT.endpoint),
    ).toHaveLength(1);
  });

  test('binds the image identity to every byte in the minimal build context', async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), 'source-analysis-context-'),
    );
    try {
      const directoryOptions = { recursive: true } as const;
      for (const relativePath of SOURCE_ANALYSIS_IMAGE_INPUTS) {
        const destination = path.join(temporaryDirectory, relativePath);
        await mkdir(path.dirname(destination), directoryOptions);
        await copyFile(path.join(REPO_ROOT, relativePath), destination);
      }
      const baseline = await sourceAnalysisBuildIdentity(temporaryDirectory);
      const dockerfile = await readFile(
        path.join(temporaryDirectory, SOURCE_ANALYSIS_IMAGE_INPUTS[0]),
        'utf8',
      );
      expect(dockerfile.split('\n')[0]).toMatch(
        /dockerfile:1@sha256:[a-f0-9]{64}$/,
      );
      for (const relativePath of SOURCE_ANALYSIS_IMAGE_INPUTS) {
        const target = path.join(temporaryDirectory, relativePath);
        const original = await readFile(target);
        await writeFile(target, new Uint8Array([...original, 1]));
        expect(await sourceAnalysisBuildIdentity(temporaryDirectory)).not.toBe(
          baseline,
        );
        await writeFile(target, original);
      }
    } finally {
      const removalOptions: RmOptions = { force: true, recursive: true };
      await rm(temporaryDirectory, removalOptions);
    }
  });

  test('materializes the build context from the exact hashed byte snapshot', async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), 'source-analysis-snapshot-'),
    );
    try {
      const directoryOptions = { recursive: true } as const;
      for (const relativePath of SOURCE_ANALYSIS_IMAGE_INPUTS) {
        const destination = path.join(temporaryDirectory, relativePath);
        await mkdir(path.dirname(destination), directoryOptions);
        await copyFile(path.join(REPO_ROOT, relativePath), destination);
      }
      const relativePath = SOURCE_ANALYSIS_IMAGE_INPUTS[0];
      const target = path.join(temporaryDirectory, relativePath);
      const originalContents = await readFile(target, 'utf8');
      const mutation: FakeSourceMutation = {
        contextMatchedSnapshot: false,
        originalContents,
        relativePath,
        replacementContents: `${originalContents}\n# concurrent mutation\n`,
      };
      const baseline = await sourceAnalysisBuildIdentity(temporaryDirectory);
      const state = fakeState(FakeDockerMode.Normal);
      state.repoRoot = temporaryDirectory;
      state.snapshotMutation = mutation;
      resetSourceAnalysisImageCacheForTest();
      const execution = {
        dependencies: fakeDependencies(state),
        request: executionRequest(),
      };
      await runSealedSourceAnalysisWithDependencies(execution);
      expect(mutation.contextMatchedSnapshot).toBe(true);
      expect(state.buildIdentity).toBe(baseline);
      expect(await sourceAnalysisBuildIdentity(temporaryDirectory)).not.toBe(
        baseline,
      );
    } finally {
      const removalOptions: RmOptions = { force: true, recursive: true };
      await rm(temporaryDirectory, removalOptions);
    }
  });

  test('verifies authority, image, config, state, and confirmed absence', async () => {
    resetSourceAnalysisImageCacheForTest();
    const state = fakeState(FakeDockerMode.Normal);
    const execution = {
      dependencies: fakeDependencies(state),
      request: executionRequest(),
    };
    const output = await runSealedSourceAnalysisWithDependencies(execution);
    expect(output.imageId).toBe(IMAGE_ID);
    expect(state.active).toBe(false);
    expect(state.removals).toBe(1);
    for (const command of state.commands) {
      expect(command.slice(0, 3)).toEqual([
        DOCKER_EXECUTABLE,
        '--host',
        DOCKER_ENVIRONMENT.endpoint,
      ]);
    }
    const allCommands = state.commands.flat().join(' ');
    expect(allCommands).toContain(SOURCE_ANALYSIS_IMAGE_LABEL);
  });

  test('rebuilds after a cached image disappears', async () => {
    resetSourceAnalysisImageCacheForTest();
    const state = fakeState(FakeDockerMode.Normal);
    const execution = {
      dependencies: fakeDependencies(state),
      request: executionRequest(),
    };
    await runSealedSourceAnalysisWithDependencies(execution);
    state.imageInspectFailures = 1;
    await runSealedSourceAnalysisWithDependencies(execution);
    expect(
      state.commands.filter((command) => command.includes('build')),
    ).toHaveLength(2);
  });

  test('fails closed and cleans up every post-create failure', async () => {
    for (const mode of [
      FakeDockerMode.ConfigurationDrift,
      FakeDockerMode.Oom,
      FakeDockerMode.StartFailure,
    ]) {
      resetSourceAnalysisImageCacheForTest();
      const state = fakeState(mode);
      const execution = {
        dependencies: fakeDependencies(state),
        request: executionRequest(),
      };
      await expect(
        runSealedSourceAnalysisWithDependencies(execution),
      ).rejects.toThrow();
      expect(state.active).toBe(false);
      expect(state.removals).toBe(1);
    }
  });

  test('attempts removal when the teardown authority probe fails', async () => {
    resetSourceAnalysisImageCacheForTest();
    const state = fakeState(FakeDockerMode.TeardownAuthorityFailure);
    const execution = {
      dependencies: fakeDependencies(state),
      request: executionRequest(),
    };
    await runSealedSourceAnalysisWithDependencies(execution);
    expect(state.removals).toBe(1);
    expect(state.active).toBe(false);
    let probeIndex = -1;
    for (const [index, command] of state.commands.entries()) {
      if (command.includes('info')) probeIndex = index;
    }
    const removalIndex = state.commands.findIndex((command) =>
      command.includes('rm'),
    );
    expect(probeIndex).toBeGreaterThanOrEqual(0);
    expect(removalIndex).toBeGreaterThan(probeIndex);
    expect(state.deadlines[removalIndex] ?? 0).toBeGreaterThan(
      state.deadlines[probeIndex] ?? 0,
    );
  });

  test('rejects preexisting containers, remote endpoints, and unconfirmed teardown', async () => {
    resetSourceAnalysisImageCacheForTest();
    const preexistingState = fakeState(FakeDockerMode.Preexisting);
    const preexistingExecution = {
      dependencies: fakeDependencies(preexistingState),
      request: executionRequest(),
    };
    await expect(
      runSealedSourceAnalysisWithDependencies(preexistingExecution),
    ).rejects.toThrow('preexisting container');

    const remoteRequest: RunSealedSourceAnalysisContainerRequest = {
      ...executionRequest(),
      dockerEnvironment: {
        ...DOCKER_ENVIRONMENT,
        endpoint: 'tcp://example.com:2376',
      },
    };
    const remoteExecution = {
      dependencies: fakeDependencies(fakeState(FakeDockerMode.Normal)),
      request: remoteRequest,
    };
    await expect(
      runSealedSourceAnalysisWithDependencies(remoteExecution),
    ).rejects.toThrow('environment is invalid');

    resetSourceAnalysisImageCacheForTest();
    const teardownState = fakeState(FakeDockerMode.TeardownFailure);
    const teardownExecution = {
      dependencies: fakeDependencies(teardownState),
      request: executionRequest(),
    };
    await expect(
      runSealedSourceAnalysisWithDependencies(teardownExecution),
    ).rejects.toThrow('teardown was not confirmed');
    expect(teardownState.removals).toBe(3);
  });
});
