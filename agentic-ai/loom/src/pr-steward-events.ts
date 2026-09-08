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
  PrStewardGithubPrReader,
  PrStewardGithubUnavailableError,
} from './pr-steward-github.ts';
import {
  PR_STEWARD_REPOSITORY,
  PrStewardBlockerCode,
  PrStewardNdjsonCodec,
  PrStewardRecordKind,
  PrStewardSource,
} from './pr-steward-contract.ts';

import type { UntrustedYamlMap, UntrustedYamlNode } from './lib/guards.ts';
import type { PrStewardAssignedPrReader } from './pr-steward-github.ts';
import type {
  PrStewardRecord,
  PrStewardRoutingRecord,
  PrStewardUrl,
} from './pr-steward-contract.ts';

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

function pullRequestNumber(args: {
  readonly body: UntrustedYamlMap;
  readonly source: PrStewardSource | false;
}): number | false {
  if (args.source === PrStewardSource.IssueComment) {
    const marker = nested({
      record: args.body,
      path: ['issue', 'pull_request'],
    });
    return isRecord(marker)
      ? optionalNumber(nested({ record: args.body, path: ['issue', 'number'] }))
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
  if (args.source === false) return false;
  const object = eventObject({ body: args.body, source: args.source });
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

function headSha(args: {
  readonly body: UntrustedYamlMap;
  readonly source: PrStewardSource | false;
}): string | false {
  if (args.source === false || args.source === PrStewardSource.IssueComment)
    return false;
  const object = eventObject({ body: args.body, source: args.source });
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

function sourceForEvent(value: string): PrStewardSource | false {
  switch (value) {
    case 'check_run':
      return PrStewardSource.CheckRun;
    case 'check_suite':
      return PrStewardSource.CheckSuite;
    case 'issue_comment':
      return PrStewardSource.IssueComment;
    case 'pull_request':
      return PrStewardSource.PullRequest;
    case 'pull_request_review':
      return PrStewardSource.PullRequestReview;
    case 'pull_request_review_comment':
      return PrStewardSource.PullRequestReviewComment;
    case 'workflow_job':
      return PrStewardSource.WorkflowJob;
    case 'workflow_run':
      return PrStewardSource.WorkflowRun;
    default:
      return false;
  }
}

function eventObject(args: {
  readonly body: UntrustedYamlMap;
  readonly source: PrStewardSource;
}): UntrustedYamlMap {
  const key =
    args.source === PrStewardSource.PullRequestReview
      ? 'review'
      : args.source === PrStewardSource.PullRequest
        ? 'pull_request'
        : args.source === PrStewardSource.CheckRun
          ? 'check_run'
          : args.source === PrStewardSource.CheckSuite
            ? 'check_suite'
            : args.source === PrStewardSource.WorkflowJob
              ? 'workflow_job'
              : args.source === PrStewardSource.WorkflowRun
                ? 'workflow_run'
                : 'comment';
  const candidate = property({ record: args.body, key });
  return isRecord(candidate) ? candidate : {};
}

function boundedText(args: {
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

function routingMetadata(args: {
  readonly body: UntrustedYamlMap;
  readonly source: PrStewardSource;
}): PrStewardMetadata {
  const object = eventObject(args);
  const github = boundedText({
    value: property({ record: object, key: 'html_url' }),
    limit: 240,
  });
  const external = boundedText({
    value: property({ record: object, key: 'target_url' }),
    limit: 240,
  });
  const line = optionalNumber(property({ record: object, key: 'line' }));
  const originalLine = optionalNumber(
    property({ record: object, key: 'original_line' }),
  );
  const comment =
    args.source === PrStewardSource.IssueComment ||
    args.source === PrStewardSource.PullRequestReviewComment;
  const objectId = optionalNumber(property({ record: object, key: 'id' }));
  return {
    objectId,
    runId:
      args.source === PrStewardSource.WorkflowRun
        ? objectId
        : optionalNumber(property({ record: object, key: 'run_id' })),
    reviewId: optionalNumber(
      property({ record: object, key: 'pull_request_review_id' }),
    ),
    commentId: comment
      ? optionalNumber(property({ record: object, key: 'id' }))
      : false,
    state:
      boundedText({
        value: property({ record: object, key: 'state' }),
        limit: 64,
      }) ||
      boundedText({
        value: property({ record: object, key: 'conclusion' }),
        limit: 64,
      }) ||
      boundedText({
        value: property({ record: object, key: 'status' }),
        limit: 64,
      }),
    url:
      github !== false
        ? PrStewardNdjsonCodec.githubUrl(github)
        : external !== false
          ? PrStewardNdjsonCodec.externalUrl(external)
          : false,
    path: boundedText({
      value: property({ record: object, key: 'path' }),
      limit: 240,
    }),
    line: line !== false ? line : originalLine,
    author: boundedText({
      value: nested({ record: object, path: ['user', 'login'] }),
      limit: 64,
    }),
  };
}

function coherentReviewHead(args: {
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
    property({ record: eventObject(args), key: 'commit_id' }),
  );
  return (
    pullHead !== false &&
    objectHead !== false &&
    /^[0-9a-f]{40}$/.test(pullHead) &&
    pullHead === objectHead
  );
}

class EventDecodeError extends Error {}

function decodeWebhookEvent(data: Uint8Array): PrStewardEvent {
  let parsed: UntrustedYamlNode;
  try {
    parsed = asUntrustedYamlNode(
      JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(data),
      ) as UntrustedYamlNode,
    );
  } catch {
    throw new EventDecodeError('event payload is not valid UTF-8 JSON');
  }
  if (!isRecord(parsed))
    throw new EventDecodeError('event payload must be an object');
  const encodedData = property({ record: parsed, key: 'data_base64' });
  if (
    typeof encodedData !== 'string' ||
    encodedData.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedData)
  ) {
    throw new EventDecodeError('event envelope is invalid');
  }
  let eventData: UntrustedYamlNode;
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.from(encodedData, 'base64'),
    );
    eventData = asUntrustedYamlNode(JSON.parse(decoded) as UntrustedYamlNode);
  } catch {
    throw new EventDecodeError('event data is invalid');
  }
  if (!isRecord(eventData)) throw new EventDecodeError('event data is invalid');
  const headers = property({ record: eventData, key: 'headers' });
  const body = property({ record: eventData, key: 'body' });
  if (!isRecord(headers) || !isRecord(body))
    throw new EventDecodeError('event data is invalid');

  const id = boundedText({
    value: property({ record: parsed, key: 'id' }),
    limit: 128,
  });
  const time = boundedText({
    value: property({ record: parsed, key: 'time' }),
    limit: 64,
  });
  const githubEvent = boundedText({
    value: headerValue({ headers, name: 'X-Github-Event' }),
    limit: 64,
  });
  const deliveryId = boundedText({
    value: headerValue({ headers, name: 'X-Github-Delivery' }),
    limit: 128,
  });
  if (
    id === false ||
    time === false ||
    !Number.isFinite(Date.parse(time)) ||
    githubEvent === false ||
    deliveryId === false
  )
    throw new EventDecodeError('event identity is invalid');

  const action = boundedText({
    value: property({ record: body, key: 'action' }),
    limit: 64,
  });
  const repository = boundedText({
    value: nested({ record: body, path: ['repository', 'full_name'] }),
    limit: 128,
  });
  const candidateSource = sourceForEvent(githubEvent);
  const source =
    candidateSource !== false &&
    coherentReviewHead({ body, source: candidateSource })
      ? candidateSource
      : false;
  const pullRequest = pullRequestNumber({ body, source });
  const sha = headSha({ body, source });
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
      : routingMetadata({ body, source });
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

export class PrStewardWebhookDecoder {
  decode(request: { readonly data: Uint8Array }): PrStewardEvent {
    return decodeWebhookEvent(request.data);
  }
}

export type PrStewardInvocation = {
  readonly repository: typeof PR_STEWARD_REPOSITORY;
  readonly pullRequest: number;
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
    const pullRequest = Number(prText);
    if (!Number.isSafeInteger(pullRequest))
      throw new Error('pull request must be a positive integer');
    const path =
      argv.length === 4
        ? argv[3]!
        : join(homedir(), '.nook/events/pr-steward-client.yaml');
    if (!isAbsolute(path)) throw new Error('credential path must be absolute');
    return {
      repository: PR_STEWARD_REPOSITORY,
      pullRequest,
      credentialPath: path,
    };
  }
}

type PrStewardObservationRequest = {
  readonly messages: AsyncIterable<{ readonly data: Uint8Array }>;
  readonly repository: typeof PR_STEWARD_REPOSITORY;
  readonly pullRequest: number;
  readonly write: (line: string) => void;
};

export class PrStewardEventObserver {
  readonly #decoder = new PrStewardWebhookDecoder();
  readonly #reader: PrStewardAssignedPrReader;

  constructor(request: { readonly reader: PrStewardAssignedPrReader }) {
    this.#reader = request.reader;
  }

  async observe(request: PrStewardObservationRequest): Promise<void> {
    for await (const message of request.messages) {
      let event: PrStewardEvent;
      try {
        event = this.#decoder.decode({ data: message.data });
      } catch (error) {
        if (!(error instanceof EventDecodeError)) throw error;
        this.#write({
          write: request.write,
          record: {
            kind: PrStewardRecordKind.Blocker,
            code: PrStewardBlockerCode.MalformedEvent,
            repository: request.repository,
            pullRequest: request.pullRequest,
            summary: 'A malformed GitHub notification was rejected.',
          },
        });
        continue;
      }
      if (
        event.source === false ||
        event.repository !== request.repository ||
        (event.pullRequest !== false &&
          event.pullRequest !== request.pullRequest) ||
        (event.headSha === false &&
          event.source !== PrStewardSource.IssueComment) ||
        (event.pullRequest === false &&
          (event.source !== PrStewardSource.WorkflowJob ||
            event.headSha === false))
      )
        continue;
      let assigned;
      try {
        assigned = this.#reader.read({
          repository: request.repository,
          pullRequest: request.pullRequest,
        });
      } catch (error) {
        if (!(error instanceof PrStewardGithubUnavailableError)) throw error;
        this.#write({
          write: request.write,
          record: {
            kind: PrStewardRecordKind.Blocker,
            code: PrStewardBlockerCode.GithubObservationUnavailable,
            repository: request.repository,
            pullRequest: request.pullRequest,
            eventId: event.id,
            deliveryId: event.deliveryId,
            source: event.source,
            headSha: event.headSha,
            objectId: event.objectId,
            runId: event.runId,
            summary: 'Assigned pull request observation is unavailable.',
          },
        });
        continue;
      }
      if (event.headSha !== false && event.headSha !== assigned.headSha)
        continue;
      const record: PrStewardRoutingRecord = {
        kind: PrStewardRecordKind.Routing,
        eventId: event.id,
        deliveryId: event.deliveryId,
        repository: request.repository,
        pullRequest: request.pullRequest,
        headSha: assigned.headSha,
        source: event.source,
        objectId: event.objectId,
        commentId: event.commentId,
        runId: event.runId,
        githubEvent: PrStewardNdjsonCodec.githubEvent({ source: event.source }),
        action: event.action,
        state: event.state,
        reviewId: event.reviewId,
        url: event.url === false ? assigned.url : event.url,
        path: event.path,
        line: event.line,
        author: event.author,
      };
      this.#write({ write: request.write, record });
    }
  }

  #write(request: {
    readonly write: (line: string) => void;
    readonly record: PrStewardRecord;
  }): void {
    request.write(PrStewardNdjsonCodec.encode(request.record));
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
      repository: invocation.repository,
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
