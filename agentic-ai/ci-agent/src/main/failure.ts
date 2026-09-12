import { err, type Result } from "neverthrow";

export enum CiFailureKind {
  Configuration = "configuration",
  Filesystem = "filesystem",
  Git = "git",
  CredentialBoundary = "credential-boundary",
  Baseline = "baseline",
  Dependency = "dependency",
  Budget = "budget",
  Github = "github",
  Schema = "schema",
  Agent = "agent",
  Timeout = "timeout",
  Cancelled = "cancelled",
  Cleanup = "cleanup",
  Combined = "combined",
}
export type CiFailure =
  | {
      readonly kind: Exclude<CiFailureKind, CiFailureKind.Combined>;
      readonly message: string;
      readonly code?: string | number;
    }
  | {
      readonly kind: CiFailureKind.Combined;
      readonly message: string;
      readonly failures: readonly CiFailure[];
    };

export class CiCleanupOutcome {
  constructor(private readonly cleanup: Result<void, CiFailure>) {}
  finish<T>(outcome: Result<T, CiFailure>): Result<T, CiFailure> {
    if (this.cleanup.isOk()) return outcome;
    if (outcome.isOk()) return err(this.cleanup.error);
    return err({
      kind: CiFailureKind.Combined,
      message: outcome.error.message + "\n" + this.cleanup.error.message,
      failures: [outcome.error, this.cleanup.error],
    });
  }
}
