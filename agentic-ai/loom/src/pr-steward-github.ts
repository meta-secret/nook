import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
import type { UntrustedYamlMap, UntrustedYamlNode } from './lib/guards.ts';
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

export enum PrStewardGithubFailureKind {
  CheckRun = 'check-run',
  CheckSuite = 'check-suite',
  WorkflowJob = 'workflow-job',
  WorkflowRun = 'workflow-run',
}
export enum PrStewardGithubFailureReadState {
  Complete = 'complete',
  Invalid = 'invalid',
  Mismatch = 'mismatch',
  Unavailable = 'unavailable',
}
export enum PrStewardGithubFailureStatus {
  Completed = 'completed',
}
export enum PrStewardGithubCheckFailureConclusion {
  ActionRequired = 'action_required',
  Cancelled = 'cancelled',
  Failure = 'failure',
  Neutral = 'neutral',
  Skipped = 'skipped',
  Stale = 'stale',
  TimedOut = 'timed_out',
}
export enum PrStewardGithubWorkflowFailureConclusion {
  ActionRequired = 'action_required',
  Cancelled = 'cancelled',
  Failure = 'failure',
  Neutral = 'neutral',
  Skipped = 'skipped',
  Stale = 'stale',
  StartupFailure = 'startup_failure',
  TimedOut = 'timed_out',
}
export enum PrStewardGithubStepStatus {
  Completed = 'completed',
}
export enum PrStewardGithubStepConclusion {
  Cancelled = 'cancelled',
  Failure = 'failure',
  Skipped = 'skipped',
  Success = 'success',
}
declare const failureObjectIdBrand: unique symbol;
declare const failureRunIdBrand: unique symbol;
export type PrStewardGithubFailureObjectId = number & {
  readonly [failureObjectIdBrand]: 'PrStewardGithubFailureObjectId';
};
export type PrStewardGithubFailureRunId = number & {
  readonly [failureRunIdBrand]: 'PrStewardGithubFailureRunId';
};
type FailureRequestCommon = {
  readonly repository: typeof PR_STEWARD_REPOSITORY;
  readonly pullRequest: PrStewardPullRequest;
  readonly headSha: PrStewardHeadSha;
  readonly objectId: number;
};
export type PrStewardGithubFailureRequest = FailureRequestCommon &
  (
    | {
        readonly kind:
          | PrStewardGithubFailureKind.CheckRun
          | PrStewardGithubFailureKind.CheckSuite
          | PrStewardGithubFailureKind.WorkflowRun;
      }
    | {
        readonly kind: PrStewardGithubFailureKind.WorkflowJob;
        readonly runId: number;
      }
  );
export type PrStewardGithubFailureStep = {
  readonly number: number;
  readonly name: string;
  readonly status: PrStewardGithubStepStatus;
  readonly conclusion: PrStewardGithubStepConclusion;
};
type FailureDetailCommon = {
  readonly objectId: PrStewardGithubFailureObjectId;
  readonly headSha: PrStewardHeadSha;
  readonly name: string;
  readonly status: PrStewardGithubFailureStatus;
};
export type PrStewardGithubFailureDetail = FailureDetailCommon &
  (
    | {
        readonly kind:
          | PrStewardGithubFailureKind.CheckRun
          | PrStewardGithubFailureKind.CheckSuite;
        readonly conclusion: PrStewardGithubCheckFailureConclusion;
      }
    | {
        readonly kind: PrStewardGithubFailureKind.WorkflowRun;
        readonly conclusion: PrStewardGithubWorkflowFailureConclusion;
      }
    | {
        readonly kind: PrStewardGithubFailureKind.WorkflowJob;
        readonly conclusion: PrStewardGithubWorkflowFailureConclusion;
        readonly runId: PrStewardGithubFailureRunId;
        readonly steps: readonly PrStewardGithubFailureStep[];
      }
  );
export type PrStewardGithubFailureReadResult =
  | {
      readonly state: PrStewardGithubFailureReadState.Complete;
      readonly detail: PrStewardGithubFailureDetail;
    }
  | {
      readonly state:
        | PrStewardGithubFailureReadState.Invalid
        | PrStewardGithubFailureReadState.Mismatch
        | PrStewardGithubFailureReadState.Unavailable;
    };

export class PrStewardGithubFailureReader {
  readonly #command: PrStewardCommandRunner;

  private constructor(request: { readonly command: PrStewardCommandRunner }) {
    this.#command = request.command;
  }

  static create(): PrStewardGithubFailureReader {
    return new PrStewardGithubFailureReader({
      command: new PrStewardGhCommand(),
    });
  }

  async read(
    request: PrStewardGithubFailureRequest,
  ): Promise<PrStewardGithubFailureReadResult> {
    if (!this.#validRequest(request))
      return { state: PrStewardGithubFailureReadState.Invalid };
    const result = await this.#command.run({
      executable: 'gh',
      arguments: [
        'api',
        '--hostname',
        'github.com',
        '--method',
        'GET',
        this.#endpoint(request),
      ],
      timeoutMilliseconds: 10_000,
      outputLimitBytes: 2_097_152,
    });
    if (
      result.kind === PrStewardCommandResultKind.Failure ||
      new TextEncoder().encode(result.stdout).length > 2_097_152
    )
      return { state: PrStewardGithubFailureReadState.Unavailable };
    let value: UntrustedYamlNode;
    try {
      value = asUntrustedYamlNode(
        JSON.parse(result.stdout) as UntrustedYamlNode,
      );
    } catch {
      return { state: PrStewardGithubFailureReadState.Unavailable };
    }
    const detail = isRecord(value) ? this.#detail({ request, value }) : false;
    return detail === false
      ? { state: PrStewardGithubFailureReadState.Mismatch }
      : { state: PrStewardGithubFailureReadState.Complete, detail };
  }

  #validRequest(request: PrStewardGithubFailureRequest): boolean {
    return (
      request.repository === PR_STEWARD_REPOSITORY &&
      Number.isSafeInteger(request.pullRequest) &&
      request.pullRequest > 0 &&
      typeof request.headSha === 'string' &&
      /^[0-9a-f]{40}$/.test(request.headSha) &&
      Number.isSafeInteger(request.objectId) &&
      request.objectId > 0 &&
      Object.values(PrStewardGithubFailureKind).some(
        (kind) => kind === request.kind,
      ) &&
      (request.kind !== PrStewardGithubFailureKind.WorkflowJob ||
        (Number.isSafeInteger(request.runId) && request.runId > 0))
    );
  }

  #endpoint(request: PrStewardGithubFailureRequest): string {
    switch (request.kind) {
      case PrStewardGithubFailureKind.CheckRun:
        return `/repos/${PR_STEWARD_REPOSITORY}/check-runs/${request.objectId}`;
      case PrStewardGithubFailureKind.CheckSuite:
        return `/repos/${PR_STEWARD_REPOSITORY}/check-suites/${request.objectId}`;
      case PrStewardGithubFailureKind.WorkflowJob:
        return `/repos/${PR_STEWARD_REPOSITORY}/actions/jobs/${request.objectId}`;
      case PrStewardGithubFailureKind.WorkflowRun:
        return `/repos/${PR_STEWARD_REPOSITORY}/actions/runs/${request.objectId}`;
    }
  }

  #detail(request: {
    readonly request: PrStewardGithubFailureRequest;
    readonly value: UntrustedYamlMap;
  }): PrStewardGithubFailureDetail | false {
    const id = this.#integer({ record: request.value, key: 'id' });
    const head = this.#head(request.value);
    const status = this.#text({
      record: request.value,
      key: 'status',
      limit: 40,
    });
    const conclusionText = this.#text({
      record: request.value,
      key: 'conclusion',
      limit: 40,
    });
    const name = this.#name(request);
    if (
      id !== request.request.objectId ||
      head !== request.request.headSha ||
      status !== PrStewardGithubFailureStatus.Completed ||
      conclusionText === false ||
      name === false
    )
      return false;
    const common: FailureDetailCommon = {
      objectId: id as PrStewardGithubFailureObjectId,
      headSha: request.request.headSha,
      name,
      status: PrStewardGithubFailureStatus.Completed,
    };
    if (
      request.request.kind === PrStewardGithubFailureKind.CheckRun ||
      request.request.kind === PrStewardGithubFailureKind.CheckSuite
    ) {
      const conclusion = this.#checkConclusion(conclusionText);
      return conclusion === false
        ? false
        : { ...common, kind: request.request.kind, conclusion };
    }
    const conclusion = this.#workflowConclusion(conclusionText);
    if (conclusion === false) return false;
    if (request.request.kind === PrStewardGithubFailureKind.WorkflowRun)
      return { ...common, kind: request.request.kind, conclusion };
    if (request.request.kind !== PrStewardGithubFailureKind.WorkflowJob)
      return false;
    const runId = this.#integer({ record: request.value, key: 'run_id' });
    const steps = this.#steps(request.value);
    return runId === request.request.runId && steps !== false
      ? {
          ...common,
          kind: request.request.kind,
          conclusion,
          runId: runId as PrStewardGithubFailureRunId,
          steps,
        }
      : false;
  }

  #name(request: {
    readonly request: PrStewardGithubFailureRequest;
    readonly value: UntrustedYamlMap;
  }): string | false {
    if (request.request.kind === PrStewardGithubFailureKind.CheckSuite) {
      const app = this.#property({ record: request.value, key: 'app' });
      return isRecord(app)
        ? this.#text({ record: app, key: 'name', limit: 120 })
        : false;
    }
    const direct = this.#text({
      record: request.value,
      key: 'name',
      limit: 120,
    });
    return direct;
  }

  #head(record: UntrustedYamlMap): string | false {
    const value = this.#property({ record, key: 'head_sha' });
    return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value)
      ? value
      : false;
  }

  #checkConclusion(
    value: string,
  ): PrStewardGithubCheckFailureConclusion | false {
    return Object.values(PrStewardGithubCheckFailureConclusion).some(
      (conclusion) => conclusion === value,
    )
      ? (value as PrStewardGithubCheckFailureConclusion)
      : false;
  }

  #workflowConclusion(
    value: string,
  ): PrStewardGithubWorkflowFailureConclusion | false {
    return Object.values(PrStewardGithubWorkflowFailureConclusion).some(
      (conclusion) => conclusion === value,
    )
      ? (value as PrStewardGithubWorkflowFailureConclusion)
      : false;
  }

  #stepConclusion(value: string): PrStewardGithubStepConclusion | false {
    return Object.values(PrStewardGithubStepConclusion).some(
      (conclusion) => conclusion === value,
    )
      ? (value as PrStewardGithubStepConclusion)
      : false;
  }

  #steps(
    record: UntrustedYamlMap,
  ): readonly PrStewardGithubFailureStep[] | false {
    const value = this.#property({ record, key: 'steps' });
    if (!Array.isArray(value) || value.length > 100) return false;
    const steps: PrStewardGithubFailureStep[] = [];
    for (const step of value) {
      if (!isRecord(step)) return false;
      const number = this.#integer({ record: step, key: 'number' });
      const name = this.#text({ record: step, key: 'name', limit: 120 });
      const status = this.#text({ record: step, key: 'status', limit: 40 });
      const conclusion = this.#text({
        record: step,
        key: 'conclusion',
        limit: 40,
      });
      const parsedConclusion =
        conclusion === false ? false : this.#stepConclusion(conclusion);
      if (
        number === false ||
        name === false ||
        status !== PrStewardGithubStepStatus.Completed ||
        parsedConclusion === false
      )
        return false;
      steps.push({
        number,
        name,
        status: PrStewardGithubStepStatus.Completed,
        conclusion: parsedConclusion,
      });
    }
    return steps;
  }

  #property(request: FieldRequest): UntrustedYamlNode | false {
    const result = untrustedYamlProperty(request);
    return result.presence === UntrustedYamlPropertyPresence.Present
      ? result.value
      : false;
  }

  #integer(request: FieldRequest): number | false {
    const value = this.#property(request);
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
      ? value
      : false;
  }

  #text(request: FieldRequest & { readonly limit: number }): string | false {
    const value = this.#property(request);
    if (typeof value !== 'string') return false;
    const clean = value.trim();
    return clean.length > 0 &&
      clean.length <= request.limit &&
      !Array.from(clean).some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127;
      }) &&
      new TextEncoder().encode(clean).length <= request.limit * 3
      ? clean
      : false;
  }
}

type FieldRequest = { readonly record: UntrustedYamlMap; readonly key: string };
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
      parsed = asUntrustedYamlNode(
        JSON.parse(result.stdout) as UntrustedYamlNode,
      );
    } catch {
      throw new PrStewardGithubUnavailableError({ cause: false });
    }
    if (!isRecord(parsed))
      throw new PrStewardGithubUnavailableError({ cause: false });
    const head = untrustedYamlProperty({ record: parsed, key: 'head' });
    const html = untrustedYamlProperty({ record: parsed, key: 'html_url' });
    if (
      head.presence !== UntrustedYamlPropertyPresence.Present ||
      !isRecord(head.value) ||
      html.presence !== UntrustedYamlPropertyPresence.Present ||
      typeof html.value !== 'string'
    )
      throw new PrStewardGithubUnavailableError({ cause: false });
    const sha = untrustedYamlProperty({ record: head.value, key: 'sha' });
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
