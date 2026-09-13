import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { ok, type Result } from 'neverthrow';

import { DevGitRepository } from '../src/dev-delivery/dev-git.ts';
import {
  BranchAdvanced,
  DevLandCommand,
  isBranchAdvancedFailure,
} from '../src/dev-delivery/dev-land.ts';
import { DevDeliveryWorkspace } from '../src/dev-delivery/dev-workspace.ts';
import {
  BranchName,
  CommandExecutable,
  type CommandOutput,
  type CommandRequest,
  type CommandRunner,
  CommitSha,
  DevFailureKind,
  type DevLandRequest,
} from '../src/dev-delivery/dev-types.ts';

const SHA_A = '1111111111111111111111111111111111111111';
const SHA_B = '2222222222222222222222222222222222222222';

test('dev:land exposes branch advancement as a typed runtime failure', () => {
  const featureBranch = BranchName.parseFeature('codex/agent-branching');
  const currentHead = CommitSha.parse(SHA_B);
  expect(featureBranch.isOk()).toBe(true);
  expect(currentHead.isOk()).toBe(true);
  if (featureBranch.isErr() || currentHead.isErr()) return;

  const failure = {
    kind: DevFailureKind.Race,
    code: BranchAdvanced,
    branch: featureBranch.value,
    currentHead: currentHead.value,
    message: 'branch advanced',
  };
  expect(isBranchAdvancedFailure(failure)).toBe(true);
  if (isBranchAdvancedFailure(failure)) {
    expect(failure.branch.value()).toBe('codex/agent-branching');
    expect(failure.currentHead.value()).toBe(SHA_B);
  }
});

class DetachedMergeRunner implements CommandRunner {
  readonly requests: CommandRequest[] = [];

  constructor(
    private readonly root: string,
    private readonly devPath: string,
  ) {}

  run(request: CommandRequest): Result<CommandOutput, never> {
    this.requests.push(request);
    if (
      request.executable === CommandExecutable.Git &&
      request.args[0] === 'rev-parse' &&
      request.args[1] === '--git-common-dir'
    ) {
      return ok({ exitCode: 0, stdout: `${this.root}\n`, stderr: '' });
    }
    if (
      request.executable === CommandExecutable.Git &&
      request.args[0] === 'branch' &&
      request.workingDirectory === this.devPath
    ) {
      return ok({ exitCode: 0, stdout: '', stderr: '' });
    }
    return ok({ exitCode: 0, stdout: '', stderr: '' });
  }
}

test('dev:land rejects a non-canonical feature branch before reading Git', () => {
  const root = mkdtempSync(join(tmpdir(), 'nook-dev-land-branch-boundary-'));
  const devPath = join(root, 'dev');
  const originMainSha = CommitSha.parse(SHA_A);
  const pinnedLocalDevSha = CommitSha.parse(SHA_B);
  expect(originMainSha.isOk()).toBe(true);
  expect(pinnedLocalDevSha.isOk()).toBe(true);
  if (originMainSha.isErr() || pinnedLocalDevSha.isErr()) {
    rmSync(root, { recursive: true, force: true });
    return;
  }

  const runner = new DetachedMergeRunner(root, devPath);
  try {
    for (const branch of ['feature/foo', 'child/temp']) {
      const result = new DevLandCommand(
        new DevDeliveryWorkspace({ root, runner }),
      ).execute({
        devPath,
        featureBranch: {
          equals: () => true,
          value: () => branch,
        },
        originMainSha: originMainSha.value,
        pinnedLocalDevSha: pinnedLocalDevSha.value,
      } as unknown as DevLandRequest);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.kind).toBe(DevFailureKind.Configuration);
        expect(result.error.message).toContain('codex branch');
      }
    }
    expect(runner.requests).toHaveLength(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  'merge boundary rejects a detached assigned dev worktree before mutation',
  () => {
    const root = mkdtempSync(join(tmpdir(), 'nook-dev-land-boundary-'));
    const devPath = join(root, 'dev');
    const expectedDevHead = CommitSha.parse(SHA_A);
    const featureHead = CommitSha.parse(SHA_B);
    const featureBranch = BranchName.parse('codex/agent-branching');
    const originMainSha = CommitSha.parse(SHA_A);
    if (
      expectedDevHead.isErr() ||
      featureHead.isErr() ||
      featureBranch.isErr() ||
      originMainSha.isErr()
    ) {
      rmSync(root, { recursive: true, force: true });
      return;
    }
    const runner = new DetachedMergeRunner(root, devPath);
    try {
      const result = new DevGitRepository({ root, runner }).mergeInto({
        devPath,
        expectedDevHead: expectedDevHead.value,
        featureHead: featureHead.value,
        featureBranch: featureBranch.value,
        originMainSha: originMainSha.value,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error.kind).toBe(DevFailureKind.Race);
      expect(
        runner.requests.some(
          ({ args }) => args[0] === 'merge' || args[0] === 'merge-tree',
        ),
      ).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
