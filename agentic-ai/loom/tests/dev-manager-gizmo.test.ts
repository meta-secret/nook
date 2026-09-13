import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { err, ok, type Result } from 'neverthrow';

import {
  DevManagerGizmoAction,
  DevManagerGizmoCommand,
  DevManagerGizmoState,
} from '../src/dev-delivery/dev-manager-gizmo.ts';
import { DevPrManagerCommand } from '../src/dev-delivery/dev-pr-manager.ts';
import { DevDeliveryWorkspace } from '../src/dev-delivery/dev-workspace.ts';
import {
  CommandExecutable,
  type CommandOutput,
  type CommandRequest,
  type CommandRunner,
  CommitSha,
  DevFailureKind,
  ManagedBranch,
  type DevFailure,
} from '../src/dev-delivery/dev-types.ts';

const SHA_A = '1111111111111111111111111111111111111111';
const SHA_B = '2222222222222222222222222222222222222222';
const SHA_MAIN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

interface PullRequestFixture {
  readonly headSha: string;
}

interface ScenarioOptions {
  readonly localSha: string;
  readonly remoteDevSha: string;
  readonly originMainSha?: string;
  readonly mainSha?: string;
  readonly ancestryPairs: readonly (readonly [string, string])[];
  readonly remoteDevPresent?: boolean;
  readonly pullRequest?: PullRequestFixture;
  readonly dirtyMain?: boolean;
  readonly dirtyDev?: boolean;
  readonly malformedWorktree?: boolean;
  readonly reportedWorktreeSha?: string;
  readonly observedHeadSha?: string;
  readonly pullRequestAppearsAfterAdmission?: boolean;
  readonly foreignPullRequestOnRecheck?: boolean;
  readonly remoteDevChangesBeforeMutation?: boolean;
}

/** Simulates local Git and bounded manager-seam transport responses. */
class DevManagerGizmoRunner implements CommandRunner {
  readonly requests: CommandRequest[] = [];
  private remoteDevPresent: boolean;
  private remoteDevSha: string;
  private pullRequest: PullRequestFixture | undefined;
  private readonly originMainSha: string;
  private fetchedOriginMainSha: string | undefined;
  private pullRequestListCount = 0;
  private pullRequestViewCount = 0;

  constructor(
    private readonly request: {
      readonly root: string;
      readonly mainPath: string;
      readonly devPath: string;
      readonly options: ScenarioOptions;
    },
  ) {
    this.remoteDevPresent = request.options.remoteDevPresent ?? true;
    this.remoteDevSha = request.options.remoteDevSha;
    this.pullRequest = request.options.pullRequest;
    this.originMainSha = request.options.originMainSha ?? SHA_MAIN;
  }

  run(request: CommandRequest): Result<CommandOutput, DevFailure> {
    this.requests.push(request);
    if (request.executable === CommandExecutable.Git) {
      return this.git(request);
    }
    return this.github(request);
  }

  private git(request: CommandRequest): Result<CommandOutput, DevFailure> {
    const args = request.args;
    switch (args[0]) {
      case 'fetch':
        this.fetchedOriginMainSha = this.originMainSha;
        return ok(this.output());
      case 'worktree':
        return ok(
          this.output({
            stdout: this.request.options.malformedWorktree
              ? `worktree ${this.request.mainPath}\nbranch refs/heads/main\n`
              : [
                  `worktree ${this.request.mainPath}`,
                  `HEAD ${this.request.options.mainSha ?? this.originMainSha}`,
                  'branch refs/heads/main',
                  '',
                  `worktree ${this.request.devPath}`,
                  `HEAD ${this.request.options.reportedWorktreeSha ?? this.request.options.localSha}`,
                  'branch refs/heads/dev',
                  '',
                ].join('\n'),
          }),
        );
      case 'status':
        return ok(
          this.output({
            stdout:
              request.workingDirectory === this.request.mainPath
                ? this.request.options.dirtyMain
                  ? 'dirty main\n'
                  : ''
                : this.request.options.dirtyDev
                  ? 'dirty dev\n'
                  : '',
          }),
        );
      case 'branch':
        return ok(
          this.output({
            stdout: `${
              request.workingDirectory === this.request.mainPath ? 'main' : 'dev'
            }\n`,
          }),
        );
      case 'rev-parse':
        return ok(
          this.output({
            stdout:
              args[1] === '--git-common-dir'
                ? `${this.request.root}\n`
                : args[1] === '--verify' &&
                    args[2] === 'refs/remotes/origin/main^{commit}'
                  ? `${this.fetchedOriginMainSha ?? this.originMainSha}\n`
                  : `${
                      request.workingDirectory === this.request.devPath
                        ? (this.request.options.observedHeadSha ??
                          this.request.options.localSha)
                        : (this.request.options.mainSha ?? this.originMainSha)
                    }\n`,
          }),
        );
      case 'ls-remote':
        return this.remoteBranch(args);
      case 'merge-base':
        return this.ancestry(args);
      case 'push':
        this.remoteDevPresent = true;
        this.remoteDevSha = this.pushSha(args);
        return ok(this.output());
      default:
        return ok(this.output());
    }
  }

  private remoteBranch(
    args: readonly string[],
  ): Result<CommandOutput, DevFailure> {
    const reference = args.at(-1);
    if (reference === 'refs/heads/main') {
      return ok(
        this.output({
          stdout: `${this.fetchedOriginMainSha ?? this.originMainSha} refs/heads/main\n`,
        }),
      );
    }
    if (reference === 'refs/heads/dev' && this.remoteDevPresent) {
      return ok(
        this.output({ stdout: `${this.remoteDevSha} refs/heads/dev\n` }),
      );
    }
    return ok(this.output());
  }

  private ancestry(args: readonly string[]): Result<CommandOutput, DevFailure> {
    const ancestor = args[2];
    const descendant = args[3];
    const isAncestor = this.request.options.ancestryPairs.some(
      (pair) => pair[0] === ancestor && pair[1] === descendant,
    );
    return ok(this.output({ exitCode: isAncestor ? 0 : 1 }));
  }

  private pushSha(args: readonly string[]): string {
    const refspec = args[2] ?? '';
    return refspec.split(':')[0] ?? this.request.options.localSha;
  }

  private github(request: CommandRequest): Result<CommandOutput, DevFailure> {
    const args = request.args;
    if (args[0] === 'repo' && args[1] === 'view') {
      return ok(this.output({ stdout: 'nook/example\n' }));
    }
    if (args[0] === 'pr' && args[1] === 'list') {
      this.pullRequestListCount += 1;
      return ok(this.pullRequestList());
    }
    if (args[0] === 'pr' && args[1] === 'create') {
      this.pullRequest = {
        headSha: this.remoteDevSha,
      };
      return ok(this.output({ stdout: 'https://github.example/pr/42\n' }));
    }
    if (args[0] === 'pr' && args[1] === 'edit') {
      return ok(this.output());
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      this.pullRequestViewCount += 1;
      if (
        this.request.options.remoteDevChangesBeforeMutation &&
        this.pullRequestViewCount === 2
      ) {
        this.remoteDevSha = SHA_A;
      }
      return ok(this.pullRequestView());
    }
    return ok(this.output());
  }

  private pullRequestList(): CommandOutput {
    if (
      !this.pullRequest &&
      !(
        this.request.options.pullRequestAppearsAfterAdmission &&
        this.pullRequestListCount === 2
      )
    ) {
      return this.output({ stdout: '[]' });
    }
    const headSha =
      this.pullRequest?.headSha ?? this.request.options.localSha;
    return this.output({
      stdout: JSON.stringify([
        {
          number: 42,
          headRefName: 'dev',
          baseRefName: 'main',
          headRefOid: headSha,
          baseRefOid: this.originMainSha,
          url: 'https://github.example/pr/42',
          isDraft: false,
        },
      ]),
    });
  }

  private pullRequestView(): CommandOutput {
    const pullRequest = this.pullRequest;
    const foreign =
      this.request.options.foreignPullRequestOnRecheck &&
      this.pullRequestViewCount === 2;
    return this.output({
      stdout: JSON.stringify({
        number: 42,
        headRefName: 'dev',
        baseRefName: 'main',
        headRefOid: pullRequest?.headSha ?? this.remoteDevSha,
        baseRefOid: this.originMainSha,
        url: 'https://github.example/pr/42',
        isDraft: false,
        state: 'OPEN',
        headRepository: {
          nameWithOwner: foreign ? 'other/example' : 'nook/example',
        },
        baseRepository: {
          nameWithOwner: foreign ? 'other/example' : 'nook/example',
        },
        reviewDecision: 'REVIEW_REQUIRED',
      }),
    });
  }

  private output(
    request: {
      readonly stdout?: string;
      readonly exitCode?: number;
    } = {},
  ): CommandOutput {
    return {
      exitCode: request.exitCode ?? 0,
      stdout: request.stdout ?? '',
      stderr: '',
    };
  }
}

class DevManagerGizmoHarness {
  readonly root: string;
  readonly mainPath: string;
  readonly devPath: string;
  readonly runner: DevManagerGizmoRunner;
  readonly workspace: DevDeliveryWorkspace;

  constructor(options: ScenarioOptions) {
    this.root = mkdtempSync(join(tmpdir(), 'nook-dev-manager-gizmo-'));
    this.mainPath = join(this.root, 'main');
    this.devPath = join(this.root, 'dev');
    this.runner = new DevManagerGizmoRunner({
      root: this.root,
      mainPath: this.mainPath,
      devPath: this.devPath,
      options,
    });
    this.workspace = new DevDeliveryWorkspace({
      root: this.root,
      runner: this.runner,
    });
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}

test('reports idle when local dev has no commits beyond refreshed main', () => {
  const harness = new DevManagerGizmoHarness({
    localSha: SHA_MAIN,
    remoteDevSha: SHA_MAIN,
    ancestryPairs: [],
  });
  try {
    const result = new DevManagerGizmoCommand(harness.workspace).execute();
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.state).toBe(DevManagerGizmoState.Idle);
    expect(result.value.action).toBe(DevManagerGizmoAction.NoAction);
    expect(result.value.expectedSha.value()).toBe(SHA_MAIN);
    expect(result.value.originMainSha.value()).toBe(SHA_MAIN);
    expect(result.value.pinnedLocalDevSha.value()).toBe(SHA_MAIN);
    expect(result.value.message).toContain(
      'no local commits exist beyond origin/main',
    );
    expect(
      harness.runner.requests.some(
        (request) =>
          request.executable === CommandExecutable.Git &&
          request.args[0] === 'fetch' &&
          request.args[1] === '--prune' &&
          request.args[2] === 'origin',
      ),
    ).toBe(true);
    expect(
      harness.runner.requests.some(
        (request) =>
          request.executable === CommandExecutable.Git &&
          request.args[0] === 'rev-parse' &&
          request.args[1] === '--verify' &&
          request.args[2] === 'refs/remotes/origin/main^{commit}',
      ),
    ).toBe(true);
    expect(
      harness.runner.requests.some(
        (request) => request.executable === CommandExecutable.GitHub,
      ),
    ).toBe(false);
  } finally {
    harness.dispose();
  }
});

test('reports idle when no origin/dev snapshot has been published', () => {
  const harness = new DevManagerGizmoHarness({
    localSha: SHA_MAIN,
    remoteDevSha: SHA_MAIN,
    ancestryPairs: [],
    remoteDevPresent: false,
  });
  try {
    const result = new DevManagerGizmoCommand(harness.workspace).execute();
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.state).toBe(DevManagerGizmoState.Idle);
    expect(result.value.action).toBe(DevManagerGizmoAction.NoAction);
    expect(result.value.expectedSha.value()).toBe(SHA_MAIN);
    expect(result.value.originMainSha.value()).toBe(SHA_MAIN);
    expect(result.value.pinnedLocalDevSha.value()).toBe(SHA_MAIN);
    expect(
      harness.runner.requests.some(
        (request) => request.executable === CommandExecutable.GitHub,
      ),
    ).toBe(false);
  } finally {
    harness.dispose();
  }
});

test('returns a typed publication handoff for unpublished local dev without publishing it', () => {
  const harness = new DevManagerGizmoHarness({
    localSha: SHA_B,
    remoteDevSha: SHA_A,
    ancestryPairs: [
      [SHA_MAIN, SHA_B],
      [SHA_A, SHA_B],
    ],
  });
  try {
    const result = new DevManagerGizmoCommand(harness.workspace).execute();
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.state).toBe(DevManagerGizmoState.ValidationRequired);
    expect(result.value.action).toBe(DevManagerGizmoAction.Publish);
    expect(result.value.expectedSha.value()).toBe(SHA_B);
    expect(result.value.originMainSha.value()).toBe(SHA_MAIN);
    expect(result.value.pinnedLocalDevSha.value()).toBe(SHA_B);
    expect(result.value.message).toContain(SHA_B);
    expect(result.value.message).toContain(
      'route the typed dev:publish handoff through Delivery Pipeline Team Gizmo to PR Lifecycle',
    );
    expect(result.value.publicationHandoff).toEqual({
      operation: 'dev:publish',
      controller: 'dev-manager',
      route: 'delivery-pipeline-gizmo',
      executor: 'pr-lifecycle',
      repositoryRoot: harness.root,
      devPath: harness.devPath,
      targetBranch: ManagedBranch.Dev,
      expectedSha: result.value.expectedSha,
      originMainSha: result.value.originMainSha,
      pinnedLocalDevSha: result.value.pinnedLocalDevSha,
    });
    expect(
      harness.runner.requests.some(
        (request) =>
          request.executable === CommandExecutable.Git &&
          request.args[0] === 'push',
      ),
    ).toBe(false);
    expect(
      harness.runner.requests.some(
        (request) => request.executable === CommandExecutable.GitHub,
      ),
    ).toBe(false);
  } finally {
    harness.dispose();
  }
});

test('returns a publication handoff while preserving newer local dev during validation', () => {
  const harness = new DevManagerGizmoHarness({
    localSha: SHA_B,
    remoteDevSha: SHA_A,
    ancestryPairs: [
      [SHA_MAIN, SHA_B],
      [SHA_A, SHA_B],
    ],
  });
  try {
    const result = new DevManagerGizmoCommand(harness.workspace).execute();
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.state).toBe(DevManagerGizmoState.ValidationRequired);
    expect(result.value.action).toBe(DevManagerGizmoAction.Publish);
    expect(result.value.expectedSha.value()).toBe(SHA_B);
    expect(result.value.originMainSha.value()).toBe(SHA_MAIN);
    expect(result.value.pinnedLocalDevSha.value()).toBe(SHA_B);
    expect(result.value.localDevSha.value()).toBe(SHA_B);
    expect(result.value.publicationHandoff?.expectedSha.value()).toBe(SHA_B);
    expect(
      harness.runner.requests.some(
        (request) =>
          request.executable === CommandExecutable.Git &&
          request.args[0] === 'push',
      ),
    ).toBe(false);
    expect(
      harness.runner.requests.some(
        (request) => request.executable === CommandExecutable.GitHub,
      ),
    ).toBe(false);
  } finally {
    harness.dispose();
  }
});

test('uses the manager-only PR seam for an already frozen snapshot without observing provider readiness', () => {
  const harness = new DevManagerGizmoHarness({
    localSha: SHA_B,
    remoteDevSha: SHA_B,
    ancestryPairs: [[SHA_MAIN, SHA_B]],
  });
  try {
    const result = new DevManagerGizmoCommand(harness.workspace).execute();
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.state).toBe(DevManagerGizmoState.ValidationRequired);
    expect(result.value.action).toBe(DevManagerGizmoAction.WaitForValidation);
    expect(result.value.expectedSha.value()).toBe(SHA_B);
    expect(result.value.originMainSha.value()).toBe(SHA_MAIN);
    expect(result.value.pinnedLocalDevSha.value()).toBe(SHA_B);
    expect(result.value.pullRequestUrl).toBe('https://github.example/pr/42');
    expect(
      harness.runner.requests.some(
        (request) =>
          request.executable === CommandExecutable.Git &&
          request.args[0] === 'push',
      ),
    ).toBe(false);
    expect(
      harness.runner.requests.some(
        (request) =>
          request.executable === CommandExecutable.GitHub &&
          (request.args[0] === 'run' || request.args[0] === 'api'),
      ),
    ).toBe(false);
  } finally {
    harness.dispose();
  }
});

test('requires the exact selected SHA before invoking the manager PR seam', () => {
  const harness = new DevManagerGizmoHarness({
    localSha: SHA_B,
    remoteDevSha: SHA_A,
    ancestryPairs: [[SHA_MAIN, SHA_B]],
  });
  const expectedSha = CommitSha.parse(SHA_B);
  try {
    expect(expectedSha.isOk()).toBe(true);
    if (expectedSha.isErr()) return;
    const result = new DevPrManagerCommand({
      workspace: harness.workspace,
      expectedSha: expectedSha.value,
    }).execute();
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.kind).toBe(DevFailureKind.Race);
    expect(result.error.message).toContain(SHA_B);
    expect(
      harness.runner.requests.some(
        (request) => request.executable === CommandExecutable.GitHub,
      ),
    ).toBe(false);
  } finally {
    harness.dispose();
  }
});

test('rejects a mismatched existing PR before any PR mutation', () => {
  const harness = new DevManagerGizmoHarness({
    localSha: SHA_B,
    remoteDevSha: SHA_B,
    pullRequest: { headSha: SHA_A },
    ancestryPairs: [[SHA_MAIN, SHA_B]],
  });
  const expectedSha = CommitSha.parse(SHA_B);
  try {
    expect(expectedSha.isOk()).toBe(true);
    if (expectedSha.isErr()) return;
    const result = new DevPrManagerCommand({
      workspace: harness.workspace,
      expectedSha: expectedSha.value,
    }).execute();
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.kind).toBe(DevFailureKind.Race);
    expect(result.error.message).toContain('refusing to mutate it');
    expect(
      harness.runner.requests.some(
        (request) =>
          request.executable === CommandExecutable.GitHub &&
          (request.args[0] === 'pr' &&
            (request.args[1] === 'create' || request.args[1] === 'edit')),
      ),
    ).toBe(false);
  } finally {
    harness.dispose();
  }
});

test('rejects a newly appearing PR instead of selecting it after absent admission', () => {
  const harness = new DevManagerGizmoHarness({
    localSha: SHA_B,
    remoteDevSha: SHA_B,
    pullRequestAppearsAfterAdmission: true,
    ancestryPairs: [[SHA_MAIN, SHA_B]],
  });
  const expectedSha = CommitSha.parse(SHA_B);
  try {
    expect(expectedSha.isOk()).toBe(true);
    if (expectedSha.isErr()) return;
    const result = new DevPrManagerCommand({
      workspace: harness.workspace,
      expectedSha: expectedSha.value,
    }).execute();
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.kind).toBe(DevFailureKind.Race);
    expect(result.error.message).toContain('appeared after admission');
    expect(
      harness.runner.requests.some(
        (request) =>
          request.executable === CommandExecutable.GitHub &&
          request.args[0] === 'pr' &&
          request.args[1] === 'create',
      ),
    ).toBe(false);
  } finally {
    harness.dispose();
  }
});

test('rechecks the admitted PR repository before editing it', () => {
  const harness = new DevManagerGizmoHarness({
    localSha: SHA_B,
    remoteDevSha: SHA_B,
    pullRequest: { headSha: SHA_B },
    foreignPullRequestOnRecheck: true,
    ancestryPairs: [[SHA_MAIN, SHA_B]],
  });
  const expectedSha = CommitSha.parse(SHA_B);
  try {
    expect(expectedSha.isOk()).toBe(true);
    if (expectedSha.isErr()) return;
    const result = new DevPrManagerCommand({
      workspace: harness.workspace,
      expectedSha: expectedSha.value,
    }).execute();
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.kind).toBe(DevFailureKind.Race);
    expect(result.error.message).toContain('identity or repository');
    expect(
      harness.runner.requests.some(
        (request) =>
          request.executable === CommandExecutable.GitHub &&
          request.args[0] === 'pr' &&
          request.args[1] === 'edit',
      ),
    ).toBe(false);
  } finally {
    harness.dispose();
  }
});

test('rechecks remote dev immediately before editing the admitted PR', () => {
  const harness = new DevManagerGizmoHarness({
    localSha: SHA_B,
    remoteDevSha: SHA_B,
    pullRequest: { headSha: SHA_B },
    remoteDevChangesBeforeMutation: true,
    ancestryPairs: [[SHA_MAIN, SHA_B]],
  });
  const expectedSha = CommitSha.parse(SHA_B);
  try {
    expect(expectedSha.isOk()).toBe(true);
    if (expectedSha.isErr()) return;
    const result = new DevPrManagerCommand({
      workspace: harness.workspace,
      expectedSha: expectedSha.value,
    }).execute();
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.kind).toBe(DevFailureKind.Race);
    expect(result.error.message).toContain('origin/dev changed immediately');
    expect(
      harness.runner.requests.some(
        (request) =>
          request.executable === CommandExecutable.GitHub &&
          request.args[0] === 'pr' &&
          request.args[1] === 'edit',
      ),
    ).toBe(false);
  } finally {
    harness.dispose();
  }
});

test('fails closed when local dev is not based on refreshed main', () => {
  const harness = new DevManagerGizmoHarness({
    localSha: SHA_B,
    remoteDevSha: SHA_A,
    ancestryPairs: [],
  });
  try {
    const result = new DevManagerGizmoCommand(harness.workspace).execute();
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.kind).toBe(DevFailureKind.Conflict);
    expect(result.error.message).toContain(
      'Canonical dev worktree diverged from the required baseline',
    );
    expect(
      harness.runner.requests.some(
        (request) => request.executable === CommandExecutable.GitHub,
      ),
    ).toBe(false);
    expect(
      harness.runner.requests.some(
        (request) =>
          request.executable === CommandExecutable.Git &&
          request.args[0] === 'push',
      ),
    ).toBe(false);
  } finally {
    harness.dispose();
  }
});

test('requires feature-path reconciliation when origin/dev is ahead of local dev', () => {
  const harness = new DevManagerGizmoHarness({
    localSha: SHA_MAIN,
    remoteDevSha: SHA_B,
    ancestryPairs: [[SHA_MAIN, SHA_B]],
  });
  try {
    const result = new DevManagerGizmoCommand(harness.workspace).execute();
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.state).toBe(DevManagerGizmoState.ReconcileRequired);
    expect(result.value.action).toBe(DevManagerGizmoAction.Reconcile);
    expect(result.value.expectedSha.value()).toBe(SHA_B);
    expect(result.value.originMainSha.value()).toBe(SHA_MAIN);
    expect(result.value.pinnedLocalDevSha.value()).toBe(SHA_MAIN);
    expect(
      harness.runner.requests.some(
        (request) => request.executable === CommandExecutable.GitHub,
      ),
    ).toBe(false);
  } finally {
    harness.dispose();
  }
});

test('fails closed when canonical main is ahead of the fetched origin/main baseline', () => {
  const harness = new DevManagerGizmoHarness({
    localSha: SHA_MAIN,
    remoteDevSha: SHA_MAIN,
    mainSha: SHA_B,
    ancestryPairs: [[SHA_MAIN, SHA_B]],
  });
  try {
    const result = new DevManagerGizmoCommand(harness.workspace).execute();
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.kind).toBe(DevFailureKind.Conflict);
    expect(result.error.message).toContain(
      'Canonical main worktree is ahead of the required baseline',
    );
    expect(
      harness.runner.requests.some(
        (request) =>
          request.executable === CommandExecutable.Git &&
          request.args[0] === 'merge',
      ),
    ).toBe(false);
    expect(
      harness.runner.requests.some(
        (request) => request.executable === CommandExecutable.GitHub,
      ),
    ).toBe(false);
  } finally {
    harness.dispose();
  }
});

test('returns typed failures for malformed and racing local worktree observations', () => {
  const malformed = new DevManagerGizmoHarness({
    localSha: SHA_MAIN,
    remoteDevSha: SHA_MAIN,
    ancestryPairs: [],
    malformedWorktree: true,
  });
  try {
    const result = new DevManagerGizmoCommand(malformed.workspace).execute();
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.kind).toBe(DevFailureKind.Git);
    expect(result.error.message).toContain('incomplete worktree record');
  } finally {
    malformed.dispose();
  }

  const racing = new DevManagerGizmoHarness({
    localSha: SHA_B,
    remoteDevSha: SHA_A,
    ancestryPairs: [[SHA_MAIN, SHA_B]],
    reportedWorktreeSha: SHA_A,
    observedHeadSha: SHA_B,
  });
  try {
    const result = new DevManagerGizmoCommand(racing.workspace).execute();
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.kind).toBe(DevFailureKind.Race);
    expect(result.error.message).toContain(SHA_A);
    expect(result.error.message).toContain(SHA_B);
  } finally {
    racing.dispose();
  }
});
