import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { ok, type Result } from 'neverthrow';

import { DevGitRepository } from '../src/dev-delivery/dev-git.ts';
import { DevLandCommand } from '../src/dev-delivery/dev-land.ts';
import { DevDeliveryWorkspace } from '../src/dev-delivery/dev-workspace.ts';
import {
  BranchName,
  CommandExecutable,
  type CommandOutput,
  type CommandRequest,
  type CommandRunner,
  CommitSha,
  DevFailureKind,
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

test(
  'dev:land rejects a canonical feature frontier that differs from its published head',
  () => {
    const originMainSha = CommitSha.parse(SHA_A);
    const pinnedLocalDevSha = CommitSha.parse(SHA_A);
    const featureHeadSha = CommitSha.parse(SHA_A);
    const expectedFeatureSha = CommitSha.parse(SHA_B);
    const featureBranch = BranchName.parse('feature/land');
    expect(originMainSha.isOk()).toBe(true);
    expect(pinnedLocalDevSha.isOk()).toBe(true);
    expect(featureHeadSha.isOk()).toBe(true);
    expect(expectedFeatureSha.isOk()).toBe(true);
    expect(featureBranch.isOk()).toBe(true);
    if (
      originMainSha.isErr() ||
      pinnedLocalDevSha.isErr() ||
      featureHeadSha.isErr() ||
      expectedFeatureSha.isErr() ||
      featureBranch.isErr()
    )
      return;

    const runner = new RecordingRunner();
    const result = new DevLandCommand(
      new DevDeliveryWorkspace({ root: '/tmp/nook-dev-land', runner }),
    ).execute({
      originMainSha: originMainSha.value,
      pinnedLocalDevSha: pinnedLocalDevSha.value,
      featureBranch: featureBranch.value,
      featureHeadSha: featureHeadSha.value,
      expectedFeatureSha: expectedFeatureSha.value,
      devPath: '/tmp/nook-dev-land/dev',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr())
      expect(result.error.kind).toBe(DevFailureKind.Configuration);
    expect(
      runner.requests.some(
        ({ executable }) => executable === CommandExecutable.Git,
      ),
    ).toBe(false);
  },
);

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

test(
  'merge boundary rejects a detached assigned dev worktree before mutation',
  () => {
    const root = mkdtempSync(join(tmpdir(), 'nook-dev-land-boundary-'));
    const devPath = join(root, 'dev');
    const expectedDevHead = CommitSha.parse(SHA_A);
    const featureHead = CommitSha.parse(SHA_B);
    const featureBranch = BranchName.parse('feature/land');
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
