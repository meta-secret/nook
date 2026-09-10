import { readFile, lstat } from "node:fs/promises";
import { ResultAsync } from "neverthrow";
import { CiFailureKind, type CiFailure } from "./failure.js";

export class AgentFile {
  constructor(readonly path: string) {}
  read(): ResultAsync<string, CiFailure> {
    return ResultAsync.fromPromise(
      readFile(this.path, "utf8"),
      (): CiFailure => ({
        kind: CiFailureKind.Filesystem,
        message: `Unable to read agent input ${this.path}`,
      }),
    );
  }
  metadata() {
    return ResultAsync.fromPromise(lstat(this.path), (cause): CiFailure => ({
      kind: CiFailureKind.Filesystem,
      message: `Unable to inspect agent input ${this.path}`,
      ...(cause instanceof Error &&
      "code" in cause &&
      typeof cause.code === "string"
        ? { code: cause.code }
        : {}),
    }));
  }
}
