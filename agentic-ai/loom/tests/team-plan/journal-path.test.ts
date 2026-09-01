import { afterEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadTeamPlanJournal } from '../../src/team-plan/journal.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0).reverse())
    rmSync(root, { recursive: true, force: true });
});

test('rejects absent and non-regular journal paths without mutation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nook-team-plan-journal-path-'));
  roots.push(root);
  const missingParent = join(root, 'missing-parent');
  await expect(
    loadTeamPlanJournal(join(missingParent, 'journal.jsonl')),
  ).rejects.toThrow();
  expect(existsSync(missingParent)).toBe(false);
  const fifo = join(root, 'journal.fifo');
  expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
  await expect(loadTeamPlanJournal(fifo)).rejects.toThrow('unsafe');
});
