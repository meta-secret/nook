import { createHash } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';

function teamPlanWorkspaceIdentity(request: {
  readonly repositoryRoot: string;
  readonly journalPath: string;
}): string {
  const identity = `${request.repositoryRoot}\n${resolve(request.journalPath)}`;
  return createHash('sha256').update(identity).digest('hex');
}

export async function teamPlanWorkspaceRoot(request: {
  readonly repositoryRoot: string;
  readonly journalPath: string;
}): Promise<string> {
  const run = teamPlanWorkspaceIdentity(request);
  const requested = resolve(tmpdir(), 'nook-team-plan-workspaces', run);
  await mkdir(requested, { recursive: true });
  return realpath(requested);
}

export async function recoverTeamPlanWorkspaceRoot(request: {
  readonly repositoryRoot: string;
  readonly journalPath: string;
  readonly workspaceRoot: string;
}): Promise<string> {
  const expectedIdentity = teamPlanWorkspaceIdentity(request);
  if (
    basename(request.workspaceRoot) !== expectedIdentity ||
    basename(dirname(request.workspaceRoot)) !== 'nook-team-plan-workspaces'
  )
    throw new Error('Team Plan workspace root has drifted.');
  await mkdir(request.workspaceRoot, { recursive: true });
  const workspaceRoot = await realpath(request.workspaceRoot);
  if (workspaceRoot !== resolve(request.workspaceRoot))
    throw new Error('Team Plan workspace root has drifted.');
  return workspaceRoot;
}
