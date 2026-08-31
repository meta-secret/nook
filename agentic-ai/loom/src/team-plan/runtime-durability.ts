import { O_NONBLOCK, O_RDONLY } from 'node:constants';
import { open, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

import { LoomFailureCode, loomFailureFromCause } from '../loom-failure.ts';
import {
  gitText,
  moduleDeliveryGitEnvironment,
  runModuleDeliveryGit,
} from '../module-delivery/git-command.ts';

import type { ModuleDeliveryAttemptLease } from '../module-delivery/index.ts';
import type { TeamPlanAttemptIdentity } from './domain.ts';
import { TeamPlanRecordKind } from './domain.ts';

export enum TeamPlanObjectType {
  Blob = 'blob',
  Commit = 'commit',
}

export type TeamPlanRunIdentity = Readonly<{
  repositoryRoot: string;
  runId: string;
}>;

export type TeamPlanRefIdentity = TeamPlanRunIdentity &
  Readonly<{
    ref: string;
    object: string;
  }>;

export type TeamPlanByteReader = Readonly<{
  read: (request: {
    readonly buffer: Buffer;
    readonly offset: number;
    readonly length: number;
    readonly position: number;
  }) => Promise<Readonly<{ bytesRead: number }>>;
}>;

export type ReadBoundedTeamPlanFileRequest = Readonly<{
  planPath: string;
  maximumBytes: number;
}>;

const TEAM_PLAN_GIT_ENVIRONMENT = moduleDeliveryGitEnvironment();

export async function readBoundedTeamPlanBytes(request: {
  readonly reader: TeamPlanByteReader;
  readonly maximumBytes: number;
}): Promise<Buffer> {
  const bytes = Buffer.alloc(request.maximumBytes + 1);
  let total = 0;
  while (total < bytes.length) {
    const result = await request.reader.read({
      buffer: bytes,
      offset: total,
      length: bytes.length - total,
      position: total,
    });
    if (!Number.isSafeInteger(result.bytesRead) || result.bytesRead < 0)
      throw new Error('Team Plan plan reader returned an invalid byte count.');
    if (result.bytesRead === 0) break;
    total += result.bytesRead;
  }
  if (total > request.maximumBytes)
    throw loomFailureFromCause({
      code: LoomFailureCode.TeamPlanValidationFailed,
      cause: new Error('Team Plan reviewed plan bytes are oversized.'),
    });
  return bytes.subarray(0, total);
}

export async function readBoundedTeamPlanFile(
  request: ReadBoundedTeamPlanFileRequest,
): Promise<Readonly<{ path: string; text: string }>> {
  let path: string;
  try {
    path = await realpath(resolve(request.planPath));
  } catch (cause) {
    throw loomFailureFromCause({
      code: LoomFailureCode.TeamPlanStorageFailed,
      cause: cause instanceof Error ? cause : new Error('Plan path failed.'),
    });
  }
  let handle;
  try {
    handle = await open(path, O_RDONLY | O_NONBLOCK);
  } catch (cause) {
    throw loomFailureFromCause({
      code: LoomFailureCode.TeamPlanStorageFailed,
      cause: cause instanceof Error ? cause : new Error('Plan open failed.'),
    });
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile())
      throw loomFailureFromCause({
        code: LoomFailureCode.TeamPlanValidationFailed,
        cause: new Error('Team Plan reviewed plan path is not a regular file.'),
      });
    if (stat.size > request.maximumBytes)
      throw loomFailureFromCause({
        code: LoomFailureCode.TeamPlanValidationFailed,
        cause: new Error('Team Plan reviewed plan bytes are oversized.'),
      });
    const bytes = await readBoundedTeamPlanBytes({
      reader: {
        read: ({ buffer, offset, length, position }) =>
          handle.read(buffer, offset, length, position),
      },
      maximumBytes: request.maximumBytes,
    });
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (cause) {
      throw loomFailureFromCause({
        code: LoomFailureCode.TeamPlanValidationFailed,
        cause:
          cause instanceof Error ? cause : new Error('UTF-8 decode failed.'),
      });
    }
    return { path, text };
  } catch (cause) {
    throw loomFailureFromCause({
      code: LoomFailureCode.TeamPlanStorageFailed,
      cause: cause instanceof Error ? cause : new Error('Plan read failed.'),
    });
  } finally {
    await handle.close();
  }
}

export function pinTeamPlanRef(identity: TeamPlanRefIdentity): void {
  const created = compareAndSwapTeamPlanRef({
    ...identity,
    expectedObject: '0'.repeat(40),
  });
  if (created) return;
  const unchanged = compareAndSwapTeamPlanRef({
    ...identity,
    expectedObject: identity.object,
  });
  if (
    !unchanged ||
    teamPlanGitText({
      cwd: identity.repositoryRoot,
      args: ['rev-parse', '--verify', identity.ref],
    }) !== identity.object
  )
    throw new Error('Team Plan durable run ref already differs.');
}

export function assertTeamPlanRef(
  identity: TeamPlanRefIdentity & Readonly<{ objectType: TeamPlanObjectType }>,
): void {
  const resolved = teamPlanGitText({
    cwd: identity.repositoryRoot,
    args: ['rev-parse', '--verify', `${identity.ref}^{${identity.objectType}}`],
  });
  if (resolved !== identity.object)
    throw new Error('Team Plan durable run ref has drifted.');
}

export function deleteTeamPlanRunRefs(request: {
  readonly run: TeamPlanRunIdentity;
  readonly expected: readonly TeamPlanRefIdentity[];
}): void {
  const prefix = teamPlanRunRefPrefix(request.run);
  const actual = teamPlanGitText({
    cwd: request.run.repositoryRoot,
    args: ['for-each-ref', '--format=%(refname)%09%(objectname)', `${prefix}/`],
  });
  const expected = request.expected
    .map(({ ref, object }) => `${ref}\t${object}`)
    .sort()
    .join('\n');
  if (actual.split('\n').filter(Boolean).sort().join('\n') !== expected)
    throw new Error('Team Plan durable run refs are incomplete or forged.');
  if (request.expected.length === 0) return;
  teamPlanGitText({
    cwd: request.run.repositoryRoot,
    args: ['update-ref', '--stdin'],
    input: `start\n${request.expected
      .map(({ ref, object }) => `delete ${ref} ${object}`)
      .join('\n')}\nprepare\ncommit\n`,
  });
}

export function teamPlanRunRefsEmpty(run: TeamPlanRunIdentity): boolean {
  return (
    teamPlanGitText({
      cwd: run.repositoryRoot,
      args: ['for-each-ref', teamPlanRunRefPrefix(run)],
    }) === ''
  );
}

export function teamPlanRunRefPrefix(run: TeamPlanRunIdentity): string {
  return `refs/nook/team-plan/${run.runId}`;
}

export function deleteTeamPlanAttemptArtifactOrphans(request: {
  readonly run: TeamPlanRunIdentity;
  readonly attempt: TeamPlanAttemptIdentity;
}): void {
  const { run, attempt } = request;
  const prefix = `${teamPlanRunRefPrefix(run)}/${attempt.generation}/${attempt.taskId}/${attempt.attempt}`;
  const actual = teamPlanGitText({
    cwd: run.repositoryRoot,
    args: ['for-each-ref', '--format=%(refname)%09%(objectname)', `${prefix}/`],
  });
  if (!actual) return;
  const allowed = new Set([
    `${prefix}/${TeamPlanRecordKind.AcceptedWrite}`,
    `${prefix}/${TeamPlanRecordKind.AcceptedEvidence}`,
  ]);
  const refs = actual.split('\n').map((line) => {
    const fields = line.split('\t');
    const ref = fields[0];
    const object = fields[1];
    if (fields.length !== 2 || !ref || !object || !allowed.has(ref))
      throw new Error('Team Plan attempt artifact ref is forged.');
    return { ref, object };
  });
  teamPlanGitText({
    cwd: run.repositoryRoot,
    args: ['update-ref', '--stdin'],
    input: `start\n${refs
      .map(({ ref, object }) => `delete ${ref} ${object}`)
      .join('\n')}\nprepare\ncommit\n`,
  });
}

export function deleteTeamPlanLeaseFrontierOrphans(request: {
  readonly run: TeamPlanRunIdentity;
  readonly expectedRefs: ReadonlySet<string>;
}): void {
  const prefix = `${teamPlanRunRefPrefix(request.run)}/frontiers/`;
  const actual = teamPlanGitText({
    cwd: request.run.repositoryRoot,
    args: ['for-each-ref', '--format=%(refname)%09%(objectname)', prefix],
  });
  const orphans = actual
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const fields = line.split('\t');
      const ref = fields[0];
      const object = fields[1];
      if (
        fields.length !== 2 ||
        !ref ||
        !object ||
        !/^refs\/nook\/team-plan\/[0-9a-f]{64}\/frontiers\/[1-9][0-9]*\/[^/]+\/[1-9][0-9]*$/u.test(
          ref,
        )
      )
        throw new Error('Team Plan lease frontier ref is forged.');
      return { ref, object };
    })
    .filter(({ ref }) => !request.expectedRefs.has(ref));
  if (orphans.length === 0) return;
  teamPlanGitText({
    cwd: request.run.repositoryRoot,
    args: ['update-ref', '--stdin'],
    input: `start\n${orphans
      .map(({ ref, object }) => `delete ${ref} ${object}`)
      .join('\n')}\nprepare\ncommit\n`,
  });
}

export function pinTeamPlanLeaseFrontier(request: {
  readonly run: TeamPlanRunIdentity;
  readonly lease: ModuleDeliveryAttemptLease;
}): void {
  pinTeamPlanRef({
    ...request.run,
    ref: teamPlanLeaseFrontierRef({
      run: request.run,
      attempt: request.lease,
    }),
    object: request.lease.startingFrontier,
  });
}

export function assertTeamPlanLeaseFrontier(request: {
  readonly run: TeamPlanRunIdentity;
  readonly lease: ModuleDeliveryAttemptLease;
}): void {
  assertTeamPlanRef({
    ...request.run,
    ref: teamPlanLeaseFrontierRef({
      run: request.run,
      attempt: request.lease,
    }),
    object: request.lease.startingFrontier,
    objectType: TeamPlanObjectType.Commit,
  });
}

export function teamPlanLeaseFrontierRef(request: {
  readonly run: TeamPlanRunIdentity;
  readonly attempt: TeamPlanAttemptIdentity;
}): string {
  return `${teamPlanRunRefPrefix(request.run)}/frontiers/${request.attempt.generation}/${request.attempt.taskId}/${request.attempt.attempt}`;
}

export function teamPlanFinalizedHeadRef(run: TeamPlanRunIdentity): string {
  return `${teamPlanRunRefPrefix(run)}/finalized`;
}

export function pinTeamPlanFinalizedHead(request: {
  readonly run: TeamPlanRunIdentity;
  readonly headCommit: string;
}): void {
  pinTeamPlanRef({
    ...request.run,
    ref: teamPlanFinalizedHeadRef(request.run),
    object: request.headCommit,
  });
}

export function assertTeamPlanFinalizedHead(request: {
  readonly run: TeamPlanRunIdentity;
  readonly headCommit: string;
}): void {
  assertTeamPlanRef({
    ...request.run,
    ref: teamPlanFinalizedHeadRef(request.run),
    object: request.headCommit,
    objectType: TeamPlanObjectType.Commit,
  });
}

export function teamPlanGitText(invocation: {
  readonly cwd: string;
  readonly args: readonly string[];
  readonly input?: string;
}): string {
  try {
    return gitText(
      runModuleDeliveryGit({
        ...invocation,
        environment: TEAM_PLAN_GIT_ENVIRONMENT,
      }),
    );
  } catch (cause) {
    throw loomFailureFromCause({
      code: LoomFailureCode.TeamPlanCommandFailed,
      cause: cause instanceof Error ? cause : new Error('Git failed.'),
    });
  }
}

export function compareAndSwapTeamPlanRef(
  request: TeamPlanRefIdentity & Readonly<{ expectedObject: string }>,
): boolean {
  let result;
  try {
    result = runModuleDeliveryGit({
      cwd: request.repositoryRoot,
      args: ['update-ref', request.ref, request.object, request.expectedObject],
      allowFailure: true,
      environment: TEAM_PLAN_GIT_ENVIRONMENT,
    });
  } catch (cause) {
    throw loomFailureFromCause({
      code: LoomFailureCode.TeamPlanCommandFailed,
      cause: cause instanceof Error ? cause : new Error('Git failed.'),
    });
  }
  if (result.exitCode === 0) return true;
  const resolved = runModuleDeliveryGit({
    cwd: request.repositoryRoot,
    args: ['rev-parse', '--verify', request.ref],
    allowFailure: true,
    environment: TEAM_PLAN_GIT_ENVIRONMENT,
  });
  if (resolved.exitCode === 0 && gitText(resolved) !== request.expectedObject)
    return false;
  throw loomFailureFromCause({
    code: LoomFailureCode.TeamPlanCommandFailed,
    cause: new Error(
      result.stderr || `Git update-ref failed (${result.exitCode}).`,
    ),
  });
}
