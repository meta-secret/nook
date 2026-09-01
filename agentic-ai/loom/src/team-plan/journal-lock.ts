import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { hostname } from 'node:os';

import type { TeamPlanJournal } from './journal.ts';

const ZERO_COMMIT = '0'.repeat(40);
const orphanedTeamPlanLocks = new Map<string, string>();

type TeamPlanLockOwnerFields = Readonly<{
  version: 3;
  pid: number;
  processIdentity: string;
  token: string;
}>;
type TeamPlanLockOwner = TeamPlanLockOwnerFields;
type TeamPlanGitArguments = readonly [string, string, string];
type TeamPlanLockRequest<T> = Readonly<{
  journal: TeamPlanJournal;
  identityPath: string;
  action: () => Promise<T>;
}>;
type GitInvocation = Readonly<{
  cwd: string;
  args: TeamPlanGitArguments;
  input?: string;
}>;

export function teamPlanLinuxNamespaceLockRecoverable(request: {
  readonly ownerIdentity: string;
  readonly currentMachineIdentity: string;
  readonly liveNamespaces: ReadonlySet<string>;
}): boolean {
  const current = /^([^:]+):([^:]+):(pid:\[[0-9]+\])$/u.exec(
    request.currentMachineIdentity,
  );
  if (!current) return false;
  const owner = /^([^:]+):([^:]+):(pid:\[[0-9]+\]):start-ticks:[0-9]+$/u.exec(
    request.ownerIdentity,
  );
  const currentBoot = current[2];
  const currentNamespace = current[3];
  const ownerBoot = owner?.[2];
  const ownerNamespace = owner?.[3];
  return Boolean(
    ownerBoot === currentBoot &&
    ownerNamespace &&
    ownerNamespace !== currentNamespace &&
    !request.liveNamespaces.has(ownerNamespace),
  );
}

export async function runWithTeamPlanJournalLock<T>(
  request: TeamPlanLockRequest<T>,
): Promise<T> {
  const identity = processStartIdentity(process.pid);
  if (!identity)
    throw new Error('Team Plan process lock identity is unavailable.');
  const owner: TeamPlanLockOwner = {
    version: 3,
    pid: process.pid,
    processIdentity: identity,
    token: randomUUID(),
  };
  const ownerBlob = gitText({
    cwd: request.journal.started.repositoryRoot,
    args: ['hash-object', '-w', '--stdin'],
    input: `${JSON.stringify(owner)}\n`,
  });
  const lockRef = teamPlanLockRef(request);
  let acquired = false;
  try {
    acquireTeamPlanLock({ journal: request.journal, lockRef, ownerBlob });
    acquired = true;
    return await request.action();
  } catch (error) {
    if (!acquired)
      throw new Error('Team Plan journal is already in use.', { cause: error });
    throw error;
  } finally {
    if (acquired)
      releaseTeamPlanLock({ journal: request.journal, lockRef, ownerBlob });
  }
}

function acquireTeamPlanLock(request: {
  readonly journal: TeamPlanJournal;
  readonly lockRef: string;
  readonly ownerBlob: string;
}): void {
  const { journal, lockRef, ownerBlob } = request;
  if (updateRef({ journal, args: [lockRef, ownerBlob, ZERO_COMMIT] })) return;
  const previousBlob = gitText({
    cwd: journal.started.repositoryRoot,
    args: ['rev-parse', '--verify', `${lockRef}^{blob}`],
  });
  const previousOwner = decodeLockOwner(
    gitText({
      cwd: journal.started.repositoryRoot,
      args: ['cat-file', 'blob', previousBlob],
    }),
  );
  if (
    orphanedTeamPlanLocks.get(lockRef) !== previousBlob &&
    !staleTeamPlanLock(previousOwner)
  )
    throw new Error('Team Plan journal lock owner is still live.');
  if (!updateRef({ journal, args: [lockRef, ownerBlob, previousBlob] }))
    throw new Error('Team Plan journal lock changed during stale recovery.');
  orphanedTeamPlanLocks.delete(lockRef);
}

function releaseTeamPlanLock(request: {
  readonly journal: TeamPlanJournal;
  readonly lockRef: string;
  readonly ownerBlob: string;
}): void {
  if (
    !updateRef({
      journal: request.journal,
      args: ['-d', request.lockRef, request.ownerBlob],
    })
  ) {
    orphanedTeamPlanLocks.set(request.lockRef, request.ownerBlob);
    throw new Error('Team Plan journal lock ownership changed.');
  }
}

function updateRef(request: {
  readonly journal: TeamPlanJournal;
  readonly args: TeamPlanGitArguments;
}): boolean {
  const args = request.args;
  const repositoryRoot = request.journal.started.repositoryRoot;
  const result = spawnSync(
    'git',
    ['update-ref', '--no-deref', args[0], args[1], args[2]],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        PATH: '/bin:/usr/bin:/usr/sbin',
        GIT_NO_REPLACE_OBJECTS: '1',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'safe.directory',
        GIT_CONFIG_VALUE_0: repositoryRoot,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  return result.status === 0;
}

function decodeLockOwner(serialized: string): TeamPlanLockOwner {
  let owner: TeamPlanLockOwner;
  try {
    owner = JSON.parse(serialized) as TeamPlanLockOwner;
  } catch (error) {
    throw new Error('Team Plan journal lock owner is malformed.', {
      cause: error,
    });
  }
  if (!owner || typeof owner !== 'object')
    throw new Error('Team Plan journal lock owner is malformed.');
  const ownerFields = Object.keys(owner).sort();
  if (
    JSON.stringify(ownerFields) !==
      JSON.stringify(['pid', 'processIdentity', 'token', 'version']) ||
    owner.version !== 3 ||
    !Number.isSafeInteger(owner.pid) ||
    owner.pid < 1 ||
    typeof owner.processIdentity !== 'string' ||
    owner.processIdentity.length < 1 ||
    typeof owner.token !== 'string' ||
    owner.token.length < 1
  )
    throw new Error('Team Plan journal lock owner is malformed.');
  return owner;
}

function staleTeamPlanLock(owner: TeamPlanLockOwner): boolean {
  const machineIdentity = processMachineIdentity();
  if (!machineIdentity) return false;
  let ownerMachineIdentity = machineIdentity;
  if (!owner.processIdentity.startsWith(`${ownerMachineIdentity}:`)) {
    const currentLinux = /^([^:]+):([^:]+):(pid:\[[0-9]+\])$/u.exec(
      machineIdentity,
    );
    const ownerLinux = /^([^:]+):([^:]+):(pid:\[[0-9]+\]):start-ticks:/u.exec(
      owner.processIdentity,
    );
    if (
      currentLinux &&
      ownerLinux &&
      currentLinux[2] === ownerLinux[2] &&
      currentLinux[3] === ownerLinux[3]
    ) {
      ownerMachineIdentity = owner.processIdentity.slice(
        0,
        owner.processIdentity.lastIndexOf(':start-ticks:'),
      );
    } else {
      const liveNamespaces = linuxLivePidNamespaces();
      if (
        liveNamespaces &&
        teamPlanLinuxNamespaceLockRecoverable({
          ownerIdentity: owner.processIdentity,
          currentMachineIdentity: machineIdentity,
          liveNamespaces,
        })
      )
        return true;
      return false;
    }
  }
  const currentIdentity = processStartIdentity(owner.pid);
  const preciseOwner = ['start-ticks', 'process-start'].some((kind) =>
    owner.processIdentity.startsWith(`${ownerMachineIdentity}:${kind}:`),
  );
  const preciseCurrent =
    currentIdentity &&
    ['start-ticks', 'process-start'].some((kind) =>
      currentIdentity.startsWith(`${machineIdentity}:${kind}:`),
    );
  if (owner.version === 3 && preciseOwner && preciseCurrent)
    return (
      `${ownerMachineIdentity}:${currentIdentity.slice(machineIdentity.length + 1)}` !==
      owner.processIdentity
    );
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    return nodeErrorCode(error as NodeJS.ErrnoException) === 'ESRCH';
  }
}

function teamPlanLockRef(request: {
  readonly journal: TeamPlanJournal;
  readonly identityPath: string;
}): string {
  const identity = `${request.journal.started.repositoryRoot}\n${request.identityPath}`;
  const run = createHash('sha256').update(identity).digest('hex');
  return `refs/nook/team-plan-locks/${run}`;
}

function gitText(invocation: GitInvocation): string {
  const args = invocation.args;
  const repositoryRoot = invocation.cwd;
  const result = spawnSync('git', [args[0], args[1], args[2]], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      PATH: '/bin:/usr/bin:/usr/sbin',
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'safe.directory',
      GIT_CONFIG_VALUE_0: repositoryRoot,
    },
    input: 'input' in invocation ? invocation.input : '',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0)
    throw new Error(result.stderr.trim() || 'Team Plan Git operation failed.');
  return result.stdout.trim();
}

function nodeErrorCode(error: NodeJS.ErrnoException): string | false {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = error.code;
  return typeof code === 'string' ? code : false;
}

function processStartIdentity(pid: number): string | false {
  const machineIdentity = processMachineIdentity();
  if (!machineIdentity) return false;
  if (process.platform === 'darwin') {
    const started = processStartTime(pid);
    return started ? `${machineIdentity}:process-start:${started}` : false;
  }
  if (process.platform !== 'linux') return false;
  const started = linuxProcessStartTicks(pid);
  return started ? `${machineIdentity}:start-ticks:${started}` : false;
}

function processStartTime(pid: number): string | false {
  const result = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
    encoding: 'utf8',
    env: { PATH: '/bin:/usr/bin:/usr/sbin' },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const started = result.status === 0 ? result.stdout.trim() : '';
  return started.length > 0 ? started : false;
}

function linuxProcessStartTicks(pid: number): string | false {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  } catch {
    return false;
  }
  const commandEnd = stat.lastIndexOf(') ');
  if (commandEnd < 1) return false;
  const fieldsAfterCommand = stat
    .slice(commandEnd + 2)
    .trim()
    .split(/\s+/u);
  const startTicks = fieldsAfterCommand[19];
  return startTicks && /^[0-9]+$/u.test(startTicks) ? startTicks : false;
}

function linuxLivePidNamespaces(): ReadonlySet<string> | false {
  if (process.platform !== 'linux') return false;
  let processes: readonly string[];
  try {
    processes = readdirSync('/proc').filter((entry) => /^[0-9]+$/u.test(entry));
  } catch {
    return false;
  }
  const namespaces = new Set<string>();
  for (const pid of processes) {
    try {
      const namespace = readlinkSync(`/proc/${pid}/ns/pid`);
      if (!/^pid:\[[0-9]+\]$/u.test(namespace)) return false;
      namespaces.add(namespace);
    } catch (error) {
      if (nodeErrorCode(error as NodeJS.ErrnoException) !== 'ENOENT')
        return false;
    }
  }
  return namespaces;
}

function processMachineIdentity(): string | false {
  let namespace = 'host';
  if (process.platform === 'linux') {
    try {
      namespace = readlinkSync('/proc/self/ns/pid');
    } catch {
      return false;
    }
    if (!/^pid:\[[0-9]+\]$/u.test(namespace)) return false;
  }
  const boot = (
    process.platform === 'darwin'
      ? spawnSync('sysctl', ['-n', 'kern.boottime'], {
          encoding: 'utf8',
          env: { PATH: '/bin:/usr/bin:/usr/sbin' },
          stdio: ['ignore', 'pipe', 'ignore'],
        })
      : spawnSync('cat', ['/proc/sys/kernel/random/boot_id'], {
          encoding: 'utf8',
          env: { PATH: '/bin:/usr/bin:/usr/sbin' },
          stdio: ['ignore', 'pipe', 'ignore'],
        })
  ).stdout.trim();
  return boot ? `${hostname()}:${boot}:${namespace}` : false;
}
