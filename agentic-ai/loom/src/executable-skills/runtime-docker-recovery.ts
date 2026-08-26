import type {
  BoundedProcessOutput,
  RunBoundedProcessRequest,
} from './source-analysis-process.ts';
import { EXECUTABLE_SKILL_OWNER_LABEL } from './runtime-docker-plan.ts';

export type ExecutableSkillDockerRecoveryRequest = {
  readonly cwd: string;
  readonly deadlineExpiresAt: number;
  readonly dockerExecutable: string;
  readonly endpoint: string;
  readonly executeProcess: (
    request: RunBoundedProcessRequest,
  ) => Promise<BoundedProcessOutput>;
  readonly killProcessGroup: (processGroupId: number) => void;
  readonly userId: number;
};

type StaleDockerProcess = {
  readonly command: string;
  readonly processGroupId: number;
  readonly processId: number;
  readonly startedAt: string;
};

type DockerResource = {
  readonly name: string;
  readonly ownerToken: string;
};

const CONTROL_OUTPUT_BYTES = 512 * 1024;
const RECOVERY_PASSES = 4;

export async function recoverStaleExecutableSkillDockerResources(
  request: ExecutableSkillDockerRecoveryRequest,
): Promise<void> {
  let cleanPasses = 0;
  for (let pass = 0; pass < RECOVERY_PASSES; pass += 1) {
    const processCount = await terminateStaleDockerProcesses(request);
    const containerCount = await removeStaleContainers(request);
    const imageCount = await removeStaleImages(request);
    if (processCount + containerCount + imageCount === 0) cleanPasses += 1;
    else cleanPasses = 0;
    if (cleanPasses === 2) return;
  }
  throw new Error('Executable skill stale resource recovery did not converge.');
}

async function terminateStaleDockerProcesses(
  request: ExecutableSkillDockerRecoveryRequest,
): Promise<number> {
  const first = await listStaleDockerProcesses(request);
  for (const candidate of first) {
    const current = (await listStaleDockerProcesses(request)).find(
      (process_) => process_.processId === candidate.processId,
    );
    if (
      current &&
      current.processGroupId === candidate.processGroupId &&
      current.processId === current.processGroupId &&
      current.startedAt === candidate.startedAt &&
      current.command === candidate.command
    ) {
      try {
        request.killProcessGroup(candidate.processGroupId);
      } catch {
        // A group may exit after identity revalidation; the rescan is decisive.
      }
    }
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const remaining = await listStaleDockerProcesses(request);
    if (remaining.length === 0) return first.length;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Executable skill stale Docker process remains active.');
}

async function listStaleDockerProcesses(
  request: ExecutableSkillDockerRecoveryRequest,
): Promise<readonly StaleDockerProcess[]> {
  const processRequest: RunBoundedProcessRequest = {
    command: ['/bin/ps', '-axo', 'uid=,pid=,pgid=,lstart=,command='],
    cwd: request.cwd,
    deadlineExpiresAt: request.deadlineExpiresAt,
    maximumStderrBytes: CONTROL_OUTPUT_BYTES,
    maximumStdinBytes: 0,
    maximumStdoutBytes: CONTROL_OUTPUT_BYTES,
    signal: false,
    stdin: false,
  };
  const output = await request.executeProcess(processRequest);
  if (output.exitCode !== 0 || output.stderr !== '') {
    throw new Error('Executable skill stale process inventory failed.');
  }
  const prefix = `${request.dockerExecutable} --host ${request.endpoint} `;
  const processes: StaleDockerProcess[] = [];
  for (const line of output.stdout.split('\n')) {
    const match = line.match(
      /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.+)$/u,
    );
    if (!match) continue;
    const userId = Number(match[1]);
    const processId = Number(match[2]);
    const processGroupId = Number(match[3]);
    const startedAt = match[4] ?? '';
    const command = match[5] ?? '';
    if (
      userId !== request.userId ||
      !Number.isSafeInteger(processId) ||
      processId <= 1 ||
      !Number.isSafeInteger(processGroupId) ||
      processGroupId <= 1 ||
      !command.startsWith(prefix) ||
      !hasExecutableSkillOwnerToken(command)
    ) {
      continue;
    }
    const process_: StaleDockerProcess = {
      command,
      processGroupId,
      processId,
      startedAt,
    };
    processes.push(Object.freeze(process_));
  }
  return Object.freeze(processes);
}

function hasExecutableSkillOwnerToken(command: string): boolean {
  return /(?:nook-executable-skill-runtime-|nook-executable-skill:|dev\.nokey\.loom\.executable-skill\.owner=)[0-9a-f]{32}(?:\s|$)/u.test(
    command,
  );
}

async function removeStaleContainers(
  request: ExecutableSkillDockerRecoveryRequest,
): Promise<number> {
  const listRequest: ListDockerResourcesRequest = {
    arguments_: [
      'container',
      'ls',
      '--all',
      '--filter',
      `label=${EXECUTABLE_SKILL_OWNER_LABEL}`,
      '--format',
      `{{.Names}}|{{.Label "${EXECUTABLE_SKILL_OWNER_LABEL}"}}`,
    ],
    request,
  };
  const resources = await listDockerResources(listRequest);
  for (const resource of resources) {
    const removalRequest: RemoveOwnedDockerResourceRequest = {
      absentMarkers: ['No such container', 'No such object'],
      inspectKind: 'container',
      removeArguments: ['rm', '--force', resource.name],
      request,
      resource,
    };
    await removeOwnedDockerResource(removalRequest);
  }
  return resources.length;
}

async function removeStaleImages(
  request: ExecutableSkillDockerRecoveryRequest,
): Promise<number> {
  const imageListRequest: RunRecoveryDockerCommandRequest = {
    arguments_: [
      'image',
      'ls',
      '--filter',
      `label=${EXECUTABLE_SKILL_OWNER_LABEL}`,
      '--format',
      '{{.Repository}}:{{.Tag}}',
    ],
    request,
  };
  const names = await runRecoveryDockerCommand(imageListRequest);
  if (names.exitCode !== 0 || names.stderr !== '') {
    throw new Error('Executable skill stale image inventory failed.');
  }
  const resources: DockerResource[] = [];
  for (const name of new Set(names.stdout.split('\n').filter(Boolean))) {
    const inspectionRequest: InspectDockerResourceOwnerRequest = {
      inspectKind: 'image',
      request,
      resourceName: name,
    };
    const owner = await inspectDockerResourceOwner(inspectionRequest);
    if (name !== `nook-executable-skill:${owner}`) {
      throw new Error('Executable skill stale image identity is invalid.');
    }
    const resource: DockerResource = { name, ownerToken: owner };
    resources.push(Object.freeze(resource));
  }
  for (const resource of resources) {
    const removalRequest: RemoveOwnedDockerResourceRequest = {
      absentMarkers: ['No such image', 'No such object'],
      inspectKind: 'image',
      removeArguments: ['image', 'rm', '--force', resource.name],
      request,
      resource,
    };
    await removeOwnedDockerResource(removalRequest);
  }
  return resources.length;
}

type ListDockerResourcesRequest = {
  readonly arguments_: readonly string[];
  readonly request: ExecutableSkillDockerRecoveryRequest;
};

async function listDockerResources(
  command: ListDockerResourcesRequest,
): Promise<readonly DockerResource[]> {
  const output = await runRecoveryDockerCommand(command);
  if (output.exitCode !== 0 || output.stderr !== '') {
    throw new Error('Executable skill stale resource inventory failed.');
  }
  const resources: DockerResource[] = [];
  for (const line of output.stdout.split('\n').filter(Boolean)) {
    const fields = line.split('|');
    const name = fields[0] ?? '';
    const ownerToken = fields[1] ?? '';
    if (
      !/^[0-9a-f]{32}$/u.test(ownerToken) ||
      name !== `nook-executable-skill-runtime-${ownerToken}`
    ) {
      throw new Error('Executable skill stale resource inventory is invalid.');
    }
    const resource: DockerResource = { name, ownerToken };
    resources.push(Object.freeze(resource));
  }
  return Object.freeze(resources);
}

type InspectDockerResourceOwnerRequest = {
  readonly inspectKind: 'container' | 'image';
  readonly request: ExecutableSkillDockerRecoveryRequest;
  readonly resourceName: string;
};

async function inspectDockerResourceOwner(
  inspection: InspectDockerResourceOwnerRequest,
): Promise<string> {
  const commandRequest: RunRecoveryDockerCommandRequest = {
    arguments_: [
      inspection.inspectKind,
      'inspect',
      '--format',
      `{{index .Config.Labels "${EXECUTABLE_SKILL_OWNER_LABEL}"}}`,
      inspection.resourceName,
    ],
    request: inspection.request,
  };
  const output = await runRecoveryDockerCommand(commandRequest);
  const ownerToken = output.stdout.trim();
  if (
    output.exitCode !== 0 ||
    output.stderr !== '' ||
    !/^[0-9a-f]{32}$/u.test(ownerToken)
  ) {
    throw new Error('Executable skill stale resource owner is invalid.');
  }
  return ownerToken;
}

type RemoveOwnedDockerResourceRequest = {
  readonly absentMarkers: readonly string[];
  readonly inspectKind: 'container' | 'image';
  readonly removeArguments: readonly string[];
  readonly request: ExecutableSkillDockerRecoveryRequest;
  readonly resource: DockerResource;
};

async function removeOwnedDockerResource(
  removal: RemoveOwnedDockerResourceRequest,
): Promise<void> {
  const inspectionRequest: InspectDockerResourceOwnerRequest = {
    inspectKind: removal.inspectKind,
    request: removal.request,
    resourceName: removal.resource.name,
  };
  const owner = await inspectDockerResourceOwner(inspectionRequest);
  if (owner !== removal.resource.ownerToken) {
    throw new Error('Executable skill stale resource ownership drifted.');
  }
  const removalRequest: RunRecoveryDockerCommandRequest = {
    arguments_: removal.removeArguments,
    request: removal.request,
  };
  const output = await runRecoveryDockerCommand(removalRequest);
  if (output.exitCode !== 0 || output.stderr !== '') {
    throw new Error('Executable skill stale resource removal failed.');
  }
  const confirmationRequest: RunRecoveryDockerCommandRequest = {
    arguments_: [removal.inspectKind, 'inspect', removal.resource.name],
    request: removal.request,
  };
  const confirmation = await runRecoveryDockerCommand(confirmationRequest);
  if (
    confirmation.exitCode === 0 ||
    confirmation.stdout.trim() !== '' ||
    !removal.absentMarkers.some((marker) =>
      confirmation.stderr.includes(marker),
    )
  ) {
    throw new Error('Executable skill stale resource remains present.');
  }
}

type RunRecoveryDockerCommandRequest = {
  readonly arguments_: readonly string[];
  readonly request: ExecutableSkillDockerRecoveryRequest;
};

async function runRecoveryDockerCommand(
  command: RunRecoveryDockerCommandRequest,
): Promise<BoundedProcessOutput> {
  const processRequest: RunBoundedProcessRequest = {
    command: [
      command.request.dockerExecutable,
      '--host',
      command.request.endpoint,
      ...command.arguments_,
    ],
    cwd: command.request.cwd,
    deadlineExpiresAt: command.request.deadlineExpiresAt,
    maximumStderrBytes: CONTROL_OUTPUT_BYTES,
    maximumStdinBytes: 0,
    maximumStdoutBytes: CONTROL_OUTPUT_BYTES,
    signal: false,
    stdin: false,
  };
  return await command.request.executeProcess(processRequest);
}
