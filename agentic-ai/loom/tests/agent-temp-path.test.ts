import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  AGENT_TEMP_DIR_TOKEN,
  AgentTemporaryDirectory,
} from '../src/lib/agent-temp-path.ts';
import { RepositoryRoot } from '../src/lib/repo.ts';
import { HostCommand } from '../src/lib/run.ts';

import type {
  AgentTempDirectoryParts,
  ResolveAgentTempPathRequest,
  TaskAnchorSelection,
} from '../src/lib/agent-temp-path.ts';
import type { RunCommandArgs } from '../src/lib/run.ts';

const FIRST_COMMIT = '1111111111111111111111111111111111111111';
const SECOND_COMMIT = '2222222222222222222222222222222222222222';

describe('agent temporary paths', () => {
  test('includes the exact commit and a stable opaque worktree ID', () => {
    const parts: AgentTempDirectoryParts = {
      repoRoot: '/worktrees/first',
      taskAnchorCommit: FIRST_COMMIT,
      osTempDirectory: '/temporary',
    };
    const first = AgentTemporaryDirectory.buildAgentTempDirectory(parts);
    const second = AgentTemporaryDirectory.buildAgentTempDirectory(parts);

    expect(first).toBe(second);
    expect(first).toMatch(
      new RegExp(`^/temporary/nook-agent-stats/${FIRST_COMMIT}/[0-9a-f]{16}$`),
    );
  });

  test('isolates equal commits in different worktrees', () => {
    const firstParts: AgentTempDirectoryParts = {
      repoRoot: '/worktrees/first',
      taskAnchorCommit: FIRST_COMMIT,
      osTempDirectory: '/temporary',
    };
    const secondParts: AgentTempDirectoryParts = {
      repoRoot: '/worktrees/second',
      taskAnchorCommit: FIRST_COMMIT,
      osTempDirectory: '/temporary',
    };

    expect(
      AgentTemporaryDirectory.buildAgentTempDirectory(firstParts),
    ).not.toBe(AgentTemporaryDirectory.buildAgentTempDirectory(secondParts));
  });

  test('isolates different commits in one worktree', () => {
    const firstParts: AgentTempDirectoryParts = {
      repoRoot: '/worktrees/first',
      taskAnchorCommit: FIRST_COMMIT,
      osTempDirectory: '/temporary',
    };
    const secondParts: AgentTempDirectoryParts = {
      ...firstParts,
      taskAnchorCommit: SECOND_COMMIT,
    };

    expect(
      AgentTemporaryDirectory.buildAgentTempDirectory(firstParts),
    ).not.toBe(AgentTemporaryDirectory.buildAgentTempDirectory(secondParts));
  });

  test('selects the latest checkout commit for the current branch', () => {
    const selection: TaskAnchorSelection = {
      currentCommit: SECOND_COMMIT,
      branchName: 'codex/current-task',
      reflog: [
        `${SECOND_COMMIT}\tcommit: implementation`,
        `${FIRST_COMMIT}\tcheckout: moving from main to codex/current-task`,
      ].join('\n'),
    };

    expect(AgentTemporaryDirectory.selectTaskAnchorCommit(selection)).toBe(
      FIRST_COMMIT,
    );
  });

  test('keeps the task anchor stable after implementation commits', () => {
    const firstSelection: TaskAnchorSelection = {
      currentCommit: FIRST_COMMIT,
      branchName: 'codex/current-task',
      reflog: `${FIRST_COMMIT}\tcheckout: moving from main to codex/current-task`,
    };
    const secondSelection: TaskAnchorSelection = {
      currentCommit: SECOND_COMMIT,
      branchName: firstSelection.branchName,
      reflog: [
        `${SECOND_COMMIT}\tcommit: implementation`,
        firstSelection.reflog,
      ].join('\n'),
    };

    expect(AgentTemporaryDirectory.selectTaskAnchorCommit(firstSelection)).toBe(
      AgentTemporaryDirectory.selectTaskAnchorCommit(secondSelection),
    );
  });

  test('keeps the first task entry after branch re-entry', () => {
    const selection: TaskAnchorSelection = {
      currentCommit: SECOND_COMMIT,
      branchName: 'codex/current-task',
      reflog: [
        `${SECOND_COMMIT}\tcheckout: moving from main to codex/current-task`,
        `${SECOND_COMMIT}\tcheckout: moving from codex/current-task to main`,
        `${FIRST_COMMIT}\tcheckout: moving from main to codex/current-task`,
      ].join('\n'),
    };

    expect(AgentTemporaryDirectory.selectTaskAnchorCommit(selection)).toBe(
      FIRST_COMMIT,
    );
  });

  test('uses the initial reflog commit for a directly created worktree', () => {
    const initialSelection: TaskAnchorSelection = {
      currentCommit: FIRST_COMMIT,
      branchName: 'codex/current-task',
      reflog: `${FIRST_COMMIT}\treset: moving to HEAD`,
    };
    const committedSelection: TaskAnchorSelection = {
      currentCommit: SECOND_COMMIT,
      branchName: initialSelection.branchName,
      reflog: [
        `${SECOND_COMMIT}\tcommit: implementation`,
        initialSelection.reflog,
      ].join('\n'),
    };

    expect(
      AgentTemporaryDirectory.selectTaskAnchorCommit(initialSelection),
    ).toBe(FIRST_COMMIT);
    expect(
      AgentTemporaryDirectory.selectTaskAnchorCommit(committedSelection),
    ).toBe(FIRST_COMMIT);
  });

  test('resolves the token with the exact task anchor commit', () => {
    const repoRoot = RepositoryRoot.find();
    const gitHeadRequest: RunCommandArgs = {
      command: 'git',
      args: ['rev-parse', 'HEAD'],
      cwd: repoRoot,
    };
    const gitCommit = HostCommand.run(gitHeadRequest).stdout.trim();
    const branchRequest: RunCommandArgs = {
      command: 'git',
      args: ['branch', '--show-current'],
      cwd: repoRoot,
    };
    const reflogRequest: RunCommandArgs = {
      command: 'git',
      args: ['reflog', '--format=%H%x09%gs', 'HEAD'],
      cwd: repoRoot,
    };
    const selection: TaskAnchorSelection = {
      currentCommit: gitCommit,
      branchName: HostCommand.run(branchRequest).stdout.trim(),
      reflog: HostCommand.run(reflogRequest).stdout,
    };
    const taskAnchorCommit =
      AgentTemporaryDirectory.selectTaskAnchorCommit(selection);
    const request: ResolveAgentTempPathRequest = {
      repoRoot,
      authoredPath: `${AGENT_TEMP_DIR_TOKEN}/123.yaml`,
    };
    const resolved = AgentTemporaryDirectory.resolveAgentTempPath(request);

    expect(resolved).toContain(`${path.sep}${taskAnchorCommit}${path.sep}`);
    expect(resolved).toMatch(
      new RegExp(
        `${path.sep.replace('\\', '\\\\')}[0-9a-f]{16}${path.sep.replace('\\', '\\\\')}123\\.yaml$`,
      ),
    );
    expect(existsSync(path.dirname(resolved))).toBe(true);
  });

  test('keeps ordinary paths compatible', () => {
    const request: ResolveAgentTempPathRequest = {
      repoRoot: RepositoryRoot.find(),
      authoredPath: 'relative/123.yaml',
    };

    expect(AgentTemporaryDirectory.resolveAgentTempPath(request)).toBe(
      path.resolve('relative/123.yaml'),
    );
  });
});
