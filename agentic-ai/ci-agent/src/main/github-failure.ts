import { CiFailureKind, type CiFailure } from "./failure.js";
export class GithubRequestFailure {
  constructor(
    private readonly cause: unknown,
    private readonly signal?: AbortSignal,
  ) {}
  outcome(): CiFailure {
    const code =
      this.cause instanceof Error &&
      "status" in this.cause &&
      typeof this.cause.status === "number"
        ? this.cause.status
        : false;
    return {
      kind: this.signal?.aborted
        ? CiFailureKind.Cancelled
        : CiFailureKind.Github,
      message: "GitHub request failed",
      ...(code === false ? {} : { code }),
    };
  }
}
