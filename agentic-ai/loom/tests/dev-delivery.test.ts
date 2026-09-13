import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { ok, type Result } from 'neverthrow';

import {
  DevGitRepository,
  DevelopmentWorktreeSelection,
  WorktreeInventoryDecoder,
} from '../src/dev-delivery/dev-git.ts';
import {
  DevelopmentCiAttemptPolicy,
  DevDeliveryContract,
} from '../src/dev-delivery/dev-github.ts';
import { DevLock, DevLockName } from '../src/dev-delivery/dev-lock.ts';
import {
  BranchName,
  CommandExecutable,
  type CommandOutput,
  type CommandRequest,
  type CommandRunner,
  CommitSha,
  ManagedBranch,
  WorktreeBranchKind,
  WorktreeRecord,
  WorkflowRunId,
} from '../src/dev-delivery/dev-types.ts';

const SHA_A = '1111111111111111111111111111111111111111';
const SHA_B = '2222222222222222222222222222222222222222';

class RecordingRunner implements CommandRunner {
  readonly requests: CommandRequest[] = [];

  run(request: CommandRequest): Result<CommandOutput, never> {
    this.requests.push(request);
    return ok({ exitCode: 0, stdout: '', stderr: '' });
  }
}

test('worktree decoding excludes prunable development worktrees', () => {
  const source = [
    `worktree /tmp/dev\nHEAD ${SHA_A}\nbranch refs/heads/dev\n`,
    `worktree /tmp/prunable\nHEAD ${SHA_B}\nbranch refs/heads/dev\nprunable\n`,
  ].join('\n');
  const decoded = new WorktreeInventoryDecoder().decode(source);
  expect(decoded.isOk()).toBe(true);
  if (decoded.isErr()) return;
  expect(new DevelopmentWorktreeSelection().select(decoded.value).isOk()).toBe(
    true,
  );
});

test('selection refuses competing usable dev worktrees', () => {
  const main = BranchName.parse(ManagedBranch.Dev);
  const headA = CommitSha.parse(SHA_A);
  const headB = CommitSha.parse(SHA_B);
  expect(main.isOk()).toBe(true);
  expect(headA.isOk()).toBe(true);
  expect(headB.isOk()).toBe(true);
  if (main.isErr() || headA.isErr() || headB.isErr()) return;
  const records = [
    new WorktreeRecord({
      path: '/tmp/a',
      head: headA.value,
      branch: { kind: WorktreeBranchKind.Branch, name: main.value },
      prunable: false,
    }),
    new WorktreeRecord({
      path: '/tmp/b',
      head: headB.value,
      branch: { kind: WorktreeBranchKind.Branch, name: main.value },
      prunable: false,
    }),
  ];
  const selected = new DevelopmentWorktreeSelection().select(records);
  expect(selected.isErr()).toBe(true);
});

test('lock acquisition fails closed when a stale-looking lock exists', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nook-dev-lock-'));
  const lockPath = join(directory, DevLockName.LocalLanding);
  mkdirSync(lockPath);
  const result = new DevLock({
    commonDirectory: directory,
    name: DevLockName.LocalLanding,
  }).acquire();
  expect(result.isErr()).toBe(true);
  rmSync(directory, { recursive: true, force: true });
});

test('exact push uses an ordinary refspec without force or merge policy flags', () => {
  const runner = new RecordingRunner();
  const root = '/tmp/nook-dev-repository';
  const repository = new DevGitRepository({ root, runner });
  const sha = CommitSha.parse(SHA_A);
  expect(sha.isOk()).toBe(true);
  if (sha.isErr()) return;
  const result = repository.pushExact({
    target: ManagedBranch.Dev,
    sha: sha.value,
    workingDirectory: root,
  });
  expect(result.isOk()).toBe(true);
  const request = runner.requests[0];
  expect(request?.executable).toBe(CommandExecutable.Git);
  expect(request?.args).toEqual(['push', 'origin', `${SHA_A}:refs/heads/dev`]);
});

test('commit parser rejects arbitrary build-proof text', () => {
  expect(CommitSha.parse('build succeeded').isErr()).toBe(true);
});

test('publication CI policy rejects active attempts and permits terminal attempts', () => {
  const runId = WorkflowRunId.parse(7);
  expect(runId.isOk()).toBe(true);
  if (runId.isErr()) return;
  const policy = new DevelopmentCiAttemptPolicy();
  expect(
    policy
      .requireTerminal({
        attempts: [{ runId: runId.value, status: 'queued' }],
        replacement: true,
      })
      .isErr(),
  ).toBe(true);
  expect(
    policy
      .requireTerminal({
        attempts: [{ runId: runId.value, status: 'in_progress' }],
        replacement: true,
      })
      .isErr(),
  ).toBe(true);
  expect(
    policy
      .requireTerminal({
        attempts: [{ runId: runId.value, status: 'completed' }],
        replacement: true,
      })
      .isOk(),
  ).toBe(true);
  expect(
    policy.requireTerminal({ attempts: [], replacement: true }).isErr(),
  ).toBe(true);
  expect(
    policy.requireTerminal({ attempts: [], replacement: false }).isOk(),
  ).toBe(true);
});

test('promotion contract keeps the stable aggregate readiness gate', () => {
  expect(DevDeliveryContract.promotion.requiredJobs).toEqual([
    'Dev promotion readiness',
  ]);
});
