import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import { DevFailureKind, type DevFailure } from './dev-types.ts';

type GitHubJsonValue =
  | string
  | number
  | boolean
  | GitHubJsonTransportNull
  | GitHubJsonValue[]
  | { readonly [key: string]: GitHubJsonValue };

type GitHubJsonTransportNull = Exclude<
  ReturnType<URLSearchParams['get']>,
  string
>;

const parseGitHubJson = JSON.parse as (source: string) => GitHubJsonValue;

/** Decodes JSON only at the GitHub CLI transport boundary. */
export class GitHubJsonDocument {
  constructor(private readonly source: string) {}

  decode<T>(schema: z.ZodType<T>): Result<T, DevFailure> {
    let value: GitHubJsonValue;
    try {
      value = parseGitHubJson(this.source);
    } catch {
      return err({
        kind: DevFailureKind.GitHub,
        message: 'GitHub returned invalid JSON',
      });
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      return err({
        kind: DevFailureKind.GitHub,
        message: 'GitHub returned an unexpected response shape',
      });
    }
    return ok(parsed.data);
  }
}
