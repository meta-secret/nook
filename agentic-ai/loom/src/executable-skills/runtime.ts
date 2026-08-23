import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  readBoundedExecutableSkillStream,
  type BoundedExecutableSkillStreamRead,
  type ReadBoundedExecutableSkillStreamRequest,
} from './bounded-stream.ts';
import {
  EXECUTABLE_SKILL_PROVISIONING_TIMEOUT_MS,
  EXECUTABLE_SKILL_TEARDOWN_ATTEMPT_TIMEOUT_MS,
} from './budgets.ts';
import { ExecutableSkillPayloadKind } from './domain.ts';
import type {
  RegisteredExecutableSkill,
  VerifiedExecutableSkillExecution,
} from './domain.ts';
import {
  EXECUTABLE_SKILL_REGISTRY,
  resolveAuditedExecutableSkillRepository,
  validateRegisteredExecutableSkillResult,
} from './registry.ts';
import type {
  AuditedExecutableSkillRegistry,
  ValidateRegisteredExecutableSkillResultRequest,
} from './registry.ts';
import {
  materializeSkillClosure,
  type MaterializedSkillClosure,
} from './closure.ts';
import { resolveDockerControlEnvironment } from './docker-environment.ts';
import {
  assertExecutableSkillNotCancelled,
  waitForExecutableSkillCancellation,
} from './lifecycle-cancellation.ts';
import {
  assertExecutableSkillByteLimit,
  boundedExecutableSkillStderr,
  executableSkillSha256,
  type AssertExecutableSkillByteLimitRequest,
} from './payload-guards.ts';
import {
  ExecutableSkillCancellationError,
  ExecutableSkillTeardownError,
  ExecutableSkillTimeoutError,
  type ExecutableSkillTimeoutErrorRequest,
} from './runtime-errors.ts';
export { resolveDockerControlEnvironment } from './docker-environment.ts';
export {
  ExecutableSkillCancellationError,
  ExecutableSkillTeardownError,
  ExecutableSkillTimeoutError,
} from './runtime-errors.ts';

type ExecuteSkillWithDefinitionRequest = ExecuteRegisteredSkillRequest & {
  readonly definition: RegisteredExecutableSkill;
  readonly provisioningDeadline: DockerDeadline;
  readonly repositoryRoot: string;
  readonly sourceTree: string;
};

export type RunDockerSkillRequest = {
  readonly closure: MaterializedSkillClosure;
  readonly deadline: DockerDeadline;
  readonly image: SealedSkillImage;
  readonly resultBytes: number;
  readonly serializedRequest: string;
  readonly signal: AbortSignal | false;
};

type RunAttachedContainerRequest = {
  readonly command: readonly string[];
  readonly deadline: DockerDeadline;
  readonly resultBytes: number;
  readonly serializedRequest: string;
  readonly signal: AbortSignal | false;
  readonly containerName: string;
  readonly provisionedImage: boolean;
};

export type DockerSkillOutput = {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
  readonly runtimeImageDigest: string;
};

type DockerControlOutput = {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
};

type SealedSkillImage = {
  readonly digest: string;
  readonly provisioned: boolean;
  readonly reference: string;
};

type DockerDeadline = {
  readonly expiresAt: number;
};

export type EnsureSkillImageRequest = {
  readonly closure: MaterializedSkillClosure;
  readonly deadline: DockerDeadline;
  readonly rebuild: boolean;
  readonly signal: AbortSignal | false;
};

type RunDockerControlRequest = {
  readonly command: readonly string[];
  readonly deadline: DockerDeadline;
  readonly maximumStderrBytes: number;
  readonly maximumStdoutBytes: number;
  readonly stdin: string | false;
  readonly signal: AbortSignal | false;
};

const BUN_SKILL_IMAGE =
  'oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4';
const CONTAINER_SKILLS_ROOT = '/skills';
const SEALED_IMAGE_LABEL = 'nook.executable-skill-closure';
const SEALED_RECIPE_LABEL = 'nook.executable-skill-recipe';
const CONTAINER_SOURCE_TREE_LABEL = 'nook.executable-skill-source-tree';
export const PROVISIONING_TIMEOUT_MS = EXECUTABLE_SKILL_PROVISIONING_TIMEOUT_MS;
const TEARDOWN_TIMEOUT_MS = EXECUTABLE_SKILL_TEARDOWN_ATTEMPT_TIMEOUT_MS;

export type ExecuteRegisteredSkillRequest = {
  readonly registryAuthority: AuditedExecutableSkillRegistry;
  readonly serializedRequest: string;
  readonly signal: AbortSignal | false;
  readonly skillId: string;
};

export async function ensureSkillImage(
  request: EnsureSkillImageRequest,
): Promise<SealedSkillImage> {
  const closure = request.closure;
  const recipe = skillDockerfile(closure.closureSha256);
  const recipeSha256 = executableSkillSha256(recipe);
  const dockerfile = recipe.replace('RECIPE_SHA_PLACEHOLDER', recipeSha256);
  const sealedIdentity = executableSkillSha256(
    `${closure.closureSha256}\n${recipeSha256}\n${BUN_SKILL_IMAGE}`,
  );
  const reference = `nook-executable-skill:${sealedIdentity}`;
  const inspectRequest: InspectSkillImageRequest = {
    closureSha256: closure.closureSha256,
    deadline: request.deadline,
    reference,
    recipeSha256,
    signal: request.signal,
  };
  if (!request.rebuild) {
    const existing = await inspectSkillImage(inspectRequest);
    if (existing !== false) return existing;
  }
  if (request.rebuild) {
    const removalRequest: RemoveSkillImageRequest = {
      deadline: request.deadline,
      reference,
      signal: request.signal,
    };
    await removeSkillImage(removalRequest);
    const remainingImage = await inspectSkillImage(inspectRequest);
    if (remainingImage !== false) {
      throw new Error(
        'Executable skill sealed image removal was not confirmed.',
      );
    }
  }
  const command = [
    'docker',
    'build',
    '--pull=false',
    '--tag',
    reference,
    '--file',
    '-',
    closure.contextDirectory,
  ];
  const buildRequest: RunDockerControlWithInputRequest = {
    command,
    deadline: request.deadline,
    signal: request.signal,
    stdin: dockerfile,
  };
  const build = await runDockerControlWithInput(buildRequest);
  if (build.exitCode !== 0) {
    throw new Error(
      `Executable skill sealed image build failed: ${boundedExecutableSkillStderr(build.stderr)}`,
    );
  }
  const built = await inspectSkillImage(inspectRequest);
  if (built === false) {
    throw new Error('Executable skill sealed image identity is invalid.');
  }
  return { ...built, provisioned: true };
}

type RemoveSkillImageRequest = {
  readonly deadline: DockerDeadline;
  readonly reference: string;
  readonly signal: AbortSignal | false;
};

async function removeSkillImage(
  request: RemoveSkillImageRequest,
): Promise<void> {
  const controlRequest: RunDockerControlRequest = {
    command: ['docker', 'image', 'rm', '--force', request.reference],
    deadline: request.deadline,
    maximumStderrBytes: 32 * 1024,
    maximumStdoutBytes: 32 * 1024,
    signal: request.signal,
    stdin: false,
  };
  const removal = await runDockerControl(controlRequest);
  if (removal.exitCode !== 0 && !removal.stderr.includes('No such image')) {
    throw new Error('Executable skill cold image removal failed.');
  }
}

type InspectSkillImageRequest = {
  readonly closureSha256: string;
  readonly deadline: DockerDeadline;
  readonly recipeSha256: string;
  readonly reference: string;
  readonly signal: AbortSignal | false;
};

async function inspectSkillImage(
  request: InspectSkillImageRequest,
): Promise<SealedSkillImage | false> {
  const format =
    `{{.Id}}|{{ index .Config.Labels "${SEALED_IMAGE_LABEL}" }}` +
    `|{{ index .Config.Labels "${SEALED_RECIPE_LABEL}" }}`;
  const command = [
    'docker',
    'image',
    'inspect',
    '--format',
    format,
    request.reference,
  ];
  const controlRequest: RunDockerControlRequest = {
    command,
    deadline: request.deadline,
    maximumStderrBytes: 32 * 1024,
    maximumStdoutBytes: 4096,
    signal: request.signal,
    stdin: false,
  };
  const inspection = await runDockerControl(controlRequest);
  if (inspection.exitCode !== 0) return false;
  const [digest, closureLabel, recipeLabel, extra] = inspection.stdout
    .trim()
    .split('|');
  if (
    typeof digest !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/u.test(digest) ||
    closureLabel !== request.closureSha256 ||
    recipeLabel !== request.recipeSha256 ||
    typeof extra === 'string'
  ) {
    return false;
  }
  return { digest, provisioned: false, reference: request.reference };
}

function skillDockerfile(closureSha256: string): string {
  return [
    `FROM ${BUN_SKILL_IMAGE}`,
    `LABEL ${SEALED_IMAGE_LABEL}=${closureSha256}`,
    `LABEL ${SEALED_RECIPE_LABEL}=RECIPE_SHA_PLACEHOLDER`,
    `WORKDIR ${CONTAINER_SKILLS_ROOT}`,
    'COPY package.json bun.lock ./',
    'RUN bun install --frozen-lockfile --production --ignore-scripts',
    'COPY . .',
    'USER 65532:65532',
    '',
  ].join('\n');
}

export async function executeRegisteredSkill(
  request: ExecuteRegisteredSkillRequest,
): Promise<VerifiedExecutableSkillExecution> {
  const definition = EXECUTABLE_SKILL_REGISTRY.get(request.skillId);
  if (!definition) {
    throw new Error(`Unregistered executable skill: ${request.skillId}`);
  }
  assertExecutableSkillNotCancelled(request.signal);
  const provisioningDeadline = dockerDeadline(PROVISIONING_TIMEOUT_MS);
  const repositoryRequest = {
    authority: request.registryAuthority,
    deadlineExpiresAt: provisioningDeadline.expiresAt,
    signal: request.signal,
  };
  const repository =
    await resolveAuditedExecutableSkillRepository(repositoryRequest);
  const executionRequest: ExecuteSkillWithDefinitionRequest = {
    ...request,
    definition,
    provisioningDeadline,
    repositoryRoot: repository.repositoryRoot,
    sourceTree: repository.sourceTree,
  };
  return executeSkillWithDefinition(executionRequest);
}

async function executeSkillWithDefinition(
  request: ExecuteSkillWithDefinitionRequest,
): Promise<VerifiedExecutableSkillExecution> {
  const manifest = request.definition.manifest;
  if (
    manifest.id !== request.skillId ||
    request.definition.skillId !== request.skillId ||
    JSON.stringify(manifest) !== JSON.stringify(request.definition.manifest)
  ) {
    throw new Error('Executable skill registration identity mismatch.');
  }
  const requestLimit: AssertExecutableSkillByteLimitRequest = {
    value: request.serializedRequest,
    maximumBytes: manifest.limits.requestBytes,
    label: ExecutableSkillPayloadKind.Request,
  };
  assertExecutableSkillByteLimit(requestLimit);
  const provisioningDeadline = request.provisioningDeadline;
  const closureRequest = {
    deadlineExpiresAt: provisioningDeadline.expiresAt,
    definition: request.definition,
    repositoryRoot: request.repositoryRoot,
    signal: request.signal,
    sourceTree: request.sourceTree,
  };
  const closure = await materializeSkillClosure(closureRequest);
  let dockerOutput: DockerSkillOutput;
  try {
    const imageRequest: EnsureSkillImageRequest = {
      closure,
      deadline: provisioningDeadline,
      rebuild: false,
      signal: request.signal,
    };
    const image = await ensureSkillImage(imageRequest);
    assertExecutableSkillNotCancelled(request.signal);
    const dockerRequest: RunDockerSkillRequest = {
      closure,
      deadline: dockerDeadline(manifest.limits.timeoutMs),
      image,
      resultBytes: manifest.limits.resultBytes,
      serializedRequest: request.serializedRequest,
      signal: request.signal,
    };
    dockerOutput = await runDockerSkill(dockerRequest);
  } finally {
    closure.dispose();
  }
  if (dockerOutput.exitCode !== 0) {
    throw new Error(
      `Executable skill container failed: ${boundedExecutableSkillStderr(dockerOutput.stderr)}`,
    );
  }
  const serializedResult = dockerOutput.stdout;
  const resultLimit: AssertExecutableSkillByteLimitRequest = {
    value: serializedResult,
    maximumBytes: manifest.limits.resultBytes,
    label: ExecutableSkillPayloadKind.Result,
  };
  assertExecutableSkillByteLimit(resultLimit);
  const resultContractRequest: ValidateRegisteredExecutableSkillResultRequest =
    {
      registration: request.definition,
      serializedResult,
    };
  validateRegisteredExecutableSkillResult(resultContractRequest);
  const execution: VerifiedExecutableSkillExecution = {
    closureSha256: closure.closureSha256,
    skillId: manifest.id,
    schemaVersion: manifest.schemaVersion,
    executionKind: manifest.executionKind,
    requestKind: manifest.requestKind,
    resultContract: request.definition.resultContract,
    resultKind: manifest.resultKind,
    requestSha256: executableSkillSha256(request.serializedRequest),
    resultSha256: executableSkillSha256(serializedResult),
    runtimeImageDigest: dockerOutput.runtimeImageDigest,
    serializedResult,
    sourceTree: closure.sourceTree,
  };
  return Object.freeze(execution);
}

export async function runDockerSkill(
  request: RunDockerSkillRequest,
): Promise<DockerSkillOutput> {
  const containerName = `nook-skill-${randomUUID()}`;
  assertExecutableSkillNotCancelled(request.signal);
  const deadline = request.deadline;
  const image = request.image;
  const containerRunner = request.closure.runnerImagePath;
  const createCommand = [
    'docker',
    'create',
    '--interactive',
    '--name',
    containerName,
    '--label',
    `${CONTAINER_SOURCE_TREE_LABEL}=${request.closure.sourceTree}`,
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--pids-limit',
    '64',
    '--memory',
    '256m',
    '--cpus',
    '1',
    '--user',
    '65532:65532',
    '--env',
    'HOME=/tmp',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=16m',
    '--workdir',
    path.posix.dirname(containerRunner),
    image.digest,
    'bun',
    'run',
    containerRunner,
  ];
  const createControlRequest: RunDockerControlRequest = {
    command: createCommand,
    deadline,
    maximumStderrBytes: 32 * 1024,
    maximumStdoutBytes: 4096,
    signal: request.signal,
    stdin: false,
  };
  let createResult: DockerControlOutput;
  try {
    createResult = await runDockerControl(createControlRequest);
  } catch (error) {
    await confirmAbsentAfterAmbiguousCreate(containerName);
    throw error;
  }
  if (createResult.exitCode !== 0) {
    await confirmAbsentAfterAmbiguousCreate(containerName);
    throw new Error(
      `Executable skill container creation failed: ${boundedExecutableSkillStderr(createResult.stderr)}`,
    );
  }
  const command = [
    'docker',
    'start',
    '--attach',
    '--interactive',
    containerName,
  ];
  const attachedRequest: RunAttachedContainerRequest = {
    command,
    containerName,
    deadline,
    provisionedImage: image.provisioned,
    resultBytes: request.resultBytes,
    serializedRequest: request.serializedRequest,
    signal: request.signal,
  };
  let attached: Omit<DockerSkillOutput, 'runtimeImageDigest'>;
  try {
    attached = await runAttachedContainer(attachedRequest);
  } catch (error) {
    await forceRemoveWithRetry(containerName);
    throw error;
  }
  await forceRemoveWithRetry(containerName);
  return {
    ...attached,
    runtimeImageDigest: image.digest,
  };
}

async function forceRemoveWithRetry(containerName: string): Promise<void> {
  try {
    await forceRemoveAndConfirm(containerName);
  } catch {
    await forceRemoveAndConfirm(containerName);
  }
}

async function runAttachedContainer(
  request: RunAttachedContainerRequest,
): Promise<Omit<DockerSkillOutput, 'runtimeImageDigest'>> {
  const executionTimeoutMs = remainingMilliseconds(request.deadline);
  const spawnOptions = {
    env: resolveDockerControlEnvironment(),
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  } as const;
  const subprocess = Bun.spawn([...request.command], spawnOptions);
  subprocess.stdin.write(request.serializedRequest);
  subprocess.stdin.end();
  const stdoutRequest: ReadBoundedExecutableSkillStreamRequest = {
    maximumBytes: request.resultBytes,
    stream: subprocess.stdout,
  };
  const stderrRequest: ReadBoundedExecutableSkillStreamRequest = {
    maximumBytes: 8 * 1024,
    stream: subprocess.stderr,
  };
  const stdoutPromise = readBoundedExecutableSkillStream(stdoutRequest);
  const stderrPromise = readBoundedExecutableSkillStream(stderrRequest);
  let timeoutHandle: ReturnType<typeof setTimeout> | false = false;
  const executionDeadline = new Promise<'timeout'>((resolve) => {
    timeoutHandle = setTimeout(resolve, executionTimeoutMs, 'timeout');
  });
  const processExit = subprocess.exited.then((exitCode) => ({ exitCode }));
  const stdoutOverflow = overflowSignal(stdoutPromise);
  const stderrOverflow = overflowSignal(stderrPromise);
  const overflow = Promise.race([stdoutOverflow, stderrOverflow]);
  const cancellation = waitForExecutableSkillCancellation(request.signal);
  try {
    const first = await Promise.race([
      processExit,
      executionDeadline,
      overflow,
      cancellation.promise,
    ]);
    if (first === 'timeout' || first === 'overflow' || first === 'cancelled') {
      subprocess.kill(9);
      await subprocess.exited;
      if (first === 'cancelled') {
        throw new ExecutableSkillCancellationError(request.containerName);
      }
      if (first === 'timeout') {
        const timeoutRequest: ExecutableSkillTimeoutErrorRequest = {
          coldImageProvisioned: request.provisionedImage,
          containerName: request.containerName,
        };
        throw new ExecutableSkillTimeoutError(timeoutRequest);
      }
      throw new Error(
        'Executable skill container output exceeds its byte limit.',
      );
    }
    const stdout = await stdoutPromise;
    const stderr = await stderrPromise;
    if (stdout.overflow || stderr.overflow) {
      throw new Error(
        'Executable skill container output exceeds its byte limit.',
      );
    }
    return {
      exitCode: first.exitCode,
      stderr: stderr.text,
      stdout: stdout.text,
    };
  } finally {
    cancellation.dispose();
    if (timeoutHandle !== false) clearTimeout(timeoutHandle);
    if (typeof subprocess.exitCode !== 'number') {
      subprocess.kill(9);
    }
    await subprocess.exited;
  }
}

async function confirmAbsentAfterAmbiguousCreate(
  containerName: string,
): Promise<void> {
  const deadline = dockerDeadline(TEARDOWN_TIMEOUT_MS);
  try {
    const inspectRequest: InspectContainerRequest = {
      containerName,
      deadline,
    };
    const inspection = await inspectContainer(inspectRequest);
    const confirmationRequest: ConfirmedAbsentInspectionRequest = {
      containerName,
      inspection,
    };
    if (isConfirmedAbsentInspection(confirmationRequest)) return;
    if (inspection.exitCode === 0) {
      await forceRemoveAndConfirm(containerName);
      return;
    }
  } catch (error) {
    if (error instanceof ExecutableSkillTeardownError) throw error;
  }
  throw new ExecutableSkillTeardownError(containerName);
}

async function overflowSignal(
  read: Promise<BoundedExecutableSkillStreamRead>,
): Promise<'overflow'> {
  const result = await read;
  if (result.overflow) return 'overflow';
  return new Promise<'overflow'>(() => {});
}

async function forceRemoveAndConfirm(containerName: string): Promise<void> {
  try {
    const deadline = dockerDeadline(TEARDOWN_TIMEOUT_MS);
    const initialInspectRequest: InspectContainerRequest = {
      containerName,
      deadline,
    };
    const initialInspection = await inspectContainer(initialInspectRequest);
    const initialConfirmationRequest: ConfirmedAbsentInspectionRequest = {
      containerName,
      inspection: initialInspection,
    };
    if (isConfirmedAbsentInspection(initialConfirmationRequest)) return;
    if (initialInspection.exitCode !== 0) {
      throw new ExecutableSkillTeardownError(containerName);
    }
    const command = ['docker', 'rm', '--force', containerName];
    const removeRequest: RunDockerControlRequest = {
      command,
      deadline,
      maximumStderrBytes: 8192,
      maximumStdoutBytes: 4096,
      signal: false,
      stdin: false,
    };
    const removal = await runDockerControl(removeRequest);
    const inspectRequest: InspectContainerRequest = {
      containerName,
      deadline,
    };
    const inspection = await inspectContainer(inspectRequest);
    const confirmationRequest: ConfirmedAbsentInspectionRequest = {
      containerName,
      inspection,
    };
    if (
      removal.exitCode !== 0 ||
      removal.stdout.trim() !== containerName ||
      removal.stderr !== '' ||
      !isConfirmedAbsentInspection(confirmationRequest)
    ) {
      throw new ExecutableSkillTeardownError(containerName);
    }
  } catch (error) {
    if (error instanceof ExecutableSkillTeardownError) throw error;
    throw new ExecutableSkillTeardownError(containerName);
  }
}

type InspectContainerRequest = {
  readonly containerName: string;
  readonly deadline: DockerDeadline;
};

async function inspectContainer(
  request: InspectContainerRequest,
): Promise<DockerControlOutput> {
  const command = [
    'docker',
    'container',
    'inspect',
    '--format',
    '{{.Name}}',
    request.containerName,
  ];
  const controlRequest: RunDockerControlRequest = {
    command,
    deadline: request.deadline,
    maximumStderrBytes: 8192,
    maximumStdoutBytes: 4096,
    signal: false,
    stdin: false,
  };
  return runDockerControl(controlRequest);
}

type ConfirmedAbsentInspectionRequest = {
  readonly containerName: string;
  readonly inspection: DockerControlOutput;
};

function isConfirmedAbsentInspection(
  request: ConfirmedAbsentInspectionRequest,
): boolean {
  if (
    request.inspection.exitCode !== 1 ||
    request.inspection.stdout.trim() !== ''
  ) {
    return false;
  }
  const stderr = request.inspection.stderr.trim();
  return (
    stderr.endsWith(`No such container: ${request.containerName}`) ||
    stderr.endsWith(`No such object: ${request.containerName}`)
  );
}

async function runDockerControl(
  request: RunDockerControlRequest,
): Promise<DockerControlOutput> {
  const controlTimeoutMs = remainingMilliseconds(request.deadline);
  const options = {
    env: resolveDockerControlEnvironment(),
    stdin: request.stdin === false ? ('ignore' as const) : ('pipe' as const),
    stdout: 'pipe',
    stderr: 'pipe',
  } as const;
  const subprocess = Bun.spawn([...request.command], options);
  if (request.stdin !== false && subprocess.stdin) {
    subprocess.stdin.write(request.stdin);
    subprocess.stdin.end();
  }
  const stdoutRequest: ReadBoundedExecutableSkillStreamRequest = {
    maximumBytes: request.maximumStdoutBytes,
    stream: subprocess.stdout,
  };
  const stderrRequest: ReadBoundedExecutableSkillStreamRequest = {
    maximumBytes: request.maximumStderrBytes,
    stream: subprocess.stderr,
  };
  const stdoutPromise = readBoundedExecutableSkillStream(stdoutRequest);
  const stderrPromise = readBoundedExecutableSkillStream(stderrRequest);
  const processExit = subprocess.exited.then((exitCode) => ({ exitCode }));
  let timeoutHandle: ReturnType<typeof setTimeout> | false = false;
  const timeout = new Promise<'timeout'>((resolve) => {
    timeoutHandle = setTimeout(resolve, controlTimeoutMs, 'timeout');
  });
  const overflow = Promise.race([
    overflowSignal(stdoutPromise),
    overflowSignal(stderrPromise),
  ]);
  const cancellation = waitForExecutableSkillCancellation(request.signal);
  try {
    const first = await Promise.race([
      processExit,
      timeout,
      overflow,
      cancellation.promise,
    ]);
    if (first === 'timeout' || first === 'overflow' || first === 'cancelled') {
      subprocess.kill(9);
      await subprocess.exited;
      if (first === 'cancelled') {
        throw new ExecutableSkillCancellationError(false);
      }
      throw new Error(
        first === 'timeout'
          ? 'Executable skill Docker control timed out.'
          : 'Executable skill Docker control output exceeded its bound.',
      );
    }
    const stdout = await stdoutPromise;
    const stderr = await stderrPromise;
    if (stdout.overflow || stderr.overflow) {
      throw new Error(
        'Executable skill Docker control output exceeded its bound.',
      );
    }
    return {
      exitCode: first.exitCode,
      stderr: stderr.text,
      stdout: stdout.text,
    };
  } finally {
    cancellation.dispose();
    if (timeoutHandle !== false) clearTimeout(timeoutHandle);
    if (typeof subprocess.exitCode !== 'number') subprocess.kill(9);
    await subprocess.exited;
  }
}

type RunDockerControlWithInputRequest = {
  readonly command: readonly string[];
  readonly deadline: DockerDeadline;
  readonly stdin: string;
  readonly signal: AbortSignal | false;
};

async function runDockerControlWithInput(
  request: RunDockerControlWithInputRequest,
): Promise<DockerControlOutput> {
  const controlRequest: RunDockerControlRequest = {
    command: request.command,
    deadline: request.deadline,
    maximumStderrBytes: 1024 * 1024,
    maximumStdoutBytes: 1024 * 1024,
    signal: request.signal,
    stdin: request.stdin,
  };
  return runDockerControl(controlRequest);
}

export function dockerDeadline(timeoutMs: number): DockerDeadline {
  return { expiresAt: Date.now() + timeoutMs };
}

function remainingMilliseconds(deadline: DockerDeadline): number {
  const remaining = deadline.expiresAt - Date.now();
  if (remaining <= 0) {
    throw new Error('Executable skill lifecycle deadline expired.');
  }
  return remaining;
}
