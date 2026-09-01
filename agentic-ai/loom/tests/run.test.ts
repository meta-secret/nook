import { describe, expect, test } from 'bun:test';
import { runCommand } from '../src/lib/run.ts';

const LARGE_OUTPUT_BYTES = 2 * 1024 * 1024;

describe('run command', () => {
  test('captures output larger than the platform default within an explicit bound', () => {
    const result = runCommand({
      command: process.execPath,
      args: ['-e', `process.stdout.write('x'.repeat(${LARGE_OUTPUT_BYTES}))`],
      cwd: process.cwd(),
      maxOutputBytes: LARGE_OUTPUT_BYTES + 1024,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.length).toBe(LARGE_OUTPUT_BYTES);
  });

  test('fails closed when output exceeds the explicit bound', () => {
    expect(() =>
      runCommand({
        command: process.execPath,
        args: ['-e', `process.stdout.write('x'.repeat(${LARGE_OUTPUT_BYTES}))`],
        cwd: process.cwd(),
        maxOutputBytes: 1024,
      }),
    ).toThrow('failed to start');
  });
});
