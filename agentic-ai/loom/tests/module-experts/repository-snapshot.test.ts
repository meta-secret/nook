import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { ExpertIsolationFailureKind } from '../../src/module-experts/isolation-failure.ts';
import {
  RepositorySnapshot,
  SnapshotContextFiles,
} from '../../src/module-experts/repository-snapshot.ts';

class RepositorySnapshotFixture {
  static runGit(
    ...[workingDirectory, args]: [
      workingDirectory: string,
      args: readonly string[],
    ]
  ): string {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
    };
    delete environment.GIT_NO_REPLACE_OBJECTS;
    const result = spawnSync('git', [...args], {
      cwd: workingDirectory,
      encoding: 'utf8',
      env: environment,
    });
    if (result.error || result.status !== 0)
      throw new Error(
        `Fixture Git command failed: ${result.stderr || result.error?.message}`,
      );
    return result.stdout;
  }

  static configureAttackSurface(
    ...[repository, marker, script]: [
      repository: string,
      marker: string,
      script: string,
    ]
  ): void {
    writeFileSync(script, `#!/bin/sh\nprintf touched > '${marker}'\n`, {
      encoding: 'utf8',
      mode: 0o700,
    });
    chmodSync(script, 0o700);
    writeFileSync(
      join(repository, 'attributes'),
      '*.txt export-ignore\n',
      'utf8',
    );
    RepositorySnapshotFixture.runGit(repository, [
      'config',
      '--local',
      'core.hooksPath',
      repository,
    ]);
    RepositorySnapshotFixture.runGit(repository, [
      'config',
      '--local',
      'core.fsmonitor',
      script,
    ]);
    RepositorySnapshotFixture.runGit(repository, [
      'config',
      '--local',
      'core.sshCommand',
      script,
    ]);
    RepositorySnapshotFixture.runGit(repository, [
      'config',
      '--local',
      'core.attributesFile',
      join(repository, 'attributes'),
    ]);
    RepositorySnapshotFixture.runGit(repository, [
      'config',
      '--local',
      'filter.attack.process',
      script,
    ]);
    RepositorySnapshotFixture.runGit(repository, [
      'config',
      '--local',
      'remote.origin.uploadpack',
      script,
    ]);
  }
}

describe('repository snapshot Git isolation', () => {
  test(
    'archives and lists the requested commit without replace refs or config execution',
    () => {
      const fixtureRoot = mkdtempSync(
        join(tmpdir(), 'loom-repository-snapshot-'),
      );
      const repository = join(fixtureRoot, 'repository');
      const codexHome = join(fixtureRoot, 'codex');
      const marker = join(fixtureRoot, 'executed');
      const script = join(fixtureRoot, 'attack.sh');
      mkdirSync(repository);
      mkdirSync(codexHome);
      try {
        RepositorySnapshotFixture.runGit(repository, ['init']);
        writeFileSync(join(repository, 'tracked.txt'), 'source\n', 'utf8');
        writeFileSync(
          join(repository, 'optional.txt'),
          'optional-source\n',
          'utf8',
        );
        RepositorySnapshotFixture.runGit(repository, ['add', '.']);
        RepositorySnapshotFixture.runGit(repository, [
          '-c',
          'user.name=Loom Test',
          '-c',
          'user.email=loom@example.test',
          'commit',
          '-m',
          'source',
        ]);
        const sourceCommit = RepositorySnapshotFixture.runGit(
          repository,
          ['rev-parse', 'HEAD'],
        ).trim();
        writeFileSync(
          join(repository, 'tracked.txt'),
          'replacement\n',
          'utf8',
        );
        rmSync(join(repository, 'optional.txt'));
        writeFileSync(
          join(repository, 'replacement.txt'),
          'replacement-only\n',
          'utf8',
        );
        RepositorySnapshotFixture.runGit(repository, ['add', '-A']);
        RepositorySnapshotFixture.runGit(repository, [
          '-c',
          'user.name=Loom Test',
          '-c',
          'user.email=loom@example.test',
          'commit',
          '-m',
          'replacement',
        ]);
        const replacementCommit = RepositorySnapshotFixture.runGit(
          repository,
          ['rev-parse', 'HEAD'],
        ).trim();
        RepositorySnapshotFixture.runGit(repository, [
          'replace',
          sourceCommit,
          replacementCommit,
        ]);
        RepositorySnapshotFixture.configureAttackSurface(
          repository,
          marker,
          script,
        );

        const globalConfig = join(fixtureRoot, 'global.gitconfig');
        const systemConfig = join(fixtureRoot, 'system.gitconfig');
        writeFileSync(
          globalConfig,
          `[core]\nfsmonitor = ${script}\n`,
          'utf8',
        );
        writeFileSync(
          systemConfig,
          `[core]\nsshCommand = ${script}\n`,
          'utf8',
        );
        const previousGlobal = process.env.GIT_CONFIG_GLOBAL;
        const previousSystem = process.env.GIT_CONFIG_SYSTEM;
        process.env.GIT_CONFIG_GLOBAL = globalConfig;
        process.env.GIT_CONFIG_SYSTEM = systemConfig;
        try {
          const result = new RepositorySnapshot({
            codexHome,
            excludedPaths: [],
            optionalScopePaths: ['optional.txt'],
            sourceCommit,
            scopePaths: ['tracked.txt'],
            workingDirectory: repository,
          }).materialize();
          expect(result.isOk()).toBe(true);
          if (result.isErr()) return;
          expect(readFileSync(join(result.value, 'tracked.txt'), 'utf8')).toBe(
            'source\n',
          );
          expect(readFileSync(join(result.value, 'optional.txt'), 'utf8')).toBe(
            'optional-source\n',
          );
          expect(() =>
            readFileSync(join(result.value, 'replacement.txt')),
          ).toThrow();
          expect(() => readFileSync(marker)).toThrow();
        } finally {
          if (previousGlobal === undefined)
            delete process.env.GIT_CONFIG_GLOBAL;
          else process.env.GIT_CONFIG_GLOBAL = previousGlobal;
          if (previousSystem === undefined)
            delete process.env.GIT_CONFIG_SYSTEM;
          else process.env.GIT_CONFIG_SYSTEM = previousSystem;
        }
      } finally {
        rmSync(fixtureRoot, { force: true, recursive: true });
      }
    },
  );

  test('rejects context writes through an archived symlink ancestor', () => {
    const fixtureRoot = mkdtempSync(
      join(tmpdir(), 'loom-repository-context-symlink-'),
    );
    const snapshot = join(fixtureRoot, 'snapshot');
    const outside = join(fixtureRoot, 'outside');
    const outsideTarget = join(outside, 'context.md');
    mkdirSync(snapshot);
    mkdirSync(outside);
    symlinkSync(outside, join(snapshot, 'archived-link'), 'dir');
    try {
      const result = new SnapshotContextFiles({
        contextFiles: [{ path: 'archived-link/context.md', content: 'blocked' }],
        repositorySnapshot: snapshot,
      }).materialize();
      expect(result.isErr()).toBe(true);
      if (result.isOk()) return;
      expect(result.error.kind).toBe(ExpertIsolationFailureKind.ContextFiles);
      expect(() => readFileSync(outsideTarget)).toThrow();
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  test('rejects context writes to an archived symlink target', () => {
    const fixtureRoot = mkdtempSync(
      join(tmpdir(), 'loom-repository-context-target-'),
    );
    const snapshot = join(fixtureRoot, 'snapshot');
    const outside = join(fixtureRoot, 'outside');
    const outsideTarget = join(outside, 'context.md');
    mkdirSync(snapshot);
    mkdirSync(outside);
    writeFileSync(outsideTarget, 'outside\n', 'utf8');
    symlinkSync(outsideTarget, join(snapshot, 'context.md'));
    try {
      const result = new SnapshotContextFiles({
        contextFiles: [{ path: 'context.md', content: 'blocked' }],
        repositorySnapshot: snapshot,
      }).materialize();
      expect(result.isErr()).toBe(true);
      if (result.isOk()) return;
      expect(result.error.kind).toBe(ExpertIsolationFailureKind.ContextFiles);
      expect(readFileSync(outsideTarget, 'utf8')).toBe('outside\n');
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });
});
