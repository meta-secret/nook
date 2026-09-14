import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  CommandOutputPolicy,
  RepositoryCommand,
  RepositoryCommandExecutable,
  RepositoryBunScript,
  RepositoryGitSecurityPolicy,
} from '../src/lib/run.ts';

const LARGE_OUTPUT_BYTES = 2 * 1024 * 1024;
const EXCESSIVE_OUTPUT_BYTES = 17 * 1024 * 1024;
const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../../..');

describe('run command', () => {
  test('captures output larger than the platform default within an explicit bound', () => {
    const launch = new RepositoryCommand({
      command: RepositoryCommandExecutable.Bun,
      script: RepositoryBunScript.TestFixture,
      args: ['output', String(LARGE_OUTPUT_BYTES)],
      rootDirectory: REPOSITORY_ROOT,
      workingDirectory: REPOSITORY_ROOT,
      outputPolicy: CommandOutputPolicy.GitHubApi,
    }).execute();
    assert(launch.isOk());
    const result = launch.value;

    expect(result.exitCode).toBe(0);
    expect(result.signaled).toBe(false);
    expect(result.stderr).toBe('');
    expect(result.stdout.length).toBe(LARGE_OUTPUT_BYTES);
  });

  test('fails closed when output exceeds the explicit bound', () => {
    const launch = new RepositoryCommand({
      command: RepositoryCommandExecutable.Bun,
      script: RepositoryBunScript.TestFixture,
      args: ['output', String(EXCESSIVE_OUTPUT_BYTES)],
      rootDirectory: REPOSITORY_ROOT,
      workingDirectory: REPOSITORY_ROOT,
      outputPolicy: CommandOutputPolicy.GitHubApi,
    }).execute();
    assert(launch.isErr());
    expect(launch.error.message).toContain('failed to start');
  });

  test('preserves subprocess signal termination', () => {
    const launch = new RepositoryCommand({
      command: RepositoryCommandExecutable.Bun,
      script: RepositoryBunScript.TestFixture,
      args: ['signal'],
      rootDirectory: REPOSITORY_ROOT,
      workingDirectory: REPOSITORY_ROOT,
    }).execute();
    assert(launch.isOk());
    const result = launch.value;

    expect(result.exitCode).toBe(1);
    expect(result.signaled).toBe(true);
  });

  test('rejects a working directory outside the repository root', () => {
    const launch = new RepositoryCommand({
      command: RepositoryCommandExecutable.Bun,
      script: RepositoryBunScript.TestFixture,
      args: ['exit'],
      rootDirectory: REPOSITORY_ROOT,
      workingDirectory: path.dirname(REPOSITORY_ROOT),
    }).execute();

    assert(launch.isErr());
    expect(launch.error.message).toContain('outside repository root');
  });

  test('accepts the current immutable read command vocabulary', () => {
    const immutableReads = [
      ['rev-parse', 'HEAD'],
      ['rev-parse', '--verify', 'HEAD^{commit}'],
      ['merge-base', '--is-ancestor', 'HEAD', 'HEAD'],
      ['status', '--porcelain', '--untracked-files=normal'],
    ];
    for (const args of immutableReads) {
      const launch = new RepositoryCommand({
        command: RepositoryCommandExecutable.Git,
        args,
        gitSecurity: RepositoryGitSecurityPolicy.ImmutableObjects,
        rootDirectory: REPOSITORY_ROOT,
        workingDirectory: REPOSITORY_ROOT,
      }).execute();

      assert(launch.isOk());
      expect(launch.value.exitCode).toBe(0);
    }
  });

  test('rejects caller config, write, and network arguments for immutable Git', () => {
    const hostileArguments = [
      ['rev-parse', 'HEAD', '-c', 'protocol.https.allow=always'],
      [
        'status',
        '--porcelain',
        '--untracked-files=normal',
        '-c',
        'core.pager=cat',
      ],
      ['commit', '-m', 'hostile write'],
      ['fetch', 'origin'],
      ['push', 'origin', 'HEAD'],
    ];
    for (const args of hostileArguments) {
      const launch = new RepositoryCommand({
        command: RepositoryCommandExecutable.Git,
        args,
        gitSecurity: RepositoryGitSecurityPolicy.ImmutableObjects,
        rootDirectory: REPOSITORY_ROOT,
        workingDirectory: REPOSITORY_ROOT,
      }).execute();

      assert(launch.isErr());
      expect(launch.error.message).toContain('Immutable Git policy');
    }
  });
});
