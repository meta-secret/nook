import { spawnSync } from 'node:child_process';
import { lstat, open, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
import type { ModuleDeliveryAttemptLease } from '../module-delivery/index.ts';
import type { TeamPlanAttemptIdentity } from './domain.ts';

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

export async function readBoundedTeamPlanFile(request: {
  readonly planPath: string;
  readonly maximumBytes: number;
}): Promise<Readonly<{ path: string; text: string }>> {
  const path = await realpath(resolve(request.planPath));
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > request.maximumBytes)
      throw new Error('Team Plan reviewed plan bytes are oversized.');
    const bytes = Buffer.alloc(request.maximumBytes + 1);
    const result = await handle.read(bytes, 0, bytes.length, 0);
    if (result.bytesRead > request.maximumBytes)
      throw new Error('Team Plan reviewed plan bytes are oversized.');
    return { path, text: bytes.subarray(0, result.bytesRead).toString('utf8') };
  } finally {
    await handle.close();
  }
}

export async function teamPlanPathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export function pinTeamPlanRef(identity: TeamPlanRefIdentity): void {
  const created = updateRefCompare({
    ...identity,
    expectedObject: '0'.repeat(40),
  });
  if (created) return;
  const unchanged = updateRefCompare({
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
  const options: SpawnSyncOptionsWithStringEncoding = {
    cwd: invocation.cwd,
    env: {},
    encoding: 'utf8',
    maxBuffer: Number.MAX_SAFE_INTEGER,
    stdio: ['pipe', 'pipe', 'pipe'],
  };
  if ('input' in invocation) options.input = invocation.input;
  const result = spawnSync('git', invocation.args, options);
  if (result.status !== 0)
    throw new Error(result.stderr.trim() || 'Team Plan Git operation failed.');
  return result.stdout.replace(/\0+$/u, '').trim();
}

function updateRefCompare(
  request: TeamPlanRefIdentity & Readonly<{ expectedObject: string }>,
): boolean {
  const result = spawnSync(
    'git',
    ['update-ref', request.ref, request.object, request.expectedObject],
    {
      cwd: request.repositoryRoot,
      env: {},
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  return result.status === 0;
}
