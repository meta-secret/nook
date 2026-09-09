import {
  UntrustedYamlPropertyPresence,
  UntrustedYamlBoundary,
} from './lib/guards.ts';
import type { UntrustedYamlMap, UntrustedYamlNode } from './lib/guards.ts';

export const PR_STEWARD_REPOSITORY = 'meta-secret/nook';
export enum PrStewardSchemaVersion {
  V2 = 'pr-steward-ndjson/v2',
}
export enum PrStewardRecordKind {
  Blocker = 'github-pr-blocker',
  Routing = 'github-pr-routing',
}
export enum PrStewardSource {
  CheckRun = 'check-run',
  CheckSuite = 'check-suite',
  IssueComment = 'issue-comment',
  PullRequest = 'pull-request',
  PullRequestReview = 'pull-request-review',
  PullRequestReviewComment = 'pull-request-review-comment',
  WorkflowJob = 'workflow-job',
  WorkflowRun = 'workflow-run',
}

export enum PrStewardGithubEvent {
  CheckRun = 'check_run',
  CheckSuite = 'check_suite',
  IssueComment = 'issue_comment',
  PullRequest = 'pull_request',
  PullRequestReview = 'pull_request_review',
  PullRequestReviewComment = 'pull_request_review_comment',
  WorkflowJob = 'workflow_job',
  WorkflowRun = 'workflow_run',
}
const EVENTS: Record<PrStewardSource, PrStewardGithubEvent> = {
  [PrStewardSource.CheckRun]: PrStewardGithubEvent.CheckRun,
  [PrStewardSource.CheckSuite]: PrStewardGithubEvent.CheckSuite,
  [PrStewardSource.IssueComment]: PrStewardGithubEvent.IssueComment,
  [PrStewardSource.PullRequest]: PrStewardGithubEvent.PullRequest,
  [PrStewardSource.PullRequestReview]: PrStewardGithubEvent.PullRequestReview,
  [PrStewardSource.PullRequestReviewComment]:
    PrStewardGithubEvent.PullRequestReviewComment,
  [PrStewardSource.WorkflowJob]: PrStewardGithubEvent.WorkflowJob,
  [PrStewardSource.WorkflowRun]: PrStewardGithubEvent.WorkflowRun,
};
export enum PrStewardUrlTrust {
  GithubOwned = 'github-owned',
  UntrustedExternal = 'untrusted-external',
}
export type PrStewardUrl = {
  readonly trust: PrStewardUrlTrust;
  readonly value: string;
};
declare const IDENTITY: unique symbol;
enum IdentityKind {
  Delivery,
  Event,
  Head,
  PullRequest,
}
type Opaque<Value, Kind extends IdentityKind> = Value & {
  readonly [IDENTITY]: Kind;
};
export type PrStewardDeliveryId = Opaque<string, IdentityKind.Delivery>;
export type PrStewardEventId = Opaque<string, IdentityKind.Event>;
export type PrStewardHeadSha = Opaque<string, IdentityKind.Head>;
export type PrStewardPullRequest = Opaque<number, IdentityKind.PullRequest>;
enum Meta {
  Author = 'author',
  CommentId = 'commentId',
  RunId = 'runId',
}
type Metadata = {
  readonly commentId: number;
  readonly runId: number;
  readonly reviewId: number;
  readonly path: string;
  readonly line: number;
  readonly author: string;
};
type Route<Source extends PrStewardSource, Allowed extends keyof Metadata> = {
  readonly source: Source;
} & { readonly [Field in Allowed]: Metadata[Field] | false } & {
  readonly [Field in Exclude<keyof Metadata, Allowed>]: false;
};
type RoutingVariant =
  | Route<
      PrStewardSource.PullRequest | PrStewardSource.PullRequestReview,
      Meta.Author
    >
  | Route<PrStewardSource.PullRequestReviewComment, keyof Metadata>
  | Route<PrStewardSource.IssueComment, Meta.CommentId | Meta.Author>
  | Route<PrStewardSource.CheckRun | PrStewardSource.WorkflowRun, Meta.RunId>
  | Route<PrStewardSource.CheckSuite, never>;
type RoutingCommon = {
  readonly kind: PrStewardRecordKind.Routing;
  readonly eventId: PrStewardEventId;
  readonly deliveryId: PrStewardDeliveryId;
  readonly repository: typeof PR_STEWARD_REPOSITORY;
  readonly pullRequest: PrStewardPullRequest;
  readonly headSha: PrStewardHeadSha;
  readonly objectId: number | false;
  readonly githubEvent: PrStewardGithubEvent;
  readonly action: string | false;
  readonly state: string | false;
  readonly url: PrStewardUrl | false;
};
export type PrStewardRoutingRecord = RoutingCommon & RoutingVariant;
export enum PrStewardBlockerCode {
  GithubObservationUnavailable = 'github-observation-unavailable',
  MalformedEvent = 'malformed-event',
}
export type PrStewardMalformedBlocker = {
  readonly kind: PrStewardRecordKind.Blocker;
  readonly code: PrStewardBlockerCode.MalformedEvent;
  readonly repository: typeof PR_STEWARD_REPOSITORY;
  readonly pullRequest: PrStewardPullRequest;
  readonly summary: string;
};
type PrStewardUnavailableCommon = {
  readonly kind: PrStewardRecordKind.Blocker;
  readonly code: PrStewardBlockerCode.GithubObservationUnavailable;
  readonly repository: typeof PR_STEWARD_REPOSITORY;
  readonly pullRequest: PrStewardPullRequest;
  readonly eventId: PrStewardEventId;
  readonly deliveryId: PrStewardDeliveryId;
  readonly objectId: number | false;
  readonly summary: string;
};
type PrStewardUnavailableVariant =
  | {
      readonly source: PrStewardSource.IssueComment;
      readonly headSha: false;
      readonly runId: false;
    }
  | {
      readonly source: PrStewardSource.CheckRun | PrStewardSource.WorkflowRun;
      readonly headSha: PrStewardHeadSha;
      readonly runId: number | false;
    }
  | {
      readonly source:
        | PrStewardSource.CheckSuite
        | PrStewardSource.PullRequest
        | PrStewardSource.PullRequestReview
        | PrStewardSource.PullRequestReviewComment;
      readonly headSha: PrStewardHeadSha;
      readonly runId: false;
    };
export type PrStewardUnavailableBlocker = PrStewardUnavailableCommon &
  PrStewardUnavailableVariant;

export type PrStewardRecord =
  | PrStewardMalformedBlocker
  | PrStewardRoutingRecord
  | PrStewardUnavailableBlocker;
export type PrStewardEnvelope = {
  readonly schemaVersion: PrStewardSchemaVersion.V2;
  readonly record: PrStewardRecord;
};

export enum PrStewardDecodeCode {
  InvalidCombination = 'invalid-combination',
  InvalidField = 'invalid-field',
  InvalidFields = 'invalid-fields',
  InvalidJson = 'invalid-json',
  InvalidRecord = 'invalid-record',
  MissingField = 'missing-field',
  UnsupportedKind = 'unsupported-kind',
  UnsupportedVersion = 'unsupported-version',
}

export class PrStewardDecodeError extends Error {
  readonly code: PrStewardDecodeCode;

  constructor(request: {
    readonly code: PrStewardDecodeCode;
    readonly cause: Error | false;
  }) {
    super(
      `PR Steward decode failed: ${request.code}`,
      request.cause === false ? {} : { cause: request.cause },
    );
    this.name = 'PrStewardDecodeError';
    this.code = request.code;
  }
}

enum Field {
  Action = 'action',
  Author = 'author',
  Code = 'code',
  CommentId = 'commentId',
  DeliveryId = 'deliveryId',
  EventId = 'eventId',
  GithubEvent = 'githubEvent',
  HeadSha = 'headSha',
  Kind = 'kind',
  Line = 'line',
  ObjectId = 'objectId',
  Path = 'path',
  Pr = 'pullRequest',
  Record = 'record',
  Repo = 'repository',
  ReviewId = 'reviewId',
  RunId = 'runId',
  SchemaVersion = 'schemaVersion',
  Source = 'source',
  State = 'state',
  Summary = 'summary',
  Trust = 'trust',
  Url = 'url',
  Value = 'value',
}

const ROUTING_FIELDS = [
  Field.Action,
  Field.Author,
  Field.CommentId,
  Field.DeliveryId,
  Field.EventId,
  Field.GithubEvent,
  Field.HeadSha,
  Field.Kind,
  Field.Line,
  Field.ObjectId,
  Field.Path,
  Field.Pr,
  Field.Repo,
  Field.ReviewId,
  Field.RunId,
  Field.Source,
  Field.State,
  Field.Url,
] as const;
const F = Field;
const MALFORMED = [F.Code, F.Kind, F.Pr, F.Repo, F.Summary] as const;
const UNAVAILABLE = [
  F.Code,
  F.DeliveryId,
  F.EventId,
  F.HeadSha,
  F.Kind,
  F.ObjectId,
  F.Pr,
  F.Repo,
  F.RunId,
  F.Source,
  F.Summary,
] as const;
const NDJSON_LIMIT = 8_192;
type RecordField = {
  readonly record: UntrustedYamlMap;
  readonly field: Field;
};

export class PrStewardNdjsonCodec {
  static pullRequest(value: UntrustedYamlNode): PrStewardPullRequest {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
      return this.#reject(PrStewardDecodeCode.InvalidField);
    return value as PrStewardPullRequest;
  }

  static headSha(value: UntrustedYamlNode): PrStewardHeadSha {
    if (typeof value !== 'string' || !/^[0-9a-f]{40}$/.test(value))
      return this.#reject(PrStewardDecodeCode.InvalidField);
    return value as PrStewardHeadSha;
  }

  static githubEvent(source: PrStewardSource): PrStewardGithubEvent {
    return EVENTS[source];
  }

  static routing(record: UntrustedYamlNode): PrStewardRoutingRecord {
    return UntrustedYamlBoundary.isRecord(record)
      ? this.#routing(record)
      : this.#reject(PrStewardDecodeCode.InvalidRecord);
  }

  static blocker(
    record: UntrustedYamlNode,
  ): PrStewardMalformedBlocker | PrStewardUnavailableBlocker {
    return UntrustedYamlBoundary.isRecord(record)
      ? this.#blocker(record)
      : this.#reject(PrStewardDecodeCode.InvalidRecord);
  }

  static encode(record: PrStewardRecord): string {
    const line = JSON.stringify({
      schemaVersion: PrStewardSchemaVersion.V2,
      record,
    });
    this.decode(line);
    return `${line}\n`;
  }

  static decode(line: string): PrStewardEnvelope {
    if (
      line.length === 0 ||
      line.length > NDJSON_LIMIT ||
      new TextEncoder().encode(line).length > NDJSON_LIMIT * 3
    )
      this.#reject(PrStewardDecodeCode.InvalidRecord);
    let parsed: UntrustedYamlNode;
    try {
      parsed = UntrustedYamlBoundary.fromHost(
        JSON.parse(line) as UntrustedYamlNode,
      );
    } catch {
      this.#fail({
        code: PrStewardDecodeCode.InvalidJson,
        cause: new Error('JSON parser rejected the record'),
      });
    }
    if (!UntrustedYamlBoundary.isRecord(parsed))
      this.#reject(PrStewardDecodeCode.InvalidRecord);
    this.#exact({
      record: parsed,
      fields: [Field.Record, Field.SchemaVersion],
    });
    if (
      this.#required({ record: parsed, field: Field.SchemaVersion }) !==
      PrStewardSchemaVersion.V2
    )
      this.#reject(PrStewardDecodeCode.UnsupportedVersion);
    const value = this.#required({ record: parsed, field: Field.Record });
    if (!UntrustedYamlBoundary.isRecord(value))
      this.#reject(PrStewardDecodeCode.InvalidRecord);
    const kind = this.#required({ record: value, field: Field.Kind });
    const record =
      kind === PrStewardRecordKind.Routing
        ? this.#routing(value)
        : kind === PrStewardRecordKind.Blocker
          ? this.#blocker(value)
          : this.#reject(PrStewardDecodeCode.UnsupportedKind);
    return { schemaVersion: PrStewardSchemaVersion.V2, record };
  }

  static githubUrl(value: string): PrStewardUrl | false {
    const url = this.#safeUrl(value);
    const prefix = `/${PR_STEWARD_REPOSITORY}`;
    return url !== false &&
      url.origin === 'https://github.com' &&
      (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))
      ? { trust: PrStewardUrlTrust.GithubOwned, value: url.toString() }
      : false;
  }

  static externalUrl(value: string): PrStewardUrl | false {
    const url = this.#safeUrl(value);
    return url === false
      ? false
      : { trust: PrStewardUrlTrust.UntrustedExternal, value: url.origin };
  }

  static #routing(record: UntrustedYamlMap): PrStewardRoutingRecord {
    this.#exact({ record, fields: ROUTING_FIELDS });
    const source = this.#source(record);
    const githubEvent = this.#text({
      record,
      field: Field.GithubEvent,
      limit: 64,
    });
    if (this.#eventSource(githubEvent) !== source)
      this.#reject(PrStewardDecodeCode.InvalidCombination);
    const path = this.#optionalText({ record, field: Field.Path, limit: 240 });
    const line = this.#optionalInteger({ record, field: Field.Line });
    const reviewId = this.#optionalInteger({ record, field: Field.ReviewId });
    const commentId = this.#optionalInteger({ record, field: Field.CommentId });
    const runId = this.#optionalInteger({ record, field: Field.RunId });
    const author = this.#optionalText({
      record,
      field: Field.Author,
      limit: 64,
    });
    const headSha = this.#head(record);
    if (headSha === false) this.#reject(PrStewardDecodeCode.InvalidField);
    if (
      source === PrStewardSource.WorkflowJob ||
      (source !== PrStewardSource.PullRequestReviewComment &&
        (path !== false || line !== false || reviewId !== false)) ||
      (source !== PrStewardSource.IssueComment &&
        source !== PrStewardSource.PullRequestReviewComment &&
        commentId !== false) ||
      (source !== PrStewardSource.CheckRun &&
        source !== PrStewardSource.WorkflowRun &&
        runId !== false) ||
      (source !== PrStewardSource.PullRequest &&
        source !== PrStewardSource.PullRequestReview &&
        source !== PrStewardSource.PullRequestReviewComment &&
        source !== PrStewardSource.IssueComment &&
        author !== false)
    )
      this.#reject(PrStewardDecodeCode.InvalidCombination);
    return {
      kind: PrStewardRecordKind.Routing,
      eventId: this.#opaqueText({
        record,
        field: Field.EventId,
        kind: IdentityKind.Event,
      }),
      deliveryId: this.#opaqueText({
        record,
        field: Field.DeliveryId,
        kind: IdentityKind.Delivery,
      }),
      repository: this.#repository(record),
      pullRequest: this.#integer({
        record,
        field: Field.Pr,
      }) as PrStewardPullRequest,
      headSha: headSha as PrStewardHeadSha,
      source,
      objectId: this.#optionalInteger({ record, field: Field.ObjectId }),
      commentId,
      runId,
      githubEvent: this.githubEvent(source),
      action: this.#optionalText({ record, field: Field.Action, limit: 64 }),
      state: this.#optionalText({ record, field: Field.State, limit: 64 }),
      reviewId,
      url: this.#url(record),
      path,
      line,
      author,
    } as PrStewardRoutingRecord;
  }

  static #blocker(
    record: UntrustedYamlMap,
  ): PrStewardMalformedBlocker | PrStewardUnavailableBlocker {
    const code = this.#required({ record, field: Field.Code });
    if (code === PrStewardBlockerCode.MalformedEvent) {
      this.#exact({ record, fields: MALFORMED });
      return {
        kind: PrStewardRecordKind.Blocker,
        code,
        repository: this.#repository(record),
        pullRequest: this.#pullRequest(record),
        summary: this.#text({ record, field: Field.Summary, limit: 240 }),
      };
    }
    if (code !== PrStewardBlockerCode.GithubObservationUnavailable)
      this.#reject(PrStewardDecodeCode.InvalidField);
    this.#exact({ record, fields: UNAVAILABLE });
    const source = this.#source(record);
    const headSha = this.#head(record);
    const runId = this.#optionalInteger({ record, field: Field.RunId });
    const common: PrStewardUnavailableCommon = {
      kind: PrStewardRecordKind.Blocker,
      code,
      repository: this.#repository(record),
      pullRequest: this.#pullRequest(record),
      eventId: this.#opaqueText({
        record,
        field: F.EventId,
        kind: IdentityKind.Event,
      }),
      deliveryId: this.#opaqueText({
        record,
        field: F.DeliveryId,
        kind: IdentityKind.Delivery,
      }),
      objectId: this.#optionalInteger({ record, field: F.ObjectId }),
      summary: this.#text({ record, field: F.Summary, limit: 240 }),
    };
    if (source === PrStewardSource.IssueComment) {
      if (headSha !== false || runId !== false)
        return this.#reject(PrStewardDecodeCode.InvalidCombination);
      return { ...common, source, headSha, runId };
    }
    if (headSha === false)
      return this.#reject(PrStewardDecodeCode.InvalidCombination);
    if (
      source === PrStewardSource.CheckRun ||
      source === PrStewardSource.WorkflowRun
    )
      return { ...common, source, headSha, runId };
    if (source === PrStewardSource.WorkflowJob || runId !== false)
      return this.#reject(PrStewardDecodeCode.InvalidCombination);
    return { ...common, source, headSha, runId };
  }

  static #pullRequest(record: UntrustedYamlMap): PrStewardPullRequest {
    return this.pullRequest(this.#required({ record, field: Field.Pr }));
  }

  static #opaqueText<Kind extends IdentityKind>(
    request: RecordField & {
      readonly kind: Kind;
    },
  ): Opaque<string, Kind> {
    return this.#text({
      record: request.record,
      field: request.field,
      limit: 128,
    }) as Opaque<string, Kind>;
  }

  static #required(request: RecordField): UntrustedYamlNode {
    const result = UntrustedYamlBoundary.property({
      record: request.record,
      key: request.field,
    });
    if (result.presence !== UntrustedYamlPropertyPresence.Present)
      this.#reject(PrStewardDecodeCode.MissingField);
    return result.value;
  }

  static #exact(request: {
    readonly record: UntrustedYamlMap;
    readonly fields: readonly Field[];
  }): void {
    const actual = Object.keys(request.record).sort();
    const expected = [...request.fields].sort();
    if (actual.join('\u0000') !== expected.join('\u0000'))
      this.#reject(PrStewardDecodeCode.InvalidFields);
  }

  static #text(
    request: RecordField & {
      readonly limit: number;
    },
  ): string {
    const value = this.#required(request);
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value.length > request.limit ||
      new TextEncoder().encode(value).length > request.limit * 3 ||
      value.trim() !== value ||
      Array.from(value).some(
        (character) =>
          character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127,
      )
    )
      this.#reject(PrStewardDecodeCode.InvalidField);
    return value;
  }

  static #optionalText(
    request: RecordField & {
      readonly limit: number;
    },
  ): string | false {
    return this.#required(request) === false ? false : this.#text(request);
  }

  static #integer(request: RecordField): number {
    const value = this.#required(request);
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
      this.#reject(PrStewardDecodeCode.InvalidField);
    return value;
  }

  static #optionalInteger(request: RecordField): number | false {
    return this.#required(request) === false ? false : this.#integer(request);
  }

  static #repository(record: UntrustedYamlMap): typeof PR_STEWARD_REPOSITORY {
    if (this.#required({ record, field: Field.Repo }) !== PR_STEWARD_REPOSITORY)
      this.#reject(PrStewardDecodeCode.InvalidField);
    return PR_STEWARD_REPOSITORY;
  }

  static #head(record: UntrustedYamlMap): PrStewardHeadSha | false {
    const value = this.#required({ record, field: Field.HeadSha });
    if (value === false) return false;
    return this.headSha(value);
  }

  static #source(record: UntrustedYamlMap): PrStewardSource {
    const value = this.#required({ record, field: Field.Source });
    for (const source of Object.values(PrStewardSource))
      if (value === source) return source;
    return this.#reject(PrStewardDecodeCode.InvalidField);
  }

  static #eventSource(value: string): PrStewardSource {
    for (const source of Object.values(PrStewardSource))
      if (value === this.githubEvent(source)) return source;
    return this.#reject(PrStewardDecodeCode.InvalidField);
  }

  static #url(record: UntrustedYamlMap): PrStewardUrl | false {
    const value = this.#required({ record, field: Field.Url });
    if (value === false) return false;
    if (!UntrustedYamlBoundary.isRecord(value))
      this.#reject(PrStewardDecodeCode.InvalidField);
    this.#exact({ record: value, fields: [Field.Trust, Field.Value] });
    const trust = this.#required({ record: value, field: Field.Trust });
    const text = this.#text({ record: value, field: Field.Value, limit: 240 });
    const url =
      trust === PrStewardUrlTrust.GithubOwned
        ? this.githubUrl(text)
        : trust === PrStewardUrlTrust.UntrustedExternal
          ? this.externalUrl(text)
          : false;
    if (url === false || url.value !== text || url.trust !== trust)
      this.#reject(PrStewardDecodeCode.InvalidField);
    return url;
  }

  static #safeUrl(value: string): URL | false {
    try {
      const url = new URL(value);
      if (
        url.protocol !== 'https:' ||
        url.username.length > 0 ||
        url.password.length > 0
      )
        return false;
      url.search = '';
      url.hash = '';
      return url.toString().length <= 240 ? url : false;
    } catch {
      return false;
    }
  }

  static #fail(request: {
    readonly code: PrStewardDecodeCode;
    readonly cause: Error | false;
  }): never {
    throw new PrStewardDecodeError(request);
  }

  static #reject(code: PrStewardDecodeCode): never {
    return this.#fail({ code, cause: false });
  }
}
