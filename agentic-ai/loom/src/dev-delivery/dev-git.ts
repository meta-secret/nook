import { resolve } from 'node:path';
import { err, ok, type Result } from 'neverthrow';

import { CommandFailureMessage } from './dev-command.ts';
import {
  Ancestry,
  BranchName,
  CommandExecutable,
  DevFailureKind,
  ManagedBranch,
  type CommandOutput,
  type CommandRunner,
  type CommitSha,
  type DevFailure,
  type RemoteBranchSnapshot,
  RemoteBranchPresence,
  WorktreeBranchKind,
  type WorktreeBranch,
  WorktreeRecord,
  WorktreeState,
} from './dev-types.ts';
import { CommitSha as CommitShaValue } from './dev-types.ts';

interface GitInvocation {
  readonly args: readonly string[];
  readonly workingDirectory: string;
}

interface AncestryRequest {
  readonly ancestor: CommitSha;
  readonly descendant: CommitSha;
  readonly workingDirectory: string;
}

interface MergeRequest {
  readonly devPath: string;
  readonly expectedDevHead: CommitSha;
  readonly featureHead: CommitSha;
}

interface PushRequest {
  readonly target: ManagedBranch;
  readonly sha: CommitSha;
  readonly workingDirectory: string;
}

interface MutableWorktreeBlock {
  path: string;
  head: string;
  branch: string;
  detached: boolean;
  prunable: boolean;
}

enum WorktreeBlockKind {
  Empty = 'empty',
  Active = 'active',
}

type WorktreeBlock =
  | { readonly kind: WorktreeBlockKind.Empty }
  | {
      readonly kind: WorktreeBlockKind.Active;
      readonly value: MutableWorktreeBlock;
    };

/** Decodes Git's porcelain worktree inventory without selecting a worktree. */
export class WorktreeInventoryDecoder {
  decode(source: string): Result<readonly WorktreeRecord[], DevFailure> {
    const records: WorktreeRecord[] = [];
    let block: WorktreeBlock = { kind: WorktreeBlockKind.Empty };
    for (const line of source.split(/\r?\n/u)) {
      if (line.startsWith('worktree ')) {
        if (block.kind === WorktreeBlockKind.Active) {
          const completed = this.complete(block.value);
          if (completed.isErr()) return err(completed.error);
          records.push(completed.value);
        }
        block = {
          kind: WorktreeBlockKind.Active,
          value: {
            path: line.slice('worktree '.length),
            head: '',
            branch: '',
            detached: false,
            prunable: false,
          },
        };
        continue;
      }
      if (block.kind === WorktreeBlockKind.Empty) continue;
      if (line.startsWith('HEAD '))
        block.value.head = line.slice('HEAD '.length);
      if (line.startsWith('branch '))
        block.value.branch = line.slice('branch '.length);
      if (line === 'detached') block.value.detached = true;
      if (line.startsWith('prunable')) block.value.prunable = true;
    }
    if (block.kind === WorktreeBlockKind.Active) {
      const completed = this.complete(block.value);
      if (completed.isErr()) return err(completed.error);
      records.push(completed.value);
    }
    return ok(records);
  }

  private complete(
    block: MutableWorktreeBlock,
  ): Result<WorktreeRecord, DevFailure> {
    if (!block.path || !block.head) {
      return err({
        kind: DevFailureKind.Git,
        message: 'Git returned an incomplete worktree record',
      });
    }
    const head = CommitShaValue.parse(block.head);
    if (head.isErr()) return err(head.error);
    let branch: WorktreeBranch;
    if (block.branch.startsWith('refs/heads/')) {
      const name = BranchName.parse(block.branch.slice('refs/heads/'.length));
      if (name.isErr()) return err(name.error);
      branch = { kind: WorktreeBranchKind.Branch, name: name.value };
    } else if (block.detached) {
      branch = { kind: WorktreeBranchKind.Detached };
    } else {
      return err({
        kind: DevFailureKind.Git,
        message: `Git returned a worktree without a branch or detached marker: ${block.path}`,
      });
    }
    return ok(
      new WorktreeRecord({
        path: resolve(block.path),
        head: head.value,
        branch,
        prunable: block.prunable,
      }),
    );
  }
}

/** Selects exactly one usable local development worktree. */
export class DevelopmentWorktreeSelection {
  select(
    records: readonly WorktreeRecord[],
  ): Result<WorktreeRecord, DevFailure> {
    const candidates = records.filter((record) =>
      record.isManagedDevelopmentWorktree(),
    );
    if (candidates.length === 0) {
      return err({
        kind: DevFailureKind.Configuration,
        message:
          'No usable local dev worktree was found; create one explicitly before landing',
      });
    }
    if (candidates.length > 1) {
      return err({
        kind: DevFailureKind.Configuration,
        message: `Multiple local dev worktrees were found (${candidates.map((candidate) => candidate.path).join(', ')}); refusing to choose one`,
      });
    }
    const candidate = candidates[0];
    if (!candidate) {
      return err({
        kind: DevFailureKind.Configuration,
        message: 'Local dev worktree selection was empty',
      });
    }
    return ok(candidate);
  }
}

/** Owns read-only Git observations and the narrowly authorized local effects. */
export class DevGitRepository {
  constructor(
    private readonly request: {
      readonly root: string;
      readonly runner: CommandRunner;
    },
  ) {}

  currentBranch(): Result<BranchName, DevFailure> {
    return this.branchAt(this.request.root);
  }

  head(): Result<CommitSha, DevFailure> {
    return this.headAt(this.request.root);
  }

  commonDirectory(): Result<string, DevFailure> {
    const output = this.successful({
      args: ['rev-parse', '--git-common-dir'],
      workingDirectory: this.request.root,
    });
    if (output.isErr()) return err(output.error);
    const common = output.value.stdout.trim();
    if (!common) {
      return err({
        kind: DevFailureKind.Git,
        message: 'Git did not return a common directory',
      });
    }
    return ok(resolve(this.request.root, common));
  }

  worktrees(): Result<readonly WorktreeRecord[], DevFailure> {
    const output = this.successful({
      args: ['worktree', 'list', '--porcelain'],
      workingDirectory: this.request.root,
    });
    if (output.isErr()) return err(output.error);
    return new WorktreeInventoryDecoder().decode(output.value.stdout);
  }

  stateAt(path: string): Result<WorktreeState, DevFailure> {
    const output = this.successful({
      args: ['status', '--porcelain', '--untracked-files=all'],
      workingDirectory: path,
    });
    if (output.isErr()) return err(output.error);
    return ok(
      output.value.stdout.length === 0
        ? WorktreeState.Clean
        : WorktreeState.Dirty,
    );
  }

  branchAt(path: string): Result<BranchName, DevFailure> {
    const output = this.successful({
      args: ['branch', '--show-current'],
      workingDirectory: path,
    });
    if (output.isErr()) return err(output.error);
    const branch = output.value.stdout.trim();
    if (!branch) {
      return err({
        kind: DevFailureKind.Configuration,
        message: `Worktree is detached; refusing to operate at ${path}`,
      });
    }
    return BranchName.parse(branch);
  }

  headAt(path: string): Result<CommitSha, DevFailure> {
    const output = this.successful({
      args: ['rev-parse', 'HEAD'],
      workingDirectory: path,
    });
    if (output.isErr()) return err(output.error);
    return CommitShaValue.parse(output.value.stdout.trim());
  }

  remoteBranch(
    branch: ManagedBranch | BranchName,
  ): Result<RemoteBranchSnapshot, DevFailure> {
    const branchValue = typeof branch === 'string' ? branch : branch.value();
    const output = this.successful({
      args: ['ls-remote', '--refs', 'origin', `refs/heads/${branchValue}`],
      workingDirectory: this.request.root,
    });
    if (output.isErr()) return err(output.error);
    const lines = output.value.stdout.trim().split(/\r?\n/u);
    const line = lines.at(0);
    if (!line) return ok({ presence: RemoteBranchPresence.Absent, branch });
    const fields = line.split(/\s+/u);
    const reference = fields.at(1);
    if (fields.length !== 2 || reference !== `refs/heads/${branchValue}`) {
      return err({
        kind: DevFailureKind.Git,
        message: `Git returned an invalid origin/${branchValue} snapshot`,
      });
    }
    const rawSha = fields.at(0);
    if (!rawSha) {
      return err({
        kind: DevFailureKind.Git,
        message: `Git returned an incomplete origin/${branchValue} snapshot`,
      });
    }
    const sha = CommitShaValue.parse(rawSha);
    if (sha.isErr()) return err(sha.error);
    return ok({
      presence: RemoteBranchPresence.Present,
      branch,
      sha: sha.value,
    });
  }

  refreshManagedRefs(): Result<void, DevFailure> {
    const output = this.execute({
      args: [
        'fetch',
        '--quiet',
        '--no-tags',
        'origin',
        'refs/heads/main:refs/remotes/origin/main',
        'refs/heads/dev:refs/remotes/origin/dev',
      ],
      workingDirectory: this.request.root,
    });
    if (output.isErr()) return err(output.error);
    if (output.value.exitCode !== 0) {
      return err({
        kind: DevFailureKind.Git,
        message: `Unable to refresh origin main/dev refs: ${new CommandFailureMessage(output.value).text()}`,
      });
    }
    return ok();
  }

  ancestry(request: AncestryRequest): Result<Ancestry, DevFailure> {
    const output = this.execute({
      args: [
        'merge-base',
        '--is-ancestor',
        request.ancestor.value(),
        request.descendant.value(),
      ],
      workingDirectory: request.workingDirectory,
    });
    if (output.isErr()) return err(output.error);
    if (output.value.exitCode === 0) return ok(Ancestry.Ancestor);
    if (output.value.exitCode === 1) return ok(Ancestry.NotAncestor);
    return err({
      kind: DevFailureKind.Git,
      message: `Git ancestry check failed: ${new CommandFailureMessage(output.value).text()}`,
    });
  }

  mergeInto(request: MergeRequest): Result<CommitSha, DevFailure> {
    const current = this.headAt(request.devPath);
    if (current.isErr()) return err(current.error);
    if (!current.value.equals(request.expectedDevHead)) {
      return err({
        kind: DevFailureKind.Race,
        message: 'Local dev changed while landing was being prepared',
      });
    }
    const state = this.stateAt(request.devPath);
    if (state.isErr()) return err(state.error);
    if (state.value !== WorktreeState.Clean) {
      return err({
        kind: DevFailureKind.DirtyWorktree,
        message: `Local dev is dirty; refusing to alter it: ${request.devPath}`,
      });
    }
    const preview = this.execute({
      args: [
        'merge-tree',
        '--write-tree',
        request.expectedDevHead.value(),
        request.featureHead.value(),
      ],
      workingDirectory: request.devPath,
    });
    if (preview.isErr()) return err(preview.error);
    if (preview.value.exitCode !== 0) {
      return err({
        kind: DevFailureKind.Conflict,
        message:
          'Feature cannot merge cleanly into local dev; merge latest local dev into FEATURE, rebuild it remotely, and retry',
      });
    }

    const merge = this.execute({
      args: ['merge', '--no-edit', request.featureHead.value()],
      workingDirectory: request.devPath,
    });
    if (merge.isErr()) return err(merge.error);
    if (merge.value.exitCode !== 0) {
      const abort = this.execute({
        args: ['merge', '--abort'],
        workingDirectory: request.devPath,
      });
      const abortMessage =
        abort.isErr() || abort.value.exitCode !== 0
          ? ' Git merge abort also failed; inspect the shared dev worktree without discarding changes.'
          : '';
      return err({
        kind: DevFailureKind.Conflict,
        message: `Feature merge into local dev failed: ${new CommandFailureMessage(merge.value).text()}.${abortMessage}`,
      });
    }
    const after = this.stateAt(request.devPath);
    if (after.isErr()) return err(after.error);
    if (after.value !== WorktreeState.Clean) {
      return err({
        kind: DevFailureKind.DirtyWorktree,
        message:
          'The local merge left dev dirty; no cleanup was attempted so foreign changes remain intact',
      });
    }
    return this.headAt(request.devPath);
  }

  pushExact(request: PushRequest): Result<void, DevFailure> {
    const target = `refs/heads/${request.target}`;
    const output = this.execute({
      args: ['push', 'origin', `${request.sha.value()}:${target}`],
      workingDirectory: request.workingDirectory,
    });
    if (output.isErr()) return err(output.error);
    if (output.value.exitCode !== 0) {
      return err({
        kind: DevFailureKind.Permission,
        message: `origin/${request.target} push was rejected; no bypass was attempted: ${new CommandFailureMessage(output.value).text()}`,
      });
    }
    return ok();
  }

  private execute(request: GitInvocation): Result<CommandOutput, DevFailure> {
    return this.request.runner.run({
      executable: CommandExecutable.Git,
      args: request.args,
      workingDirectory: request.workingDirectory,
    });
  }

  private successful(
    request: GitInvocation,
  ): Result<CommandOutput, DevFailure> {
    const output = this.execute(request);
    if (output.isErr()) return err(output.error);
    if (output.value.exitCode !== 0) {
      return err({
        kind: DevFailureKind.Git,
        message: `Git observation failed: ${new CommandFailureMessage(output.value).text()}`,
      });
    }
    return ok(output.value);
  }
}
