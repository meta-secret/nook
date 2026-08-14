import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import type { RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  AgentSourceStabilityPhase,
  assertAgentSourceStable,
} from '../../src/agent-workflow/codex-runtime.ts';
import type { AgentSourceStabilityCheck } from '../../src/agent-workflow/codex-runtime.ts';
import { runCommand } from '../../src/lib/run.ts';
import type { RunCommandArgs } from '../../src/lib/run.ts';

function runGit(command: RunCommandArgs): string {
  const result = runCommand(command);
  expect(result.exitCode).toBe(0);
  return result.stdout.trim();
}

describe('Codex agent source stability', () => {
  test('fails closed for commit or worktree drift', async () => {
    const workingDirectory = await mkdtemp(
      join(tmpdir(), 'loom-agent-source-stability-'),
    );
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const initCommand: RunCommandArgs = {
        command: 'git',
        args: ['init'],
        cwd: workingDirectory,
      };
      runGit(initCommand);
      const identityCommand: RunCommandArgs = {
        command: 'git',
        args: [
          '-c',
          'user.name=Loom Test',
          '-c',
          'user.email=loom@example.test',
        ],
        cwd: workingDirectory,
      };
      const trackedPath = join(workingDirectory, 'tracked.txt');
      await writeFile(trackedPath, 'stable\n');
      const addCommand: RunCommandArgs = {
        command: 'git',
        args: ['add', 'tracked.txt'],
        cwd: workingDirectory,
      };
      runGit(addCommand);
      const commitCommand: RunCommandArgs = {
        ...identityCommand,
        args: [
          '-c',
          'user.name=Loom Test',
          '-c',
          'user.email=loom@example.test',
          'commit',
          '-m',
          'fixture',
        ],
      };
      runGit(commitCommand);
      const headCommand: RunCommandArgs = {
        command: 'git',
        args: ['rev-parse', 'HEAD'],
        cwd: workingDirectory,
      };
      const sourceCommit = runGit(headCommand);
      const stableCheck: AgentSourceStabilityCheck = {
        workingDirectory,
        sourceCommit,
        phase: AgentSourceStabilityPhase.BeforeAttempt,
      };
      expect(() => assertAgentSourceStable(stableCheck)).not.toThrow();

      const wrongCommitCheck: AgentSourceStabilityCheck = {
        ...stableCheck,
        sourceCommit: '0000000000000000000000000000000000000000',
      };
      expect(() => assertAgentSourceStable(wrongCommitCheck)).toThrow(
        'is not at immutable commit',
      );

      const untrackedPath = join(workingDirectory, 'untracked.txt');
      await writeFile(untrackedPath, 'drifted\n');
      expect(() => assertAgentSourceStable(stableCheck)).toThrow(
        'worktree is not clean before attempt',
      );
      await unlink(untrackedPath);

      await writeFile(trackedPath, 'drifted\n');
      const dirtyCheck: AgentSourceStabilityCheck = {
        ...stableCheck,
        phase: AgentSourceStabilityPhase.AfterAttempt,
      };
      expect(() => assertAgentSourceStable(dirtyCheck)).toThrow(
        'worktree is not clean after attempt',
      );
    } finally {
      await rm(workingDirectory, removeOptions);
    }
  });
});
