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
import { DevDeliveryWorkspace } from '../src/dev-delivery/dev-workspace.ts';
import {
  CommandExecutable,
  type CommandOutput,
  type CommandRequest,
  type CommandRunner,
  DevFailureKind,
  type DevFailure,
} from '../src/dev-delivery/dev-types.ts';

const SHA_A = '1111111111111111111111111111111111111111';
const SHA_B = '2222222222222222222222222222222222222222';

interface PullRequestFixture {
  readonly headSha: string;
}

interface ScenarioOptions {
  readonly localSha: string;
  readonly remoteDevSha: string;
  readonly ancestryPairs: readonly (readonly [string, string])[];
  readonly remoteDevPresent?: boolean;
  readonly pullRequest?: PullRequestFixture;
  readonly ciStatus?: string;
  readonly malformedWorktree?: boolean;
  readonly reportedWorktreeSha?: string;
  readonly observedHeadSha?: string;
}

/** Simulates local Git and bounded manager-seam transport responses. */
class DevManagerGizmoRunner implements CommandRunner {
  readonly requests: CommandRequest[] = [];
  private remoteDevPresent: boolean;
  private remoteDevSha: string;
  private pullRequest: PullRequestFixture | undefined;

  constructor(
    private readonly request: {
      readonly root: string;
      readonly devPath: string;
      readonly options: ScenarioOptions;
    },
  ) {
    this.remoteDevPresent = request.options.remoteDevPresent ?? true;
    this.remoteDevSha = request.options.remoteDevSha;
    this.pullRequest = request.options.pullRequest;
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
        return ok(this.output());
      case 'worktree':
        return ok(
          this.output({
            stdout: this.request.options.malformedWorktree
              ? `worktree ${this.request.devPath}\nbranch refs/heads/dev\n`
              : `worktree ${this.request.devPath}\nHEAD ${this.request.options.reportedWorktreeSha ?? this.request.options.localSha}\nbranch refs/heads/dev\n`,
          }),
        );
      case 'status':
        return ok(this.output());
      case 'branch':
        return ok(this.output({ stdout: 'dev\n' }));
      case 'rev-parse':
        return ok(
          this.output({
            stdout:
              args[1] === '--git-common-dir'
                ? `${this.request.root}\n`
                : `${this.request.options.observedHeadSha ?? this.request.options.localSha}\n`,
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
      return ok(this.output({ stdout: `${SHA_A} refs/heads/main\n` }));
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
      return ok(this.pullRequestView());
    }
    if (args[0] === 'run' && args[1] === 'list') {
      return ok(this.ciRuns());
    }
    return ok(this.output());
  }

  private pullRequestList(): CommandOutput {
    if (!this.pullRequest) return this.output({ stdout: '[]' });
    return this.output({
      stdout: JSON.stringify([
        {
          number: 42,
          headRefName: 'dev',
          baseRefName: 'main',
          headRefOid: this.pullRequest.headSha,
          baseRefOid: SHA_A,
          url: 'https://github.example/pr/42',
          isDraft: false,
        },
      ]),
    });
  }

  private pullRequestView(): CommandOutput {
    const pullRequest = this.pullRequest;
    return this.output({
      stdout: JSON.stringify({
        number: 42,
        headRefName: 'dev',
        baseRefName: 'main',
        headRefOid: pullRequest?.headSha ?? this.remoteDevSha,
        baseRefOid: SHA_A,
        url: 'https://github.example/pr/42',
        isDraft: false,
        state: 'OPEN',
        headRepository: { nameWithOwner: 'nook/example' },
        baseRepository: { nameWithOwner: 'nook/example' },
        reviewDecision: 'REVIEW_REQUIRED',
      }),
    });
  }

  private ciRuns(): CommandOutput {
    return this.output({
      stdout: JSON.stringify([
        {
          databaseId: 7,
          headBranch: 'dev',
          headSha: this.remoteDevSha,
          status: this.request.options.ciStatus ?? 'completed',
          conclusion: 'pending',
          event: 'pull_request',
          workflowName: 'CI',
        },
      ]),
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
  readonly devPath: string;
  readonly runner: DevManagerGizmoRunner;
  readonly workspace: DevDeliveryWorkspace;

  constructor(options: ScenarioOptions) {
    this.root = mkdtempSync(join(tmpdir(), 'nook-dev-manager-gizmo-'));
    this.devPath = join(this.root, 'dev');
    this.runner = new DevManagerGizmoRunner({
      root: this.root,
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
    localSha: SHA_A,
    remoteDevSha: SHA_A,
    ancestryPairs: [],
  });
  try {
    const result = new DevManagerGizmoCommand(harness.workspace).execute();
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.state).toBe(DevManagerGizmoState.Idle);
    expect(result.value.action).toBe(DevManagerGizmoAction.NoAction);
    expect(result.value.expectedSha.value()).toBe(SHA_A);
    expect(result.value.message).toContain(
      'no local commits exist beyond origin/main',
    );
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
    localSha: SHA_A,
    remoteDevSha: SHA_A,
    ancestryPairs: [],
    remoteDevPresent: false,
  });
  try {
    const result = new DevManagerGizmoCommand(harness.workspace).execute();
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.state).toBe(DevManagerGizmoState.Idle);
    expect(result.value.action).toBe(DevManagerGizmoAction.NoAction);
    expect(result.value.expectedSha.value()).toBe(SHA_A);
    expect(
      harness.runner.requests.some(
        (request) => request.executable === CommandExecutable.GitHub,
      ),
    ).toBe(false);
  } finally {
    harness.dispose();
  }
});

test('publishes unpublished local dev through existing manager commands and reports the exact expected SHA', () => {
  const harness = new DevManagerGizmoHarness({
    localSha: SHA_B,
    remoteDevSha: SHA_A,
    ancestryPairs: [[SHA_A, SHA_B]],
  });
  try {
    const result = new DevManagerGizmoCommand(harness.workspace).execute();
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.state).toBe(DevManagerGizmoState.ValidationRequired);
    expect(result.value.action).toBe(DevManagerGizmoAction.WaitForValidation);
    expect(result.value.expectedSha.value()).toBe(SHA_B);
    expect(result.value.message).toContain(SHA_B);
    expect(result.value.message).toContain(
      'wait for complete exact-head evidence',
    );
    expect(
      harness.runner.requests.some(
        (request) =>
          request.executable === CommandExecutable.Git &&
          request.args[0] === 'push',
      ),
    ).toBe(true);
    expect(
      harness.runner.requests.some(
        (request) =>
          request.executable === CommandExecutable.GitHub &&
          request.args[0] === 'pr' &&
          request.args[1] === 'create',
      ),
    ).toBe(true);
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

test('preserves newer local dev when the bounded publication seam reports active validation', () => {
  const harness = new DevManagerGizmoHarness({
    localSha: SHA_B,
    remoteDevSha: SHA_A,
    ancestryPairs: [[SHA_A, SHA_B]],
    pullRequest: {
      headSha: SHA_A,
    },
    ciStatus: 'in_progress',
  });
  try {
    const result = new DevManagerGizmoCommand(harness.workspace).execute();
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.state).toBe(DevManagerGizmoState.ValidationFrozen);
    expect(result.value.action).toBe(DevManagerGizmoAction.WaitForValidation);
    expect(result.value.expectedSha.value()).toBe(SHA_A);
    expect(result.value.localDevSha.value()).toBe(SHA_B);
    expect(result.value.message).toContain('local dev remains preserved');
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
          request.args[0] === 'run' &&
          request.args[1] === 'list',
      ),
    ).toBe(true);
  } finally {
    harness.dispose();
  }
});

test('uses the manager-only PR seam for an already frozen snapshot without observing provider readiness', () => {
  const harness = new DevManagerGizmoHarness({
    localSha: SHA_B,
    remoteDevSha: SHA_B,
    ancestryPairs: [[SHA_A, SHA_B]],
  });
  try {
    const result = new DevManagerGizmoCommand(harness.workspace).execute();
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.state).toBe(DevManagerGizmoState.ValidationRequired);
    expect(result.value.action).toBe(DevManagerGizmoAction.WaitForValidation);
    expect(result.value.expectedSha.value()).toBe(SHA_B);
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

test('requires feature-path reconciliation when local dev is not based on refreshed main', () => {
  const harness = new DevManagerGizmoHarness({
    localSha: SHA_B,
    remoteDevSha: SHA_A,
    ancestryPairs: [],
  });
  try {
    const result = new DevManagerGizmoCommand(harness.workspace).execute();
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.state).toBe(DevManagerGizmoState.ReconcileRequired);
    expect(result.value.action).toBe(DevManagerGizmoAction.Reconcile);
    expect(result.value.expectedSha.value()).toBe(SHA_A);
    expect(
      harness.runner.requests.some(
        (request) => request.executable === CommandExecutable.GitHub,
      ),
    ).toBe(false);
  } finally {
    harness.dispose();
  }
});

test('requires feature-path reconciliation when origin/dev is ahead of local dev', () => {
  const harness = new DevManagerGizmoHarness({
    localSha: SHA_A,
    remoteDevSha: SHA_B,
    ancestryPairs: [[SHA_A, SHA_B]],
  });
  try {
    const result = new DevManagerGizmoCommand(harness.workspace).execute();
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.state).toBe(DevManagerGizmoState.ReconcileRequired);
    expect(result.value.action).toBe(DevManagerGizmoAction.Reconcile);
    expect(result.value.expectedSha.value()).toBe(SHA_B);
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
    localSha: SHA_A,
    remoteDevSha: SHA_A,
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
    ancestryPairs: [[SHA_A, SHA_B]],
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
