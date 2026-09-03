import { describe, expect, test } from 'bun:test';
import { CommandOutputPolicy, runCommand } from '../src/lib/run.ts';

const LARGE_OUTPUT_BYTES = 2 * 1024 * 1024;
const EXCESSIVE_OUTPUT_BYTES = 17 * 1024 * 1024;

describe('run command', () => {
  test('captures output larger than the platform default within an explicit bound', () => {
    const result = runCommand({
      command: process.execPath,
      args: ['-e', `process.stdout.write('x'.repeat(${LARGE_OUTPUT_BYTES}))`],
      cwd: process.cwd(),
      outputPolicy: CommandOutputPolicy.GitHubApi,
    });

    expect(result.exitCode).toBe(0);
    expect(result.signaled).toBe(false);
    expect(result.stderr).toBe('');
    expect(result.stdout.length).toBe(LARGE_OUTPUT_BYTES);
  });

  test('fails closed when output exceeds the explicit bound', () => {
    expect(() =>
      runCommand({
        command: process.execPath,
        args: [
          '-e',
          `process.stdout.write('x'.repeat(${EXCESSIVE_OUTPUT_BYTES}))`,
        ],
        cwd: process.cwd(),
        outputPolicy: CommandOutputPolicy.GitHubApi,
      }),
    ).toThrow('failed to start');
  });

  test('preserves subprocess signal termination', () => {
    const result = runCommand({
      command: process.execPath,
      args: ['-e', "process.kill(process.pid, 'SIGTERM')"],
      cwd: process.cwd(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.signaled).toBe(true);
  });
});
