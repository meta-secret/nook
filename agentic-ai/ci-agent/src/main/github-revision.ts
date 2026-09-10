import { err, ok, type Result } from "neverthrow";
import { CiFailureKind, type CiFailure } from "./failure.js";
import type { RepoRef, PullRequestRevision } from "./github.js";
export class GitHubRepositoryName {
  constructor(private readonly request: string) {}
  parse(): Result<RepoRef, CiFailure> {
    const fullName = this.request;

    const [owner, repo] = fullName.split("/");
    if (!owner || !repo) {
      return err({
        kind: CiFailureKind.Github,
        message: `Invalid GITHUB_REPOSITORY: ${fullName}`,
      });
    }
    return ok({ owner, repo });
  }
}

export interface GitHubSamePullRequestRevisionRequest {
  readonly left: PullRequestRevision;
  readonly right: PullRequestRevision;
}

export class PullRequestRevisionComparison {
  constructor(private readonly request: GitHubSamePullRequestRevisionRequest) {}
  matches(): boolean {
    const { left, right } = this.request;

    return (
      left.baseRef === right.baseRef &&
      left.baseSha === right.baseSha &&
      left.headSha === right.headSha
    );
  }
}

export interface GitHubAssertPullRequestRevisionRequest {
  readonly expected: PullRequestRevision;
  readonly actual: PullRequestRevision;
}

export class PullRequestRevisionConstraint {
  constructor(
    private readonly request: GitHubAssertPullRequestRevisionRequest,
  ) {}
  enforce(): Result<void, CiFailure> {
    const { expected, actual } = this.request;

    if (
      new PullRequestRevisionComparison({
        left: expected,
        right: actual,
      }).matches()
    )
      return ok();
    return err({
      kind: CiFailureKind.Github,
      message: `Pull request revision changed from ${expected.headSha}/${expected.baseSha}/${expected.baseRef} to ${actual.headSha}/${actual.baseSha}/${actual.baseRef}; no review was requested`,
    });
  }
}
