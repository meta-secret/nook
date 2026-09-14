import { realpathSync } from 'node:fs';
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
  WorktreeRecord,
  WorktreeState,
} from './dev-types.ts';
import { CommitSha as CommitShaValue } from './dev-types.ts';
import {
  ManagedWorktreeSelection,
  WorktreeInventoryDecoder,
} from './dev-git-worktrees.ts';
import { DevGitMergeBoundary } from './dev-git-merge.ts';

export {
  DevelopmentWorktreeSelection,
  MainWorktreeSelection,
  ManagedWorktreeSelection,
  WorktreeInventoryDecoder,
} from './dev-git-worktrees.ts';

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
  readonly featureHead: CommitSha;
  readonly featureBranch: BranchName;
}

interface FastForwardRequest {
  readonly path: string;
  readonly target: CommitSha;
}

interface PushRequest {
  readonly target: ManagedBranch;
  readonly sha: CommitSha;
  readonly workingDirectory: string;
}

export interface DevGitBootstrapRequest {
  /** Require clean-start local dev to finish exactly at origin/main. */
  readonly requireDevEquality?: boolean;
  /** Canonical worktree paths; omitted paths are discovered from Git. */
  readonly mainPath?: string;
  readonly devPath?: string;
}

/** Exact refs selected by the delivery bootstrap for subsequent feature work. */
export interface DevGitBootstrapEvidence {
  readonly originMainSha: CommitSha;
  readonly pinnedLocalDevSha: CommitSha;
  readonly localMainSha: CommitSha;
  readonly mainPath: string;
  readonly devPath: string;
}

interface SynchronizeWorktreeRequest {
  readonly path: string;
  readonly target: CommitSha;
  readonly branch: ManagedBranch;
  readonly requireEquality: boolean;
}

interface BootstrapWorktreePathRequest {
  readonly branch: ManagedBranch;
  readonly requestedPath: string | undefined;
  readonly records: readonly WorktreeRecord[];
  readonly repositoryIdentity: string;
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
    return this.commonDirectoryAt(this.request.root);
  }

  /**
   * Requires an exact, canonical worktree registered in this repository for a
   * managed branch. The caller must provide the packet-assigned path; this
   * method never discovers a replacement worktree.
   */
  managedWorktreeAt(
    ...[path, branch]: [path: string, branch: ManagedBranch]
  ): Result<WorktreeRecord, DevFailure> {
    const canonicalPath = this.canonicalWorktreePath(
      path,
      `Canonical ${branch} worktree path`,
      true,
    );
    if (canonicalPath.isErr()) return err(canonicalPath.error);

    const repository = this.repositoryIdentityAt(canonicalPath.value);
    if (repository.isErr()) return err(repository.error);
    const featureRepository = this.repositoryIdentityAt(this.request.root);
    if (featureRepository.isErr()) return err(featureRepository.error);
    if (repository.value !== featureRepository.value) {
      return err({
        kind: DevFailureKind.Configuration,
        message: `Assigned ${branch} worktree belongs to a different repository: ${path}`,
      });
    }

    const records = this.worktrees();
    if (records.isErr()) return err(records.error);
    const matches = records.value.filter(
      (record) => record.path === canonicalPath.value,
    );
    if (matches.length !== 1) {
      return err({
        kind: DevFailureKind.Configuration,
        message: `Assigned ${branch} worktree is not uniquely registered at its canonical path: ${path}`,
      });
    }
    const record = matches[0];
    if (!record) {
      return err({
        kind: DevFailureKind.Configuration,
        message: `Assigned ${branch} worktree selection was empty: ${path}`,
      });
    }
    if (
      record.prunable ||
      record.branch.kind !== WorktreeBranchKind.Branch ||
      record.branch.name.value() !== branch
    ) {
      return err({
        kind: DevFailureKind.Configuration,
        message: `Assigned worktree is not a usable ${branch} worktree: ${path}`,
      });
    }
    return ok(record);
  }

  worktrees(): Result<readonly WorktreeRecord[], DevFailure> {
    const output = this.successful({
      args: ['worktree', 'list', '--porcelain'],
      workingDirectory: this.request.root,
    });
    if (output.isErr()) return err(output.error);
    return new WorktreeInventoryDecoder().decode(output.value.stdout);
  }

  /** Resolves an existing checked-out dev worktree without creating one. */
  developmentWorktreeForLanding(): Result<WorktreeRecord | undefined, DevFailure> {
    const records = this.worktrees();
    if (records.isErr()) return err(records.error);
    const candidates = records.value.filter((record) =>
      record.isManagedDevelopmentWorktree(),
    );
    if (candidates.length > 1) {
      return err({
        kind: DevFailureKind.Configuration,
        message: `Multiple local dev worktrees were found (${candidates.map((candidate) => candidate.path).join(', ')}); refusing to choose one`,
      });
    }
    return ok(candidates[0]);
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

  /** Resolves the latest committed head of an authorized remote feature ref. */
  resolveFeatureBranchHead(
    branch: BranchName,
  ): Result<CommitSha, DevFailure> {
    const snapshot = this.remoteBranch(branch);
    if (snapshot.isErr()) return err(snapshot.error);
    if (snapshot.value.presence !== RemoteBranchPresence.Present) {
      return err({
        kind: DevFailureKind.Configuration,
        message: `origin/${branch.value()} must exist before landing a feature into dev`,
      });
    }
    return ok(snapshot.value.sha);
  }

  /** Refreshes the delivery refs, optionally pruning stale origin refs. */
  refreshManagedRefs(
    request: { readonly prune?: boolean } = {},
  ): Result<void, DevFailure> {
    if (request.prune) return this.fetchOrigin({ prune: true });
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

  /**
   * Refreshes all origin refs for a fresh bootstrap. Pruning is explicit so a
   * caller cannot accidentally normalize a repository while doing an ordinary
   * manager observation.
   */
  fetchOrigin(
    request: { readonly prune?: boolean } = {},
  ): Result<void, DevFailure> {
    const args = ['fetch'];
    if (request.prune) args.push('--prune');
    args.push('origin');
    const output = this.execute({
      args,
      workingDirectory: this.request.root,
    });
    if (output.isErr()) return err(output.error);
    if (output.value.exitCode !== 0) {
      return err({
        kind: DevFailureKind.Git,
        message: `Unable to fetch origin refs${request.prune ? ' with pruning' : ''}: ${new CommandFailureMessage(output.value).text()}`,
      });
    }
    return ok();
  }

  /** Resolves the exact locally fetched origin/main commit. */
  originMainSha(): Result<CommitSha, DevFailure> {
    return this.trackingHead(ManagedBranch.Main);
  }

  /**
   * Bootstraps canonical main and dev without rewriting unexpected work.
   *
   * The only permitted normalization is an ordinary fast-forward on a clean
   * named worktree. An ahead, divergent, detached, dirty, or racing checkout
   * is returned as a blocker; no reset, clean, force update, or worktree
   * issuance is attempted.
   */
  bootstrap(
    request: DevGitBootstrapRequest = {},
  ): Result<DevGitBootstrapEvidence, DevFailure> {
    const refreshed = this.refreshManagedRefs({ prune: true });
    if (refreshed.isErr()) return err(refreshed.error);

    const originMain = this.originMainSha();
    if (originMain.isErr()) return err(originMain.error);
    const records = this.worktrees();
    if (records.isErr()) return err(records.error);
    const repositoryIdentity = this.repositoryIdentityAt(this.request.root);
    if (repositoryIdentity.isErr()) return err(repositoryIdentity.error);
    const mainPath = this.bootstrapWorktreePath({
      branch: ManagedBranch.Main,
      requestedPath: request.mainPath,
      records: records.value,
      repositoryIdentity: repositoryIdentity.value,
    });
    if (mainPath.isErr()) return err(mainPath.error);
    const devPath = this.bootstrapWorktreePath({
      branch: ManagedBranch.Dev,
      requestedPath: request.devPath,
      records: records.value,
      repositoryIdentity: repositoryIdentity.value,
    });
    if (devPath.isErr()) return err(devPath.error);

    const main = this.synchronizeWorktree({
      path: mainPath.value,
      target: originMain.value,
      branch: ManagedBranch.Main,
      requireEquality: true,
    });
    if (main.isErr()) return err(main.error);
    const dev = this.synchronizeWorktree({
      path: devPath.value,
      target: originMain.value,
      branch: ManagedBranch.Dev,
      requireEquality: request.requireDevEquality ?? true,
    });
    if (dev.isErr()) return err(dev.error);

    const finalOriginMain = this.originMainSha();
    if (finalOriginMain.isErr()) return err(finalOriginMain.error);
    if (!finalOriginMain.value.equals(originMain.value)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'origin/main changed while the canonical main and dev worktrees were being synchronized',
      });
    }
    return ok({
      originMainSha: originMain.value,
      pinnedLocalDevSha: dev.value,
      localMainSha: main.value,
      mainPath: mainPath.value,
      devPath: devPath.value,
    });
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
    return new DevGitMergeBoundary({
      repository: this,
      featurePath: this.request.root,
      execute: (invocation) => this.execute(invocation),
    }).mergeInto(request);
  }

  /** Resolves a local branch ref, returning undefined when it does not exist. */
  localBranchHead(
    branch: ManagedBranch,
  ): Result<CommitSha | undefined, DevFailure> {
    const output = this.execute({
      args: ['rev-parse', '--verify', `refs/heads/${branch}^{commit}`],
      workingDirectory: this.request.root,
    });
    if (output.isErr()) return err(output.error);
    if (output.value.exitCode === 1) return ok(undefined);
    if (output.value.exitCode !== 0) {
      return err({
        kind: DevFailureKind.Git,
        message: `Unable to resolve local refs/heads/${branch}: ${new CommandFailureMessage(output.value).text()}`,
      });
    }
    const sha = CommitShaValue.parse(output.value.stdout.trim());
    if (sha.isErr()) return err(sha.error);
    return ok(sha.value);
  }

  /** Fast-forwards local dev to a promoted snapshot without rewriting newer work. */
  fastForwardTo(request: FastForwardRequest): Result<CommitSha, DevFailure> {
    const current = this.headAt(request.path);
    if (current.isErr()) return err(current.error);
    const state = this.stateAt(request.path);
    if (state.isErr()) return err(state.error);
    if (state.value !== WorktreeState.Clean) {
      return err({
        kind: DevFailureKind.DirtyWorktree,
        message: `Local dev is dirty; refusing to fast-forward it: ${request.path}`,
      });
    }
    const currentIsAncestor = this.ancestry({
      ancestor: current.value,
      descendant: request.target,
      workingDirectory: request.path,
    });
    if (currentIsAncestor.isErr()) return err(currentIsAncestor.error);
    if (currentIsAncestor.value === Ancestry.NotAncestor) {
      const targetIsAncestor = this.ancestry({
        ancestor: request.target,
        descendant: current.value,
        workingDirectory: request.path,
      });
      if (targetIsAncestor.isErr()) return err(targetIsAncestor.error);
      if (targetIsAncestor.value === Ancestry.Ancestor) return ok(current.value);
      return err({
        kind: DevFailureKind.Conflict,
        message:
          'Local dev diverged from the promoted snapshot; refusing to rewrite newer local work',
      });
    }
    if (current.value.equals(request.target)) return ok(current.value);
    const merged = this.execute({
      args: ['merge', '--ff-only', request.target.value()],
      workingDirectory: request.path,
    });
    if (merged.isErr()) return err(merged.error);
    if (merged.value.exitCode !== 0) {
      return err({
        kind: DevFailureKind.Conflict,
        message: `Local dev fast-forward failed: ${new CommandFailureMessage(merged.value).text()}`,
      });
    }
    const after = this.headAt(request.path);
    if (after.isErr()) return err(after.error);
    if (!after.value.equals(request.target)) {
      return err({
        kind: DevFailureKind.Race,
        message: 'Local dev did not finish at the promoted snapshot',
      });
    }
    return ok(after.value);
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

  private trackingHead(branch: ManagedBranch): Result<CommitSha, DevFailure> {
    const output = this.successful({
      args: ['rev-parse', '--verify', `refs/remotes/origin/${branch}^{commit}`],
      workingDirectory: this.request.root,
    });
    if (output.isErr()) {
      return err({
        kind: DevFailureKind.Configuration,
        message: `origin/${branch} must exist as a fetched remote-tracking ref`,
      });
    }
    const sha = CommitShaValue.parse(output.value.stdout.trim());
    if (sha.isErr()) return err(sha.error);
    return ok(sha.value);
  }

  private bootstrapWorktreePath(
    request: BootstrapWorktreePathRequest,
  ): Result<string, DevFailure> {
    const candidates = request.records.filter(
      (record) =>
        !record.prunable &&
        record.branch.kind === WorktreeBranchKind.Branch &&
        record.branch.name.value() === request.branch,
    );
    let path: string;
    if (request.requestedPath !== undefined) {
      const requestedPath = this.canonicalWorktreePath(
        request.requestedPath,
        `Canonical ${request.branch} worktree path`,
        true,
      );
      if (requestedPath.isErr()) return err(requestedPath.error);
      const matching = [] as string[];
      for (const candidate of candidates) {
        const candidatePath = this.canonicalWorktreePath(
          candidate.path,
          `Git ${request.branch} worktree path`,
        );
        if (candidatePath.isErr()) return err(candidatePath.error);
        if (candidatePath.value === requestedPath.value)
          matching.push(candidatePath.value);
      }
      if (matching.length !== 1) {
        return err({
          kind: DevFailureKind.Configuration,
          message: `Requested ${request.branch} worktree is not a unique managed worktree in this repository: ${request.requestedPath}`,
        });
      }
      const selectedPath = matching[0];
      if (!selectedPath) {
        return err({
          kind: DevFailureKind.Configuration,
          message: `Requested ${request.branch} worktree selection was empty`,
        });
      }
      path = selectedPath;
    } else {
      const selected = new ManagedWorktreeSelection().select(
        request.records,
        request.branch,
      );
      if (selected.isErr()) return err(selected.error);
      const selectedPath = this.canonicalWorktreePath(
        selected.value.path,
        `Git ${request.branch} worktree path`,
      );
      if (selectedPath.isErr()) return err(selectedPath.error);
      path = selectedPath.value;
    }
    const identity = this.repositoryIdentityAt(path);
    if (identity.isErr()) return err(identity.error);
    if (identity.value !== request.repositoryIdentity) {
      return err({
        kind: DevFailureKind.Configuration,
        message: `Requested ${request.branch} worktree belongs to a different repository: ${path}`,
      });
    }
    return ok(path);
  }

  private commonDirectoryAt(path: string): Result<string, DevFailure> {
    const output = this.successful({
      args: ['rev-parse', '--git-common-dir'],
      workingDirectory: path,
    });
    if (output.isErr()) return err(output.error);
    const common = output.value.stdout.trim();
    if (!common) {
      return err({
        kind: DevFailureKind.Git,
        message: 'Git did not return a common directory',
      });
    }
    return ok(resolve(path, common));
  }

  private repositoryIdentityAt(path: string): Result<string, DevFailure> {
    const common = this.commonDirectoryAt(path);
    if (common.isErr()) return err(common.error);
    return this.canonicalWorktreePath(common.value, 'Git common directory');
  }

  private canonicalWorktreePath(
    ...[path, label, requireCanonicalInput = false]: [
      path: string,
      label: string,
      requireCanonicalInput?: boolean,
    ]
  ): Result<string, DevFailure> {
    const normalized = resolve(path);
    if (requireCanonicalInput && path !== normalized) {
      return err({
        kind: DevFailureKind.Configuration,
        message: `${label} must already be normalized and absolute: ${path}`,
      });
    }
    let real: string;
    try {
      real = realpathSync(normalized);
    } catch {
      return err({
        kind: DevFailureKind.Configuration,
        message: `${label} must resolve to an existing canonical path: ${path}`,
      });
    }
    if (real !== normalized) {
      return err({
        kind: DevFailureKind.Configuration,
        message: `${label} must not be a symlink or path alias: ${path}`,
      });
    }
    return ok(real);
  }

  private synchronizeWorktree(
    request: SynchronizeWorktreeRequest,
  ): Result<CommitSha, DevFailure> {
    const branch = this.branchAt(request.path);
    if (branch.isErr()) return err(branch.error);
    if (branch.value.value() !== request.branch) {
      return err({
        kind: DevFailureKind.Configuration,
        message: `Canonical ${request.branch} worktree is not on ${request.branch}: ${request.path}`,
      });
    }
    const state = this.stateAt(request.path);
    if (state.isErr()) return err(state.error);
    if (state.value !== WorktreeState.Clean) {
      return err({
        kind: DevFailureKind.DirtyWorktree,
        message: `Canonical ${request.branch} worktree is dirty; refusing to normalize it: ${request.path}`,
      });
    }
    const current = this.headAt(request.path);
    if (current.isErr()) return err(current.error);
    if (current.value.equals(request.target)) return ok(current.value);

    const currentIsAncestor = this.ancestry({
      ancestor: current.value,
      descendant: request.target,
      workingDirectory: request.path,
    });
    if (currentIsAncestor.isErr()) return err(currentIsAncestor.error);
    if (currentIsAncestor.value === Ancestry.Ancestor) {
      const beforeMergeBranch = this.branchAt(request.path);
      if (beforeMergeBranch.isErr()) return err(beforeMergeBranch.error);
      if (beforeMergeBranch.value.value() !== request.branch) {
        return err({
          kind: DevFailureKind.Race,
          message: `Canonical ${request.branch} worktree branch changed before synchronization: ${request.path}`,
        });
      }
      const beforeMergeState = this.stateAt(request.path);
      if (beforeMergeState.isErr()) return err(beforeMergeState.error);
      if (beforeMergeState.value !== WorktreeState.Clean) {
        return err({
          kind: DevFailureKind.DirtyWorktree,
          message: `Canonical ${request.branch} worktree became dirty before synchronization; no cleanup was attempted: ${request.path}`,
        });
      }
      const beforeMergeHead = this.headAt(request.path);
      if (beforeMergeHead.isErr()) return err(beforeMergeHead.error);
      if (!beforeMergeHead.value.equals(current.value)) {
        return err({
          kind: DevFailureKind.Race,
          message: `Canonical ${request.branch} worktree changed before synchronization: expected ${current.value.value()}, found ${beforeMergeHead.value.value()}`,
        });
      }
      const merged = this.execute({
        args: ['merge', '--ff-only', request.target.value()],
        workingDirectory: request.path,
      });
      if (merged.isErr()) return err(merged.error);
      if (merged.value.exitCode !== 0) {
        return err({
          kind: DevFailureKind.Conflict,
          message: `Canonical ${request.branch} worktree fast-forward failed: ${new CommandFailureMessage(merged.value).text()}`,
        });
      }
      const after = this.headAt(request.path);
      if (after.isErr()) return err(after.error);
      if (!after.value.equals(request.target)) {
        return err({
          kind: DevFailureKind.Race,
          message: `Canonical ${request.branch} worktree did not finish at the required baseline`,
        });
      }
      const afterState = this.stateAt(request.path);
      if (afterState.isErr()) return err(afterState.error);
      if (afterState.value !== WorktreeState.Clean) {
        return err({
          kind: DevFailureKind.DirtyWorktree,
          message: `Canonical ${request.branch} fast-forward left the worktree dirty; no cleanup was attempted: ${request.path}`,
        });
      }
      return ok(after.value);
    }

    const targetIsAncestor = this.ancestry({
      ancestor: request.target,
      descendant: current.value,
      workingDirectory: request.path,
    });
    if (targetIsAncestor.isErr()) return err(targetIsAncestor.error);
    if (targetIsAncestor.value === Ancestry.Ancestor) {
      if (request.requireEquality) {
        return err({
          kind: DevFailureKind.Conflict,
          message: `Canonical ${request.branch} worktree is ahead of the required baseline; refusing to discard its commits: ${request.path}`,
        });
      }
      return ok(current.value);
    }
    return err({
      kind: DevFailureKind.Conflict,
      message: `Canonical ${request.branch} worktree diverged from the required baseline; refusing to rewrite it: ${request.path}`,
    });
  }

  private execute(request: GitInvocation): Result<CommandOutput, DevFailure> {
    return this.request.runner.run({
      executable: CommandExecutable.Git,
      args: request.args,
      workingDirectory: request.workingDirectory,
      repositoryRoot: this.request.root,
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
