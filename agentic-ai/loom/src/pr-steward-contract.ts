import {
  asUntrustedYamlNode,
  isRecord,
  untrustedYamlProperty,
  UntrustedYamlPropertyPresence,
} from './lib/guards.ts';
import type { UntrustedYamlMap, UntrustedYamlNode } from './lib/guards.ts';

export const PR_STEWARD_REPOSITORY = 'meta-secret/nook';

export enum PrStewardSchemaVersion {
  V1 = 'pr-steward-ndjson/v1',
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

export type PrStewardRoutingRecord = {
  readonly kind: PrStewardRecordKind.Routing;
  readonly eventId: string;
  readonly deliveryId: string;
  readonly repository: typeof PR_STEWARD_REPOSITORY;
  readonly pullRequest: number;
  readonly headSha: string;
  readonly source: PrStewardSource;
  readonly objectId: number | false;
  readonly commentId: number | false;
  readonly runId: number | false;
  readonly githubEvent: PrStewardGithubEvent;
  readonly action: string | false;
  readonly state: string | false;
  readonly reviewId: number | false;
  readonly url: PrStewardUrl | false;
  readonly path: string | false;
  readonly line: number | false;
  readonly author: string | false;
};

export enum PrStewardBlockerCode {
  GithubObservationUnavailable = 'github-observation-unavailable',
  MalformedEvent = 'malformed-event',
}

export type PrStewardMalformedBlocker = {
  readonly kind: PrStewardRecordKind.Blocker;
  readonly code: PrStewardBlockerCode.MalformedEvent;
  readonly repository: typeof PR_STEWARD_REPOSITORY;
  readonly pullRequest: number;
  readonly summary: string;
};

export type PrStewardUnavailableBlocker = {
  readonly kind: PrStewardRecordKind.Blocker;
  readonly code: PrStewardBlockerCode.GithubObservationUnavailable;
  readonly repository: typeof PR_STEWARD_REPOSITORY;
  readonly pullRequest: number;
  readonly eventId: string;
  readonly deliveryId: string;
  readonly source: PrStewardSource;
  readonly headSha: string | false;
  readonly objectId: number | false;
  readonly runId: number | false;
  readonly summary: string;
};

export type PrStewardBlockerRecord =
  PrStewardMalformedBlocker | PrStewardUnavailableBlocker;
export type PrStewardRecord = PrStewardBlockerRecord | PrStewardRoutingRecord;
export type PrStewardEnvelope = {
  readonly schemaVersion: PrStewardSchemaVersion.V1;
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
  PullRequest = 'pullRequest',
  Record = 'record',
  Repository = 'repository',
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
  Field.PullRequest,
  Field.Repository,
  Field.ReviewId,
  Field.RunId,
  Field.Source,
  Field.State,
  Field.Url,
] as const;
const MALFORMED_FIELDS = [
  Field.Code,
  Field.Kind,
  Field.PullRequest,
  Field.Repository,
  Field.Summary,
] as const;
const UNAVAILABLE_FIELDS = [
  Field.Code,
  Field.DeliveryId,
  Field.EventId,
  Field.HeadSha,
  Field.Kind,
  Field.ObjectId,
  Field.PullRequest,
  Field.Repository,
  Field.RunId,
  Field.Source,
  Field.Summary,
] as const;

const NDJSON_LIMIT = 8_192;

export class PrStewardNdjsonCodec {
  static githubEvent(request: {
    readonly source: PrStewardSource;
  }): PrStewardGithubEvent {
    return EVENTS[request.source];
  }

  static encode(record: PrStewardRecord): string {
    const line = JSON.stringify({
      schemaVersion: PrStewardSchemaVersion.V1,
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
      parsed = asUntrustedYamlNode(JSON.parse(line) as UntrustedYamlNode);
    } catch {
      this.#fail({
        code: PrStewardDecodeCode.InvalidJson,
        cause: new Error('JSON parser rejected the record'),
      });
    }
    if (!isRecord(parsed)) this.#reject(PrStewardDecodeCode.InvalidRecord);
    this.#exact({
      record: parsed,
      fields: [Field.Record, Field.SchemaVersion],
    });
    if (
      this.#required({ record: parsed, field: Field.SchemaVersion }) !==
      PrStewardSchemaVersion.V1
    )
      this.#reject(PrStewardDecodeCode.UnsupportedVersion);
    const value = this.#required({ record: parsed, field: Field.Record });
    if (!isRecord(value)) this.#reject(PrStewardDecodeCode.InvalidRecord);
    const kind = this.#required({ record: value, field: Field.Kind });
    const record =
      kind === PrStewardRecordKind.Routing
        ? this.#routing(value)
        : kind === PrStewardRecordKind.Blocker
          ? this.#blocker(value)
          : this.#reject(PrStewardDecodeCode.UnsupportedKind);
    return { schemaVersion: PrStewardSchemaVersion.V1, record };
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
    const headSha = this.#head({ record, optional: false });
    if (headSha === false) this.#reject(PrStewardDecodeCode.InvalidField);
    if (
      (source !== PrStewardSource.PullRequestReviewComment &&
        (path !== false || line !== false)) ||
      (source !== PrStewardSource.PullRequestReview &&
        source !== PrStewardSource.PullRequestReviewComment &&
        reviewId !== false)
    )
      this.#reject(PrStewardDecodeCode.InvalidCombination);
    return {
      kind: PrStewardRecordKind.Routing,
      eventId: this.#text({ record, field: Field.EventId, limit: 128 }),
      deliveryId: this.#text({ record, field: Field.DeliveryId, limit: 128 }),
      repository: this.#repository(record),
      pullRequest: this.#integer({ record, field: Field.PullRequest }),
      headSha,
      source,
      objectId: this.#optionalInteger({ record, field: Field.ObjectId }),
      commentId: this.#optionalInteger({ record, field: Field.CommentId }),
      runId: this.#optionalInteger({ record, field: Field.RunId }),
      githubEvent: this.githubEvent({ source }),
      action: this.#optionalText({ record, field: Field.Action, limit: 64 }),
      state: this.#optionalText({ record, field: Field.State, limit: 64 }),
      reviewId,
      url: this.#url(record),
      path,
      line,
      author: this.#optionalText({ record, field: Field.Author, limit: 64 }),
    };
  }

  static #blocker(record: UntrustedYamlMap): PrStewardBlockerRecord {
    const code = this.#required({ record, field: Field.Code });
    if (code === PrStewardBlockerCode.MalformedEvent) {
      this.#exact({ record, fields: MALFORMED_FIELDS });
      return {
        kind: PrStewardRecordKind.Blocker,
        code,
        repository: this.#repository(record),
        pullRequest: this.#integer({ record, field: Field.PullRequest }),
        summary: this.#text({ record, field: Field.Summary, limit: 240 }),
      };
    }
    if (code !== PrStewardBlockerCode.GithubObservationUnavailable)
      this.#reject(PrStewardDecodeCode.InvalidField);
    this.#exact({ record, fields: UNAVAILABLE_FIELDS });
    return {
      kind: PrStewardRecordKind.Blocker,
      code,
      repository: this.#repository(record),
      pullRequest: this.#integer({ record, field: Field.PullRequest }),
      eventId: this.#text({ record, field: Field.EventId, limit: 128 }),
      deliveryId: this.#text({ record, field: Field.DeliveryId, limit: 128 }),
      source: this.#source(record),
      headSha: this.#head({ record, optional: true }),
      objectId: this.#optionalInteger({ record, field: Field.ObjectId }),
      runId: this.#optionalInteger({ record, field: Field.RunId }),
      summary: this.#text({ record, field: Field.Summary, limit: 240 }),
    };
  }

  static #required(request: {
    readonly record: UntrustedYamlMap;
    readonly field: Field;
  }): UntrustedYamlNode {
    const result = untrustedYamlProperty({
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

  static #text(request: {
    readonly record: UntrustedYamlMap;
    readonly field: Field;
    readonly limit: number;
  }): string {
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

  static #optionalText(request: {
    readonly record: UntrustedYamlMap;
    readonly field: Field;
    readonly limit: number;
  }): string | false {
    return this.#required(request) === false ? false : this.#text(request);
  }

  static #integer(request: {
    readonly record: UntrustedYamlMap;
    readonly field: Field;
  }): number {
    const value = this.#required(request);
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
      this.#reject(PrStewardDecodeCode.InvalidField);
    return value;
  }

  static #optionalInteger(request: {
    readonly record: UntrustedYamlMap;
    readonly field: Field;
  }): number | false {
    return this.#required(request) === false ? false : this.#integer(request);
  }

  static #repository(record: UntrustedYamlMap): typeof PR_STEWARD_REPOSITORY {
    if (
      this.#required({ record, field: Field.Repository }) !==
      PR_STEWARD_REPOSITORY
    )
      this.#reject(PrStewardDecodeCode.InvalidField);
    return PR_STEWARD_REPOSITORY;
  }

  static #head(request: {
    readonly record: UntrustedYamlMap;
    readonly optional: boolean;
  }): string | false {
    const value = this.#required({
      record: request.record,
      field: Field.HeadSha,
    });
    if (value === false && request.optional) return false;
    if (typeof value !== 'string' || !/^[0-9a-f]{40}$/.test(value))
      this.#reject(PrStewardDecodeCode.InvalidField);
    return value;
  }

  static #source(record: UntrustedYamlMap): PrStewardSource {
    const value = this.#required({ record, field: Field.Source });
    for (const source of Object.values(PrStewardSource))
      if (value === source) return source;
    return this.#reject(PrStewardDecodeCode.InvalidField);
  }

  static #eventSource(value: string): PrStewardSource {
    for (const source of Object.values(PrStewardSource))
      if (value === this.githubEvent({ source })) return source;
    return this.#reject(PrStewardDecodeCode.InvalidField);
  }

  static #url(record: UntrustedYamlMap): PrStewardUrl | false {
    const value = this.#required({ record, field: Field.Url });
    if (value === false) return false;
    if (!isRecord(value)) this.#reject(PrStewardDecodeCode.InvalidField);
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
