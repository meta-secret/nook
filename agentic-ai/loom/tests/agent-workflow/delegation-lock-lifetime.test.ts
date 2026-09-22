import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DelegationRunJournal } from '../../src/agent-workflow/delegation-run-journal.ts';

test('released delegation locks cannot authorize another action or release twice', async () => {
  const runDirectory = await mkdtemp(join(tmpdir(), 'loom-lock-lifetime-'));
  try {
    const lease = await DelegationRunJournal.acquireDelegationLifecycleLock({
      runDirectory,
    });
    lease.assertHeld(runDirectory);
    await lease.release();
    expect(() => lease.assertHeld(runDirectory)).toThrow('not held');
    await expect(lease.release()).rejects.toThrow('already been released');
    const successor = await DelegationRunJournal.acquireDelegationLifecycleLock(
      { runDirectory },
    );
    successor.assertHeld(runDirectory);
    await successor.release();
  } finally {
    await rm(runDirectory, { recursive: true, force: true });
  }
});
