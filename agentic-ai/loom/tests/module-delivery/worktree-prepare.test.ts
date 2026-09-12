import { afterEach, describe, expect, test } from 'bun:test';

import {
  chmodSync,
  existsSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';

import { join } from 'node:path';

import { ModuleWorktree } from '../../src/module-delivery/index.ts';

import { ModuleRepositoryGit } from '../../src/module-delivery/git-command.ts';

import { ModuleDeliveryWorktreeTestSupportScenario } from './worktree-test-support.ts';

import type {
  CleanupModuleWorktreeRequest,
  ModuleWorktreeHandle,
  PrepareModuleWorktreeRequest,
} from '../../src/module-delivery/index.ts';

import type { GitFixture } from './worktree-test-support.ts';

export class ModuleDeliveryWorktreePrepareScenario {
  private constructor(private readonly request: PrepareModuleWorktreeRequest) {}

  static createTrackedFixture(): GitFixture {
    const fixture =
      ModuleDeliveryWorktreeTestSupportScenario.createGitFixture();
    fixtures.push(fixture);
    return fixture;
  }

  static prepared(request: PrepareModuleWorktreeRequest): ModuleWorktreeHandle {
    return new ModuleDeliveryWorktreePrepareScenario(request).execute();
  }

  private execute(): ModuleWorktreeHandle {
    const request = this.request;
    const workspace = ModuleWorktree.prepareModuleWorktree(request);
    workspaces.push(workspace);
    return workspace;
  }
}

const fixtures: GitFixture[] = [];

const workspaces: ModuleWorktreeHandle[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    const cleanupRequest: CleanupModuleWorktreeRequest = { workspace };
    try {
      ModuleWorktree.cleanupModuleWorktree(cleanupRequest);
    } catch {
      // Rejection tests can intentionally invalidate the workspace.
    }
  }
  for (const fixture of fixtures.splice(0)) {
    ModuleDeliveryWorktreeTestSupportScenario.disposeGitFixture(fixture);
  }
});

describe('prepareModuleWorktree', () => {
  test('prepares an isolated child at the exact baseline and leaves the parent unchanged', () => {
    const fixture =
      ModuleDeliveryWorktreePrepareScenario.createTrackedFixture();
    const marker =
      ModuleDeliveryWorktreeTestSupportScenario.installCheckoutHook(fixture);
    const request =
      ModuleDeliveryWorktreeTestSupportScenario.prepareRequest(fixture);
    const parentGit =
      ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture);
    const parentBranch = parentGit(['symbolic-ref', '--quiet', 'HEAD']);
    const workspace = ModuleDeliveryWorktreePrepareScenario.prepared(request);
    const git =
      ModuleDeliveryWorktreeTestSupportScenario.worktreeGit(workspace);

    expect(workspace.baselineCommit).toBe(fixture.baselineCommit);
    expect(workspace.role).toBe('child');
    expect(workspace.worktreePath).toBe(
      join(fixture.workspaceRoot, 'core-provider-attempt-1'),
    );
    expect(workspace.ownedWorkspaceRoot).toBe(fixture.workspaceRoot);
    expect(workspace.worktreeId).toBe('core-provider-attempt-1');
    expect(workspace.branchName).toBe(
      `refs/heads/nook/module-delivery/${request.planDigest}/${workspace.worktreeId}`,
    );
    expect(git(['rev-parse', 'HEAD'])).toBe(fixture.baselineCommit);
    expect(git(['status', '--porcelain=v1'])).toBe('');
    expect(git(['symbolic-ref', '--quiet', 'HEAD'])).toBe(workspace.branchName);
    expect(parentGit(['rev-parse', 'HEAD'])).toBe(fixture.baselineCommit);
    expect(parentGit(['symbolic-ref', '--quiet', 'HEAD'])).toBe(parentBranch);
    expect(parentGit(['status', '--porcelain=v1'])).toBe('');
    expect(existsSync(marker)).toBe(false);
  });

  test('uses distinct generated child worktrees and branches for retry attempts', () => {
    const fixture =
      ModuleDeliveryWorktreePrepareScenario.createTrackedFixture();
    const firstRequest =
      ModuleDeliveryWorktreeTestSupportScenario.prepareRequest(fixture);
    const first = ModuleDeliveryWorktreePrepareScenario.prepared(firstRequest);
    const secondRequest: PrepareModuleWorktreeRequest = {
      ...firstRequest,
      attempt: 2,
    };
    const second =
      ModuleDeliveryWorktreePrepareScenario.prepared(secondRequest);
    expect(second.worktreePath).not.toBe(first.worktreePath);
    expect(second.worktreeId).not.toBe(first.worktreeId);
    expect(second.branchName).not.toBe(first.branchName);
    expect(second.attempt).toBe(2);
    expect(second.worktreePath).toBe(
      join(fixture.workspaceRoot, 'core-provider-attempt-2'),
    );
  });

  test('cleans only the owned child worktree and branch', () => {
    const fixture =
      ModuleDeliveryWorktreePrepareScenario.createTrackedFixture();
    const parentGit =
      ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture);
    const workspace = ModuleDeliveryWorktreePrepareScenario.prepared(
      ModuleDeliveryWorktreeTestSupportScenario.prepareRequest(fixture),
    );
    expect(ModuleWorktree.cleanupModuleWorktree({ workspace }).removed).toBe(
      true,
    );
    expect(existsSync(workspace.worktreePath)).toBe(false);
    expect(
      parentGit(['for-each-ref', '--format=%(refname)', workspace.branchName]),
    ).toBe('');
    expect(parentGit(['rev-parse', 'HEAD'])).toBe(fixture.baselineCommit);
    expect(ModuleWorktree.cleanupModuleWorktree({ workspace }).removed).toBe(
      false,
    );
  });

  test('represents the integration parent without allowing parent removal', () => {
    const fixture =
      ModuleDeliveryWorktreePrepareScenario.createTrackedFixture();
    const workspace = ModuleWorktree.prepareSharedIntegrationWorkspace({
      ...ModuleDeliveryWorktreeTestSupportScenario.prepareRequest(fixture),
      taskId: 'module-delivery-integration',
    });

    expect(workspace.role).toBe('integration-parent');
    expect(workspace.worktreePath).toBe(fixture.sourceRoot);
    expect(workspace.ownedWorkspaceRoot).toBe(fixture.workspaceRoot);
    expect(
      ModuleWorktree.cleanupSharedIntegrationWorkspace({ workspace }).removed,
    ).toBe(false);
    expect(existsSync(workspace.worktreePath)).toBe(true);
    expect(() => ModuleWorktree.cleanupModuleWorktree({ workspace })).toThrow(
      'Only child',
    );
  });

  test('preserves committed handoffs and refuses ignored files during cleanup', () => {
    const fixture =
      ModuleDeliveryWorktreePrepareScenario.createTrackedFixture();
    const sourceGit =
      ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture);
    ModuleDeliveryWorktreeTestSupportScenario.fixtureFileWriter(fixture)([
      '.gitignore',
      'ignored/\n',
    ]);
    sourceGit(['add', '.gitignore']);
    sourceGit(['commit', '--quiet', '-m', 'ignore generated files']);
    const baselineCommit = sourceGit(['rev-parse', 'HEAD']);
    const workspace = ModuleDeliveryWorktreePrepareScenario.prepared({
      ...ModuleDeliveryWorktreeTestSupportScenario.prepareRequest(fixture),
      baselineCommit,
    });
    const childGit =
      ModuleDeliveryWorktreeTestSupportScenario.worktreeGit(workspace);
    ModuleDeliveryWorktreeTestSupportScenario.worktreeFileWriter(workspace)([
      'module/committed.ts',
      'committed\n',
    ]);
    childGit(['add', '--all']);
    childGit(['commit', '--quiet', '-m', 'committed handoff']);
    expect(() => ModuleWorktree.cleanupModuleWorktree({ workspace })).toThrow(
      'Committed child handoff',
    );
    expect(existsSync(workspace.worktreePath)).toBe(true);

    childGit(['reset', '--hard', baselineCommit]);
    ModuleDeliveryWorktreeTestSupportScenario.worktreeFileWriter(workspace)([
      'ignored/generated.txt',
      'generated\n',
    ]);
    expect(() => ModuleWorktree.cleanupModuleWorktree({ workspace })).toThrow(
      'must be clean',
    );
    expect(existsSync(workspace.worktreePath)).toBe(true);
    childGit(['clean', '-fdX']);
    expect(ModuleWorktree.cleanupModuleWorktree({ workspace }).removed).toBe(
      true,
    );
  });

  test('refuses to force-remove a dirty child worktree', () => {
    const fixture =
      ModuleDeliveryWorktreePrepareScenario.createTrackedFixture();
    const workspace = ModuleDeliveryWorktreePrepareScenario.prepared(
      ModuleDeliveryWorktreeTestSupportScenario.prepareRequest(fixture),
    );
    ModuleDeliveryWorktreeTestSupportScenario.worktreeFileWriter(workspace)([
      'module/uncommitted.ts',
      'uncommitted\n',
    ]);
    expect(() => ModuleWorktree.cleanupModuleWorktree({ workspace })).toThrow(
      'must be clean',
    );
    expect(existsSync(workspace.worktreePath)).toBe(true);
    ModuleDeliveryWorktreeTestSupportScenario.worktreeGit(workspace)([
      'clean',
      '-fd',
    ]);
  });

  test('rejects a dirty or stale shared checkout before dispatch', () => {
    const fixture =
      ModuleDeliveryWorktreePrepareScenario.createTrackedFixture();
    const request =
      ModuleDeliveryWorktreeTestSupportScenario.prepareRequest(fixture);
    writeFileSync(join(fixture.sourceRoot, 'dirty.ts'), 'dirty\n');
    expect(() => ModuleWorktree.prepareModuleWorktree(request)).toThrow(
      'must be clean before dispatch',
    );
    ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture)([
      'clean',
      '-fd',
    ]);
    writeFileSync(join(fixture.sourceRoot, 'later.ts'), 'later\n');
    ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture)([
      'add',
      'later.ts',
    ]);
    ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture)([
      'commit',
      '--quiet',
      '-m',
      'later',
    ]);
    expect(() => ModuleWorktree.prepareModuleWorktree(request)).toThrow(
      'HEAD must match its baseline',
    );
  });

  test('rejects a detached shared checkout before dispatch', () => {
    const fixture =
      ModuleDeliveryWorktreePrepareScenario.createTrackedFixture();
    ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture)([
      'checkout',
      '--quiet',
      '--detach',
    ]);
    expect(() =>
      ModuleWorktree.prepareModuleWorktree(
        ModuleDeliveryWorktreeTestSupportScenario.prepareRequest(fixture),
      ),
    ).toThrow();
  });

  test('rejects nonexact commits and overlapping workspace roots', () => {
    const fixture =
      ModuleDeliveryWorktreePrepareScenario.createTrackedFixture();
    const base =
      ModuleDeliveryWorktreeTestSupportScenario.prepareRequest(fixture);
    const shortCommitRequest: PrepareModuleWorktreeRequest = {
      ...base,
      baselineCommit: fixture.baselineCommit.slice(0, 12),
    };
    expect(() =>
      ModuleWorktree.prepareModuleWorktree(shortCommitRequest),
    ).toThrow('exact lowercase 40-hex');

    const hadGitDirectory = 'GIT_DIR' in process.env;
    const [previousGitDirectory = ''] = [process.env.GIT_DIR];
    process.env.GIT_DIR = join(fixture.root, 'does-not-exist');
    const scrubbed = ModuleDeliveryWorktreePrepareScenario.prepared(base);
    expect(scrubbed.baselineCommit).toBe(fixture.baselineCommit);
    if (hadGitDirectory) process.env.GIT_DIR = previousGitDirectory;
    else delete process.env.GIT_DIR;

    const nestedRoot = join(fixture.sourceRoot, 'nested-workspaces');
    mkdirSync(nestedRoot);
    const nestedRequest: PrepareModuleWorktreeRequest = {
      ...base,
      workspaceRoot: nestedRoot,
    };
    expect(() => ModuleWorktree.prepareModuleWorktree(nestedRequest)).toThrow(
      'disjoint',
    );
  });

  test('rejects symlink workspace roots before creating a worktree registration', () => {
    const fixture =
      ModuleDeliveryWorktreePrepareScenario.createTrackedFixture();
    const linkedRoot = join(fixture.root, 'linked-workspaces');
    symlinkSync(fixture.workspaceRoot, linkedRoot);
    const request: PrepareModuleWorktreeRequest = {
      ...ModuleDeliveryWorktreeTestSupportScenario.prepareRequest(fixture),
      workspaceRoot: linkedRoot,
    };
    expect(() => ModuleWorktree.prepareModuleWorktree(request)).toThrow(
      'real directory',
    );
    expect(
      ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture)([
        'worktree',
        'list',
        '--porcelain',
      ]),
    ).not.toContain(linkedRoot);
  });

  test('ignores inherited global Git configuration during preparation', () => {
    const fixture =
      ModuleDeliveryWorktreePrepareScenario.createTrackedFixture();
    const marker = join(fixture.root, 'fsmonitor-ran');
    const monitor = join(fixture.root, 'fsmonitor.sh');
    const globalConfig = join(fixture.root, 'poisoned.gitconfig');
    writeFileSync(monitor, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`);
    chmodSync(monitor, 0o755);
    writeFileSync(globalConfig, `[core]\n\tfsmonitor = ${monitor}\n`);
    const hadGlobalConfig = 'GIT_CONFIG_GLOBAL' in process.env;
    const [previousConfig = ''] = [process.env.GIT_CONFIG_GLOBAL];
    process.env.GIT_CONFIG_GLOBAL = globalConfig;
    try {
      ModuleDeliveryWorktreePrepareScenario.prepared(
        ModuleDeliveryWorktreeTestSupportScenario.prepareRequest(fixture),
      );
    } finally {
      if (hadGlobalConfig) process.env.GIT_CONFIG_GLOBAL = previousConfig;
      else delete process.env.GIT_CONFIG_GLOBAL;
    }
    expect(existsSync(marker)).toBe(false);
  });

  test('does not inherit ambient process environment in Git commands', () => {
    const fixture =
      ModuleDeliveryWorktreePrepareScenario.createTrackedFixture();
    const hadEmail = 'EMAIL' in process.env;
    const [previousEmail = ''] = [process.env.EMAIL];
    process.env.EMAIL = 'ambient-authority@nook.invalid';
    try {
      const result = ModuleRepositoryGit.runModuleDeliveryGit({
        cwd: fixture.sourceRoot,
        args: ['var', 'GIT_AUTHOR_IDENT'],
      });
      expect(ModuleRepositoryGit.gitText(result)).not.toContain(
        'ambient-authority@nook.invalid',
      );
    } finally {
      if (hadEmail) process.env.EMAIL = previousEmail;
      else delete process.env.EMAIL;
    }
  });

  test('validates executable search paths for the host platform', () => {
    const fixture =
      ModuleDeliveryWorktreePrepareScenario.createTrackedFixture();
    const hadPath = 'PATH' in process.env;
    const [previousPath = ''] = [process.env.PATH];
    try {
      process.env.PATH = `relative-bin:${previousPath || '/usr/bin'}`;
      expect(() =>
        ModuleRepositoryGit.runModuleDeliveryGit({
          cwd: fixture.sourceRoot,
          args: ['status', '--short'],
        }),
      ).toThrow('search path must contain absolute paths');
      process.env.PATH = '\\\\server\\git';
      let message = '';
      try {
        ModuleRepositoryGit.runModuleDeliveryGit({
          cwd: fixture.sourceRoot,
          args: ['status', '--short'],
        });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      if (process.platform === 'win32')
        expect(message).not.toContain(
          'search path must contain absolute paths',
        );
      else expect(message).toContain('search path must contain absolute paths');
    } finally {
      if (hadPath) process.env.PATH = previousPath;
      else delete process.env.PATH;
    }
  });

  test('preserves trusted Git arguments within explicit input bounds', () => {
    const fixture =
      ModuleDeliveryWorktreePrepareScenario.createTrackedFixture();
    const exact = ModuleRepositoryGit.runModuleDeliveryGit({
      cwd: fixture.sourceRoot,
      args: ['rev-parse', '--verify', 'HEAD'],
    });
    expect(ModuleRepositoryGit.gitText(exact)).toBe(fixture.baselineCommit);
    expect(() =>
      ModuleRepositoryGit.runModuleDeliveryGit({
        cwd: fixture.sourceRoot,
        args: Array.from({ length: 1025 }, () => 'status'),
      }),
    ).toThrow('arguments exceed bounded input');
    expect(() =>
      ModuleRepositoryGit.runModuleDeliveryGit({
        cwd: fixture.sourceRoot,
        args: ['x'.repeat(1024 * 1024 + 1)],
      }),
    ).toThrow('arguments exceed bounded input');
  });
});
