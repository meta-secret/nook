import { err, ok, type Result } from "neverthrow";

export enum DevFailureKind {
  Configuration = "configuration",
  Command = "command",
  Git = "git",
  GitHub = "github",
  Evidence = "evidence",
  DirtyWorktree = "dirty-worktree",
  Lock = "lock",
  Conflict = "conflict",
  Race = "race",
  Checks = "checks",
  Reviews = "reviews",
  Deployment = "deployment",
  Permission = "permission",
}

export interface DevFailure {
  readonly kind: DevFailureKind;
  readonly message: string;
}

export class CommitSha {
  private constructor(private readonly raw: string) {}

  static parse(input: string): Result<CommitSha, DevFailure> {
    if (!/^[0-9a-f]{40}$/u.test(input)) {
      return err({
        kind: DevFailureKind.Configuration,
        message: `Expected a 40-character lowercase commit SHA, received: ${input}`,
      });
    }
    return ok(new CommitSha(input));
  }

  value(): string {
    return this.raw;
  }

  equals(other: CommitSha): boolean {
    return this.raw === other.raw;
  }
}

export class BranchName {
  private constructor(private readonly raw: string) {}

  static parse(input: string): Result<BranchName, DevFailure> {
    if (
      input.length === 0 ||
      input.startsWith("-") ||
      input.includes("..") ||
      input.includes("@{") ||
      !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(input)
    ) {
      return err({
        kind: DevFailureKind.Configuration,
        message: `Invalid Git branch name: ${input}`,
      });
    }
    return ok(new BranchName(input));
  }

  value(): string {
    return this.raw;
  }

  equals(other: BranchName): boolean {
    return this.raw === other.raw;
  }
}

export enum ManagedBranch {
  Main = "main",
  Dev = "dev",
}

export enum WorktreeBranchKind {
  Branch = "branch",
  Detached = "detached",
}

export type WorktreeBranch =
  | {
      readonly kind: WorktreeBranchKind.Branch;
      readonly name: BranchName;
    }
  | { readonly kind: WorktreeBranchKind.Detached };

export class WorktreeRecord {
  constructor(
    readonly path: string,
    readonly head: CommitSha,
    readonly branch: WorktreeBranch,
    readonly prunable: boolean,
  ) {}

  isManagedDevelopmentWorktree(): boolean {
    return (
      !this.prunable &&
      this.branch.kind === WorktreeBranchKind.Branch &&
      this.branch.name.value() === ManagedBranch.Dev
    );
  }
}

export enum WorktreeState {
  Clean = "clean",
  Dirty = "dirty",
}

export enum Ancestry {
  Ancestor = "ancestor",
  NotAncestor = "not-ancestor",
}

export enum RemoteBranchPresence {
  Present = "present",
  Absent = "absent",
}

export type RemoteBranchSnapshot =
  | {
      readonly presence: RemoteBranchPresence.Present;
      readonly branch: ManagedBranch | BranchName;
      readonly sha: CommitSha;
    }
  | {
      readonly presence: RemoteBranchPresence.Absent;
      readonly branch: ManagedBranch | BranchName;
    };

export enum CommandExecutable {
  Git = "git",
  GitHub = "gh",
}

export interface CommandRequest {
  readonly executable: CommandExecutable;
  readonly args: readonly string[];
  readonly workingDirectory: string;
}

export interface CommandOutput {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandRunner {
  run(request: CommandRequest): Result<CommandOutput, DevFailure>;
}

export interface DevWorkspaceRequest {
  readonly root: string;
  readonly runner: CommandRunner;
}

export interface DevLockRequest {
  readonly commonDirectory: string;
  readonly name: string;
}

export interface BuildProofRequest {
  readonly branch: BranchName;
  readonly sha: CommitSha;
}

export interface DevelopmentCiObservationRequest {
  readonly sha: CommitSha;
  readonly workingDirectory: string;
}

export class WorkflowRunId {
  private constructor(private readonly raw: number) {}

  static parse(input: number): Result<WorkflowRunId, DevFailure> {
    if (!Number.isSafeInteger(input) || input < 1) {
      return err({
        kind: DevFailureKind.Evidence,
        message: `Invalid remote workflow run id: ${input}`,
      });
    }
    return ok(new WorkflowRunId(input));
  }

  value(): number {
    return this.raw;
  }
}

export class PullRequestNumber {
  private constructor(private readonly raw: number) {}

  static parse(input: number): Result<PullRequestNumber, DevFailure> {
    if (!Number.isSafeInteger(input) || input < 1) {
      return err({
        kind: DevFailureKind.GitHub,
        message: `Invalid pull-request number: ${input}`,
      });
    }
    return ok(new PullRequestNumber(input));
  }

  value(): number {
    return this.raw;
  }
}

export class RepositorySlug {
  private constructor(
    readonly owner: string,
    readonly repository: string,
  ) {}

  static parse(input: string): Result<RepositorySlug, DevFailure> {
    const parts = input.trim().split("/");
    const owner = parts[0];
    const repository = parts[1];
    if (
      parts.length !== 2 ||
      !owner ||
      !repository ||
      !/^[A-Za-z0-9_.-]+$/u.test(owner) ||
      !/^[A-Za-z0-9_.-]+$/u.test(repository)
    ) {
      return err({
        kind: DevFailureKind.GitHub,
        message: `GitHub returned an invalid repository name: ${input}`,
      });
    }
    return ok(new RepositorySlug(owner, repository));
  }

  value(): string {
    return `${this.owner}/${this.repository}`;
  }
}

export interface BuildProof {
  readonly sha: CommitSha;
  readonly runId: WorkflowRunId;
}

export interface CiAttempt {
  readonly runId: WorkflowRunId;
  readonly status: string;
}

export interface DevelopmentPullRequest {
  readonly number: PullRequestNumber;
  readonly headSha: CommitSha;
  readonly baseSha: CommitSha;
  readonly url: string;
  readonly isDraft: boolean;
  readonly reviewDecision: PullRequestReviewDecision;
}

export interface PromotionRequest {
  readonly expectedSha: CommitSha;
}

export interface DevSnapshot {
  readonly devPath: string;
  readonly devSha: CommitSha;
}

export interface DevPublishRequest {
  readonly devPath: string;
  readonly devSha: CommitSha;
}

export interface ManagedRemoteSnapshot {
  readonly main: CommitSha;
  readonly dev: CommitSha;
}

export enum PullRequestState {
  Open = "OPEN",
  Closed = "CLOSED",
  Merged = "MERGED",
}

export enum PullRequestReviewDecision {
  Approved = "APPROVED",
  ChangesRequested = "CHANGES_REQUESTED",
  ReviewRequired = "REVIEW_REQUIRED",
  Empty = "EMPTY",
  Unknown = "UNKNOWN",
}

export interface PullRequestStatus {
  readonly state: PullRequestState;
  readonly merged: boolean;
}
