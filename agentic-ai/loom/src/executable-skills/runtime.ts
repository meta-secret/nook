import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { findRepoRoot } from '../lib/repo.ts';
import {
  ExecutableSkillHostResultContract,
  ExecutableSkillPayloadKind,
} from './domain.ts';
import type {
  ExecuteRegisteredSkillRequest,
  RegisteredExecutableSkill,
  VerifiedExecutableSkillExecution,
} from './domain.ts';
import { decodeExecutableSkillManifest } from './manifest-codec.ts';
import {
  auditExecutableSkillRegistry,
  EXECUTABLE_SKILL_REGISTRY,
  validateRegisteredExecutableSkillResult,
} from './registry.ts';
import type { ValidateRegisteredExecutableSkillResultRequest } from './registry.ts';
import {
  materializeSkillAcceptanceProbeClosure,
  materializeSkillClosure,
  type MaterializedSkillClosure,
} from './closure.ts';

type ExecuteSkillWithDefinitionRequest = ExecuteRegisteredSkillRequest & {
  readonly definition: RegisteredExecutableSkill;
  readonly repositoryRoot: string;
};

type AssertByteLimitRequest = {
  readonly value: string;
  readonly maximumBytes: number;
  readonly label: ExecutableSkillPayloadKind;
};

type RunDockerSkillRequest = {
  readonly closure: MaterializedSkillClosure;
  readonly resultBytes: number;
  readonly serializedRequest: string;
  readonly timeoutMs: number;
};

type RunAttachedContainerRequest = {
  readonly command: readonly string[];
  readonly deadline: DockerDeadline;
  readonly resultBytes: number;
  readonly serializedRequest: string;
  readonly containerName: string;
};

type DockerSkillOutput = {
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
  readonly reference: string;
};

type DockerDeadline = {
  readonly expiresAt: number;
};

type EnsureSkillImageRequest = {
  readonly closure: MaterializedSkillClosure;
  readonly deadline: DockerDeadline;
};

type RunDockerControlRequest = {
  readonly command: readonly string[];
  readonly deadline: DockerDeadline;
  readonly maximumStderrBytes: number;
  readonly maximumStdoutBytes: number;
  readonly stdin: string | false;
};

type ReadBoundedStreamRequest = {
  readonly maximumBytes: number;
  readonly stream: ReadableStream<Uint8Array>;
};

type BoundedStreamRead = {
  readonly overflow: boolean;
  readonly text: string;
};

const BUN_SKILL_IMAGE =
  'oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4';
const CONTAINER_SKILLS_ROOT = '/skills';
const SEALED_IMAGE_LABEL = 'nook.executable-skill-closure';
const SEALED_RECIPE_LABEL = 'nook.executable-skill-recipe';
const DOCKER_CONNECTION_ENVIRONMENT_KEYS = [
  'DOCKER_CERT_PATH',
  'DOCKER_CONFIG',
  'DOCKER_CONTEXT',
  'DOCKER_HOST',
  'DOCKER_TLS',
  'DOCKER_TLS_VERIFY',
  'HOME',
  'SSH_AUTH_SOCK',
] as const;
const BASE_DOCKER_CONTROL_ENVIRONMENT: Readonly<Record<string, string>> = {
  NO_COLOR: '1',
  PATH: '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin',
};

export function resolveDockerControlEnvironment(): Readonly<
  Record<string, string>
> {
  const environment: Record<string, string> = {
    ...BASE_DOCKER_CONTROL_ENVIRONMENT,
  };
  for (const key of DOCKER_CONNECTION_ENVIRONMENT_KEYS) {
    const value = Bun.env[key];
    if (typeof value === 'string' && value.length > 0) {
      environment[key] = value;
    }
  }
  return Object.freeze(environment);
}

export enum ExecutableSkillAcceptanceProbe {
  Containment = 'containment',
  Overflow = 'overflow',
  Timeout = 'timeout',
}

export type ExecutableSkillAcceptanceEvidence = {
  readonly probe: ExecutableSkillAcceptanceProbe;
  readonly serializedOutput: string;
};

async function ensureSkillImage(
  request: EnsureSkillImageRequest,
): Promise<SealedSkillImage> {
  const closure = request.closure;
  const recipe = skillDockerfile(closure.closureSha256);
  const recipeSha256 = sha256(recipe);
  const dockerfile = recipe.replace('RECIPE_SHA_PLACEHOLDER', recipeSha256);
  const sealedIdentity = sha256(
    `${closure.closureSha256}\n${recipeSha256}\n${BUN_SKILL_IMAGE}`,
  );
  const reference = `nook-executable-skill:${sealedIdentity}`;
  const inspectRequest: InspectSkillImageRequest = {
    closureSha256: closure.closureSha256,
    deadline: request.deadline,
    reference,
    recipeSha256,
  };
  const existing = await inspectSkillImage(inspectRequest);
  if (existing !== false) return existing;
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
    stdin: dockerfile,
  };
  const build = await runDockerControlWithInput(buildRequest);
  if (build.exitCode !== 0) {
    throw new Error(
      `Executable skill sealed image build failed: ${boundedStderr(build.stderr)}`,
    );
  }
  const built = await inspectSkillImage(inspectRequest);
  if (built === false) {
    throw new Error('Executable skill sealed image identity is invalid.');
  }
  return built;
}

type InspectSkillImageRequest = {
  readonly closureSha256: string;
  readonly deadline: DockerDeadline;
  readonly recipeSha256: string;
  readonly reference: string;
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
  return { digest, reference: request.reference };
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

export class ExecutableSkillTimeoutError extends Error {
  readonly containerName: string;

  constructor(containerName: string) {
    super('Executable skill timed out and its container was removed.');
    this.name = 'ExecutableSkillTimeoutError';
    this.containerName = containerName;
  }
}

export class ExecutableSkillTeardownError extends Error {
  readonly containerName: string;

  constructor(containerName: string) {
    super('Executable skill container teardown could not be confirmed.');
    this.name = 'ExecutableSkillTeardownError';
    this.containerName = containerName;
  }
}

export async function executeRegisteredSkill(
  request: ExecuteRegisteredSkillRequest,
): Promise<VerifiedExecutableSkillExecution> {
  const definition = EXECUTABLE_SKILL_REGISTRY.get(request.skillId);
  if (!definition) {
    throw new Error(`Unregistered executable skill: ${request.skillId}`);
  }
  const repositoryRoot = findRepoRoot();
  const auditRequest = { repositoryRoot };
  const auditFindings = auditExecutableSkillRegistry(auditRequest);
  if (auditFindings.length > 0) {
    throw new Error('Executable skill registry audit failed before execution.');
  }
  const executionRequest: ExecuteSkillWithDefinitionRequest = {
    ...request,
    definition,
    repositoryRoot,
  };
  return executeSkillWithDefinition(executionRequest);
}

async function executeSkillWithDefinition(
  request: ExecuteSkillWithDefinitionRequest,
): Promise<VerifiedExecutableSkillExecution> {
  const manifestPath = path.join(
    request.repositoryRoot,
    request.definition.manifestPath,
  );
  const manifest = decodeExecutableSkillManifest(
    readFileSync(manifestPath, 'utf8'),
  );
  if (
    manifest.id !== request.skillId ||
    request.definition.skillId !== request.skillId ||
    JSON.stringify(manifest) !== JSON.stringify(request.definition.manifest)
  ) {
    throw new Error('Executable skill registration identity mismatch.');
  }
  const requestLimit: AssertByteLimitRequest = {
    value: request.serializedRequest,
    maximumBytes: manifest.limits.requestBytes,
    label: ExecutableSkillPayloadKind.Request,
  };
  assertByteLimit(requestLimit);
  const closureRequest = {
    definition: request.definition,
    repositoryRoot: request.repositoryRoot,
  };
  const closure = materializeSkillClosure(closureRequest);
  const dockerRequest: RunDockerSkillRequest = {
    closure,
    resultBytes: manifest.limits.resultBytes,
    serializedRequest: request.serializedRequest,
    timeoutMs: manifest.limits.timeoutMs,
  };
  let dockerOutput: DockerSkillOutput;
  try {
    dockerOutput = await runDockerSkill(dockerRequest);
  } finally {
    closure.dispose();
  }
  if (dockerOutput.exitCode !== 0) {
    throw new Error(
      `Executable skill container failed: ${boundedStderr(dockerOutput.stderr)}`,
    );
  }
  const serializedResult = dockerOutput.stdout;
  const resultLimit: AssertByteLimitRequest = {
    value: serializedResult,
    maximumBytes: manifest.limits.resultBytes,
    label: ExecutableSkillPayloadKind.Result,
  };
  assertByteLimit(resultLimit);
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
    requestSha256: sha256(request.serializedRequest),
    resultSha256: sha256(serializedResult),
    runtimeImageDigest: dockerOutput.runtimeImageDigest,
    serializedResult,
    sourceTree: closure.sourceTree,
  };
  return Object.freeze(execution);
}

export async function executeExecutableSkillAcceptanceProbe(
  probe: ExecutableSkillAcceptanceProbe,
): Promise<ExecutableSkillAcceptanceEvidence> {
  const repositoryRoot = findRepoRoot();
  const fixtureRoot = '.agents/skills/cortex-article-structure/tests/fixtures';
  const manifestName =
    probe === ExecutableSkillAcceptanceProbe.Timeout
      ? 'timeout-manifest.json'
      : 'containment-manifest.json';
  const manifestPath = path.join(repositoryRoot, fixtureRoot, manifestName);
  const manifest = decodeExecutableSkillManifest(
    readFileSync(manifestPath, 'utf8'),
  );
  const definition: RegisteredExecutableSkill = {
    skillId: 'cortex-article-structure',
    manifest,
    manifestPath: `${fixtureRoot}/${manifestName}`,
    resultContract: ExecutableSkillHostResultContract.CortexArticleStructureV1,
    runnerPath: `${fixtureRoot}/${probe}-runner.ts`,
  };
  const closureRequest = { definition, repositoryRoot };
  const closure = materializeSkillAcceptanceProbeClosure(closureRequest);
  const dockerRequest: RunDockerSkillRequest = {
    closure,
    resultBytes: manifest.limits.resultBytes,
    serializedRequest: '{}',
    timeoutMs: manifest.limits.timeoutMs,
  };
  let output: DockerSkillOutput;
  try {
    output = await runDockerSkill(dockerRequest);
  } finally {
    closure.dispose();
  }
  if (output.exitCode !== 0) {
    throw new Error(
      `Executable skill acceptance container failed: ${boundedStderr(output.stderr)}`,
    );
  }
  const evidence: ExecutableSkillAcceptanceEvidence = {
    probe,
    serializedOutput: output.stdout,
  };
  return Object.freeze(evidence);
}

async function runDockerSkill(
  request: RunDockerSkillRequest,
): Promise<DockerSkillOutput> {
  const containerName = `nook-skill-${randomUUID()}`;
  const deadline = dockerDeadline(request.timeoutMs);
  const imageRequest: EnsureSkillImageRequest = {
    closure: request.closure,
    deadline,
  };
  const image = await ensureSkillImage(imageRequest);
  const containerRunner = request.closure.runnerImagePath;
  const createCommand = [
    'docker',
    'create',
    '--interactive',
    '--name',
    containerName,
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
    image.reference,
    'bun',
    'run',
    containerRunner,
  ];
  const createControlRequest: RunDockerControlRequest = {
    command: createCommand,
    deadline,
    maximumStderrBytes: 32 * 1024,
    maximumStdoutBytes: 4096,
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
      `Executable skill container creation failed: ${boundedStderr(createResult.stderr)}`,
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
    resultBytes: request.resultBytes,
    serializedRequest: request.serializedRequest,
  };
  let teardownConfirmed = false;
  try {
    const attached = await runAttachedContainer(attachedRequest);
    await forceRemoveAndConfirm(containerName);
    teardownConfirmed = true;
    return {
      ...attached,
      runtimeImageDigest: image.digest,
    };
  } finally {
    if (!teardownConfirmed) {
      await forceRemoveAndConfirm(containerName);
    }
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
  const stdoutRequest: ReadBoundedStreamRequest = {
    maximumBytes: request.resultBytes,
    stream: subprocess.stdout,
  };
  const stderrRequest: ReadBoundedStreamRequest = {
    maximumBytes: 8 * 1024,
    stream: subprocess.stderr,
  };
  const stdoutPromise = readBoundedStream(stdoutRequest);
  const stderrPromise = readBoundedStream(stderrRequest);
  let timeoutHandle: ReturnType<typeof setTimeout> | false = false;
  const executionDeadline = new Promise<'timeout'>((resolve) => {
    timeoutHandle = setTimeout(resolve, executionTimeoutMs, 'timeout');
  });
  const processExit = subprocess.exited.then((exitCode) => ({ exitCode }));
  const stdoutOverflow = overflowSignal(stdoutPromise);
  const stderrOverflow = overflowSignal(stderrPromise);
  const overflow = Promise.race([stdoutOverflow, stderrOverflow]);
  try {
    const first = await Promise.race([
      processExit,
      executionDeadline,
      overflow,
    ]);
    if (first === 'timeout' || first === 'overflow') {
      subprocess.kill(9);
      await subprocess.exited;
      if (first === 'timeout') {
        throw new ExecutableSkillTimeoutError(request.containerName);
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
  const deadline = dockerDeadline(15_000);
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
  read: Promise<BoundedStreamRead>,
): Promise<'overflow'> {
  const result = await read;
  if (result.overflow) return 'overflow';
  return new Promise<'overflow'>(() => {});
}

async function forceRemoveAndConfirm(containerName: string): Promise<void> {
  const deadline = dockerDeadline(15_000);
  const command = ['docker', 'rm', '--force', containerName];
  const removeRequest: RunDockerControlRequest = {
    command,
    deadline,
    maximumStderrBytes: 8192,
    maximumStdoutBytes: 4096,
    stdin: false,
  };
  const removal = await runDockerControl(removeRequest);
  const inspectRequest: InspectContainerRequest = { containerName, deadline };
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
}

type InspectContainerRequest = {
  readonly containerName: string;
  readonly deadline: DockerDeadline;
};

async function inspectContainer(
  request: InspectContainerRequest,
): Promise<DockerControlOutput> {
  const command = ['docker', 'container', 'inspect', request.containerName];
  const controlRequest: RunDockerControlRequest = {
    command,
    deadline: request.deadline,
    maximumStderrBytes: 8192,
    maximumStdoutBytes: 8192,
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
    request.inspection.stdout.trim() !== '[]'
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
  const stdoutRequest: ReadBoundedStreamRequest = {
    maximumBytes: request.maximumStdoutBytes,
    stream: subprocess.stdout,
  };
  const stderrRequest: ReadBoundedStreamRequest = {
    maximumBytes: request.maximumStderrBytes,
    stream: subprocess.stderr,
  };
  const stdoutPromise = readBoundedStream(stdoutRequest);
  const stderrPromise = readBoundedStream(stderrRequest);
  const processExit = subprocess.exited.then((exitCode) => ({ exitCode }));
  let timeoutHandle: ReturnType<typeof setTimeout> | false = false;
  const timeout = new Promise<'timeout'>((resolve) => {
    timeoutHandle = setTimeout(resolve, controlTimeoutMs, 'timeout');
  });
  const overflow = Promise.race([
    overflowSignal(stdoutPromise),
    overflowSignal(stderrPromise),
  ]);
  try {
    const first = await Promise.race([processExit, timeout, overflow]);
    if (first === 'timeout' || first === 'overflow') {
      subprocess.kill(9);
      await subprocess.exited;
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
    if (timeoutHandle !== false) clearTimeout(timeoutHandle);
    if (typeof subprocess.exitCode !== 'number') subprocess.kill(9);
    await subprocess.exited;
  }
}

type RunDockerControlWithInputRequest = {
  readonly command: readonly string[];
  readonly deadline: DockerDeadline;
  readonly stdin: string;
};

async function runDockerControlWithInput(
  request: RunDockerControlWithInputRequest,
): Promise<DockerControlOutput> {
  const controlRequest: RunDockerControlRequest = {
    command: request.command,
    deadline: request.deadline,
    maximumStderrBytes: 1024 * 1024,
    maximumStdoutBytes: 1024 * 1024,
    stdin: request.stdin,
  };
  return runDockerControl(controlRequest);
}

function dockerDeadline(timeoutMs: number): DockerDeadline {
  return { expiresAt: Date.now() + timeoutMs };
}

function remainingMilliseconds(deadline: DockerDeadline): number {
  const remaining = deadline.expiresAt - Date.now();
  if (remaining <= 0) {
    throw new Error('Executable skill lifecycle deadline expired.');
  }
  return remaining;
}

async function readBoundedStream(
  request: ReadBoundedStreamRequest,
): Promise<BoundedStreamRead> {
  const reader = request.stream.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > request.maximumBytes) {
        await reader.cancel();
        return { overflow: true, text: '' };
      }
      const decodeOptions = { stream: true } as const;
      text += decoder.decode(chunk.value, decodeOptions);
    }
    text += decoder.decode();
    return { overflow: false, text };
  } finally {
    reader.releaseLock();
  }
}

function assertByteLimit(request: AssertByteLimitRequest): void {
  if (Buffer.byteLength(request.value, 'utf8') > request.maximumBytes) {
    throw new Error(
      `Executable skill ${request.label} exceeds its byte limit.`,
    );
  }
}

function boundedStderr(stderr: string): string {
  const normalized = stderr.trim().replaceAll(/[\r\n]+/gu, ' ');
  return normalized.slice(0, 512) || 'runner exited without an error message';
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
