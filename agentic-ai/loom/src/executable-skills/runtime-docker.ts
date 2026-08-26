import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { assertLocalDockerHostAllowed } from './docker-host-admission.ts';
import { MINIMUM_EXECUTABLE_SKILL_TIMEOUT_MS } from './domain.ts';
import type { RegisteredExecutableSkill } from './domain.ts';
import type { AuditedExecutableSkillRegistry } from './registry.ts';
import { resolveAuditedExecutableSkill } from './registry.ts';
import type { SealedSourceAnalysisDockerEnvironment } from './source-analysis-docker.ts';
import {
  runBoundedProcess,
  type BoundedProcessOutput,
  type RunBoundedProcessRequest,
} from './source-analysis-process.ts';
import { resolveTrustedDockerExecutable } from './source-analysis-docker-executable.ts';
import type { MaterializedExecutableSkillContext } from './runtime-context.ts';
import {
  materializeExecutableSkillContext,
  type MaterializeExecutableSkillContextRequest,
} from './runtime-context.ts';
import {
  throwExecutableSkillRuntimeFailure,
  type ThrowExecutableSkillRuntimeFailureRequest,
} from './runtime-failure.ts';
import {
  EXECUTABLE_SKILL_CONTAINER_LABEL,
  EXECUTABLE_SKILL_OWNER_LABEL,
  planExecutableSkillContainer,
  type ExecutableSkillContainerPlanRequest,
} from './runtime-docker-plan.ts';
import {
  executeExecutableSkillInRuntimeSlot,
  type ExecutableSkillRuntimeSlotClock,
  type ExecuteExecutableSkillInRuntimeSlotRequest,
} from './runtime-slot.ts';
import {
  executeWithExecutableSkillDockerLease,
  resolveExecutableSkillHostUserId,
  type ExecuteWithExecutableSkillDockerLeaseRequest,
} from './runtime-docker-lease.ts';
import {
  recoverStaleExecutableSkillDockerResources,
  type ExecutableSkillDockerRecoveryRequest,
} from './runtime-docker-recovery.ts';
import {
  attemptExecutableSkillContainerCreation,
  type ExecutableSkillContainerCreationDependencies,
} from './runtime-docker-create.ts';
import {
  executeExecutableSkillResourceTeardownWithDependencies,
  type ExecutableSkillResourceTeardownDependencies,
  type ExecutableSkillResourceTeardownRequest,
  type ExecuteExecutableSkillResourceTeardownWithDependenciesRequest,
} from './runtime-docker-teardown.ts';
export {
  executeExecutableSkillResourceTeardownWithDependencies,
  type ExecutableSkillResourceTeardownDependencies,
  type ExecutableSkillResourceTeardownRequest,
  type ExecuteExecutableSkillResourceTeardownWithDependenciesRequest,
} from './runtime-docker-teardown.ts';
import {
  resolveExecutableSkillContainerState,
  type ExecutableSkillContainerState,
} from './runtime-docker-state.ts';
import {
  assertExecutableSkillContainerDeadline,
  MAXIMUM_EXECUTABLE_SKILL_TOTAL_MILLISECONDS,
  type ExecutableSkillContainerDeadlineValidationRequest,
} from './runtime-deadline.ts';
export {
  resolveExecutableSkillContainerState,
  type ExecutableSkillContainerState,
} from './runtime-docker-state.ts';
export {
  assertExecutableSkillContainerDeadline,
  type ExecutableSkillContainerDeadlineValidationRequest,
} from './runtime-deadline.ts';
export {
  planExecutableSkillContainer,
  type ExecutableSkillContainerPlan,
  type ExecutableSkillContainerPlanRequest,
} from './runtime-docker-plan.ts';

export type ExecutableSkillDockerProcessExecutor = (
  request: RunBoundedProcessRequest,
) => Promise<BoundedProcessOutput>;

export type ExecutableSkillDockerDependencies = {
  readonly dockerExecutable: string;
  readonly executeProcess: ExecutableSkillDockerProcessExecutor;
  readonly killProcessGroup: (processGroupId: number) => void;
  readonly uniqueId: () => string;
  readonly userId: number;
};

export type ExecuteExecutableSkillContainerRequest = {
  readonly deadlineExpiresAt: number;
  readonly registryAuthority: AuditedExecutableSkillRegistry;
  readonly serializedRequest: string;
  readonly signal: AbortSignal | false;
  readonly skillId: string;
};

export type ExecutableSkillContainerCandidate = {
  readonly imageDigest: string;
  readonly serializedResult: string;
};

export type ExecuteExecutableSkillContainerWithDependenciesRequest = {
  readonly dependencies: ExecutableSkillDockerDependencies;
  readonly request: ExecuteExecutableSkillContainerRequest;
};

export type ExecutableSkillTeardownInventoryActivityRequest = {
  readonly operationDeadlineExpiresAt: number;
  readonly operationSignal: AbortSignal | false;
  readonly totalDeadlineExpiresAt: number;
};

export type ExecutableSkillTeardownInventoryActivity = {
  readonly deadlineExpiresAt: number;
  readonly signal: false;
};

type DockerCommandRequest = {
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly deadlineExpiresAt: number;
  readonly dependencies: ExecutableSkillDockerDependencies;
  readonly environment: SealedSourceAnalysisDockerEnvironment;
  readonly maximumStderrBytes: number;
  readonly maximumStdinBytes: number;
  readonly maximumStdoutBytes: number;
  readonly signal: AbortSignal | false;
  readonly stdin: string | false;
};

type ExecuteExecutableSkillContainerLifecycleRequest = {
  readonly context: MaterializedExecutableSkillContext;
  readonly deadlineExpiresAt: number;
  readonly dockerEnvironment: SealedSourceAnalysisDockerEnvironment;
  readonly registration: RegisteredExecutableSkill;
  readonly serializedRequest: string;
  readonly signal: AbortSignal | false;
};

type DockerResourceNames = {
  readonly container: string;
  readonly image: string;
  readonly ownerToken: string;
};

const PINNED_BUN_IMAGE =
  'oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4';
const IMAGE_CLOSURE_LABEL = 'dev.nokey.loom.executable-skill.closure';
const EXECUTABLE_SKILL_CONTAINER_PREFIX = 'nook-executable-skill-runtime';
const EXPECTED_DOCKER_RUNTIME = 'runc';
const OPERATION_RESERVE_MILLISECONDS = 28_000;
const LEASE_TEARDOWN_RESERVE_MILLISECONDS = 4_000;
const TEARDOWN_AUTHORITY_MILLISECONDS = 1_500;
const TEARDOWN_ATTEMPT_MILLISECONDS = 4_500;
const TEARDOWN_PHASE_MILLISECONDS = 3_000;
const TEARDOWN_INVENTORY_MILLISECONDS = 3_000;
const CONTROL_OUTPUT_BYTES = 64 * 1024;
const BUILD_OUTPUT_BYTES = 512 * 1024;
export const EXECUTABLE_SKILL_DOCKER_AUTHORITY_FORMAT =
  '{{.ID}}|{{.OSType}}|{{.DefaultRuntime}}|{{json .SecurityOptions}}|{{.CgroupVersion}}';

export async function executeExecutableSkillContainer(
  request: ExecuteExecutableSkillContainerRequest,
): Promise<ExecutableSkillContainerCandidate> {
  try {
    assertLocalDockerHostAllowed();
    assertContainerRequestDeadline(request);
    const preflightRequest = {
      authority: request.registryAuthority,
      deadlineExpiresAt: request.deadlineExpiresAt,
      signal: request.signal,
      skillId: request.skillId,
    };
    resolveAuditedExecutableSkill(preflightRequest);
    const dependencies: ExecutableSkillDockerDependencies = {
      dockerExecutable: await resolveTrustedDockerExecutable(),
      executeProcess: runBoundedProcess,
      killProcessGroup: (processGroupId) =>
        process.kill(-processGroupId, 'SIGKILL'),
      uniqueId: randomUUID,
      userId: resolveExecutableSkillHostUserId(),
    };
    const execution: ExecuteExecutableSkillContainerWithDependenciesRequest = {
      dependencies,
      request,
    };
    return await executeExecutableSkillContainerAfterAdmission(execution);
  } catch (error) {
    const failureRequest: ThrowExecutableSkillRuntimeFailureRequest = {
      error:
        error instanceof Error ? error : 'Executable skill execution failed.',
    };
    throwExecutableSkillRuntimeFailure(failureRequest);
  }
}

export async function executeExecutableSkillContainerWithDependencies(
  execution: ExecuteExecutableSkillContainerWithDependenciesRequest,
): Promise<ExecutableSkillContainerCandidate> {
  try {
    const request = execution.request;
    assertContainerRequestDeadline(request);
    const preflightRequest = {
      authority: request.registryAuthority,
      deadlineExpiresAt: request.deadlineExpiresAt,
      signal: request.signal,
      skillId: request.skillId,
    };
    resolveAuditedExecutableSkill(preflightRequest);
    return await executeExecutableSkillContainerAfterAdmission(execution);
  } catch (error) {
    const failureRequest: ThrowExecutableSkillRuntimeFailureRequest = {
      error:
        error instanceof Error ? error : 'Executable skill execution failed.',
    };
    throwExecutableSkillRuntimeFailure(failureRequest);
  }
}

async function executeExecutableSkillContainerAfterAdmission(
  execution: ExecuteExecutableSkillContainerWithDependenciesRequest,
): Promise<ExecutableSkillContainerCandidate> {
  const clock: ExecutableSkillRuntimeSlotClock = { now: Date.now };
  const slotRequest: ExecuteExecutableSkillInRuntimeSlotRequest = {
    clock,
    deadlineExpiresAt: execution.request.deadlineExpiresAt,
    execute: async () =>
      await executeExecutableSkillContainerInsideSlot(execution),
    signal: execution.request.signal,
  };
  return await executeExecutableSkillInRuntimeSlot(slotRequest);
}

async function executeExecutableSkillContainerInsideSlot(
  execution: ExecuteExecutableSkillContainerWithDependenciesRequest,
): Promise<ExecutableSkillContainerCandidate> {
  const request = execution.request;
  const resolutionRequest = {
    authority: request.registryAuthority,
    deadlineExpiresAt: request.deadlineExpiresAt,
    signal: request.signal,
    skillId: request.skillId,
  };
  const resolved = resolveAuditedExecutableSkill(resolutionRequest);
  const contextRequest: MaterializeExecutableSkillContextRequest = {
    closurePlan: resolved.closurePlan,
    deadlineExpiresAt: request.deadlineExpiresAt,
    signal: request.signal,
  };
  const context = await materializeExecutableSkillContext(contextRequest);
  const lifecycleRequest: ExecuteExecutableSkillContainerLifecycleRequest = {
    context,
    deadlineExpiresAt: request.deadlineExpiresAt,
    dockerEnvironment: resolved.dockerEnvironment,
    registration: resolved.registration,
    serializedRequest: request.serializedRequest,
    signal: request.signal,
  };
  try {
    const lifecycle: ExecuteExecutableSkillContainerLifecycle = {
      dependencies: execution.dependencies,
      request: lifecycleRequest,
    };
    return await executeExecutableSkillContainerLifecycle(lifecycle);
  } finally {
    await context.dispose();
  }
}

type ExecuteExecutableSkillContainerLifecycle = {
  readonly dependencies: ExecutableSkillDockerDependencies;
  readonly request: ExecuteExecutableSkillContainerLifecycleRequest;
};

type ExecuteExecutableSkillContainerInsideDockerLeaseRequest = {
  readonly authorityRequest: DockerAuthorityRequest;
  readonly execution: ExecuteExecutableSkillContainerLifecycle;
  readonly suffix: string;
};

async function executeExecutableSkillContainerLifecycle(
  execution: ExecuteExecutableSkillContainerLifecycle,
): Promise<ExecutableSkillContainerCandidate> {
  const request = execution.request;
  assertRuntimeRequest(request);
  const operationDeadlineExpiresAt =
    request.deadlineExpiresAt - OPERATION_RESERVE_MILLISECONDS;
  const authorityRequest: DockerAuthorityRequest = {
    cwd: request.context.directory,
    deadlineExpiresAt: operationDeadlineExpiresAt,
    dependencies: execution.dependencies,
    environment: request.dockerEnvironment,
    signal: request.signal,
  };
  await assertDockerAuthority(authorityRequest);
  const suffix = execution.dependencies.uniqueId().replaceAll('-', '');
  if (!/^[0-9a-f]{32}$/u.test(suffix)) {
    throw new Error('Executable skill runtime identifier is invalid.');
  }
  let candidate: ExecutableSkillContainerCandidate | false = false;
  const leaseRequest: ExecuteWithExecutableSkillDockerLeaseRequest = {
    daemonId: request.dockerEnvironment.daemonId,
    endpoint: request.dockerEnvironment.endpoint,
    execute: async () => {
      const insideLeaseRequest: ExecuteExecutableSkillContainerInsideDockerLeaseRequest =
        { authorityRequest, execution, suffix };
      candidate =
        await executeExecutableSkillContainerInsideDockerLease(
          insideLeaseRequest,
        );
    },
    recover: async () => {
      const recoveryRequest: ExecutableSkillDockerRecoveryRequest = {
        cwd: request.context.directory,
        deadlineExpiresAt: authorityRequest.deadlineExpiresAt,
        dockerExecutable: execution.dependencies.dockerExecutable,
        endpoint: request.dockerEnvironment.endpoint,
        executeProcess: execution.dependencies.executeProcess,
        killProcessGroup: execution.dependencies.killProcessGroup,
        userId: execution.dependencies.userId,
      };
      await recoverStaleExecutableSkillDockerResources(recoveryRequest);
    },
  };
  await executeWithExecutableSkillDockerLease(leaseRequest);
  if (candidate === false) {
    throw new Error('Executable skill Docker lease returned no result.');
  }
  return candidate;
}

async function executeExecutableSkillContainerInsideDockerLease(
  request: ExecuteExecutableSkillContainerInsideDockerLeaseRequest,
): Promise<ExecutableSkillContainerCandidate> {
  const execution = request.execution;
  const lifecycleRequest = execution.request;
  const resourceDeadlineExpiresAt =
    lifecycleRequest.deadlineExpiresAt - LEASE_TEARDOWN_RESERVE_MILLISECONDS;
  await assertNoExecutableSkillContainers(request.authorityRequest);
  const names: DockerResourceNames = {
    container: `${EXECUTABLE_SKILL_CONTAINER_PREFIX}-${request.suffix}`,
    image: `nook-executable-skill:${request.suffix}`,
    ownerToken: request.suffix,
  };
  let imageMayExist = false;
  let containerMayExist = false;
  try {
    imageMayExist = true;
    const buildRequest: RuntimeDockerRequestOperation = {
      cwd: lifecycleRequest.context.directory,
      deadlineExpiresAt: request.authorityRequest.deadlineExpiresAt,
      dependencies: execution.dependencies,
      environment: lifecycleRequest.dockerEnvironment,
      names,
      request: lifecycleRequest,
    };
    const imageDigest = await buildSkillImage(buildRequest);
    await assertDockerAuthority(request.authorityRequest);
    const createRequest: CreateSkillContainerRequest = {
      cwd: lifecycleRequest.context.directory,
      deadlineExpiresAt: request.authorityRequest.deadlineExpiresAt,
      dependencies: execution.dependencies,
      environment: lifecycleRequest.dockerEnvironment,
      imageDigest,
      names,
      request: lifecycleRequest,
    };
    const creationDependencies: ExecutableSkillContainerCreationDependencies = {
      create: async () => await createSkillContainer(createRequest),
      markContainerMayExist: () => {
        containerMayExist = true;
      },
    };
    await attemptExecutableSkillContainerCreation(creationDependencies);
    await inspectSkillContainer(createRequest);
    await assertDockerAuthority(request.authorityRequest);
    const executionDeadlineExpiresAt = Math.min(
      request.authorityRequest.deadlineExpiresAt,
      Date.now() + lifecycleRequest.registration.manifest.limits.timeoutMs,
    );
    const startRequest: RuntimeDockerRequestOperation = {
      cwd: lifecycleRequest.context.directory,
      deadlineExpiresAt: executionDeadlineExpiresAt,
      dependencies: execution.dependencies,
      environment: lifecycleRequest.dockerEnvironment,
      names,
      request: lifecycleRequest,
    };
    const output = await startSkillContainer(startRequest);
    const stateRequest: RuntimeDockerRequestOperation = {
      ...startRequest,
      deadlineExpiresAt: request.authorityRequest.deadlineExpiresAt,
    };
    const state = await inspectSkillContainerState(stateRequest);
    if (output.exitCode !== 0 || state.exitCode !== 0 || state.oomKilled) {
      throw new Error('Executable skill container execution failed.');
    }
    const candidate: ExecutableSkillContainerCandidate = {
      imageDigest,
      serializedResult: output.stdout,
    };
    return Object.freeze(candidate);
  } finally {
    const containerRemoval: RuntimeDockerOperation = {
      cwd: lifecycleRequest.context.directory,
      deadlineExpiresAt: resourceDeadlineExpiresAt,
      dependencies: execution.dependencies,
      environment: lifecycleRequest.dockerEnvironment,
      names,
    };
    const imageRemoval: RuntimeDockerOperation = {
      ...containerRemoval,
    };
    const teardownDependencies: ExecutableSkillResourceTeardownDependencies = {
      assertContainerInventoryEmpty: async () => {
        const teardownActivityRequest: ExecutableSkillTeardownInventoryActivityRequest =
          {
            operationDeadlineExpiresAt:
              request.authorityRequest.deadlineExpiresAt,
            operationSignal: request.authorityRequest.signal,
            totalDeadlineExpiresAt: resourceDeadlineExpiresAt,
          };
        const teardownActivity = planExecutableSkillTeardownInventoryActivity(
          teardownActivityRequest,
        );
        const inventoryRequest: DockerAuthorityRequest = {
          cwd: lifecycleRequest.context.directory,
          deadlineExpiresAt: teardownActivity.deadlineExpiresAt,
          dependencies: execution.dependencies,
          environment: lifecycleRequest.dockerEnvironment,
          signal: teardownActivity.signal,
        };
        await assertNoExecutableSkillContainers(inventoryRequest);
      },
      confirmContainerRemoved: async () =>
        await attemptContainerRemovalAndConfirm(containerRemoval),
      removeImage: async () => await removeImage(imageRemoval),
    };
    const teardownRequest: ExecutableSkillResourceTeardownRequest = {
      containerMayExist,
      imageMayExist,
    };
    const teardown: ExecuteExecutableSkillResourceTeardownWithDependenciesRequest =
      {
        dependencies: teardownDependencies,
        request: teardownRequest,
      };
    await executeExecutableSkillResourceTeardownWithDependencies(teardown);
  }
}

type RuntimeDockerOperation = {
  readonly cwd: string;
  readonly deadlineExpiresAt: number;
  readonly dependencies: ExecutableSkillDockerDependencies;
  readonly environment: SealedSourceAnalysisDockerEnvironment;
  readonly names: DockerResourceNames;
};

type RuntimeDockerRequestOperation = RuntimeDockerOperation & {
  readonly request: ExecuteExecutableSkillContainerLifecycleRequest;
};

type CreateSkillContainerRequest = RuntimeDockerRequestOperation & {
  readonly imageDigest: string;
};

type DockerAuthorityRequest = {
  readonly cwd: string;
  readonly deadlineExpiresAt: number;
  readonly dependencies: ExecutableSkillDockerDependencies;
  readonly environment: SealedSourceAnalysisDockerEnvironment;
  readonly signal: AbortSignal | false;
};

async function assertDockerAuthority(
  request: DockerAuthorityRequest,
): Promise<void> {
  if (
    !/^[A-Za-z0-9-]{16,128}$/u.test(request.environment.daemonId) ||
    !request.environment.endpoint.startsWith('unix:///')
  ) {
    throw new Error('Executable skill Docker authority is invalid.');
  }
  const endpointPath = request.environment.endpoint.slice('unix://'.length);
  if (
    !path.isAbsolute(endpointPath) ||
    path.normalize(endpointPath) !== endpointPath ||
    endpointPath === '/'
  ) {
    throw new Error('Executable skill Docker authority is invalid.');
  }
  const commandRequest: DockerCommandRequest = {
    arguments: ['info', '--format', EXECUTABLE_SKILL_DOCKER_AUTHORITY_FORMAT],
    cwd: request.cwd,
    deadlineExpiresAt: request.deadlineExpiresAt,
    dependencies: request.dependencies,
    environment: request.environment,
    maximumStderrBytes: CONTROL_OUTPUT_BYTES,
    maximumStdinBytes: 0,
    maximumStdoutBytes: CONTROL_OUTPUT_BYTES,
    signal: request.signal,
    stdin: false,
  };
  const output = await runDocker(commandRequest);
  const fields = output.stdout.trim().split('|');
  const securityOptions = fields[3] ?? '';
  if (
    output.exitCode !== 0 ||
    output.stderr !== '' ||
    fields.length !== 5 ||
    fields[0] !== request.environment.daemonId ||
    fields[1] !== 'linux' ||
    fields[2] !== EXPECTED_DOCKER_RUNTIME ||
    !securityOptions.includes('name=seccomp,profile=builtin') ||
    !securityOptions.includes('name=cgroupns') ||
    fields[4] !== '2'
  ) {
    throw new Error('Executable skill Docker authority probe failed.');
  }
}

async function buildSkillImage(
  operation: RuntimeDockerRequestOperation,
): Promise<string> {
  const closureSha256 = operation.request.context.closureSha256;
  const dockerfile = [
    `FROM ${PINNED_BUN_IMAGE}`,
    `LABEL ${IMAGE_CLOSURE_LABEL}=${closureSha256}`,
    `LABEL ${EXECUTABLE_SKILL_OWNER_LABEL}=${operation.names.ownerToken}`,
    'WORKDIR /opt/nook-skill',
    'COPY --chown=65532:65532 . .',
    'USER 65532:65532',
    '',
  ].join('\n');
  const buildCommand: DockerCommandRequest = {
    arguments: [
      'build',
      '--network=none',
      '--pull=false',
      '--no-cache',
      '--tag',
      operation.names.image,
      '--file',
      '-',
      operation.request.context.directory,
    ],
    cwd: operation.request.context.directory,
    deadlineExpiresAt: operation.deadlineExpiresAt,
    dependencies: operation.dependencies,
    environment: operation.environment,
    maximumStderrBytes: BUILD_OUTPUT_BYTES,
    maximumStdinBytes: 16 * 1024,
    maximumStdoutBytes: BUILD_OUTPUT_BYTES,
    signal: operation.request.signal,
    stdin: dockerfile,
  };
  const output = await runDocker(buildCommand);
  if (output.exitCode !== 0) {
    throw new Error('Executable skill image build failed.');
  }
  const inspectionCommand: DockerCommandRequest = {
    arguments: [
      'image',
      'inspect',
      '--format',
      '{{.Id}}',
      operation.names.image,
    ],
    cwd: operation.request.context.directory,
    deadlineExpiresAt: operation.deadlineExpiresAt,
    dependencies: operation.dependencies,
    environment: operation.environment,
    maximumStderrBytes: CONTROL_OUTPUT_BYTES,
    maximumStdinBytes: 0,
    maximumStdoutBytes: CONTROL_OUTPUT_BYTES,
    signal: operation.request.signal,
    stdin: false,
  };
  const inspection = await runDocker(inspectionCommand);
  const digest = inspection.stdout.trim();
  if (
    inspection.exitCode !== 0 ||
    inspection.stderr !== '' ||
    !/^sha256:[0-9a-f]{64}$/u.test(digest)
  ) {
    throw new Error('Executable skill image identity is invalid.');
  }
  return digest;
}

async function createSkillContainer(
  operation: CreateSkillContainerRequest,
): Promise<void> {
  const planRequest: ExecutableSkillContainerPlanRequest = {
    containerName: operation.names.container,
    imageDigest: operation.imageDigest,
    ownerToken: operation.names.ownerToken,
    runnerContainerPath: operation.request.context.runnerContainerPath,
    skillId: operation.request.registration.skillId,
  };
  const plan = planExecutableSkillContainer(planRequest);
  const commandRequest: DockerCommandRequest = {
    arguments: plan.createArguments,
    cwd: operation.request.context.directory,
    deadlineExpiresAt: operation.deadlineExpiresAt,
    dependencies: operation.dependencies,
    environment: operation.environment,
    maximumStderrBytes: CONTROL_OUTPUT_BYTES,
    maximumStdinBytes: 0,
    maximumStdoutBytes: CONTROL_OUTPUT_BYTES,
    signal: operation.request.signal,
    stdin: false,
  };
  const output = await runDocker(commandRequest);
  if (output.exitCode !== 0 || output.stderr !== '') {
    throw new Error('Executable skill container creation failed.');
  }
}

async function inspectSkillContainer(
  operation: CreateSkillContainerRequest,
): Promise<void> {
  const planRequest: ExecutableSkillContainerPlanRequest = {
    containerName: operation.names.container,
    imageDigest: operation.imageDigest,
    ownerToken: operation.names.ownerToken,
    runnerContainerPath: operation.request.context.runnerContainerPath,
    skillId: operation.request.registration.skillId,
  };
  const plan = planExecutableSkillContainer(planRequest);
  const commandRequest: DockerCommandRequest = {
    arguments: [
      'container',
      'inspect',
      '--format',
      plan.inspectionFormat,
      operation.names.container,
    ],
    cwd: operation.cwd,
    deadlineExpiresAt: operation.deadlineExpiresAt,
    dependencies: operation.dependencies,
    environment: operation.environment,
    maximumStderrBytes: CONTROL_OUTPUT_BYTES,
    maximumStdinBytes: 0,
    maximumStdoutBytes: CONTROL_OUTPUT_BYTES,
    signal: operation.request.signal,
    stdin: false,
  };
  const inspection = await runDocker(commandRequest);
  if (
    inspection.exitCode !== 0 ||
    inspection.stderr !== '' ||
    inspection.stdout.trim() !== plan.expectedInspection
  ) {
    throw new Error('Executable skill container configuration drifted.');
  }
}

async function startSkillContainer(
  operation: RuntimeDockerRequestOperation,
): Promise<BoundedProcessOutput> {
  const commandRequest: DockerCommandRequest = {
    arguments: [
      'start',
      '--attach',
      '--interactive',
      operation.names.container,
    ],
    cwd: operation.request.context.directory,
    deadlineExpiresAt: operation.deadlineExpiresAt,
    dependencies: operation.dependencies,
    environment: operation.environment,
    maximumStderrBytes: CONTROL_OUTPUT_BYTES,
    maximumStdinBytes:
      operation.request.registration.manifest.limits.requestBytes,
    maximumStdoutBytes:
      operation.request.registration.manifest.limits.resultBytes,
    signal: operation.request.signal,
    stdin: operation.request.serializedRequest,
  };
  return await runDocker(commandRequest);
}

async function inspectSkillContainerState(
  operation: RuntimeDockerRequestOperation,
): Promise<ExecutableSkillContainerState> {
  const commandRequest: DockerCommandRequest = {
    arguments: [
      'container',
      'inspect',
      '--format',
      '{{.State.OOMKilled}}|{{.State.ExitCode}}',
      operation.names.container,
    ],
    cwd: operation.cwd,
    deadlineExpiresAt: operation.deadlineExpiresAt,
    dependencies: operation.dependencies,
    environment: operation.environment,
    maximumStderrBytes: CONTROL_OUTPUT_BYTES,
    maximumStdinBytes: 0,
    maximumStdoutBytes: CONTROL_OUTPUT_BYTES,
    signal: operation.request.signal,
    stdin: false,
  };
  return resolveExecutableSkillContainerState(await runDocker(commandRequest));
}

async function attemptContainerRemovalAndConfirm(
  operation: RuntimeDockerOperation,
): Promise<boolean> {
  const startedAt = Date.now();
  if (operation.deadlineExpiresAt - startedAt <= 1_000) return false;
  const authorityRequest: DockerAuthorityRequest = {
    cwd: operation.cwd,
    deadlineExpiresAt: Math.min(
      operation.deadlineExpiresAt,
      startedAt + TEARDOWN_AUTHORITY_MILLISECONDS,
    ),
    dependencies: operation.dependencies,
    environment: operation.environment,
    signal: false,
  };
  try {
    await assertDockerAuthority(authorityRequest);
  } catch {
    // Removal still targets the exact registry-bound endpoint and unique name.
  }
  const ownershipCommand: DockerCommandRequest = {
    arguments: [
      'container',
      'inspect',
      '--format',
      `{{index .Config.Labels "${EXECUTABLE_SKILL_OWNER_LABEL}"}}`,
      operation.names.container,
    ],
    cwd: operation.cwd,
    deadlineExpiresAt: Math.min(
      operation.deadlineExpiresAt,
      startedAt + TEARDOWN_PHASE_MILLISECONDS,
    ),
    dependencies: operation.dependencies,
    environment: operation.environment,
    maximumStderrBytes: CONTROL_OUTPUT_BYTES,
    maximumStdinBytes: 0,
    maximumStdoutBytes: CONTROL_OUTPUT_BYTES,
    signal: false,
    stdin: false,
  };
  const ownership = await runDocker(ownershipCommand);
  if (isConfirmedContainerAbsent(ownership)) return true;
  if (
    ownership.exitCode !== 0 ||
    ownership.stderr !== '' ||
    ownership.stdout.trim() !== operation.names.ownerToken
  ) {
    throw new Error('Executable skill container teardown owner is invalid.');
  }
  const removalCommand: DockerCommandRequest = {
    arguments: ['rm', '--force', operation.names.container],
    cwd: operation.cwd,
    deadlineExpiresAt: Math.min(
      operation.deadlineExpiresAt,
      startedAt + TEARDOWN_PHASE_MILLISECONDS,
    ),
    dependencies: operation.dependencies,
    environment: operation.environment,
    maximumStderrBytes: CONTROL_OUTPUT_BYTES,
    maximumStdinBytes: 0,
    maximumStdoutBytes: CONTROL_OUTPUT_BYTES,
    signal: false,
    stdin: false,
  };
  try {
    await runDocker(removalCommand);
  } catch {
    // An interrupted CLI can still have removed the container; inspect next.
  }
  const confirmationCommand: DockerCommandRequest = {
    arguments: ['container', 'inspect', operation.names.container],
    cwd: operation.cwd,
    deadlineExpiresAt: Math.min(
      operation.deadlineExpiresAt,
      startedAt + TEARDOWN_ATTEMPT_MILLISECONDS,
    ),
    dependencies: operation.dependencies,
    environment: operation.environment,
    maximumStderrBytes: CONTROL_OUTPUT_BYTES,
    maximumStdinBytes: 0,
    maximumStdoutBytes: CONTROL_OUTPUT_BYTES,
    signal: false,
    stdin: false,
  };
  try {
    const confirmation = await runDocker(confirmationCommand);
    return isConfirmedContainerAbsent(confirmation);
  } catch {
    return false;
  }
}

function isConfirmedContainerAbsent(output: BoundedProcessOutput): boolean {
  return (
    output.exitCode !== 0 &&
    output.stdout.trim() === '' &&
    (output.stderr.includes('No such container') ||
      output.stderr.includes('No such object'))
  );
}

async function assertNoExecutableSkillContainers(
  request: DockerAuthorityRequest,
): Promise<void> {
  const commandRequest: DockerCommandRequest = {
    arguments: [
      'container',
      'ls',
      '--all',
      '--quiet',
      '--filter',
      `label=${EXECUTABLE_SKILL_CONTAINER_LABEL}`,
    ],
    cwd: request.cwd,
    deadlineExpiresAt: request.deadlineExpiresAt,
    dependencies: request.dependencies,
    environment: request.environment,
    maximumStderrBytes: CONTROL_OUTPUT_BYTES,
    maximumStdinBytes: 0,
    maximumStdoutBytes: CONTROL_OUTPUT_BYTES,
    signal: request.signal,
    stdin: false,
  };
  assertExecutableSkillContainerInventory(await runDocker(commandRequest));
}

export function assertExecutableSkillContainerInventory(
  output: BoundedProcessOutput,
): void {
  if (
    output.exitCode !== 0 ||
    output.stderr !== '' ||
    output.stdout.trim() !== ''
  ) {
    const failureRequest = {
      error: 'Executable skill runtime found a preexisting container.',
    };
    throwExecutableSkillRuntimeFailure(failureRequest);
  }
}

export function planExecutableSkillTeardownInventoryActivity(
  request: ExecutableSkillTeardownInventoryActivityRequest,
): ExecutableSkillTeardownInventoryActivity {
  void request.operationDeadlineExpiresAt;
  void request.operationSignal;
  const activity: ExecutableSkillTeardownInventoryActivity = {
    deadlineExpiresAt: teardownInventoryDeadline(
      request.totalDeadlineExpiresAt,
    ),
    signal: false,
  };
  return Object.freeze(activity);
}

async function removeImage(operation: RuntimeDockerOperation): Promise<void> {
  const authorityRequest: DockerAuthorityRequest = {
    cwd: operation.cwd,
    deadlineExpiresAt: teardownAuthorityDeadline(operation.deadlineExpiresAt),
    dependencies: operation.dependencies,
    environment: operation.environment,
    signal: false,
  };
  try {
    await assertDockerAuthority(authorityRequest);
  } catch {
    // Image removal remains mandatory after an interrupted authority probe.
  }
  const commandRequest: DockerCommandRequest = {
    arguments: ['image', 'rm', '--force', operation.names.image],
    cwd: operation.cwd,
    deadlineExpiresAt: teardownDeadline(operation.deadlineExpiresAt),
    dependencies: operation.dependencies,
    environment: operation.environment,
    maximumStderrBytes: CONTROL_OUTPUT_BYTES,
    maximumStdinBytes: 0,
    maximumStdoutBytes: CONTROL_OUTPUT_BYTES,
    signal: false,
    stdin: false,
  };
  const output = await runDocker(commandRequest);
  if (output.exitCode !== 0 && !output.stderr.includes('No such image')) {
    throw new Error('Executable skill image removal failed.');
  }
}

async function runDocker(
  request: DockerCommandRequest,
): Promise<BoundedProcessOutput> {
  const processRequest: RunBoundedProcessRequest = {
    command: [
      request.dependencies.dockerExecutable,
      '--host',
      request.environment.endpoint,
      ...request.arguments,
    ],
    cwd: request.cwd,
    deadlineExpiresAt: request.deadlineExpiresAt,
    maximumStderrBytes: request.maximumStderrBytes,
    maximumStdinBytes: request.maximumStdinBytes,
    maximumStdoutBytes: request.maximumStdoutBytes,
    signal: request.signal,
    stdin: request.stdin,
  };
  return await request.dependencies.executeProcess(processRequest);
}

function assertRuntimeRequest(
  request: ExecuteExecutableSkillContainerLifecycleRequest,
): void {
  const remaining = request.deadlineExpiresAt - Date.now();
  const timeout = request.registration.manifest.limits.timeoutMs;
  const requestBytes = new TextEncoder().encode(
    request.serializedRequest,
  ).byteLength;
  if (
    !Number.isSafeInteger(request.deadlineExpiresAt) ||
    remaining <= OPERATION_RESERVE_MILLISECONDS + 1_000 ||
    timeout < MINIMUM_EXECUTABLE_SKILL_TIMEOUT_MS ||
    timeout > MAXIMUM_EXECUTABLE_SKILL_TOTAL_MILLISECONDS ||
    requestBytes > request.registration.manifest.limits.requestBytes
  ) {
    throw new Error('Executable skill runtime deadline is invalid.');
  }
  if (request.signal !== false && request.signal.aborted) {
    throw new Error('Executable skill runtime was aborted.');
  }
}

function assertContainerRequestDeadline(
  request: ExecuteExecutableSkillContainerRequest,
): void {
  const validationRequest: ExecutableSkillContainerDeadlineValidationRequest = {
    deadlineExpiresAt: request.deadlineExpiresAt,
    now: Date.now(),
    signalAborted: request.signal !== false && request.signal.aborted,
  };
  assertExecutableSkillContainerDeadline(validationRequest);
}

function teardownDeadline(totalDeadlineExpiresAt: number): number {
  const deadline = Math.min(
    totalDeadlineExpiresAt,
    Date.now() + TEARDOWN_PHASE_MILLISECONDS,
  );
  if (deadline - Date.now() <= 1_000) {
    throw new Error('Executable skill teardown reserve was exhausted.');
  }
  return deadline;
}

function teardownAuthorityDeadline(totalDeadlineExpiresAt: number): number {
  const deadline = Math.min(
    totalDeadlineExpiresAt,
    Date.now() + TEARDOWN_AUTHORITY_MILLISECONDS,
  );
  if (deadline - Date.now() <= 1_000) {
    throw new Error('Executable skill teardown reserve was exhausted.');
  }
  return deadline;
}

function teardownInventoryDeadline(totalDeadlineExpiresAt: number): number {
  const deadline = Math.min(
    totalDeadlineExpiresAt,
    Date.now() + TEARDOWN_INVENTORY_MILLISECONDS,
  );
  if (deadline - Date.now() <= 1_000) {
    const failureRequest = {
      error: 'Executable skill teardown reserve was exhausted.',
    };
    throwExecutableSkillRuntimeFailure(failureRequest);
  }
  return deadline;
}
