import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findRepoRoot } from '../lib/repo.ts';
import {
  type BoundedProcessOutput,
  type RunBoundedProcessRequest,
  runBoundedProcess,
} from './source-analysis-process.ts';
import {
  MAXIMUM_SOURCE_ANALYSIS_STDERR_BYTES,
  MAXIMUM_SOURCE_ANALYSIS_STDIN_BYTES,
  MAXIMUM_SOURCE_ANALYSIS_STDOUT_BYTES,
} from './source-analysis-codec.ts';

export type SealedSourceAnalysisDockerEnvironment = {
  readonly contextName: string;
  readonly daemonId: string;
  readonly endpoint: string;
};

export type RunSealedSourceAnalysisContainerRequest = {
  readonly deadlineExpiresAt: number;
  readonly dockerEnvironment: SealedSourceAnalysisDockerEnvironment;
  readonly serializedRequest: string;
  readonly signal: AbortSignal | false;
};

export type SealedSourceAnalysisContainerOutput = {
  readonly imageId: string;
  readonly serializedResult: string;
};

export type SourceAnalysisDockerProcessExecutor = (
  request: RunBoundedProcessRequest,
) => Promise<BoundedProcessOutput>;

export type SourceAnalysisDockerDependencies = {
  readonly executeProcess: SourceAnalysisDockerProcessExecutor;
  readonly repoRoot: string;
  readonly uniqueId: () => string;
};

type RunSealedSourceAnalysisWithDependenciesRequest = {
  readonly dependencies: SourceAnalysisDockerDependencies;
  readonly request: RunSealedSourceAnalysisContainerRequest;
};

type DockerAuthorityRequest = {
  readonly deadlineExpiresAt: number;
  readonly dependencies: SourceAnalysisDockerDependencies;
  readonly environment: SealedSourceAnalysisDockerEnvironment;
  readonly signal: AbortSignal | false;
};

type SourceAnalysisImageReceipt = {
  readonly authorityKey: string;
  readonly buildIdentity: string;
  readonly imageId: string;
  readonly imageTag: string;
};

type SourceAnalysisImageInputSnapshot = {
  readonly contents: Uint8Array;
  readonly relativePath: string;
};

type SourceAnalysisImageSnapshot = {
  readonly buildIdentity: string;
  readonly inputs: readonly SourceAnalysisImageInputSnapshot[];
};

type InspectSourceAnalysisContainerRequest = DockerAuthorityRequest & {
  readonly containerName: string;
  readonly imageId: string;
};

type RemoveSourceAnalysisContainerRequest = DockerAuthorityRequest & {
  readonly containerName: string;
};

type DockerCommandRequest = {
  readonly arguments: readonly string[];
  readonly endpoint: string;
};

type ExecuteDockerCommandRequest = DockerAuthorityRequest & {
  readonly arguments: readonly string[];
  readonly maximumStderrBytes: number;
  readonly maximumStdoutBytes: number;
  readonly stdin: string | false;
};

type DockerCommandSuccessRequest = {
  readonly label: string;
  readonly output: BoundedProcessOutput;
};

export type CreateContainerCommandRequest = {
  readonly containerName: string;
  readonly endpoint: string;
  readonly imageId: string;
};

type SourceAnalysisContainerState = {
  readonly exitCode: number;
  readonly oomKilled: boolean;
};

const DOCKER = 'docker';
export const SOURCE_ANALYSIS_CONTAINER_LABEL =
  'dev.nokey.loom.source-analysis=sealed';
export const SOURCE_ANALYSIS_IMAGE_LABEL =
  'dev.nokey.loom.source-analysis.build-id';
const SOURCE_ANALYSIS_IMAGE_DOCKERFILE =
  'agentic-ai/loom/source-analysis-image/Dockerfile';
export const SOURCE_ANALYSIS_IMAGE_INPUTS = [
  SOURCE_ANALYSIS_IMAGE_DOCKERFILE,
  'agentic-ai/loom/package.json',
  'agentic-ai/loom/bun.lock',
  'agentic-ai/loom/src/executable-skills/source-policy.ts',
  'agentic-ai/loom/src/executable-skills/source-analysis-codec.ts',
  'agentic-ai/loom/src/executable-skills/source-analysis-worker.ts',
  'agentic-ai/loom/tests/fixtures/source-analysis-allocation-bomb.ts',
  'agentic-ai/loom/tests/fixtures/source-analysis-containment-probe.ts',
  'agentic-ai/loom/tests/fixtures/source-analysis-hang.ts',
] as const;
const EXPECTED_IMAGE_USER = '65532:65532';
const EXPECTED_ENTRYPOINT =
  '["bun","run","src/executable-skills/source-analysis-worker.ts"]';
const EXPECTED_WORKING_DIRECTORY = '/opt/nook-source-analysis';
const EXPECTED_RUNTIME = 'runc';
const CONTAINER_MEMORY_BYTES = 512 * 1024 * 1024;
const CONTAINER_PIDS_LIMIT = 64;
const DOCKER_CONTROL_STDOUT_BYTES = 64 * 1024;
const DOCKER_CONTROL_STDERR_BYTES = 64 * 1024;
const DOCKER_BUILD_OUTPUT_BYTES = 512 * 1024;
const TEARDOWN_ATTEMPTS = 3;
const TEARDOWN_ATTEMPT_MILLISECONDS = 4_500;
const TEARDOWN_AUTHORITY_MILLISECONDS = 1_500;
const TEARDOWN_REMOVAL_MILLISECONDS = 3_000;
const TEARDOWN_RESERVE_MILLISECONDS = 15_000;
const MINIMUM_TOTAL_MILLISECONDS = 20_000;
const MAXIMUM_TOTAL_MILLISECONDS = 5 * 60 * 1_000;
const SEALED_ANALYZER_ENVIRONMENT = 'NOOK_SEALED_SOURCE_ANALYZER=1';
const NO_SUCH_CONTAINER_MARKERS = [
  'No such container:',
  'No such object:',
] as const;

let sourceAnalysisImage: Promise<SourceAnalysisImageReceipt> | false = false;

export async function runSealedSourceAnalysisContainer(
  request: RunSealedSourceAnalysisContainerRequest,
): Promise<SealedSourceAnalysisContainerOutput> {
  assertSourceAnalysisDockerHostAllowed();
  const dependencies: SourceAnalysisDockerDependencies = {
    executeProcess: runBoundedProcess,
    repoRoot: findRepoRoot(),
    uniqueId: randomUUID,
  };
  const executionRequest: RunSealedSourceAnalysisWithDependenciesRequest = {
    dependencies,
    request,
  };
  return await runSealedSourceAnalysisWithDependencies(executionRequest);
}

export async function runSealedSourceAnalysisWithDependencies(
  execution: RunSealedSourceAnalysisWithDependenciesRequest,
): Promise<SealedSourceAnalysisContainerOutput> {
  const request = execution.request;
  assertTotalDeadline(request.deadlineExpiresAt);
  const operationDeadlineExpiresAt =
    request.deadlineExpiresAt - TEARDOWN_RESERVE_MILLISECONDS;
  const authorityRequest: DockerAuthorityRequest = {
    deadlineExpiresAt: operationDeadlineExpiresAt,
    dependencies: execution.dependencies,
    environment: request.dockerEnvironment,
    signal: request.signal,
  };
  await assertDockerAuthority(authorityRequest);
  await assertNoLabeledContainers(authorityRequest);
  const image = await requireSourceAnalysisImage(authorityRequest);
  await assertDockerAuthority(authorityRequest);
  const containerName = `nook-source-analysis-${execution.dependencies.uniqueId()}`;
  const createCommandRequest: CreateContainerCommandRequest = {
    containerName,
    endpoint: request.dockerEnvironment.endpoint,
    imageId: image.imageId,
  };
  const createCommand = createContainerCommand(createCommandRequest);
  let createAttempted = false;
  try {
    createAttempted = true;
    const createRequest: ExecuteDockerCommandRequest = {
      ...authorityRequest,
      arguments: createCommand.slice(3),
      maximumStderrBytes: DOCKER_CONTROL_STDERR_BYTES,
      maximumStdoutBytes: DOCKER_CONTROL_STDOUT_BYTES,
      stdin: false,
    };
    const created = await executeDockerCommand(createRequest);
    const createSuccessRequest: DockerCommandSuccessRequest = {
      label: 'create',
      output: created,
    };
    assertDockerCommandSucceeded(createSuccessRequest);
    const inspectRequest: InspectSourceAnalysisContainerRequest = {
      ...authorityRequest,
      containerName,
      imageId: image.imageId,
    };
    await inspectSourceAnalysisContainer(inspectRequest);
    const startRequest: ExecuteDockerCommandRequest = {
      ...authorityRequest,
      arguments: ['start', '--attach', '--interactive', containerName],
      maximumStderrBytes: MAXIMUM_SOURCE_ANALYSIS_STDERR_BYTES,
      maximumStdoutBytes: MAXIMUM_SOURCE_ANALYSIS_STDOUT_BYTES,
      stdin: request.serializedRequest,
    };
    const started = await executeDockerCommand(startRequest);
    const state = await inspectContainerState(inspectRequest);
    if (state.oomKilled) {
      throw new Error('Sealed source analysis exceeded its memory limit.');
    }
    if (started.exitCode !== 0 || state.exitCode !== 0) {
      throw new Error('Sealed source analysis container failed.');
    }
    return {
      imageId: image.imageId,
      serializedResult: started.stdout,
    };
  } finally {
    if (createAttempted) {
      const removalRequest: RemoveSourceAnalysisContainerRequest = {
        containerName,
        deadlineExpiresAt: request.deadlineExpiresAt,
        dependencies: execution.dependencies,
        environment: request.dockerEnvironment,
        signal: false,
      };
      await removeSourceAnalysisContainer(removalRequest);
      await assertNoLabeledContainers(removalRequest);
    }
  }
}

function assertSourceAnalysisDockerHostAllowed(): void {
  if (
    process.env.NOOK_ARC_RUNNER === '1' ||
    process.env.NOOK_BUILDKIT_REMOTE === '1'
  ) {
    throw new Error(
      'Sealed source analysis requires its explicit non-ARC Docker environment.',
    );
  }
}

function assertTotalDeadline(deadlineExpiresAt: number): void {
  const remaining = deadlineExpiresAt - Date.now();
  if (
    !Number.isSafeInteger(deadlineExpiresAt) ||
    remaining < MINIMUM_TOTAL_MILLISECONDS ||
    remaining > MAXIMUM_TOTAL_MILLISECONDS
  ) {
    throw new Error('Sealed source analysis total deadline is invalid.');
  }
}

function assertDockerOperationActive(request: DockerAuthorityRequest): void {
  if (request.signal !== false && request.signal.aborted) {
    throw new Error('Sealed source analysis Docker operation was aborted.');
  }
  if (Date.now() >= request.deadlineExpiresAt) {
    throw new Error(
      'Sealed source analysis Docker operation deadline expired.',
    );
  }
}

async function assertDockerAuthority(
  request: DockerAuthorityRequest,
): Promise<void> {
  assertDockerEnvironment(request.environment);
  const contextRequest: ExecuteDockerCommandRequest = {
    ...request,
    arguments: [
      'context',
      'inspect',
      request.environment.contextName,
      '--format',
      '{{.Name}}|{{.Endpoints.docker.Host}}|{{.Endpoints.docker.SkipTLSVerify}}',
    ],
    maximumStderrBytes: DOCKER_CONTROL_STDERR_BYTES,
    maximumStdoutBytes: DOCKER_CONTROL_STDOUT_BYTES,
    stdin: false,
  };
  const context = await executeDockerCommand(contextRequest);
  const contextSuccessRequest: DockerCommandSuccessRequest = {
    label: 'context inspect',
    output: context,
  };
  assertDockerCommandSucceeded(contextSuccessRequest);
  const expectedContext = `${request.environment.contextName}|${request.environment.endpoint}|false`;
  if (context.stdout.trim() !== expectedContext) {
    throw new Error('Sealed source analysis Docker context drifted.');
  }
  const infoRequest: ExecuteDockerCommandRequest = {
    ...request,
    arguments: [
      'info',
      '--format',
      '{{.ID}}|{{.OSType}}|{{.DefaultRuntime}}|{{json .SecurityOptions}}|{{.CgroupVersion}}',
    ],
    maximumStderrBytes: DOCKER_CONTROL_STDERR_BYTES,
    maximumStdoutBytes: DOCKER_CONTROL_STDOUT_BYTES,
    stdin: false,
  };
  const info = await executeDockerCommand(infoRequest);
  const infoSuccessRequest: DockerCommandSuccessRequest = {
    label: 'daemon info',
    output: info,
  };
  assertDockerCommandSucceeded(infoSuccessRequest);
  const fields = info.stdout.trim().split('|');
  const securityOptions = fields[3] ?? '';
  if (
    fields.length !== 5 ||
    fields[0] !== request.environment.daemonId ||
    fields[1] !== 'linux' ||
    fields[2] !== EXPECTED_RUNTIME ||
    !securityOptions.includes('name=seccomp,profile=builtin') ||
    !securityOptions.includes('name=cgroupns') ||
    fields[4] !== '2'
  ) {
    throw new Error('Sealed source analysis Docker daemon is not approved.');
  }
}

function assertDockerEnvironment(
  environment: SealedSourceAnalysisDockerEnvironment,
): void {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(environment.contextName) ||
    !/^[A-Za-z0-9-]{16,128}$/.test(environment.daemonId) ||
    !environment.endpoint.startsWith('unix:///')
  ) {
    throw new Error('Sealed source analysis Docker environment is invalid.');
  }
  const endpointPath = environment.endpoint.slice('unix://'.length);
  if (
    !path.isAbsolute(endpointPath) ||
    path.normalize(endpointPath) !== endpointPath ||
    endpointPath === '/'
  ) {
    throw new Error('Sealed source analysis Docker endpoint is not local.');
  }
}

async function requireSourceAnalysisImage(
  request: DockerAuthorityRequest,
): Promise<SourceAnalysisImageReceipt> {
  const snapshot = await readSourceAnalysisImageSnapshot(
    request.dependencies.repoRoot,
  );
  const authorityKey = dockerAuthorityKey(request.environment);
  if (sourceAnalysisImage !== false) {
    const cachedPromise = sourceAnalysisImage;
    const cached = await cachedPromise;
    if (
      cached.authorityKey === authorityKey &&
      cached.buildIdentity === snapshot.buildIdentity
    ) {
      const inspectRequest: InspectSourceAnalysisImageRequest = {
        ...request,
        receipt: cached,
      };
      try {
        await inspectSourceAnalysisImage(inspectRequest);
        return cached;
      } catch {
        if (sourceAnalysisImage === cachedPromise) {
          sourceAnalysisImage = false;
        }
        assertDockerOperationActive(request);
      }
    }
  }
  const buildRequest: BuildSourceAnalysisImageRequest = {
    ...request,
    authorityKey,
    snapshot,
  };
  const candidate = buildSourceAnalysisImage(buildRequest);
  sourceAnalysisImage = candidate.catch((error) => {
    sourceAnalysisImage = false;
    throw error;
  });
  return await sourceAnalysisImage;
}

type BuildSourceAnalysisImageRequest = DockerAuthorityRequest & {
  readonly authorityKey: string;
  readonly snapshot: SourceAnalysisImageSnapshot;
};

async function buildSourceAnalysisImage(
  request: BuildSourceAnalysisImageRequest,
): Promise<SourceAnalysisImageReceipt> {
  const buildIdentity = request.snapshot.buildIdentity;
  const imageTag = `nook-source-analysis:${buildIdentity.slice(0, 24)}`;
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), 'nook-source-analysis-build-'),
  );
  const iidFile = path.join(temporaryDirectory, 'image-id');
  try {
    const contextRequest: PrepareBuildContextRequest = {
      contextRoot: temporaryDirectory,
      snapshot: request.snapshot,
    };
    await prepareBuildContext(contextRequest);
    const executeRequest: ExecuteDockerCommandRequest = {
      ...request,
      arguments: [
        'build',
        '--pull=false',
        '--iidfile',
        iidFile,
        '--tag',
        imageTag,
        '--build-arg',
        `SOURCE_ANALYSIS_BUILD_ID=${buildIdentity}`,
        '--file',
        path.join(temporaryDirectory, SOURCE_ANALYSIS_IMAGE_DOCKERFILE),
        temporaryDirectory,
      ],
      maximumStderrBytes: DOCKER_BUILD_OUTPUT_BYTES,
      maximumStdoutBytes: DOCKER_BUILD_OUTPUT_BYTES,
      stdin: false,
    };
    const built = await executeDockerCommand(executeRequest);
    const successRequest: DockerCommandSuccessRequest = {
      label: 'image build',
      output: built,
    };
    assertDockerCommandSucceeded(successRequest);
    const imageId = (await readFile(iidFile, 'utf8')).trim();
    if (!/^sha256:[0-9a-f]{64}$/.test(imageId)) {
      throw new Error('Sealed source analysis image ID is invalid.');
    }
    const receipt: SourceAnalysisImageReceipt = {
      authorityKey: request.authorityKey,
      buildIdentity,
      imageId,
      imageTag,
    };
    const inspectRequest: InspectSourceAnalysisImageRequest = {
      ...request,
      receipt,
    };
    await inspectSourceAnalysisImage(inspectRequest);
    return receipt;
  } finally {
    const removalOptions: RmOptions = { force: true, recursive: true };
    await rm(temporaryDirectory, removalOptions);
  }
}

type PrepareBuildContextRequest = {
  readonly contextRoot: string;
  readonly snapshot: SourceAnalysisImageSnapshot;
};

async function prepareBuildContext(
  request: PrepareBuildContextRequest,
): Promise<void> {
  const directoryOptions = { recursive: true } as const;
  for (const input of request.snapshot.inputs) {
    const destination = path.join(request.contextRoot, input.relativePath);
    await mkdir(path.dirname(destination), directoryOptions);
    await writeFile(destination, input.contents);
  }
}

type InspectSourceAnalysisImageRequest = DockerAuthorityRequest & {
  readonly receipt: SourceAnalysisImageReceipt;
};

async function inspectSourceAnalysisImage(
  request: InspectSourceAnalysisImageRequest,
): Promise<void> {
  const format = [
    '{{.Id}}',
    '{{.Config.User}}',
    '{{json .Config.Entrypoint}}',
    '{{.Config.WorkingDir}}',
    `{{index .Config.Labels "${SOURCE_ANALYSIS_IMAGE_LABEL}"}}`,
    '{{json .Config.Env}}',
  ].join('\n');
  const executeRequest: ExecuteDockerCommandRequest = {
    ...request,
    arguments: [
      'image',
      'inspect',
      '--format',
      format,
      request.receipt.imageTag,
    ],
    maximumStderrBytes: DOCKER_CONTROL_STDERR_BYTES,
    maximumStdoutBytes: DOCKER_CONTROL_STDOUT_BYTES,
    stdin: false,
  };
  const inspected = await executeDockerCommand(executeRequest);
  const successRequest: DockerCommandSuccessRequest = {
    label: 'image inspect',
    output: inspected,
  };
  assertDockerCommandSucceeded(successRequest);
  const fields = inspected.stdout.trim().split('\n');
  if (
    fields.length !== 6 ||
    fields[0] !== request.receipt.imageId ||
    fields[1] !== EXPECTED_IMAGE_USER ||
    fields[2] !== EXPECTED_ENTRYPOINT ||
    fields[3] !== EXPECTED_WORKING_DIRECTORY ||
    fields[4] !== request.receipt.buildIdentity ||
    !fields[5]?.includes(`"${SEALED_ANALYZER_ENVIRONMENT}"`)
  ) {
    throw new Error('Sealed source analysis image configuration drifted.');
  }
}

export function createContainerCommand(
  request: CreateContainerCommandRequest,
): readonly string[] {
  const commandRequest: DockerCommandRequest = {
    arguments: [
      'create',
      '--interactive',
      '--name',
      request.containerName,
      '--label',
      SOURCE_ANALYSIS_CONTAINER_LABEL,
      '--network',
      'none',
      '--read-only',
      '--user',
      EXPECTED_IMAGE_USER,
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
      String(CONTAINER_PIDS_LIMIT),
      '--memory',
      '512m',
      '--memory-swap',
      '512m',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=16m',
      '--runtime',
      EXPECTED_RUNTIME,
      '--ipc',
      'private',
      '--cgroupns',
      'private',
      request.imageId,
    ],
    endpoint: request.endpoint,
  };
  return dockerCommand(commandRequest);
}

async function inspectSourceAnalysisContainer(
  request: InspectSourceAnalysisContainerRequest,
): Promise<void> {
  const format = [
    '{{.Image}}',
    '{{.Config.User}}',
    '{{.HostConfig.NetworkMode}}',
    '{{.HostConfig.ReadonlyRootfs}}',
    '{{.HostConfig.Privileged}}',
    '{{.HostConfig.AutoRemove}}',
    '{{.HostConfig.OomKillDisable}}',
    '{{.HostConfig.Memory}}',
    '{{.HostConfig.MemorySwap}}',
    '{{.HostConfig.PidsLimit}}',
    '{{json .HostConfig.CapDrop}}',
    '{{json .HostConfig.SecurityOpt}}',
    '{{json .HostConfig.Tmpfs}}',
    '{{len .HostConfig.Binds}}',
    '{{len .Mounts}}',
    '{{len .HostConfig.Devices}}',
    '{{.HostConfig.Runtime}}',
    '{{.HostConfig.IpcMode}}',
    '{{.HostConfig.PidMode}}',
    '{{.HostConfig.UTSMode}}',
    '{{.HostConfig.UsernsMode}}',
    '{{.HostConfig.CgroupnsMode}}',
    '{{.HostConfig.CgroupParent}}',
    '{{.HostConfig.LogConfig.Type}}',
    '{{.HostConfig.RestartPolicy.Name}}',
  ].join('|');
  const executeRequest: ExecuteDockerCommandRequest = {
    ...request,
    arguments: [
      'container',
      'inspect',
      '--format',
      format,
      request.containerName,
    ],
    maximumStderrBytes: DOCKER_CONTROL_STDERR_BYTES,
    maximumStdoutBytes: DOCKER_CONTROL_STDOUT_BYTES,
    stdin: false,
  };
  const inspected = await executeDockerCommand(executeRequest);
  const successRequest: DockerCommandSuccessRequest = {
    label: 'container inspect',
    output: inspected,
  };
  assertDockerCommandSucceeded(successRequest);
  const expected = [
    request.imageId,
    EXPECTED_IMAGE_USER,
    'none',
    'true',
    'false',
    'false',
    'false',
    String(CONTAINER_MEMORY_BYTES),
    String(CONTAINER_MEMORY_BYTES),
    String(CONTAINER_PIDS_LIMIT),
    '["ALL"]',
    '["no-new-privileges","seccomp=builtin"]',
    '{"/tmp":"rw,noexec,nosuid,size=16m"}',
    '0',
    '0',
    '0',
    EXPECTED_RUNTIME,
    'private',
    '',
    '',
    '',
    'private',
    '',
    'none',
    'no',
  ].join('|');
  if (inspected.stdout.trim() !== expected) {
    throw new Error('Sealed source analysis container configuration drifted.');
  }
}

async function inspectContainerState(
  request: InspectSourceAnalysisContainerRequest,
): Promise<SourceAnalysisContainerState> {
  const executeRequest: ExecuteDockerCommandRequest = {
    ...request,
    arguments: [
      'container',
      'inspect',
      '--format',
      '{{.State.OOMKilled}}|{{.State.ExitCode}}',
      request.containerName,
    ],
    maximumStderrBytes: DOCKER_CONTROL_STDERR_BYTES,
    maximumStdoutBytes: DOCKER_CONTROL_STDOUT_BYTES,
    stdin: false,
  };
  const inspected = await executeDockerCommand(executeRequest);
  const successRequest: DockerCommandSuccessRequest = {
    label: 'container state inspect',
    output: inspected,
  };
  assertDockerCommandSucceeded(successRequest);
  const fields = inspected.stdout.trim().split('|');
  const oomKilled = fields[0] ?? '';
  const exitCode = fields[1] ?? '';
  if (
    fields.length !== 2 ||
    (oomKilled !== 'true' && oomKilled !== 'false') ||
    !/^[0-9]+$/.test(exitCode)
  ) {
    throw new Error('Sealed source analysis container state is malformed.');
  }
  return {
    exitCode: Number(exitCode),
    oomKilled: oomKilled === 'true',
  };
}

async function removeSourceAnalysisContainer(
  request: RemoveSourceAnalysisContainerRequest,
): Promise<void> {
  for (let attempt = 0; attempt < TEARDOWN_ATTEMPTS; attempt += 1) {
    const remaining = request.deadlineExpiresAt - Date.now();
    if (remaining <= 1_000) break;
    const attemptStartedAt = Date.now();
    const attemptDeadline = Math.min(
      request.deadlineExpiresAt,
      attemptStartedAt + TEARDOWN_ATTEMPT_MILLISECONDS,
    );
    const authorityDeadline = Math.min(
      request.deadlineExpiresAt,
      attemptStartedAt + TEARDOWN_AUTHORITY_MILLISECONDS,
    );
    const removalDeadline = Math.min(
      request.deadlineExpiresAt,
      attemptStartedAt + TEARDOWN_REMOVAL_MILLISECONDS,
    );
    const attemptAuthorityRequest: DockerAuthorityRequest = {
      ...request,
      deadlineExpiresAt: authorityDeadline,
      signal: false,
    };
    try {
      await assertDockerAuthority(attemptAuthorityRequest);
    } catch {
      // Removal still runs against the exact verified local endpoint and unique
      // container name. A slow authority probe cannot consume teardown.
    }
    const executeRequest: ExecuteDockerCommandRequest = {
      ...request,
      arguments: ['rm', '--force', request.containerName],
      deadlineExpiresAt: removalDeadline,
      maximumStderrBytes: DOCKER_CONTROL_STDERR_BYTES,
      maximumStdoutBytes: DOCKER_CONTROL_STDOUT_BYTES,
      signal: false,
      stdin: false,
    };
    try {
      await executeDockerCommand(executeRequest);
    } catch {
      // Inspection below is authoritative for absence.
    }
    const absenceRequest: RemoveSourceAnalysisContainerRequest = {
      ...request,
      deadlineExpiresAt: attemptDeadline,
    };
    if (await sourceAnalysisContainerIsAbsent(absenceRequest)) return;
  }
  throw new Error(
    'Sealed source analysis container teardown was not confirmed.',
  );
}

async function sourceAnalysisContainerIsAbsent(
  request: RemoveSourceAnalysisContainerRequest,
): Promise<boolean> {
  const executeRequest: ExecuteDockerCommandRequest = {
    ...request,
    arguments: [
      'container',
      'inspect',
      '--format',
      '{{.Id}}',
      request.containerName,
    ],
    maximumStderrBytes: DOCKER_CONTROL_STDERR_BYTES,
    maximumStdoutBytes: DOCKER_CONTROL_STDOUT_BYTES,
    signal: false,
    stdin: false,
  };
  try {
    const inspected = await executeDockerCommand(executeRequest);
    if (inspected.exitCode === 0) return false;
    return NO_SUCH_CONTAINER_MARKERS.some((marker) =>
      inspected.stderr.includes(marker),
    );
  } catch {
    return false;
  }
}

async function assertNoLabeledContainers(
  request: DockerAuthorityRequest,
): Promise<void> {
  const executeRequest: ExecuteDockerCommandRequest = {
    ...request,
    arguments: [
      'container',
      'ls',
      '--all',
      '--quiet',
      '--filter',
      `label=${SOURCE_ANALYSIS_CONTAINER_LABEL}`,
    ],
    maximumStderrBytes: DOCKER_CONTROL_STDERR_BYTES,
    maximumStdoutBytes: DOCKER_CONTROL_STDOUT_BYTES,
    stdin: false,
  };
  const listed = await executeDockerCommand(executeRequest);
  const successRequest: DockerCommandSuccessRequest = {
    label: 'container inventory',
    output: listed,
  };
  assertDockerCommandSucceeded(successRequest);
  if (listed.stdout.trim().length > 0) {
    throw new Error('Sealed source analysis found a preexisting container.');
  }
}

async function executeDockerCommand(
  request: ExecuteDockerCommandRequest,
): Promise<BoundedProcessOutput> {
  const commandRequest: DockerCommandRequest = {
    arguments: request.arguments,
    endpoint: request.environment.endpoint,
  };
  const processRequest: RunBoundedProcessRequest = {
    command: dockerCommand(commandRequest),
    cwd: request.dependencies.repoRoot,
    deadlineExpiresAt: request.deadlineExpiresAt,
    maximumStderrBytes: request.maximumStderrBytes,
    maximumStdinBytes:
      request.stdin === false ? 0 : MAXIMUM_SOURCE_ANALYSIS_STDIN_BYTES,
    maximumStdoutBytes: request.maximumStdoutBytes,
    signal: request.signal,
    stdin: request.stdin,
  };
  return await request.dependencies.executeProcess(processRequest);
}

function dockerCommand(request: DockerCommandRequest): readonly string[] {
  return [DOCKER, '--host', request.endpoint, ...request.arguments];
}

function assertDockerCommandSucceeded(
  request: DockerCommandSuccessRequest,
): void {
  if (request.output.exitCode !== 0) {
    throw new Error(`Sealed source analysis Docker ${request.label} failed.`);
  }
}

export async function sourceAnalysisBuildIdentity(
  repoRoot: string,
): Promise<string> {
  return (await readSourceAnalysisImageSnapshot(repoRoot)).buildIdentity;
}

async function readSourceAnalysisImageSnapshot(
  repoRoot: string,
): Promise<SourceAnalysisImageSnapshot> {
  const digest = createHash('sha256');
  const inputs: SourceAnalysisImageInputSnapshot[] = [];
  for (const relativePath of SOURCE_ANALYSIS_IMAGE_INPUTS) {
    const contents = await readFile(path.join(repoRoot, relativePath));
    digest.update(
      `${relativePath.length}:${relativePath}:${contents.byteLength}:`,
    );
    digest.update(contents);
    const input: SourceAnalysisImageInputSnapshot = {
      contents: Uint8Array.from(contents),
      relativePath,
    };
    inputs.push(input);
  }
  return { buildIdentity: digest.digest('hex'), inputs };
}

function dockerAuthorityKey(
  environment: SealedSourceAnalysisDockerEnvironment,
): string {
  return `${environment.contextName}|${environment.endpoint}|${environment.daemonId}`;
}

export function resetSourceAnalysisImageCacheForTest(): void {
  sourceAnalysisImage = false;
}
