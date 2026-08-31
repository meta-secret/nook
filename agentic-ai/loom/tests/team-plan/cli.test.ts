import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runTeamPlanCli } from '../../src/team-plan/cli.ts';

test('rejects non-files and oversized record requests before reading', async () => {
  const root = mkdtempSync(join(tmpdir(), 'team-plan-cli-'));
  const request = join(root, 'request.json');
  writeFileSync(request, 'x'.repeat(1_048_577));
  for (const path of [root, request])
    await expect(
      runTeamPlanCli([
        'record',
        '--journal',
        join(root, 'journal'),
        '--request',
        path,
      ]),
    ).rejects.toThrow('invalid or oversized');
  rmSync(root, { recursive: true });
});
