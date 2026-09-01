import { createHash } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

export async function teamPlanWorkspaceRoot(request: {
  readonly repositoryRoot: string;
  readonly journalPath: string;
}): Promise<string> {
  const identity = `${request.repositoryRoot}\n${resolve(request.journalPath)}`;
  const run = createHash('sha256').update(identity).digest('hex');
  const requested = resolve(tmpdir(), 'nook-team-plan-workspaces', run);
  await mkdir(requested, { recursive: true });
  return realpath(requested);
}
