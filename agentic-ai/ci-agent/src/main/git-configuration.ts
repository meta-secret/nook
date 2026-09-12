import { err, ok, type Result } from "neverthrow";
import { CiFailureKind, type CiFailure } from "./failure.js";
export class NulSeparatedRecords {
  constructor(private readonly request: string) {}
  values(): string[] {
    const value = this.request;

    return value.split("\0").filter(Boolean);
  }
}

export class GitConfiguration {
  constructor(private readonly request: readonly GitConfigEntry[]) {}
  assertCredentialFree(): Result<void, CiFailure> {
    const entries = this.request;

    const forbidden = entries.some((entry) => {
      const key = entry.key.toLowerCase();
      const keyOrValue = `${key}\n${entry.value.toLowerCase()}`;
      return (
        (key.startsWith("http.") && key.endsWith(".extraheader")) ||
        key === "credential.helper" ||
        (key.startsWith("credential.") && key.endsWith(".helper")) ||
        keyOrValue.includes("authorization:") ||
        keyOrValue.includes("x-access-token") ||
        keyOrValue.includes("github_pat_") ||
        /https?:\/\/[^/\s]+@/u.test(keyOrValue)
      );
    });
    if (forbidden)
      return err({
        kind: CiFailureKind.CredentialBoundary,
        message: "Persisted Git publication credential detected in config",
      });
    return ok();
  }
}

export class GitConfigurationText {
  constructor(private readonly request: string) {}
  decode(): Result<GitConfigEntry[], CiFailure> {
    const output = this.request;

    let entries: GitConfigEntry[] = [];
    for (const record of new NulSeparatedRecords(output).values()) {
      const separator = record.indexOf("\n");
      if (separator < 1)
        return err({
          kind: CiFailureKind.Schema,
          message: "Malformed Git config record",
        });
      entries = [
        ...entries,
        { key: record.slice(0, separator), value: record.slice(separator + 1) },
      ];
    }
    return ok(entries);
  }
}

export type GitConfigEntry = {
  key: string;
  value: string;
};
