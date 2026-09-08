import {
  constants,
  closeSync,
  fstatSync,
  openSync,
  readFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { wsconnect } from '@nats-io/nats-core';
import {
  asUntrustedYamlNode,
  isRecord,
  untrustedYamlProperty,
  UntrustedYamlPropertyPresence,
} from './lib/guards.ts';
import {
  PR_STEWARD_REPOSITORY,
  PrStewardBlockerCode,
  PrStewardDecodeError,
  PrStewardNdjsonCodec,
  PrStewardRecordKind,
  PrStewardSource,
} from './pr-steward-contract.ts';
import {
  PrStewardGithubPrReader,
  PrStewardGithubUnavailableError,
} from './pr-steward-github.ts';

import type { UntrustedYamlMap, UntrustedYamlNode } from './lib/guards.ts';
import type {
  PrStewardPullRequest,
  PrStewardRecord,
  PrStewardUrl,
} from './pr-steward-contract.ts';
import type { PrStewardAssignedPrReader } from './pr-steward-github.ts';

export const PR_STEWARD_ENDPOINT = 'wss://events.dev.nokey.sh';
export const PR_STEWARD_SUBJECT = 'default.github-webhook.pr-lifecycle';
export type PrStewardCredential = {
  readonly username: 'pr-steward';
  readonly password: string;
};

export type PrStewardEvent = {
  readonly id: string;
  readonly time: string;
  readonly githubEvent: string;
  readonly deliveryId: string;
  readonly action: string | false;
  readonly repository: string | false;
  readonly pullRequest: number | false;
  readonly headSha: string | false;
  readonly source: PrStewardSource | false;
  readonly objectId: number | false;
  readonly runId: number | false;
  readonly reviewId: number | false;
  readonly commentId: number | false;
  readonly state: string | false;
  readonly url: PrStewardUrl | false;
  readonly path: string | false;
  readonly line: number | false;
  readonly author: string | false;
};

function property(args: {
  readonly record: UntrustedYamlMap;
  readonly key: string;
}): UntrustedYamlNode | false {
  const result = untrustedYamlProperty(args);
  if (result.presence === UntrustedYamlPropertyPresence.Absent) return false;
  return !result.value && typeof result.value === 'object'
    ? false
    : result.value;
}

function nested(args: {
  readonly record: UntrustedYamlMap;
  readonly path: readonly string[];
}): UntrustedYamlNode | false {
  let current: UntrustedYamlNode = args.record;
  for (const key of args.path) {
    if (!isRecord(current)) return false;
    const next = property({ record: current, key });
    if (next === false) return false;
    current = next;
  }
  return current;
}

function optionalString(value: UntrustedYamlNode | false): string | false {
  return typeof value === 'string' && value.length > 0 ? value : false;
}

function optionalNumber(value: UntrustedYamlNode | false): number | false {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : false;
}

function headerValue(args: {
  readonly headers: UntrustedYamlMap;
  readonly name: string;
}): string | false {
  const value = property({ record: args.headers, key: args.name });
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return false;
}

enum PrStewardWebhookDecodeCode {
  Data = 'data',
  Envelope = 'envelope',
  Identity = 'identity',
  Payload = 'payload',
}
type PrStewardMetadata = Pick<
  PrStewardEvent,
  | 'author'
  | 'commentId'
  | 'line'
  | 'objectId'
  | 'path'
  | 'reviewId'
  | 'runId'
  | 'state'
  | 'url'
>;
class EventDecodeError extends Error {
  readonly attribution:
    | {
        readonly repository: typeof PR_STEWARD_REPOSITORY;
        readonly pullRequest: number;
      }
    | false;

  constructor(request: {
    readonly code: PrStewardWebhookDecodeCode;
    readonly attribution: EventDecodeError['attribution'];
  }) {
    super(`PR Steward webhook decode failed: ${request.code}`);
    this.name = 'EventDecodeError';
    this.attribution = request.attribution;
  }
}

export class PrStewardWebhookDecoder {
  static #source(value: string): PrStewardSource | false {
    for (const source of Object.values(PrStewardSource))
      if (PrStewardNdjsonCodec.githubEvent(source) === value) return source;
    return false;
  }

  static #object(args: {
    readonly body: UntrustedYamlMap;
    readonly source: PrStewardSource;
  }): UntrustedYamlMap {
    const keys: Record<PrStewardSource, string> = {
      [PrStewardSource.CheckRun]: 'check_run',
      [PrStewardSource.CheckSuite]: 'check_suite',
      [PrStewardSource.IssueComment]: 'comment',
      [PrStewardSource.PullRequest]: 'pull_request',
      [PrStewardSource.PullRequestReview]: 'review',
      [PrStewardSource.PullRequestReviewComment]: 'comment',
      [PrStewardSource.WorkflowJob]: 'workflow_job',
      [PrStewardSource.WorkflowRun]: 'workflow_run',
    };
    const candidate = property({ record: args.body, key: keys[args.source] });
    return isRecord(candidate) ? candidate : {};
  }

  static #pullRequestNumber(args: {
    readonly body: UntrustedYamlMap;
    readonly source: PrStewardSource | false;
  }): number | false {
    if (args.source === PrStewardSource.IssueComment) {
      const marker = nested({
        record: args.body,
        path: ['issue', 'pull_request'],
      });
      return isRecord(marker)
        ? optionalNumber(
            nested({ record: args.body, path: ['issue', 'number'] }),
          )
        : false;
    }
    if (
      args.source === PrStewardSource.PullRequest ||
      args.source === PrStewardSource.PullRequestReview ||
      args.source === PrStewardSource.PullRequestReviewComment
    )
      return optionalNumber(
        nested({ record: args.body, path: ['pull_request', 'number'] }),
      );
    const source = args.source;
    if (source === false) return false;
    const object = this.#object({ body: args.body, source });
    const candidates = property({ record: object, key: 'pull_requests' });
    if (
      !Array.isArray(candidates) ||
      candidates.length !== 1 ||
      !isRecord(candidates[0])
    )
      return false;
    const pullRequest = optionalNumber(
      property({ record: candidates[0], key: 'number' }),
    );
    const associatedHead = optionalString(
      nested({ record: candidates[0], path: ['head', 'sha'] }),
    );
    const eventHead = optionalString(
      property({ record: object, key: 'head_sha' }),
    );
    return pullRequest !== false &&
      associatedHead !== false &&
      eventHead !== false &&
      /^[0-9a-f]{40}$/.test(associatedHead) &&
      associatedHead === eventHead
      ? pullRequest
      : false;
  }

  static #headSha(args: {
    readonly body: UntrustedYamlMap;
    readonly source: PrStewardSource | false;
  }): string | false {
    const source = args.source;
    if (source === false || source === PrStewardSource.IssueComment)
      return false;
    const object = this.#object({ body: args.body, source });
    const value = optionalString(
      args.source === PrStewardSource.PullRequest
        ? nested({ record: object, path: ['head', 'sha'] })
        : args.source === PrStewardSource.PullRequestReview ||
            args.source === PrStewardSource.PullRequestReviewComment
          ? property({ record: object, key: 'commit_id' })
          : property({ record: object, key: 'head_sha' }),
    );
    return value !== false && /^[0-9a-f]{40}$/.test(value) ? value : false;
  }

  static #boundedText(args: {
    readonly value: UntrustedYamlNode | false;
    readonly limit: number;
  }): string | false {
    const candidate = optionalString(args.value);
    if (candidate === false) return false;
    const normalized = Array.from(candidate)
      .map((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127 ? ' ' : character;
      })
      .join('')
      .trim();
    return normalized.length === 0 || normalized.length > args.limit
      ? false
      : normalized;
  }

  static #routingMetadata(args: {
    readonly body: UntrustedYamlMap;
    readonly source: PrStewardSource;
  }): PrStewardMetadata {
    const object = this.#object(args);
    const github = this.#boundedText({
      value: property({ record: object, key: 'html_url' }),
      limit: 240,
    });
    const external = this.#boundedText({
      value: property({ record: object, key: 'target_url' }),
      limit: 240,
    });
    const reviewComment =
      args.source === PrStewardSource.PullRequestReviewComment;
    const line = optionalNumber(
      property({ record: reviewComment ? object : {}, key: 'line' }),
    );
    const originalLine = optionalNumber(
      property({ record: reviewComment ? object : {}, key: 'original_line' }),
    );
    const comment =
      args.source === PrStewardSource.IssueComment || reviewComment;
    const run =
      args.source === PrStewardSource.CheckRun ||
      args.source === PrStewardSource.WorkflowRun;
    const human =
      comment ||
      args.source === PrStewardSource.PullRequest ||
      args.source === PrStewardSource.PullRequestReview;
    const objectId = optionalNumber(property({ record: object, key: 'id' }));
    return {
      objectId,
      runId: !run
        ? false
        : args.source === PrStewardSource.WorkflowRun
          ? objectId
          : optionalNumber(property({ record: object, key: 'run_id' })),
      reviewId: optionalNumber(
        property({
          record: reviewComment ? object : {},
          key: 'pull_request_review_id',
        }),
      ),
      commentId: comment
        ? optionalNumber(property({ record: object, key: 'id' }))
        : false,
      state:
        this.#boundedText({
          value: property({ record: object, key: 'state' }),
          limit: 64,
        }) ||
        this.#boundedText({
          value: property({ record: object, key: 'conclusion' }),
          limit: 64,
        }) ||
        this.#boundedText({
          value: property({ record: object, key: 'status' }),
          limit: 64,
        }),
      url:
        github !== false
          ? PrStewardNdjsonCodec.githubUrl(github)
          : external !== false
            ? PrStewardNdjsonCodec.externalUrl(external)
            : false,
      path: this.#boundedText({
        value: property({ record: reviewComment ? object : {}, key: 'path' }),
        limit: 240,
      }),
      line: line !== false ? line : originalLine,
      author:
        human &&
        this.#boundedText({
          value: nested({ record: object, path: ['user', 'login'] }),
          limit: 64,
        }),
    };
  }

  static #coherentReviewHead(args: {
    readonly body: UntrustedYamlMap;
    readonly source: PrStewardSource;
  }): boolean {
    if (
      args.source !== PrStewardSource.PullRequestReview &&
      args.source !== PrStewardSource.PullRequestReviewComment
    )
      return true;
    const pullHead = optionalString(
      nested({ record: args.body, path: ['pull_request', 'head', 'sha'] }),
    );
    const objectHead = optionalString(
      property({ record: this.#object(args), key: 'commit_id' }),
    );
    return (
      pullHead !== false &&
      objectHead !== false &&
      /^[0-9a-f]{40}$/.test(pullHead) &&
      pullHead === objectHead
    );
  }

  static decode(request: { readonly data: Uint8Array }): PrStewardEvent {
    const data = request.data;
    let parsed: UntrustedYamlNode;
    try {
      parsed = asUntrustedYamlNode(
        JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(data),
        ) as UntrustedYamlNode,
      );
    } catch {
      throw new EventDecodeError({
        code: PrStewardWebhookDecodeCode.Payload,
        attribution: false,
      });
    }
    if (!isRecord(parsed))
      throw new EventDecodeError({
        code: PrStewardWebhookDecodeCode.Payload,
        attribution: false,
      });
    const encodedData = property({ record: parsed, key: 'data_base64' });
    if (
      typeof encodedData !== 'string' ||
      encodedData.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedData)
    ) {
      throw new EventDecodeError({
        code: PrStewardWebhookDecodeCode.Envelope,
        attribution: false,
      });
    }
    let eventData: UntrustedYamlNode;
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
        Buffer.from(encodedData, 'base64'),
      );
      eventData = asUntrustedYamlNode(JSON.parse(decoded) as UntrustedYamlNode);
    } catch {
      throw new EventDecodeError({
        code: PrStewardWebhookDecodeCode.Data,
        attribution: false,
      });
    }
    if (!isRecord(eventData))
      throw new EventDecodeError({
        code: PrStewardWebhookDecodeCode.Data,
        attribution: false,
      });
    const headers = property({ record: eventData, key: 'headers' });
    const body = property({ record: eventData, key: 'body' });
    if (!isRecord(headers) || !isRecord(body))
      throw new EventDecodeError({
        code: PrStewardWebhookDecodeCode.Data,
        attribution: false,
      });

    const id = this.#boundedText({
      value: property({ record: parsed, key: 'id' }),
      limit: 128,
    });
    const time = this.#boundedText({
      value: property({ record: parsed, key: 'time' }),
      limit: 64,
    });
    const githubEvent = this.#boundedText({
      value: headerValue({ headers, name: 'X-Github-Event' }),
      limit: 64,
    });
    const deliveryId = this.#boundedText({
      value: headerValue({ headers, name: 'X-Github-Delivery' }),
      limit: 128,
    });
    const repository = this.#boundedText({
      value: nested({ record: body, path: ['repository', 'full_name'] }),
      limit: 128,
    });
    const candidateSource =
      githubEvent === false ? false : this.#source(githubEvent);
    const source =
      candidateSource !== false &&
      this.#coherentReviewHead({ body, source: candidateSource })
        ? candidateSource
        : false;
    const pullRequest = this.#pullRequestNumber({ body, source });
    if (
      id === false ||
      time === false ||
      !Number.isFinite(Date.parse(time)) ||
      githubEvent === false ||
      deliveryId === false
    )
      throw new EventDecodeError({
        code: PrStewardWebhookDecodeCode.Identity,
        attribution:
          repository === PR_STEWARD_REPOSITORY &&
          pullRequest !== false &&
          source !== PrStewardSource.WorkflowJob
            ? { repository, pullRequest }
            : false,
      });

    const action = this.#boundedText({
      value: property({ record: body, key: 'action' }),
      limit: 64,
    });
    const sha = this.#headSha({ body, source });
    const metadata: PrStewardMetadata =
      source === false
        ? {
            objectId: false,
            runId: false,
            reviewId: false,
            commentId: false,
            state: false,
            url: false,
            path: false,
            line: false,
            author: false,
          }
        : this.#routingMetadata({ body, source });
    return {
      id,
      time,
      githubEvent,
      deliveryId,
      action,
      repository,
      pullRequest,
      headSha: sha,
      source,
      ...metadata,
    };
  }
}

export type PrStewardInvocation = {
  readonly pullRequest: PrStewardPullRequest;
  readonly credentialPath: string;
};

export class PrStewardInvocationCodec {
  static parse(argv: readonly string[]): PrStewardInvocation {
    if (
      (argv.length !== 2 && argv.length !== 4) ||
      argv[0] !== '--pr' ||
      (argv.length === 4 && argv[2] !== '--config')
    ) {
      throw new Error('expected --pr N [--config /absolute/path]');
    }
    const prText = argv[1]!;
    if (!/^[1-9][0-9]*$/.test(prText))
      throw new Error('pull request must be a positive integer');
    let pullRequest: PrStewardPullRequest;
    try {
      pullRequest = PrStewardNdjsonCodec.pullRequest(Number(prText));
    } catch {
      throw new Error('pull request must be a positive integer');
    }
    const path =
      argv.length === 4
        ? argv[3]!
        : join(homedir(), '.nook/events/pr-steward-client.yaml');
    if (!isAbsolute(path)) throw new Error('credential path must be absolute');
    return { pullRequest, credentialPath: path };
  }
}

type PrStewardObservationRequest = {
  readonly messages: AsyncIterable<{ readonly data: Uint8Array }>;
  readonly pullRequest: PrStewardPullRequest;
  readonly write: (line: string) => void;
};
type PrStewardMessage = { readonly data: Uint8Array };

export class PrStewardEventObserver {
  readonly #reader: PrStewardAssignedPrReader;

  constructor(request: { readonly reader: PrStewardAssignedPrReader }) {
    this.#reader = request.reader;
  }

  async observe(request: PrStewardObservationRequest): Promise<void> {
    let pending: Promise<PrStewardRecord | false>[] = [];
    try {
      for await (const message of request.messages) {
        pending.push(this.#observeMessage({ request, message }));
        if (pending.length === 4) {
          await this.#complete({ request, pending });
          pending = [];
        }
      }
    } catch (error) {
      await Promise.allSettled(pending);
      throw error;
    }
    await this.#complete({ request, pending });
  }

  async #complete(args: {
    readonly request: PrStewardObservationRequest;
    readonly pending: readonly Promise<PrStewardRecord | false>[];
  }): Promise<void> {
    const results = await Promise.allSettled(args.pending);
    for (const result of results)
      if (result.status === 'rejected') throw result.reason;
    for (const result of results)
      if (result.status === 'fulfilled' && result.value !== false)
        args.request.write(PrStewardNdjsonCodec.encode(result.value));
  }

  async #observeMessage(args: {
    readonly request: PrStewardObservationRequest;
    readonly message: PrStewardMessage;
  }): Promise<PrStewardRecord | false> {
    let event: PrStewardEvent;
    try {
      event = PrStewardWebhookDecoder.decode({ data: args.message.data });
    } catch (error) {
      if (!(error instanceof EventDecodeError)) throw error;
      if (
        error.attribution !== false &&
        error.attribution.pullRequest === args.request.pullRequest
      )
        return this.#malformed(args.request);
      return false;
    }
    const request = args.request;
    if (
      event.repository !== PR_STEWARD_REPOSITORY ||
      event.source === false ||
      event.source === PrStewardSource.WorkflowJob ||
      (event.pullRequest !== false &&
        event.pullRequest !== request.pullRequest) ||
      event.pullRequest === false
    )
      return false;
    if (
      event.headSha === false &&
      event.source !== PrStewardSource.IssueComment
    ) {
      if (event.pullRequest === request.pullRequest)
        return this.#malformed(request);
      return false;
    }
    let assigned;
    try {
      assigned = await this.#reader.read({
        repository: PR_STEWARD_REPOSITORY,
        pullRequest: request.pullRequest,
      });
    } catch (error) {
      if (!(error instanceof PrStewardGithubUnavailableError)) throw error;
      return this.#unavailable({ request, event, source: event.source });
    }
    if (event.headSha !== false && event.headSha !== assigned.headSha)
      return false;
    let record: PrStewardRecord;
    try {
      record = PrStewardNdjsonCodec.routing({
        kind: PrStewardRecordKind.Routing,
        eventId: event.id,
        deliveryId: event.deliveryId,
        repository: PR_STEWARD_REPOSITORY,
        pullRequest: request.pullRequest,
        headSha: assigned.headSha,
        source: event.source,
        objectId: event.objectId,
        commentId: event.commentId,
        runId: event.runId,
        githubEvent: PrStewardNdjsonCodec.githubEvent(event.source),
        action: event.action,
        state: event.state,
        reviewId: event.reviewId,
        url: event.url,
        path: event.path,
        line: event.line,
        author: event.author,
      });
    } catch (error) {
      if (!(error instanceof PrStewardDecodeError)) throw error;
      return this.#malformed(request);
    }
    return record;
  }

  #malformed(request: PrStewardObservationRequest): PrStewardRecord {
    return PrStewardNdjsonCodec.blocker({
      kind: PrStewardRecordKind.Blocker,
      code: PrStewardBlockerCode.MalformedEvent,
      repository: PR_STEWARD_REPOSITORY,
      pullRequest: request.pullRequest,
      summary: 'A malformed assigned GitHub notification was rejected.',
    });
  }

  #unavailable(args: {
    readonly request: PrStewardObservationRequest;
    readonly event: PrStewardEvent;
    readonly source: PrStewardSource;
  }): PrStewardRecord {
    return PrStewardNdjsonCodec.blocker({
      kind: PrStewardRecordKind.Blocker,
      code: PrStewardBlockerCode.GithubObservationUnavailable,
      repository: PR_STEWARD_REPOSITORY,
      pullRequest: args.request.pullRequest,
      eventId: args.event.id,
      deliveryId: args.event.deliveryId,
      source: args.source,
      headSha: args.event.headSha,
      objectId: args.event.objectId,
      runId: args.event.runId,
      summary: 'Assigned pull request observation is unavailable.',
    });
  }
}

export function loadCredential(path: string): PrStewardCredential {
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new Error('credential file cannot be opened securely');
  }
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile())
      throw new Error('credential path must be a regular file');
    if (!process.getuid || stat.uid !== process.getuid())
      throw new Error('credential owner mismatch');
    if ((stat.mode & 0o777) !== 0o600)
      throw new Error('credential mode must be 0600');
    const parsed = asUntrustedYamlNode(
      Bun.YAML.parse(readFileSync(descriptor, 'utf8')) as UntrustedYamlNode,
    );
    if (
      !isRecord(parsed) ||
      Object.keys(parsed).sort().join(',') !== 'password,username'
    ) {
      throw new Error('credential schema is invalid');
    }
    const username = property({ record: parsed, key: 'username' });
    const password = property({ record: parsed, key: 'password' });
    if (
      username !== 'pr-steward' ||
      typeof password !== 'string' ||
      !/^[0-9a-f]{64}$/.test(password)
    ) {
      throw new Error('credential schema is invalid');
    }
    return { username, password };
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('credential '))
      throw cause;
    throw new Error('credential schema is invalid', { cause });
  } finally {
    closeSync(descriptor);
  }
}

async function main(): Promise<void> {
  const invocation = PrStewardInvocationCodec.parse(process.argv.slice(2));
  const credential = loadCredential(invocation.credentialPath);
  const connection = await wsconnect({
    servers: PR_STEWARD_ENDPOINT,
    user: credential.username,
    pass: credential.password,
    name: `pr-steward-${process.pid}`,
    ignoreClusterUpdates: true,
  });
  const subscription = connection.subscribe(PR_STEWARD_SUBJECT);
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    void connection.drain().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await new PrStewardEventObserver({
      reader: PrStewardGithubPrReader.create(),
    }).observe({
      messages: subscription,
      pullRequest: invocation.pullRequest,
      write: (line) => {
        process.stdout.write(line);
      },
    });
    const closeError = await connection.closed();
    if (closeError) throw new Error('NATS connection closed unexpectedly');
  } finally {
    if (!stopping) await connection.close();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

if (import.meta.main) {
  main().catch((cause) => {
    const message =
      cause instanceof Error ? cause.message : 'subscription failed';
    process.stderr.write(`PR Steward event subscription failed: ${message}\n`);
    process.exitCode = 1;
  });
}
