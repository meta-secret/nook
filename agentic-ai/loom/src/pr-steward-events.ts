import {
  constants,
  closeSync,
  fstatSync,
  openSync,
  readFileSync,
} from 'node:fs';

import {
  UntrustedYamlPropertyPresence,
  UntrustedYamlBoundary,
} from './lib/guards.ts';

import {
  PR_STEWARD_REPOSITORY,
  PrStewardBlockerCode,
  PrStewardDecodeError,
  PrStewardNdjsonCodec,
  PrStewardRecordKind,
  PrStewardSource,
} from './pr-steward-contract.ts';

import { PrStewardGithubUnavailableError } from './pr-steward-github.ts';

import type { UntrustedYamlMap, UntrustedYamlNode } from './lib/guards.ts';

import type {
  PrStewardPullRequest,
  PrStewardRecord,
  PrStewardUrl,
} from './pr-steward-contract.ts';

import type { PrStewardAssignedPrReader } from './pr-steward-github.ts';

import { PrStewardOutput } from './pr-steward-output.ts';
import { PrStewardDeliveries } from './pr-steward-deliveries.ts';

export class WebhookProperty {
  private constructor(
    private readonly request: {
      readonly record: UntrustedYamlMap;
      readonly key: string;
    },
  ) {}
  static read(args: {
    readonly record: UntrustedYamlMap;
    readonly key: string;
  }): UntrustedYamlNode | false {
    return new WebhookProperty(args).execute();
  }
  private execute(): UntrustedYamlNode | false {
    const args = this.request;
    const result = UntrustedYamlBoundary.property(args);
    if (result.presence === UntrustedYamlPropertyPresence.Absent) return false;
    return !result.value && typeof result.value === 'object'
      ? false
      : result.value;
  }
}

export class WebhookObjectPath {
  private constructor(
    private readonly request: {
      readonly record: UntrustedYamlMap;
      readonly path: readonly string[];
    },
  ) {}
  static read(args: {
    readonly record: UntrustedYamlMap;
    readonly path: readonly string[];
  }): UntrustedYamlNode | false {
    return new WebhookObjectPath(args).execute();
  }
  private execute(): UntrustedYamlNode | false {
    const args = this.request;
    let current: UntrustedYamlNode = args.record;
    for (const key of args.path) {
      if (!UntrustedYamlBoundary.isRecord(current)) return false;
      const next = WebhookProperty.read({ record: current, key });
      if (next === false) return false;
      current = next;
    }
    return current;
  }
}

export class WebhookOptionalText {
  private constructor(private readonly request: UntrustedYamlNode | false) {}
  static read(value: UntrustedYamlNode | false): string | false {
    return new WebhookOptionalText(value).execute();
  }
  private execute(): string | false {
    const value = this.request;
    return typeof value === 'string' && value.length > 0 ? value : false;
  }
}

export class WebhookOptionalInteger {
  private constructor(private readonly request: UntrustedYamlNode | false) {}
  static read(value: UntrustedYamlNode | false): number | false {
    return new WebhookOptionalInteger(value).execute();
  }
  private execute(): number | false {
    const value = this.request;
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
      ? value
      : false;
  }
}

export class WebhookHeader {
  private constructor(
    private readonly request: {
      readonly headers: UntrustedYamlMap;
      readonly name: string;
    },
  ) {}
  static read(args: {
    readonly headers: UntrustedYamlMap;
    readonly name: string;
  }): string | false {
    return new WebhookHeader(args).execute();
  }
  private execute(): string | false {
    const args = this.request;
    const value = WebhookProperty.read({
      record: args.headers,
      key: args.name,
    });
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    return false;
  }
}

export class PrStewardCredentialFile {
  private constructor(private readonly request: string) {}
  static load(path: string): PrStewardCredential {
    return new PrStewardCredentialFile(path).execute();
  }
  private execute(): PrStewardCredential {
    const path = this.request;
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
      const parsed = UntrustedYamlBoundary.fromHost(
        Bun.YAML.parse(readFileSync(descriptor, 'utf8')) as UntrustedYamlNode,
      );
      if (
        !UntrustedYamlBoundary.isRecord(parsed) ||
        Object.keys(parsed).sort().join(',') !== 'password,username'
      ) {
        throw new Error('credential schema is invalid');
      }
      const username = WebhookProperty.read({
        record: parsed,
        key: 'username',
      });
      const password = WebhookProperty.read({
        record: parsed,
        key: 'password',
      });
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
}

export const PR_STEWARD_ENDPOINT = 'wss://events.dev.nokey.sh';
export const PR_STEWARD_SUBJECT = 'default.github-webhook.pr-lifecycle';
export const PR_STEWARD_PENDING_MESSAGE_LIMIT = 4;
export enum PrStewardSubscriptionKind {
  Active = 'active',
  Closed = 'closed',
  Failed = 'failed',
  Overloaded = 'overloaded',
}
export type PrStewardSubscriptionTermination =
  | { readonly kind: PrStewardSubscriptionKind.Closed }
  | { readonly kind: PrStewardSubscriptionKind.Failed; readonly error: Error };

type PrStewardSubscriptionOverload = {
  readonly kind: PrStewardSubscriptionKind.Overloaded;
  readonly pending: number;
};
type PrStewardSubscriptionState =
  | { readonly kind: PrStewardSubscriptionKind.Active }
  | PrStewardSubscriptionTermination
  | PrStewardSubscriptionOverload;
export type PrStewardSubscriptionAdmission = {
  readonly data: Uint8Array;
  readonly unsubscribe: () => void;
};
export type PrStewardSubscriptionOutcome =
  PrStewardSubscriptionTermination | PrStewardSubscriptionOverload;
type PrStewardSubscriptionOverloadRequest = { readonly pending: number };
export class PrStewardSubscriptionOverloadError extends Error {
  readonly pending: number;
  constructor(request: PrStewardSubscriptionOverloadRequest) {
    super(
      `NATS subscription overloaded with ${request.pending} pending messages`,
    );
    this.name = 'PrStewardSubscriptionOverloadError';
    this.pending = request.pending;
  }
}
export class PrStewardBoundedMessageStream implements AsyncIterable<PrStewardMessage> {
  // Admission remains owned until the consumer resumes after processing it.
  #admitted = 0;
  readonly #messages: PrStewardMessage[] = [];
  #signal = Promise.withResolvers<void>();
  #state: PrStewardSubscriptionState = {
    kind: PrStewardSubscriptionKind.Active,
  };

  admit(request: PrStewardSubscriptionAdmission): void {
    if (this.#state.kind !== PrStewardSubscriptionKind.Active) return;
    if (this.#admitted === PR_STEWARD_PENDING_MESSAGE_LIMIT) {
      this.#state = {
        kind: PrStewardSubscriptionKind.Overloaded,
        pending: this.#admitted,
      };
      request.unsubscribe();
      this.#signal.resolve();
      return;
    }
    this.#admitted += 1;
    this.#messages.push({ data: request.data });
    this.#signal.resolve();
  }

  terminate(termination: PrStewardSubscriptionTermination): void {
    if (this.#state.kind !== PrStewardSubscriptionKind.Active) return;
    this.#state = termination;
    this.#signal.resolve();
  }

  outcome(): PrStewardSubscriptionOutcome {
    if (this.#state.kind === PrStewardSubscriptionKind.Active)
      throw new Error('NATS subscription is still active');
    return this.#state;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<PrStewardMessage> {
    while (true) {
      const message = this.#messages.shift();
      if (message) {
        yield message;
        this.#admitted -= 1;
        continue;
      }
      if (this.#state.kind === PrStewardSubscriptionKind.Active) {
        await this.#signal.promise;
        this.#signal = Promise.withResolvers<void>();
        continue;
      }
      if (this.#state.kind === PrStewardSubscriptionKind.Failed)
        throw this.#state.error;
      return;
    }
  }
}

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
    const candidate = WebhookProperty.read({
      record: args.body,
      key: keys[args.source],
    });
    return UntrustedYamlBoundary.isRecord(candidate) ? candidate : {};
  }

  static #pullRequestNumber(args: {
    readonly body: UntrustedYamlMap;
    readonly source: PrStewardSource | false;
  }): number | false {
    if (args.source === PrStewardSource.IssueComment) {
      const marker = WebhookObjectPath.read({
        record: args.body,
        path: ['issue', 'pull_request'],
      });
      return UntrustedYamlBoundary.isRecord(marker)
        ? WebhookOptionalInteger.read(
            WebhookObjectPath.read({
              record: args.body,
              path: ['issue', 'number'],
            }),
          )
        : false;
    }
    if (
      args.source === PrStewardSource.PullRequest ||
      args.source === PrStewardSource.PullRequestReview ||
      args.source === PrStewardSource.PullRequestReviewComment
    )
      return WebhookOptionalInteger.read(
        WebhookObjectPath.read({
          record: args.body,
          path: ['pull_request', 'number'],
        }),
      );
    const source = args.source;
    if (source === false) return false;
    const object = this.#object({ body: args.body, source });
    const candidates = WebhookProperty.read({
      record: object,
      key: 'pull_requests',
    });
    if (
      !Array.isArray(candidates) ||
      candidates.length !== 1 ||
      !UntrustedYamlBoundary.isRecord(candidates[0])
    )
      return false;
    const pullRequest = WebhookOptionalInteger.read(
      WebhookProperty.read({ record: candidates[0], key: 'number' }),
    );
    const associatedHead = WebhookOptionalText.read(
      WebhookObjectPath.read({ record: candidates[0], path: ['head', 'sha'] }),
    );
    const eventHead = WebhookOptionalText.read(
      WebhookProperty.read({ record: object, key: 'head_sha' }),
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
    const value = WebhookOptionalText.read(
      args.source === PrStewardSource.PullRequest
        ? WebhookObjectPath.read({ record: object, path: ['head', 'sha'] })
        : args.source === PrStewardSource.PullRequestReview ||
            args.source === PrStewardSource.PullRequestReviewComment
          ? WebhookProperty.read({ record: object, key: 'commit_id' })
          : WebhookProperty.read({ record: object, key: 'head_sha' }),
    );
    return value !== false && /^[0-9a-f]{40}$/.test(value) ? value : false;
  }

  static #boundedText(args: {
    readonly value: UntrustedYamlNode | false;
    readonly limit: number;
  }): string | false {
    const candidate = WebhookOptionalText.read(args.value);
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
      value: WebhookProperty.read({ record: object, key: 'html_url' }),
      limit: 240,
    });
    const external = this.#boundedText({
      value: WebhookProperty.read({ record: object, key: 'target_url' }),
      limit: 240,
    });
    const reviewComment =
      args.source === PrStewardSource.PullRequestReviewComment;
    const line = WebhookOptionalInteger.read(
      WebhookProperty.read({
        record: reviewComment ? object : {},
        key: 'line',
      }),
    );
    const originalLine = WebhookOptionalInteger.read(
      WebhookProperty.read({
        record: reviewComment ? object : {},
        key: 'original_line',
      }),
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
    const objectId = WebhookOptionalInteger.read(
      WebhookProperty.read({ record: object, key: 'id' }),
    );
    return {
      objectId,
      runId: !run
        ? false
        : args.source === PrStewardSource.WorkflowRun
          ? objectId
          : WebhookOptionalInteger.read(
              WebhookProperty.read({ record: object, key: 'run_id' }),
            ),
      reviewId: WebhookOptionalInteger.read(
        WebhookProperty.read({
          record: reviewComment ? object : {},
          key: 'pull_request_review_id',
        }),
      ),
      commentId: comment
        ? WebhookOptionalInteger.read(
            WebhookProperty.read({ record: object, key: 'id' }),
          )
        : false,
      state:
        this.#boundedText({
          value: WebhookProperty.read({ record: object, key: 'state' }),
          limit: 64,
        }) ||
        this.#boundedText({
          value: WebhookProperty.read({ record: object, key: 'conclusion' }),
          limit: 64,
        }) ||
        this.#boundedText({
          value: WebhookProperty.read({ record: object, key: 'status' }),
          limit: 64,
        }),
      url:
        github !== false
          ? PrStewardNdjsonCodec.githubUrl(github)
          : external !== false
            ? PrStewardNdjsonCodec.externalUrl(external)
            : false,
      path: this.#boundedText({
        value: WebhookProperty.read({
          record: reviewComment ? object : {},
          key: 'path',
        }),
        limit: 240,
      }),
      line: line !== false ? line : originalLine,
      author:
        human &&
        this.#boundedText({
          value: WebhookObjectPath.read({
            record: object,
            path: ['user', 'login'],
          }),
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
    const pullHead = WebhookOptionalText.read(
      WebhookObjectPath.read({
        record: args.body,
        path: ['pull_request', 'head', 'sha'],
      }),
    );
    const objectHead = WebhookOptionalText.read(
      WebhookProperty.read({ record: this.#object(args), key: 'commit_id' }),
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
      parsed = UntrustedYamlBoundary.fromHost(
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
    if (!UntrustedYamlBoundary.isRecord(parsed))
      throw new EventDecodeError({
        code: PrStewardWebhookDecodeCode.Payload,
        attribution: false,
      });
    const encodedData = WebhookProperty.read({
      record: parsed,
      key: 'data_base64',
    });
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
      eventData = UntrustedYamlBoundary.fromHost(
        JSON.parse(decoded) as UntrustedYamlNode,
      );
    } catch {
      throw new EventDecodeError({
        code: PrStewardWebhookDecodeCode.Data,
        attribution: false,
      });
    }
    if (!UntrustedYamlBoundary.isRecord(eventData))
      throw new EventDecodeError({
        code: PrStewardWebhookDecodeCode.Data,
        attribution: false,
      });
    const headers = WebhookProperty.read({ record: eventData, key: 'headers' });
    const body = WebhookProperty.read({ record: eventData, key: 'body' });
    if (
      !UntrustedYamlBoundary.isRecord(headers) ||
      !UntrustedYamlBoundary.isRecord(body)
    )
      throw new EventDecodeError({
        code: PrStewardWebhookDecodeCode.Data,
        attribution: false,
      });

    const id = this.#boundedText({
      value: WebhookProperty.read({ record: parsed, key: 'id' }),
      limit: 128,
    });
    const time = this.#boundedText({
      value: WebhookProperty.read({ record: parsed, key: 'time' }),
      limit: 64,
    });
    const githubEvent = this.#boundedText({
      value: WebhookHeader.read({ headers, name: 'X-Github-Event' }),
      limit: 64,
    });
    const deliveryId = this.#boundedText({
      value: WebhookHeader.read({ headers, name: 'X-Github-Delivery' }),
      limit: 128,
    });
    const repository = this.#boundedText({
      value: WebhookObjectPath.read({
        record: body,
        path: ['repository', 'full_name'],
      }),
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
      value: WebhookProperty.read({ record: body, key: 'action' }),
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

type PrStewardObservationRequest = {
  readonly messages: AsyncIterable<{ readonly data: Uint8Array }>;
  readonly pullRequest: PrStewardPullRequest;
  readonly write: (line: string) => void;
  readonly activity: (event: { readonly checkEvent: boolean }) => void;
};

type PrStewardMessage = { readonly data: Uint8Array };

export class PrStewardEventObserver {
  readonly #reader: PrStewardAssignedPrReader;

  constructor(request: { readonly reader: PrStewardAssignedPrReader }) {
    this.#reader = request.reader;
  }

  async observe(request: PrStewardObservationRequest): Promise<void> {
    const deliveries = new PrStewardDeliveries();
    const output = new PrStewardOutput();
    for await (const message of request.messages) {
      if (deliveries.contains(message)) continue;
      const record = await this.#observeMessage({ request, message });
      if (record === false || !output.shouldEmit({ record })) continue;
      if (record.kind === PrStewardRecordKind.Routing)
        request.activity({
          checkEvent:
            record.source === PrStewardSource.CheckRun ||
            record.source === PrStewardSource.CheckSuite ||
            record.source === PrStewardSource.WorkflowRun,
        });
      request.write(PrStewardNdjsonCodec.encode(record));
      if (record.kind === PrStewardRecordKind.Routing)
        deliveries.remember(message);
    }
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

if (import.meta.main) {
  import('./pr-steward-cli.ts')
    .then(({ PrStewardEventCli }) => PrStewardEventCli.main())
    .catch((cause) => {
      const message =
        cause instanceof Error ? cause.message : 'subscription failed';
      process.stderr.write(
        `PR Steward event subscription failed: ${message}\n`,
      );
      process.exitCode = 1;
    });
}
