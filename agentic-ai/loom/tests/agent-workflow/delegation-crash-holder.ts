import { randomUUID } from 'node:crypto';
import { lstat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  acquireDelegationLifecycleLock,
  releaseDelegationLifecycleLock,
} from '../../src/agent-workflow/delegation-run-journal.ts';
import type { DelegationLifecycleLockInput } from '../../src/agent-workflow/delegation-run-journal.ts';

const EXCLUSIVE_UTF8_WRITE_OPTIONS: {
  readonly encoding: 'utf8';
  readonly flag: 'wx';
} = { encoding: 'utf8', flag: 'wx' };

const runDirectory = process.argv[2];
const readyPath = process.argv[3];
const boundary = process.argv[4];
const releasePath = process.argv[5];
if (!runDirectory || !readyPath || !boundary || !releasePath) {
  throw new Error('Crash holder arguments are required.');
}

const lockInput: DelegationLifecycleLockInput = { runDirectory };
const lease = await acquireDelegationLifecycleLock(lockInput);
if (boundary === 'temp-written') {
  const temporaryPath = join(
    runDirectory,
    `view.md.tmp-${process.pid}-${randomUUID()}`,
  );
  await writeFile(
    temporaryPath,
    '# Interrupted projection\n',
    EXCLUSIVE_UTF8_WRITE_OPTIONS,
  );
} else if (boundary !== 'lock-held') {
  throw new Error('Crash holder boundary is invalid.');
}
await writeFile(readyPath, 'ready\n', 'utf8');
while (!(await filesystemPathExists(releasePath))) {
  await Bun.sleep(10);
}
await releaseDelegationLifecycleLock(lease);

async function filesystemPathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
