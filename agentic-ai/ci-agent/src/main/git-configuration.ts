export class NulSeparatedRecords {
  constructor(private readonly request: string) {}
  values(): string[] {
    const value = this.request;

    return value.split("\0").filter(Boolean);
  }
}

export class GitConfiguration {
  constructor(private readonly request: readonly GitConfigEntry[]) {}
  assertCredentialFree(): void {
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
      throw new Error(
        "Persisted Git publication credential detected in config",
      );
  }
}

export class GitConfigurationText {
  constructor(private readonly request: string) {}
  decode(): GitConfigEntry[] {
    const output = this.request;

    return new NulSeparatedRecords(output).values().map((record) => {
      const separator = record.indexOf("\n");
      if (separator < 1) throw new Error("Malformed Git config record");
      return {
        key: record.slice(0, separator),
        value: record.slice(separator + 1),
      };
    });
  }
}

export type GitConfigEntry = {
  key: string;
  value: string;
};
