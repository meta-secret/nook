import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findRepoRoot } from '../../src/lib/repo.ts';
import {
  type BoundedProcessOutput,
  type RunBoundedProcessRequest,
  runBoundedProcess,
} from '../../src/executable-skills/source-analysis-process.ts';

const REPO_ROOT = findRepoRoot();

async function assertProcessStopped(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      process.kill(pid, 0);
      if (process.platform === 'linux') {
        const processState = (
          await readFile(`/proc/${pid}/stat`, 'utf8')
        ).split(' ')[2];
        if (processState === 'Z') return;
      }
    } catch {
      return;
    }
    await Bun.sleep(50);
  }
  throw new Error(`Process ${pid} remained live after group teardown.`);
}

describe('sealed source analysis bounded process', () => {
  test('bounds stdin, stdout, and stderr independently', async () => {
    const successfulRequest: RunBoundedProcessRequest = {
      command: [
        process.execPath,
        '-e',
        'const input = await Bun.stdin.text(); await Bun.write(Bun.stdout, input); await Bun.write(Bun.stderr, "err");',
      ],
      cwd: REPO_ROOT,
      deadlineExpiresAt: Date.now() + 5_000,
      maximumStderrBytes: 3,
      maximumStdinBytes: 5,
      maximumStdoutBytes: 5,
      signal: false,
      stdin: 'input',
    };
    const expected: BoundedProcessOutput = {
      exitCode: 0,
      stderr: 'err',
      stdout: 'input',
    };
    await expect(runBoundedProcess(successfulRequest)).resolves.toEqual(
      expected,
    );

    const oversizedInputRequest: RunBoundedProcessRequest = {
      ...successfulRequest,
      maximumStdinBytes: 4,
    };
    await expect(runBoundedProcess(oversizedInputRequest)).rejects.toThrow(
      'request is invalid',
    );

    const oversizedOutputRequest: RunBoundedProcessRequest = {
      ...successfulRequest,
      command: [process.execPath, '-e', 'console.log("0123456789")'],
      maximumStdoutBytes: 4,
      stdin: false,
    };
    await expect(runBoundedProcess(oversizedOutputRequest)).rejects.toThrow(
      'stdout exceeds its byte limit',
    );
  });

  test('returns bounded nonzero exits without treating them as success', async () => {
    const request: RunBoundedProcessRequest = {
      command: [process.execPath, '-e', 'process.exit(7)'],
      cwd: REPO_ROOT,
      deadlineExpiresAt: Date.now() + 5_000,
      maximumStderrBytes: 16,
      maximumStdinBytes: 0,
      maximumStdoutBytes: 16,
      signal: false,
      stdin: false,
    };
    const output = await runBoundedProcess(request);
    expect(output.exitCode).toBe(7);
  });

  test('scrubs ambient executable and Docker helper configuration', async () => {
    const script =
      'console.log([process.env.HOME, process.env.PATH, process.env.TMPDIR, process.env.DOCKER_CONFIG ?? ""].join("|"));';
    const request: RunBoundedProcessRequest = {
      command: [process.execPath, '-e', script],
      cwd: REPO_ROOT,
      deadlineExpiresAt: Date.now() + 5_000,
      maximumStderrBytes: 16,
      maximumStdinBytes: 0,
      maximumStdoutBytes: 128,
      signal: false,
      stdin: false,
    };
    const output = await runBoundedProcess(request);
    expect(output.stdout.trim()).toBe('/var/empty|/usr/bin:/bin|/tmp|');
  });

  test('terminates the entire process group before its finite deadline', async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), 'source-analysis-process-'),
    );
    const pidFile = path.join(temporaryDirectory, 'child-pid');
    try {
      const script = [
        `const child = Bun.spawn(["sleep", "30"]);`,
        `await Bun.write(${JSON.stringify(pidFile)}, String(child.pid));`,
        'await new Promise(() => false);',
      ].join('\n');
      const request: RunBoundedProcessRequest = {
        command: [process.execPath, '-e', script],
        cwd: REPO_ROOT,
        deadlineExpiresAt: Date.now() + 1_500,
        maximumStderrBytes: 16,
        maximumStdinBytes: 0,
        maximumStdoutBytes: 16,
        signal: false,
        stdin: false,
      };
      await expect(runBoundedProcess(request)).rejects.toThrow(
        'deadline expired',
      );
      const childPid = Number(await readFile(pidFile, 'utf8'));
      expect(Number.isSafeInteger(childPid)).toBe(true);
      await assertProcessStopped(childPid);
    } finally {
      const removalOptions: RmOptions = { force: true, recursive: true };
      await rm(temporaryDirectory, removalOptions);
    }
  });

  test('keeps inherited output pipes inside the deadline race', async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), 'source-analysis-pipe-'),
    );
    const pidFile = path.join(temporaryDirectory, 'child-pid');
    try {
      const script = [
        'const options = { stdout: "inherit", stderr: "inherit" } as const;',
        'const child = Bun.spawn(["sleep", "30"], options);',
        `await Bun.write(${JSON.stringify(pidFile)}, String(child.pid));`,
      ].join('\n');
      const request: RunBoundedProcessRequest = {
        command: [process.execPath, '-e', script],
        cwd: REPO_ROOT,
        deadlineExpiresAt: Date.now() + 1_500,
        maximumStderrBytes: 16,
        maximumStdinBytes: 0,
        maximumStdoutBytes: 16,
        signal: false,
        stdin: false,
      };
      await expect(runBoundedProcess(request)).rejects.toThrow(
        'deadline expired',
      );
      const childPid = Number(await readFile(pidFile, 'utf8'));
      await assertProcessStopped(childPid);
    } finally {
      const removalOptions: RmOptions = { force: true, recursive: true };
      await rm(temporaryDirectory, removalOptions);
    }
  });

  test('aborts and rejects unbounded deadline inputs', async () => {
    const controller = new AbortController();
    const abortedRequest: RunBoundedProcessRequest = {
      command: [process.execPath, '-e', 'await new Promise(() => false)'],
      cwd: REPO_ROOT,
      deadlineExpiresAt: Date.now() + 5_000,
      maximumStderrBytes: 16,
      maximumStdinBytes: 0,
      maximumStdoutBytes: 16,
      signal: controller.signal,
      stdin: false,
    };
    setTimeout(() => controller.abort(), 20);
    await expect(runBoundedProcess(abortedRequest)).rejects.toThrow('aborted');

    const unboundedRequest: RunBoundedProcessRequest = {
      ...abortedRequest,
      deadlineExpiresAt: Date.now() + 10 * 60 * 1_000,
      signal: false,
    };
    await expect(runBoundedProcess(unboundedRequest)).rejects.toThrow(
      'request is invalid',
    );
  });
});
