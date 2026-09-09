import type { RepositoryBaseline } from "./fix.js";
export class DependencyFixAssertGitMetadataBaselineUnchanged {
  constructor(
    private readonly request: {
      baseline: RepositoryBaseline["gitMetadata"];
      current: RepositoryBaseline["gitMetadata"];
    },
  ) {}
  execute(): void {
    const args = this.request;

    if (
      args.current.commonDirectory !== args.baseline.commonDirectory ||
      args.current.gitDirectory !== args.baseline.gitDirectory ||
      args.current.configuration !== args.baseline.configuration
    ) {
      throw new Error("Bounded editor changed trusted Git metadata");
    }
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
  execute(): void {
    const args = this.request;

    const changed =
      args.currentHeadSha !== args.baseline.headSha
        ? "HEAD"
        : args.currentIndexTreeSha !== args.baseline.indexTreeSha
          ? "index"
          : "";
    if (changed)
      throw new Error(`Bounded editor changed the trusted baseline ${changed}`);
  }
}
