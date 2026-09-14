import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { ok, type Result } from 'neverthrow';

import { DevPublishCommand } from '../src/dev-delivery/dev-publish.ts';
import { DevDeliveryWorkspace } from '../src/dev-delivery/dev-workspace.ts';
import {
  CommandExecutable,
  type CommandOutput,
  type CommandRequest,
  type CommandRunner,
  CommitSha,
  DevFailureKind,
} from '../src/dev-delivery/dev-types.ts';

const SHA_MAIN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SHA_PRIOR = '1111111111111111111111111111111111111111';
const SHA_SELECTED = '2222222222222222222222222222222222222222';

interface PullRequestFixture {
  readonly number: number;
  readonly headSha: string;
  readonly url: string;
}

type DevPublishPublicationRequest = {
  readonly pullRequests: readonly (PullRequestFixture | false)[];
  readonly ciStatuses?: readonly string[];
};

/** Simulates the bounded Git and GitHub observations used by dev:publish. */
class PublishRunner implements CommandRunner {
  readonly requests: CommandRequest[] = [];
  private remoteDevSha = SHA_PRIOR;
  private pullRequestIndex = 0;
  private currentPullRequest: PullRequestFixture | false = false;
  private ciIndex = 0;

  constructor(
    private readonly request: {
      readonly root: string;
      readonly devPath: string;
      readonly pullRequests: readonly (PullRequestFixture | false)[];
      readonly ciStatuses: readonly string[];
    },
  ) {}

  run(request: CommandRequest): Result<CommandOutput, never> {
    this.requests.push(request);
    return request.executable === CommandExecutable.Git
      ? this.git(request)
      : this.github(request);
  }

  private git(request: CommandRequest): Result<CommandOutput, never> {
    const args = request.args;
    if (!args[0]) return ok(this.output());
    switch (args[0]) {
      case 'rev-parse':
        return ok(
          this.output({
            stdout:
              args[1] === '--git-common-dir'
                ? `${this.request.root}\n`
                : `${SHA_SELECTED}\n`,
          }),
        );
      case 'worktree':
        return ok(
          this.output({
            stdout: [
              `worktree ${this.request.devPath}`,
              `HEAD ${SHA_SELECTED}`,
              'branch refs/heads/dev',
              '',
            ].join('\n'),
          }),
        );
      case 'status':
        return ok(this.output());
      case 'branch':
        return ok(this.output({ stdout: 'dev\n' }));
      case 'fetch':
        return ok(this.output());
      case 'ls-remote':
        return ok(
          this.output({
            stdout:
              args.at(-1) === 'refs/heads/main'
                ? `${SHA_MAIN} refs/heads/main\n`
                : `${this.remoteDevSha} refs/heads/dev\n`,
          }),
        );
      case 'merge-base':
        return ok(this.output());
      case 'push':
        this.remoteDevSha = SHA_SELECTED;
        return ok(this.output());
      default:
        return ok(this.output());
    }
  }

  private github(request: CommandRequest): Result<CommandOutput, never> {
    const args = request.args;
    if (args[0] === 'repo' && args[1] === 'view') {
      return ok(this.output({ stdout: 'nook/example\n' }));
    }
    if (args[0] === 'pr' && args[1] === 'list') {
      const next = this.request.pullRequests[this.pullRequestIndex] ?? false;
      this.pullRequestIndex += 1;
      this.currentPullRequest = next;
      return ok(this.pullRequestList(next));
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      return ok(this.pullRequestView(this.currentPullRequest));
    }
    if (args[0] === 'run' && args[1] === 'list') {
      const status =
        this.request.ciStatuses[this.ciIndex] ||
        this.request.ciStatuses.at(-1) ||
        'completed';
      this.ciIndex += 1;
      return ok(
        this.output({
          stdout: JSON.stringify([
            {
              databaseId: 17,
              headBranch: 'dev',
              headSha: SHA_PRIOR,
              status,
              conclusion: 'success',
              event: 'pull_request',
              workflowName: 'CI',
            },
          ]),
        }),
      );
    }
    return ok(this.output());
  }

  private pullRequestList(
    pullRequest: PullRequestFixture | false,
  ): CommandOutput {
    if (!pullRequest) return this.output({ stdout: '[]' });
    return this.output({
      stdout: JSON.stringify([
        {
          number: pullRequest.number,
          headRefName: 'dev',
          baseRefName: 'main',
          headRefOid: pullRequest.headSha,
          baseRefOid: SHA_MAIN,
          url: pullRequest.url,
          isDraft: false,
          headRepository: { nameWithOwner: 'nook/example' },
          baseRepository: { nameWithOwner: 'nook/example' },
          isCrossRepository: false,
        },
      ]),
    });
  }

  private pullRequestView(
    pullRequest: PullRequestFixture | false,
  ): CommandOutput {
    if (!pullRequest) return this.output({ stdout: '{}' });
    return this.output({
      stdout: JSON.stringify({
        number: pullRequest.number,
        headRefName: 'dev',
        baseRefName: 'main',
        headRefOid: pullRequest.headSha,
        baseRefOid: SHA_MAIN,
        url: pullRequest.url,
        isDraft: false,
        state: 'OPEN',
        headRepository: { nameWithOwner: 'nook/example' },
        isCrossRepository: false,
        reviewDecision: 'REVIEW_REQUIRED',
      }),
    });
  }

  private output(
    request: { readonly stdout?: string; readonly exitCode?: number } = {},
  ): CommandOutput {
    return {
      exitCode: typeof request.exitCode === 'number' ? request.exitCode : 0,
      stdout: typeof request.stdout === 'string' ? request.stdout : '',
      stderr: '',
    };
  }
}

class DevPublishPullRequestFixture {
  private constructor(
    private readonly request: {
      readonly number?: number;
      readonly headSha?: string;
    },
  ) {}

  static from(
    request: { readonly number?: number; readonly headSha?: string } = {},
  ): PullRequestFixture {
    return new DevPublishPullRequestFixture(request).execute();
  }

  private execute(): PullRequestFixture {
    const request = this.request;
    return {
      number: request.number || 42,
      headSha: request.headSha || SHA_PRIOR,
      url: `https://github.example/pr/${request.number || 42}`,
    };
  }
}

class DevPublishPublicationScenario {
  constructor(private readonly request: DevPublishPublicationRequest) {}

  execute(): {
    readonly runner: PublishRunner;
    readonly result: ReturnType<DevPublishCommand['execute']>;
  } {
    const request = this.request;
    const root = mkdtempSync(join(tmpdir(), 'nook-dev-publish-'));
    const devPath = join(root, 'dev');
    const runner = new PublishRunner({
      root,
      devPath,
      pullRequests: request.pullRequests,
      ciStatuses: request.ciStatuses || ['completed'],
    });
    const workspace = new DevDeliveryWorkspace({ root, runner });
    const expectedSha = CommitSha.parse(SHA_SELECTED);
    if (expectedSha.isErr()) throw new Error(expectedSha.error.message);
    const result = new DevPublishCommand(workspace).execute({
      expectedSha: expectedSha.value,
    });
    rmSync(root, { recursive: true, force: true });
    return { runner, result };
  }
}

test('publication rejects a PR that appears before the final push boundary', () => {
  const { result, runner } = new DevPublishPublicationScenario({
    pullRequests: [false, DevPublishPullRequestFixture.from()],
  }).execute();

  expect(result.isErr()).toBe(true);
  if (result.isErr()) expect(result.error.kind).toBe(DevFailureKind.Race);
  expect(runner.requests.some((request) => request.args[0] === 'push')).toBe(
    false,
  );
});

test('publication rejects a changed PR head before the final push boundary', () => {
  const { result, runner } = new DevPublishPublicationScenario({
    pullRequests: [
      DevPublishPullRequestFixture.from(),
      DevPublishPullRequestFixture.from({ headSha: SHA_SELECTED }),
    ],
  }).execute();

  expect(result.isErr()).toBe(true);
  if (result.isErr()) expect(result.error.kind).toBe(DevFailureKind.Race);
  expect(runner.requests.some((request) => request.args[0] === 'push')).toBe(
    false,
  );
});

test('publication rechecks replacement CI and rejects an active attempt', () => {
  const { result, runner } = new DevPublishPublicationScenario({
    pullRequests: [
      DevPublishPullRequestFixture.from(),
      DevPublishPullRequestFixture.from(),
    ],
    ciStatuses: ['completed', 'in_progress'],
  }).execute();

  expect(result.isErr()).toBe(true);
  if (result.isErr()) expect(result.error.kind).toBe(DevFailureKind.Checks);
  expect(runner.requests.some((request) => request.args[0] === 'push')).toBe(
    false,
  );
});

test('publication pushes the selected SHA when the PR and CI remain frozen', () => {
  const { result, runner } = new DevPublishPublicationScenario({
    pullRequests: [
      DevPublishPullRequestFixture.from(),
      DevPublishPullRequestFixture.from(),
    ],
    ciStatuses: ['completed', 'completed'],
  }).execute();

  expect(result.isOk()).toBe(true);
  expect(
    runner.requests.some(
      (request) =>
        request.args[0] === 'push' &&
        request.args[2] === `${SHA_SELECTED}:refs/heads/dev`,
    ),
  ).toBe(true);
});
