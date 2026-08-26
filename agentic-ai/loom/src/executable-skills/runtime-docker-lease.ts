import path from 'node:path';
import type {
  BoundedProcessOutput,
  RunBoundedProcessRequest,
} from './source-analysis-process.ts';
import {
  throwExecutableSkillRuntimeFailure,
  type ThrowExecutableSkillRuntimeFailureRequest,
} from './runtime-failure.ts';

export type ExecutableSkillDockerLeaseExecutor = () => Promise<void>;

export type ExecuteWithExecutableSkillDockerLeaseRequest = {
  readonly cwd: string;
  readonly deadlineExpiresAt: number;
  readonly dockerExecutable: string;
  readonly endpoint: string;
  readonly execute: ExecutableSkillDockerLeaseExecutor;
  readonly executeProcess: (
    request: RunBoundedProcessRequest,
  ) => Promise<BoundedProcessOutput>;
  readonly ownerToken: string;
  readonly signal: AbortSignal | false;
};

const LEASE_NAME = 'nook-executable-skill-runtime-lease';
const LEASE_OWNER_LABEL = 'dev.nokey.loom.executable-skill.lease-owner';
const CONTROL_OUTPUT_BYTES = 64 * 1024;
const LEASE_REMOVAL_PHASE_MILLISECONDS = 2_000;

export async function executeWithExecutableSkillDockerLease(
  request: ExecuteWithExecutableSkillDockerLeaseRequest,
): Promise<void> {
  let ownsLease = false;
  try {
    assertLeaseRequest(request);
    await createDockerLease(request);
    ownsLease = (await readDockerLeaseOwner(request)) === request.ownerToken;
    if (!ownsLease) {
      throw new Error('Executable skill Docker lease is already owned.');
    }
    await request.execute();
  } catch (error) {
    const failureRequest: ThrowExecutableSkillRuntimeFailureRequest = {
      error:
        error instanceof Error
          ? error
          : 'Executable skill Docker lease failed.',
    };
    throwExecutableSkillRuntimeFailure(failureRequest);
  } finally {
    if (ownsLease) await removeOwnedDockerLease(request);
  }
}

async function createDockerLease(
  request: ExecuteWithExecutableSkillDockerLeaseRequest,
): Promise<void> {
  const arguments_ = [
    'volume',
    'create',
    '--label',
    `${LEASE_OWNER_LABEL}=${request.ownerToken}`,
    LEASE_NAME,
  ];
  const commandRequest: RunDockerLeaseCommandRequest = { arguments_, request };
  const output = await runDockerLeaseCommand(commandRequest);
  if (
    output.exitCode !== 0 ||
    output.stderr !== '' ||
    output.stdout.trim() !== LEASE_NAME
  ) {
    throw new Error('Executable skill Docker lease creation failed.');
  }
}

async function readDockerLeaseOwner(
  request: ExecuteWithExecutableSkillDockerLeaseRequest,
): Promise<string> {
  const arguments_ = [
    'volume',
    'inspect',
    '--format',
    `{{index .Labels "${LEASE_OWNER_LABEL}"}}`,
    LEASE_NAME,
  ];
  const commandRequest: RunDockerLeaseCommandRequest = { arguments_, request };
  const output = await runDockerLeaseCommand(commandRequest);
  const ownerToken = output.stdout.trim();
  if (
    output.exitCode !== 0 ||
    output.stderr !== '' ||
    !/^[0-9a-f]{32}$/u.test(ownerToken)
  ) {
    throw new Error('Executable skill Docker lease inspection failed.');
  }
  return ownerToken;
}

async function removeOwnedDockerLease(
  request: ExecuteWithExecutableSkillDockerLeaseRequest,
): Promise<void> {
  try {
    const removalRequest: ExecuteWithExecutableSkillDockerLeaseRequest = {
      ...request,
      signal: false,
    };
    const inspectionRequest: ExecuteWithExecutableSkillDockerLeaseRequest = {
      ...removalRequest,
      deadlineExpiresAt:
        removalRequest.deadlineExpiresAt - LEASE_REMOVAL_PHASE_MILLISECONDS,
    };
    if (
      (await readDockerLeaseOwner(inspectionRequest)) !== request.ownerToken
    ) {
      throw new Error('Executable skill Docker lease ownership drifted.');
    }
    const commandRequest: RunDockerLeaseCommandRequest = {
      arguments_: ['volume', 'rm', LEASE_NAME],
      request: removalRequest,
    };
    const output = await runDockerLeaseCommand(commandRequest);
    if (
      output.exitCode !== 0 ||
      output.stderr !== '' ||
      output.stdout.trim() !== LEASE_NAME
    ) {
      throw new Error('Executable skill Docker lease removal failed.');
    }
  } catch (error) {
    const failureRequest: ThrowExecutableSkillRuntimeFailureRequest = {
      error:
        error instanceof Error
          ? error
          : 'Executable skill Docker lease teardown failed.',
    };
    throwExecutableSkillRuntimeFailure(failureRequest);
  }
}

type RunDockerLeaseCommandRequest = {
  readonly arguments_: readonly string[];
  readonly request: ExecuteWithExecutableSkillDockerLeaseRequest;
};

async function runDockerLeaseCommand(
  commandRequest: RunDockerLeaseCommandRequest,
): Promise<BoundedProcessOutput> {
  const request = commandRequest.request;
  const processRequest: RunBoundedProcessRequest = {
    command: [
      request.dockerExecutable,
      '--host',
      request.endpoint,
      ...commandRequest.arguments_,
    ],
    cwd: request.cwd,
    deadlineExpiresAt: request.deadlineExpiresAt,
    maximumStderrBytes: CONTROL_OUTPUT_BYTES,
    maximumStdinBytes: 0,
    maximumStdoutBytes: CONTROL_OUTPUT_BYTES,
    signal: request.signal,
    stdin: false,
  };
  return await request.executeProcess(processRequest);
}

function assertLeaseRequest(
  request: ExecuteWithExecutableSkillDockerLeaseRequest,
): void {
  const endpointPath = request.endpoint.slice('unix://'.length);
  if (
    !request.endpoint.startsWith('unix:///') ||
    !path.isAbsolute(endpointPath) ||
    path.normalize(endpointPath) !== endpointPath ||
    endpointPath === '/' ||
    !/^[0-9a-f]{32}$/u.test(request.ownerToken) ||
    request.deadlineExpiresAt - Date.now() <= 1_000 ||
    (request.signal !== false && request.signal.aborted)
  ) {
    throw new Error('Executable skill Docker lease request is invalid.');
  }
}
