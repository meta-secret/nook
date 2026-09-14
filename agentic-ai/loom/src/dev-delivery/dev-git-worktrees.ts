import { resolve } from 'node:path';
import { err, ok, type Result } from 'neverthrow';

import {
  BranchName,
  CommitSha,
  DevFailureKind,
  ManagedBranch,
  type DevFailure,
  WorktreeBranchKind,
  type WorktreeBranch,
  WorktreeRecord,
} from './dev-types.ts';

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
      if (line.startsWith('HEAD ')) block.value.head = line.slice('HEAD '.length);
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
    const head = CommitSha.parse(block.head);
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

/** Selects exactly one usable managed worktree for a named branch. */
export class ManagedWorktreeSelection {
  select(
    ...[records, branch]: [
      records: readonly WorktreeRecord[],
      branch: ManagedBranch,
    ]
  ): Result<WorktreeRecord, DevFailure> {
    const candidates = records.filter((record) =>
      !record.prunable &&
      record.branch.kind === WorktreeBranchKind.Branch &&
      record.branch.name.value() === branch,
    );
    if (candidates.length === 0) {
      return err({
        kind: DevFailureKind.Configuration,
        message:
          `No usable local ${branch} worktree was found; create one explicitly before delivery`,
      });
    }
    if (candidates.length > 1) {
      return err({
        kind: DevFailureKind.Configuration,
        message: `Multiple local ${branch} worktrees were found (${candidates.map((candidate) => candidate.path).join(', ')}); refusing to choose one`,
      });
    }
    const candidate = candidates[0];
    if (!candidate) {
      return err({
        kind: DevFailureKind.Configuration,
        message: `Local ${branch} worktree selection was empty`,
      });
    }
    return ok(candidate);
  }
}

/** Selects exactly one usable local development worktree. */
export class DevelopmentWorktreeSelection {
  select(
    records: readonly WorktreeRecord[],
  ): Result<WorktreeRecord, DevFailure> {
    return new ManagedWorktreeSelection().select(records, ManagedBranch.Dev);
  }
}

/** Selects exactly one canonical local main worktree. */
export class MainWorktreeSelection {
  select(
    records: readonly WorktreeRecord[],
  ): Result<WorktreeRecord, DevFailure> {
    return new ManagedWorktreeSelection().select(records, ManagedBranch.Main);
  }
}
