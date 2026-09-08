import { describe, expect, test } from 'bun:test';
import {
  PR_STEWARD_REPOSITORY as REPO,
  PrStewardBlockerCode as BlockerCode,
  PrStewardDecodeCode as DecodeCode,
  PrStewardGithubEvent as GithubEvent,
  PrStewardNdjsonCodec as Codec,
  PrStewardRecordKind as Kind,
  PrStewardSchemaVersion as Version,
  PrStewardSource as Source,
  PrStewardUrlTrust as UrlTrust,
} from '../src/pr-steward-contract.ts';
import type { UntrustedYamlMap } from '../src/lib/guards.ts';

const HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const routing = (fields: UntrustedYamlMap = {}) => ({
  kind: Kind.Routing,
  eventId: 'event-1',
  deliveryId: 'delivery-1',
  repository: REPO,
  pullRequest: 1564,
  headSha: HEAD,
  source: Source.PullRequest,
  objectId: false,
  commentId: false,
  runId: false,
  githubEvent: GithubEvent.PullRequest,
  action: false,
  state: false,
  reviewId: false,
  url: false,
  path: false,
  line: false,
  author: false,
  ...fields,
});
const envelope = (record: UntrustedYamlMap) =>
  JSON.stringify({ schemaVersion: Version.V2, record });

describe('closed PR Steward NDJSON codec', () => {
  test('round trips every supported source-discriminated routing state', () => {
    const variants: [Source, UntrustedYamlMap][] = [
      [Source.PullRequest, {}],
      [Source.PullRequestReview, { author: 'reviewer' }],
      [
        Source.PullRequestReviewComment,
        {
          commentId: 8,
          reviewId: 7,
          path: 'src/a.ts',
          line: 9,
          author: 'reviewer',
        },
      ],
      [Source.IssueComment, { commentId: 8 }],
      [Source.CheckRun, { runId: 10 }],
      [Source.CheckSuite, {}],
      [Source.WorkflowRun, { runId: 11 }],
    ];
    for (const [source, fields] of variants) {
      const record = Codec.routing(
        routing({ ...fields, source, githubEvent: Codec.githubEvent(source) }),
      );
      expect(Codec.decode(Codec.encode(record)).record).toEqual(record);
    }
  });

  test('rejects invalid routing through direct and envelope entry points', () => {
    const invalid: UntrustedYamlMap[] = [
      { eventId: '' },
      { deliveryId: '' },
      { pullRequest: 0 },
      { headSha: 'bad' },
      { runId: 1, commentId: 2, reviewId: 3 },
      {
        source: Source.IssueComment,
        githubEvent: GithubEvent.IssueComment,
        headSha: false,
      },
      { source: Source.WorkflowJob, githubEvent: GithubEvent.WorkflowJob },
      { body: 'forbidden' },
    ];
    for (const fields of invalid) {
      const raw = routing(fields);
      expect(() => Codec.routing(raw)).toThrow();
      expect(() => Codec.decode(envelope(raw))).toThrow();
    }
  });

  test('constructs a blocker with the validated opaque PR identifier', () => {
    const blocker = Codec.blocker({
      kind: Kind.Blocker,
      code: BlockerCode.MalformedEvent,
      repository: REPO,
      pullRequest: 1564,
      summary: 'A malformed notification was rejected.',
    });
    expect(Codec.decode(Codec.encode(blocker)).record).toEqual(blocker);
    expect(() => Codec.blocker({ ...blocker, pullRequest: 0 })).toThrow(
      DecodeCode.InvalidField,
    );
    const unavailable = Codec.blocker({
      kind: Kind.Blocker,
      code: BlockerCode.GithubObservationUnavailable,
      repository: REPO,
      pullRequest: 1564,
      eventId: 'event-1',
      deliveryId: 'delivery-1',
      source: Source.PullRequest,
      headSha: HEAD,
      objectId: 8,
      runId: false,
      summary: 'Assigned pull request observation is unavailable.',
    });
    expect(Codec.decode(Codec.encode(unavailable)).record).toEqual(unavailable);
    expect(() =>
      Codec.blocker({ ...unavailable, source: Source.WorkflowJob }),
    ).toThrow(DecodeCode.InvalidCombination);
    expect(() =>
      Codec.blocker({ ...unavailable, source: Source.IssueComment }),
    ).toThrow(DecodeCode.InvalidCombination);
    expect(() =>
      Codec.blocker({ ...unavailable, source: Source.CheckSuite, runId: 9 }),
    ).toThrow(DecodeCode.InvalidCombination);
    expect(() => Codec.blocker({ ...unavailable, body: 'forbidden' })).toThrow(
      DecodeCode.InvalidFields,
    );
  });

  test('accepts only bounded safe URL forms and exactly v2', () => {
    expect(
      Codec.githubUrl('https://github.com/meta-secret/nook/pull/1564'),
    ).toMatchObject({ trust: UrlTrust.GithubOwned });
    expect(Codec.githubUrl('https://github.com:444/meta-secret/nook')).toBe(
      false,
    );
    expect(Codec.externalUrl('https://ci.example/private?secret=x')).toEqual({
      trust: UrlTrust.UntrustedExternal,
      value: 'https://ci.example',
    });
    expect(() =>
      Codec.decode(
        JSON.stringify({ schemaVersion: 'pr-steward-ndjson/v1', record: {} }),
      ),
    ).toThrow(DecodeCode.UnsupportedVersion);
  });
});
