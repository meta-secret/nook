import { err, ok, type Result } from "neverthrow";
import { CiFailureKind, type CiFailure } from "./failure.js";
import type { RepositoryBaseline } from "./fix.js";
export class DependencyFixAssertGitMetadataBaselineUnchanged {
  constructor(
    private readonly request: {
      baseline: RepositoryBaseline["gitMetadata"];
      current: RepositoryBaseline["gitMetadata"];
    },
  ) {}
  execute(): Result<void, CiFailure> {
    const args = this.request;

    if (
      args.current.commonDirectory !== args.baseline.commonDirectory ||
      args.current.gitDirectory !== args.baseline.gitDirectory ||
      args.current.configuration !== args.baseline.configuration
    ) {
      return err({
        kind: CiFailureKind.Baseline,
        message: "Bounded editor changed trusted Git metadata",
      });
    }
    return ok();
  }
}
export class DependencyFixAssertRepositoryBaselineUnchanged {
  constructor(
    private readonly request: {
      baseline: Pick<RepositoryBaseline, "headSha" | "indexTreeSha">;
      currentHeadSha: string;
      currentIndexTreeSha: string;
    },
  ) {}
  execute(): Result<void, CiFailure> {
    const args = this.request;

    const changed =
      args.currentHeadSha !== args.baseline.headSha
        ? "HEAD"
        : args.currentIndexTreeSha !== args.baseline.indexTreeSha
          ? "index"
          : "";
    if (changed)
      return err({
        kind: CiFailureKind.Baseline,
        message: `Bounded editor changed the trusted baseline ${changed}`,
      });
    return ok();
  }
}
