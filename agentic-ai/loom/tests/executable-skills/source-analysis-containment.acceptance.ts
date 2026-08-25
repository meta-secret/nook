import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  decodeSourceAnalysisResult,
  encodeSourceAnalysisRequest,
} from '../../src/executable-skills/source-analysis-codec.ts';
import {
  createContainerCommand,
  type RunSealedSourceAnalysisContainerRequest,
  runSealedSourceAnalysisContainer,
  SOURCE_ANALYSIS_CONTAINER_LABEL,
  type SealedSourceAnalysisDockerEnvironment,
} from '../../src/executable-skills/source-analysis-docker.ts';
import {
  type BoundedProcessOutput,
  type RunBoundedProcessRequest,
  runBoundedProcess,
} from '../../src/executable-skills/source-analysis-process.ts';
import type {
  AnalyzeExecutableSkillSourceRequest,
  ExecutableSkillSourceAnalysis,
} from '../../src/executable-skills/source-policy.ts';
import { findRepoRoot } from '../../src/lib/repo.ts';

type AcceptanceContainerRequest = {
  readonly deadlineExpiresAt: number;
  readonly dockerEnvironment: SealedSourceAnalysisDockerEnvironment;
  readonly imageId: string;
  readonly maximumStdoutBytes: number;
  readonly script: string;
  readonly signal: AbortSignal | false;
};

type AcceptanceContainerOutput = {
  readonly oomKilled: boolean;
  readonly process: BoundedProcessOutput;
};

type AcceptanceDockerCommandRequest = {
  readonly arguments: readonly string[];
  readonly environment: SealedSourceAnalysisDockerEnvironment;
};

type SourceAnalysisContainmentReceipt = {
  readonly capEff: string | false;
  readonly cgroup: string | false;
  readonly cgroupNamespace: string | false;
  readonly ipcNamespace: string | false;
  readonly netNamespace: string | false;
  readonly noNewPrivs: string | false;
  readonly pidNamespace: string | false;
  readonly rootMount: string | false;
  readonly seccomp: string | false;
  readonly tmpMount: string | false;
  readonly userNamespace: string | false;
  readonly utsNamespace: string | false;
};

const REPO_ROOT = findRepoRoot();

function requireDockerEnvironment(): SealedSourceAnalysisDockerEnvironment {
  const contextName = process.env.NOOK_SOURCE_ANALYSIS_DOCKER_CONTEXT;
  const daemonId = process.env.NOOK_SOURCE_ANALYSIS_DOCKER_DAEMON_ID;
  const endpoint = process.env.NOOK_SOURCE_ANALYSIS_DOCKER_ENDPOINT;
  if (
    typeof contextName !== 'string' ||
    typeof daemonId !== 'string' ||
    typeof endpoint !== 'string' ||
    process.env.NOOK_ARC_RUNNER === '1' ||
    process.env.NOOK_BUILDKIT_REMOTE === '1'
  ) {
    throw new Error(
      'Source-analysis containment requires an explicit non-ARC Docker contract.',
    );
  }
  return { contextName, daemonId, endpoint };
}

async function runDocker(
  request: RunBoundedProcessRequest,
): Promise<BoundedProcessOutput> {
  return await runBoundedProcess(request);
}

function dockerCommand(
  request: AcceptanceDockerCommandRequest,
): readonly string[] {
  return [
    'docker',
    '--context',
    request.environment.contextName,
    ...request.arguments,
  ];
}

async function assertNoOrphans(
  environment: SealedSourceAnalysisDockerEnvironment,
): Promise<void> {
  const commandRequest: AcceptanceDockerCommandRequest = {
    arguments: [
      'container',
      'ls',
      '--all',
      '--quiet',
      '--filter',
      `label=${SOURCE_ANALYSIS_CONTAINER_LABEL}`,
    ],
    environment,
  };
  const request: RunBoundedProcessRequest = {
    command: dockerCommand(commandRequest),
    cwd: REPO_ROOT,
    deadlineExpiresAt: Date.now() + 10_000,
    maximumStderrBytes: 64 * 1024,
    maximumStdinBytes: 0,
    maximumStdoutBytes: 64 * 1024,
    signal: false,
    stdin: false,
  };
  const output = await runDocker(request);
  expect(output.exitCode).toBe(0);
  expect(output.stdout.trim()).toBe('');
}

async function runAcceptanceContainer(
  request: AcceptanceContainerRequest,
): Promise<AcceptanceContainerOutput> {
  const containerName = `nook-source-analysis-acceptance-${randomUUID()}`;
  const createRequest = {
    containerName,
    contextName: request.dockerEnvironment.contextName,
    imageId: request.imageId,
  };
  const staticCommand = [...createContainerCommand(createRequest)];
  const imageId = staticCommand.pop();
  if (typeof imageId !== 'string') {
    throw new Error('Containment acceptance image ID is missing.');
  }
  const createCommand = [
    ...staticCommand,
    '--entrypoint',
    'bun',
    imageId,
    'run',
    request.script,
  ];
  const createProcessRequest: RunBoundedProcessRequest = {
    command: createCommand,
    cwd: REPO_ROOT,
    deadlineExpiresAt: Date.now() + 10_000,
    maximumStderrBytes: 64 * 1024,
    maximumStdinBytes: 0,
    maximumStdoutBytes: 64 * 1024,
    signal: false,
    stdin: false,
  };
  try {
    const created = await runDocker(createProcessRequest);
    expect(created.exitCode).toBe(0);
    const startCommandRequest: AcceptanceDockerCommandRequest = {
      arguments: ['start', '--attach', containerName],
      environment: request.dockerEnvironment,
    };
    const startRequest: RunBoundedProcessRequest = {
      command: dockerCommand(startCommandRequest),
      cwd: REPO_ROOT,
      deadlineExpiresAt: request.deadlineExpiresAt,
      maximumStderrBytes: 64 * 1024,
      maximumStdinBytes: 0,
      maximumStdoutBytes: request.maximumStdoutBytes,
      signal: request.signal,
      stdin: false,
    };
    const processOutput = await runDocker(startRequest);
    const stateCommandRequest: AcceptanceDockerCommandRequest = {
      arguments: [
        'container',
        'inspect',
        '--format',
        '{{.State.OOMKilled}}',
        containerName,
      ],
      environment: request.dockerEnvironment,
    };
    const stateRequest: RunBoundedProcessRequest = {
      ...startRequest,
      command: dockerCommand(stateCommandRequest),
      deadlineExpiresAt: Date.now() + 10_000,
      maximumStdoutBytes: 16,
      signal: false,
    };
    const state = await runDocker(stateRequest);
    expect(state.exitCode).toBe(0);
    const oomKilled = state.stdout.trim();
    expect(oomKilled === 'true' || oomKilled === 'false').toBe(true);
    return { oomKilled: oomKilled === 'true', process: processOutput };
  } finally {
    const removeCommandRequest: AcceptanceDockerCommandRequest = {
      arguments: ['rm', '--force', containerName],
      environment: request.dockerEnvironment,
    };
    const removeRequest: RunBoundedProcessRequest = {
      command: dockerCommand(removeCommandRequest),
      cwd: REPO_ROOT,
      deadlineExpiresAt: Date.now() + 10_000,
      maximumStderrBytes: 64 * 1024,
      maximumStdinBytes: 0,
      maximumStdoutBytes: 64 * 1024,
      signal: false,
      stdin: false,
    };
    await runDocker(removeRequest);
    await assertNoOrphans(request.dockerEnvironment);
  }
}

function decodeContainmentReceipt(
  serialized: string,
): SourceAnalysisContainmentReceipt {
  let receipt: SourceAnalysisContainmentReceipt;
  try {
    receipt = JSON.parse(serialized) as SourceAnalysisContainmentReceipt;
  } catch {
    throw new Error('Containment receipt is malformed.');
  }
  if (!receipt || typeof receipt !== 'object') {
    throw new Error('Containment receipt is malformed.');
  }
  return receipt;
}

describe('sealed source analysis live containment', () => {
  test(
    'proves normal, rejection, kernel receipt, bounds, abort, deadline, OOM, and teardown',
    async () => {
      const dockerEnvironment = requireDockerEnvironment();
      await assertNoOrphans(dockerEnvironment);
      const sourceRequest: AnalyzeExecutableSkillSourceRequest = {
        relativePath: './acceptance.ts',
        source: 'export {};',
      };
      const containerRequest: RunSealedSourceAnalysisContainerRequest = {
        deadlineExpiresAt: Date.now() + 4 * 60 * 1_000,
        dockerEnvironment,
        serializedRequest: encodeSourceAnalysisRequest(sourceRequest),
        signal: false,
      };
      const normal = await runSealedSourceAnalysisContainer(containerRequest);
      const expectedAnalysis: ExecutableSkillSourceAnalysis = {
        moduleSpecifiers: [],
      };
      expect(decodeSourceAnalysisResult(normal.serializedResult)).toEqual(
        expectedAnalysis,
      );

      const rejectedSourceRequest: AnalyzeExecutableSkillSourceRequest = {
        relativePath: './rejected.ts',
        source: 'postMessage("unsafe");',
      };
      const rejectedContainerRequest: RunSealedSourceAnalysisContainerRequest =
        {
          ...containerRequest,
          deadlineExpiresAt: Date.now() + 4 * 60 * 1_000,
          serializedRequest: encodeSourceAnalysisRequest(rejectedSourceRequest),
        };
      const rejected = await runSealedSourceAnalysisContainer(
        rejectedContainerRequest,
      );
      expect(() =>
        decodeSourceAnalysisResult(rejected.serializedResult),
      ).toThrow('ambient global capabilities');

      const probeRequest: AcceptanceContainerRequest = {
        deadlineExpiresAt: Date.now() + 30_000,
        dockerEnvironment,
        imageId: normal.imageId,
        maximumStdoutBytes: 64 * 1024,
        script: 'acceptance/source-analysis-containment-probe.ts',
        signal: false,
      };
      const probe = await runAcceptanceContainer(probeRequest);
      const receipt = decodeContainmentReceipt(probe.process.stdout);
      expect(receipt.capEff).toBe('0000000000000000');
      expect(receipt.noNewPrivs).toBe('1');
      expect(receipt.seccomp).toBe('2');
      expect(receipt.rootMount).toContain(' ro,');
      expect(receipt.tmpMount).toContain(' rw,');
      expect(receipt.tmpMount).toContain('noexec');
      expect(receipt.tmpMount).toContain('nosuid');
      for (const namespace of [
        receipt.cgroupNamespace,
        receipt.ipcNamespace,
        receipt.netNamespace,
        receipt.pidNamespace,
        receipt.userNamespace,
        receipt.utsNamespace,
      ]) {
        expect(namespace).toMatch(/^[a-z]+:\[\d+\]$/);
      }
      expect(receipt.cgroup).not.toBe(false);

      const outputBoundRequest: AcceptanceContainerRequest = {
        ...probeRequest,
        deadlineExpiresAt: Date.now() + 30_000,
        maximumStdoutBytes: 8,
      };
      await expect(runAcceptanceContainer(outputBoundRequest)).rejects.toThrow(
        'stdout exceeds its byte limit',
      );

      const controller = new AbortController();
      const abortRequest: AcceptanceContainerRequest = {
        ...probeRequest,
        deadlineExpiresAt: Date.now() + 30_000,
        script: 'acceptance/source-analysis-hang.ts',
        signal: controller.signal,
      };
      setTimeout(() => controller.abort(), 100);
      await expect(runAcceptanceContainer(abortRequest)).rejects.toThrow(
        'aborted',
      );

      const deadlineRequest: AcceptanceContainerRequest = {
        ...abortRequest,
        deadlineExpiresAt: Date.now() + 2_000,
        signal: false,
      };
      await expect(runAcceptanceContainer(deadlineRequest)).rejects.toThrow(
        'deadline expired',
      );

      const oomRequest: AcceptanceContainerRequest = {
        ...deadlineRequest,
        deadlineExpiresAt: Date.now() + 60_000,
        script: 'acceptance/source-analysis-allocation-bomb.ts',
      };
      const oom = await runAcceptanceContainer(oomRequest);
      expect(oom.process.exitCode).not.toBe(0);
      expect(oom.oomKilled).toBe(true);
      await assertNoOrphans(dockerEnvironment);
    },
    8 * 60 * 1_000,
  );
});
