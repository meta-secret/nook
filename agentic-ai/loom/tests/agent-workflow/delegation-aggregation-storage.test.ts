import { describe, expect, test } from 'bun:test';

import { randomUUID } from 'node:crypto';

import {
  mkdir,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { TaskTerminalKind } from '../../src/agent-workflow/domain.ts';

import { DelegationRunFinalization } from '../../src/agent-workflow/delegation-aggregation.ts';

import { DelegationRunJournal } from '../../src/agent-workflow/delegation-run-journal.ts';

import type { DelegationLifecycleLockInput } from '../../src/agent-workflow/delegation-run-journal.ts';

import {
  AgentWorkflowDelegationAggregationScenario,
  REMOVE_OPTIONS,
  RECURSIVE_DIRECTORY_OPTIONS,
} from './delegation-aggregation-fixtures.ts';

import type {
  AdmissionForInput,
  CrashBoundary,
  FixtureInput,
  KillCrashHolderInput,
} from './delegation-aggregation-fixtures.ts';

describe('delegation aggregation storage and lifecycle safety', () => {
  test('rejects unplanned attempt storage without materializing closure', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'loom-aggregate-'));
    try {
      const fixtureInput: FixtureInput = {
        workingDirectory,
        runId: 'unplanned-evidence',
        leafKind: TaskTerminalKind.Cancelled,
      };
      const fixture =
        await AgentWorkflowDelegationAggregationScenario.completeFixture(
          fixtureInput,
        );
      await mkdir(
        join(fixture.runDirectory, 'agents', 'unplanned', 'attempt-1'),
        RECURSIVE_DIRECTORY_OPTIONS,
      );
      await expect(
        DelegationRunFinalization.finalizeDelegationRun(
          fixture.finalizationInput,
        ),
      ).rejects.toThrow('unplanned attempt evidence');
    } finally {
      await rm(workingDirectory, REMOVE_OPTIONS);
    }
  });

  test('never overwrites a conflicting run projection', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'loom-aggregate-'));
    try {
      const fixtureInput: FixtureInput = {
        workingDirectory,
        runId: 'conflicting-projection',
        leafKind: TaskTerminalKind.Skipped,
      };
      const fixture =
        await AgentWorkflowDelegationAggregationScenario.completeFixture(
          fixtureInput,
        );
      await writeFile(
        join(fixture.runDirectory, 'view.md'),
        '# Conflicting view\n',
        'utf8',
      );
      await expect(
        DelegationRunFinalization.finalizeDelegationRun(
          fixture.finalizationInput,
        ),
      ).rejects.toThrow('projection is not exact');
    } finally {
      await rm(workingDirectory, REMOVE_OPTIONS);
    }
  });

  test('removes stale temporary projections even when their PID is live', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'loom-aggregate-'));
    try {
      const fixtureInput: FixtureInput = {
        workingDirectory,
        runId: 'reused-temp-pid',
        leafKind: TaskTerminalKind.Blocked,
      };
      const fixture =
        await AgentWorkflowDelegationAggregationScenario.completeFixture(
          fixtureInput,
        );
      const stalePath = join(
        fixture.runDirectory,
        `view.md.tmp-${process.pid}-${randomUUID()}`,
      );
      await writeFile(stalePath, '# Stale projection\n', 'utf8');

      const receipt = await DelegationRunFinalization.finalizeDelegationRun(
        fixture.finalizationInput,
      );

      await expect(stat(stalePath)).rejects.toThrow();
      expect(await readFile(receipt.viewPath, 'utf8')).toContain(
        '# Root aggregate',
      );
    } finally {
      await rm(workingDirectory, REMOVE_OPTIONS);
    }
  });

  test('recovers killed lock owners and their written temporary projections', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'loom-aggregate-'));
    const boundaries: readonly CrashBoundary[] = [
      CrashBoundary.LockHeld,
      CrashBoundary.TempWritten,
    ];
    try {
      for (const boundary of boundaries) {
        const fixtureInput: FixtureInput = {
          workingDirectory,
          runId: `crash-${boundary}`,
          leafKind: TaskTerminalKind.Failed,
        };
        const fixture =
          await AgentWorkflowDelegationAggregationScenario.completeFixture(
            fixtureInput,
          );
        const crashInput: KillCrashHolderInput = {
          runDirectory: fixture.runDirectory,
          boundary,
        };
        await AgentWorkflowDelegationAggregationScenario.killCrashHolder(
          crashInput,
        );
        if (boundary === CrashBoundary.LockHeld) {
          await AgentWorkflowDelegationAggregationScenario.proveConcurrentSuccessorSerialization(
            fixture.runDirectory,
          );
          const admissionFixture: AdmissionForInput = {
            workingDirectory,
            plan: fixture.plan,
            declaration: AgentWorkflowDelegationAggregationScenario.itemAt([
              fixture.plan.attempts,
              0,
            ]),
          };
          await DelegationRunJournal.admitDelegationAttempt(
            AgentWorkflowDelegationAggregationScenario.admissionFor(
              admissionFixture,
            ),
          );
        }
        const receipt = await DelegationRunFinalization.finalizeDelegationRun(
          fixture.finalizationInput,
        );
        expect(await readFile(receipt.viewPath, 'utf8')).toContain(
          '# Root aggregate',
        );
        const entries = await readdir(fixture.runDirectory);
        expect(entries.some((entry) => entry.includes('.tmp-'))).toBe(false);
        expect(
          (
            await stat(join(fixture.runDirectory, '.delegation.lock.sqlite'))
          ).isFile(),
        ).toBe(true);
      }
    } finally {
      await rm(workingDirectory, REMOVE_OPTIONS);
    }
  });

  test('rejects symlinked and oversized lifecycle databases without replacing them', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'loom-lock-'));
    try {
      const runDirectory = join(workingDirectory, 'run');
      await mkdir(runDirectory);
      const lockPath = join(runDirectory, '.delegation.lock.sqlite');
      const linkedRunDirectory = join(workingDirectory, 'linked-run');
      await symlink(runDirectory, linkedRunDirectory);
      const linkedRunLockInput: DelegationLifecycleLockInput = {
        runDirectory: linkedRunDirectory,
      };
      await expect(
        DelegationRunJournal.acquireDelegationLifecycleLock(linkedRunLockInput),
      ).rejects.toThrow('run directory is unsafe');
      await expect(stat(lockPath)).rejects.toThrow();

      const targetPath = join(workingDirectory, 'external-lock.sqlite');
      const targetContent = 'external lock target\n';
      await writeFile(targetPath, targetContent, 'utf8');
      await symlink(targetPath, lockPath);
      const lockInput: DelegationLifecycleLockInput = { runDirectory };
      await expect(
        DelegationRunJournal.acquireDelegationLifecycleLock(lockInput),
      ).rejects.toThrow('lock acquisition failed');
      expect(await readFile(targetPath, 'utf8')).toBe(targetContent);
      expect((await lstat(lockPath)).isSymbolicLink()).toBe(true);

      await rm(lockPath);
      const oversizedDatabase = 'x'.repeat(1025);
      await writeFile(lockPath, oversizedDatabase, 'utf8');
      await expect(
        DelegationRunJournal.acquireDelegationLifecycleLock(lockInput),
      ).rejects.toThrow('lock acquisition failed');
      expect(await readFile(lockPath, 'utf8')).toBe(oversizedDatabase);
    } finally {
      await rm(workingDirectory, REMOVE_OPTIONS);
    }
  });
});
