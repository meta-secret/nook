import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import { CommandOutputPolicy, RepositoryCommand } from '../src/lib/run.ts';

const LARGE_OUTPUT_BYTES = 2 * 1024 * 1024;
const EXCESSIVE_OUTPUT_BYTES = 17 * 1024 * 1024;

describe('run command', () => {
  test('captures output larger than the platform default within an explicit bound', () => {
    const launch = new RepositoryCommand({
      command: 'node',
      args: ['-e', `process.stdout.write('x'.repeat(${LARGE_OUTPUT_BYTES}))`],
      rootDirectory: process.cwd(),
      workingDirectory: process.cwd(),
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
      command: 'node',
      args: [
        '-e',
        `process.stdout.write('x'.repeat(${EXCESSIVE_OUTPUT_BYTES}))`,
      ],
      rootDirectory: process.cwd(),
      workingDirectory: process.cwd(),
      outputPolicy: CommandOutputPolicy.GitHubApi,
    }).execute();
    assert(launch.isErr());
    expect(launch.error.message).toContain('failed to start');
  });

  test('preserves subprocess signal termination', () => {
    const launch = new RepositoryCommand({
      command: 'node',
      args: ['-e', "process.kill(process.pid, 'SIGTERM')"],
      rootDirectory: process.cwd(),
      workingDirectory: process.cwd(),
    }).execute();
    assert(launch.isOk());
    const result = launch.value;

    expect(result.exitCode).toBe(1);
    expect(result.signaled).toBe(true);
  });

  test('rejects a working directory outside the repository root', () => {
    const launch = new RepositoryCommand({
      command: 'node',
      args: ['-e', 'process.exit(0)'],
      rootDirectory: process.cwd(),
      workingDirectory: path.dirname(process.cwd()),
    }).execute();

    assert(launch.isErr());
    expect(launch.error.message).toContain('outside repository root');
  });
});
