import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  UntrustedYamlPropertyPresence,
  UntrustedYamlBoundary,
} from './lib/guards.ts';
import {
  PR_STEWARD_REPOSITORY,
  PrStewardNdjsonCodec,
} from './pr-steward-contract.ts';
import type { UntrustedYamlNode } from './lib/guards.ts';
import type {
  PrStewardHeadSha,
  PrStewardPullRequest,
  PrStewardUrl,
} from './pr-steward-contract.ts';

export type PrStewardAssignedPullRequest = {
  readonly headSha: PrStewardHeadSha;
  readonly url: PrStewardUrl;
};
export type PrStewardAssignedPrRequest = {
  readonly repository: typeof PR_STEWARD_REPOSITORY;
  readonly pullRequest: PrStewardPullRequest;
};
export interface PrStewardAssignedPrReader {
  read(
    request: PrStewardAssignedPrRequest,
  ): Promise<PrStewardAssignedPullRequest>;
}
export type PrStewardCommandRequest = {
  readonly executable: 'gh';
  readonly arguments: readonly string[];
  readonly timeoutMilliseconds: 10_000;
  readonly outputLimitBytes: 2_097_152;
};
export enum PrStewardCommandResultKind {
  Failure = 'failure',
  Success = 'success',
}
export type PrStewardCommandResult =
  | {
      readonly kind: PrStewardCommandResultKind.Failure;
      readonly cause: Error;
    }
  | {
      readonly kind: PrStewardCommandResultKind.Success;
      readonly stdout: string;
    };
export interface PrStewardCommandRunner {
  run(request: PrStewardCommandRequest): Promise<PrStewardCommandResult>;
}

export class PrStewardGithubUnavailableError extends Error {
  constructor(request: { readonly cause: Error | false }) {
    super(
      'Assigned pull request observation is unavailable.',
      request.cause === false ? {} : { cause: request.cause },
    );
    this.name = 'PrStewardGithubUnavailableError';
  }
}

class PrStewardGhCommand implements PrStewardCommandRunner {
  async run(request: PrStewardCommandRequest): Promise<PrStewardCommandResult> {
    try {
      const result = await promisify(execFile)(
        request.executable,
        request.arguments,
        {
          encoding: 'utf8',
          maxBuffer: request.outputLimitBytes,
          timeout: request.timeoutMilliseconds,
          killSignal: 'SIGTERM',
          shell: false,
        },
      );
      return {
        kind: PrStewardCommandResultKind.Success,
        stdout: result.stdout,
      };
    } catch (cause) {
      return {
        kind: PrStewardCommandResultKind.Failure,
        cause:
          cause instanceof Error ? cause : new Error('gh execution failed'),
      };
    }
  }
}

export class PrStewardGithubPrReader implements PrStewardAssignedPrReader {
  readonly #command: PrStewardCommandRunner;

  constructor(request: { readonly command: PrStewardCommandRunner }) {
    this.#command = request.command;
  }

  static create(): PrStewardGithubPrReader {
    return new PrStewardGithubPrReader({ command: new PrStewardGhCommand() });
  }

  async read(
    request: PrStewardAssignedPrRequest,
  ): Promise<PrStewardAssignedPullRequest> {
    if (
      request.repository !== PR_STEWARD_REPOSITORY ||
      !Number.isSafeInteger(request.pullRequest) ||
      request.pullRequest <= 0
    )
      throw new PrStewardGithubUnavailableError({ cause: false });
    const result = await this.#command.run({
      executable: 'gh',
      arguments: [
        'api',
        '--hostname',
        'github.com',
        '--method',
        'GET',
        `/repos/${PR_STEWARD_REPOSITORY}/pulls/${request.pullRequest}`,
      ],
      timeoutMilliseconds: 10_000,
      outputLimitBytes: 2_097_152,
    });
    if (
      result.kind === PrStewardCommandResultKind.Failure ||
      new TextEncoder().encode(result.stdout).length > 2_097_152
    )
      throw new PrStewardGithubUnavailableError({
        cause:
          result.kind === PrStewardCommandResultKind.Failure
            ? result.cause
            : false,
      });
    let parsed: UntrustedYamlNode;
    try {
      parsed = UntrustedYamlBoundary.fromHost(
        JSON.parse(result.stdout) as UntrustedYamlNode,
      );
    } catch {
      throw new PrStewardGithubUnavailableError({ cause: false });
    }
    if (!UntrustedYamlBoundary.isRecord(parsed))
      throw new PrStewardGithubUnavailableError({ cause: false });
    const head = UntrustedYamlBoundary.property({
      record: parsed,
      key: 'head',
    });
    const html = UntrustedYamlBoundary.property({
      record: parsed,
      key: 'html_url',
    });
    if (
      head.presence !== UntrustedYamlPropertyPresence.Present ||
      !UntrustedYamlBoundary.isRecord(head.value) ||
      html.presence !== UntrustedYamlPropertyPresence.Present ||
      typeof html.value !== 'string'
    )
      throw new PrStewardGithubUnavailableError({ cause: false });
    const sha = UntrustedYamlBoundary.property({
      record: head.value,
      key: 'sha',
    });
    const expected = `https://github.com/${PR_STEWARD_REPOSITORY}/pull/${request.pullRequest}`;
    const url = PrStewardNdjsonCodec.githubUrl(html.value);
    if (
      sha.presence !== UntrustedYamlPropertyPresence.Present ||
      typeof sha.value !== 'string' ||
      !/^[0-9a-f]{40}$/.test(sha.value) ||
      html.value !== expected ||
      url === false ||
      url.value !== expected
    )
      throw new PrStewardGithubUnavailableError({ cause: false });
    return { headSha: PrStewardNdjsonCodec.headSha(sha.value), url };
  }
}
