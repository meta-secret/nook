import { spawnSync } from 'node:child_process';
import {
  asUntrustedYamlNode,
  isRecord,
  untrustedYamlProperty,
  UntrustedYamlPropertyPresence,
} from './lib/guards.ts';
import {
  PR_STEWARD_REPOSITORY,
  PrStewardNdjsonCodec,
} from './pr-steward-contract.ts';
import type { UntrustedYamlNode } from './lib/guards.ts';
import type { PrStewardUrl } from './pr-steward-contract.ts';

export type PrStewardAssignedPullRequest = {
  readonly headSha: string;
  readonly url: PrStewardUrl;
};

export type PrStewardAssignedPrRequest = {
  readonly repository: typeof PR_STEWARD_REPOSITORY;
  readonly pullRequest: number;
};

export interface PrStewardAssignedPrReader {
  read(request: PrStewardAssignedPrRequest): PrStewardAssignedPullRequest;
}

export type PrStewardCommandRequest = {
  readonly executable: 'gh';
  readonly arguments: readonly string[];
  readonly timeoutMilliseconds: 10_000;
  readonly outputLimitBytes: 2_097_152;
};

export type PrStewardCommandResult = {
  readonly status: number | false;
  readonly signal: string | false;
  readonly stdout: string;
};

export interface PrStewardCommandRunner {
  run(request: PrStewardCommandRequest): PrStewardCommandResult;
}

export class PrStewardGithubUnavailableError extends Error {
  constructor() {
    super('Assigned pull request observation is unavailable.');
  }
}

class PrStewardGhCommand implements PrStewardCommandRunner {
  run(request: PrStewardCommandRequest): PrStewardCommandResult {
    const result = spawnSync(request.executable, request.arguments, {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: request.outputLimitBytes,
      timeout: request.timeoutMilliseconds,
      killSignal: 'SIGTERM',
      shell: false,
    });
    return {
      status: typeof result.status === 'number' ? result.status : false,
      signal: typeof result.signal === 'string' ? result.signal : false,
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
    };
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

  read(request: PrStewardAssignedPrRequest): PrStewardAssignedPullRequest {
    if (
      request.repository !== PR_STEWARD_REPOSITORY ||
      !Number.isSafeInteger(request.pullRequest) ||
      request.pullRequest <= 0
    )
      throw new PrStewardGithubUnavailableError();
    const result = this.#command.run({
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
      result.status !== 0 ||
      result.signal !== false ||
      new TextEncoder().encode(result.stdout).length > 2_097_152
    )
      throw new PrStewardGithubUnavailableError();
    let parsed: UntrustedYamlNode;
    try {
      parsed = asUntrustedYamlNode(
        JSON.parse(result.stdout) as UntrustedYamlNode,
      );
    } catch {
      throw new PrStewardGithubUnavailableError();
    }
    if (!isRecord(parsed)) throw new PrStewardGithubUnavailableError();
    const head = untrustedYamlProperty({ record: parsed, key: 'head' });
    if (
      head.presence !== UntrustedYamlPropertyPresence.Present ||
      !isRecord(head.value)
    )
      throw new PrStewardGithubUnavailableError();
    const sha = untrustedYamlProperty({ record: head.value, key: 'sha' });
    if (
      sha.presence !== UntrustedYamlPropertyPresence.Present ||
      typeof sha.value !== 'string' ||
      !/^[0-9a-f]{40}$/.test(sha.value)
    )
      throw new PrStewardGithubUnavailableError();
    const html = untrustedYamlProperty({ record: parsed, key: 'html_url' });
    const url =
      html.presence === UntrustedYamlPropertyPresence.Present &&
      typeof html.value === 'string'
        ? PrStewardNdjsonCodec.githubUrl(html.value)
        : false;
    const expected = `https://github.com/${PR_STEWARD_REPOSITORY}/pull/${request.pullRequest}`;
    if (url === false || url.value !== expected)
      throw new PrStewardGithubUnavailableError();
    return {
      headSha: sha.value,
      url,
    };
  }
}
