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

  constructor(private readonly root: string) {}

  run(request: CommandRequest): Result<CommandOutput, never> {
    this.requests.push(request);
    if (
      request.executable === CommandExecutable.Git &&
      request.args[0] === 'rev-parse' &&
      request.args[1] === '--git-common-dir'
    ) {
      return ok({ exitCode: 0, stdout: `${this.root}\n`, stderr: '' });
    }
    return ok({ exitCode: 0, stdout: '', stderr: '' });
  }
}

test('dev:land rejects a non-canonical feature branch before reading Git', () => {
  const root = mkdtempSync(join(tmpdir(), 'nook-dev-land-branch-boundary-'));
  const runner = new DetachedMergeRunner(root);
  try {
    for (const branch of ['feature/foo', 'child/temp']) {
      const validBranch = BranchName.parseFeature('codex/agent-branching');
      expect(validBranch.isOk()).toBe(true);
      if (validBranch.isErr()) return;
      Object.defineProperty(validBranch.value, 'value', {
        configurable: true,
        value: () => branch,
      });
      const result = new DevLandCommand(
        new DevDeliveryWorkspace({ root, runner }),
      ).execute({ featureBranch: validBranch.value });

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

test('merge boundary rejects a detached feature worktree before mutation', () => {
    const root = mkdtempSync(join(tmpdir(), 'nook-dev-land-boundary-'));
    const featureHead = CommitSha.parse(SHA_B);
    const featureBranch = BranchName.parse('codex/agent-branching');
    if (featureHead.isErr() || featureBranch.isErr()) {
      rmSync(root, { recursive: true, force: true });
      return;
    }
    const runner = new DetachedMergeRunner(root);
    try {
      const result = new DevGitRepository({ root, runner }).mergeInto({
        featureHead: featureHead.value,
        featureBranch: featureBranch.value,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error.kind).toBe(DevFailureKind.Race);
      expect(
        runner.requests.some(
          ({ args }) => args[0] === 'merge' || args[0] === 'update-ref',
        ),
      ).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
