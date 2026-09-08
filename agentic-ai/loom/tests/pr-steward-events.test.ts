import { afterEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadCredential,
  PrStewardEventObserver,
  PrStewardInvocationCodec,
} from '../src/pr-steward-events.ts';
import {
  PR_STEWARD_REPOSITORY,
  PrStewardBlockerCode,
  PrStewardDecodeCode,
  PrStewardDecodeError,
  PrStewardNdjsonCodec,
  PrStewardRecordKind,
  PrStewardSchemaVersion,
  PrStewardSource,
  PrStewardUrlTrust,
} from '../src/pr-steward-contract.ts';
import {
  PrStewardGithubPrReader,
  PrStewardGithubUnavailableError,
} from '../src/pr-steward-github.ts';
import type {
  PrStewardAssignedPrReader,
  PrStewardAssignedPrRequest,
  PrStewardCommandRequest,
  PrStewardCommandResult,
  PrStewardCommandRunner,
} from '../src/pr-steward-github.ts';
import type { UntrustedYamlMap } from '../src/lib/guards.ts';

const HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const STALE_HEAD = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const encoder = new TextEncoder();
const temporaryPaths: string[] = [];
const repository = { full_name: PR_STEWARD_REPOSITORY };
const pullRequest = { number: 1560, head: { sha: HEAD } };
const assignedUrl = {
  trust: PrStewardUrlTrust.GithubOwned,
  value: 'https://github.com/meta-secret/nook/pull/1560',
} as const;

class FixturePrReader implements PrStewardAssignedPrReader {
  read(_request: PrStewardAssignedPrRequest) {
    return { headSha: HEAD, url: assignedUrl } as const;
  }
}

class UnavailablePrReader implements PrStewardAssignedPrReader {
  read(_request: PrStewardAssignedPrRequest): never {
    throw new PrStewardGithubUnavailableError();
  }
}

class FixtureCommand implements PrStewardCommandRunner {
  request: PrStewardCommandRequest | false = false;
  readonly #result: PrStewardCommandResult;

  constructor(request: { readonly result: PrStewardCommandResult }) {
    this.#result = request.result;
  }

  run(request: PrStewardCommandRequest): PrStewardCommandResult {
    this.request = request;
    return this.#result;
  }
}

class PrStewardEventFixture {
  static associated(args: {
    readonly id: number;
    readonly head: string | false;
  }): UntrustedYamlMap {
    return {
      id: args.id,
      head_sha: HEAD,
      pull_requests: [
        { number: 1560, head: args.head === false ? {} : { sha: args.head } },
      ],
    };
  }

  static cloudEvent(args: {
    readonly event: string;
    readonly body: UntrustedYamlMap;
    readonly id?: string;
  }): Uint8Array {
    const eventData = JSON.stringify({
      headers: {
        'X-Github-Event': args.event,
        'X-Github-Delivery': `delivery-${args.event}`,
      },
      body: args.body,
    });
    return encoder.encode(
      JSON.stringify({
        id: 'id' in args ? args.id : `event-${args.event}`,
        time: '2026-09-08T20:00:00Z',
        data_base64: Buffer.from(eventData).toString('base64'),
      }),
    );
  }

  static async write(data: readonly Uint8Array[]): Promise<readonly string[]> {
    return PrStewardEventFixture.observe({
      data,
      reader: new FixturePrReader(),
    });
  }

  static async observe(request: {
    readonly data: readonly Uint8Array[];
    readonly reader: PrStewardAssignedPrReader;
  }): Promise<readonly string[]> {
    const lines: string[] = [];
    await new PrStewardEventObserver({ reader: request.reader }).observe({
      messages: (async function* () {
        for (const item of request.data) yield { data: item };
      })(),
      repository: PR_STEWARD_REPOSITORY,
      pullRequest: 1560,
      write: (line) => lines.push(line),
    });
    return lines;
  }
}
const { associated, cloudEvent, write } = PrStewardEventFixture;

afterEach(() => {
  for (const path of temporaryPaths.splice(0))
    rmSync(path, { recursive: true, force: true });
});

describe('PR Steward credentials and invocation codec', () => {
  test('loads only the infrastructure-owned credential shape', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nook-pr-events-'));
    temporaryPaths.push(directory);
    const path = join(directory, 'client.yaml');
    writeFileSync(path, `username: pr-steward\npassword: ${'a'.repeat(64)}\n`);
    chmodSync(path, 0o600);
    expect(loadCredential(path)).toEqual({
      username: 'pr-steward',
      password: 'a'.repeat(64),
    });
    writeFileSync(
      path,
      `username: pr-steward\npassword: ${'a'.repeat(64)}\nextra: true\n`,
    );
    expect(() => loadCredential(path)).toThrow('credential schema is invalid');
  });

  test('rejects broad modes and symbolic links', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nook-pr-events-'));
    temporaryPaths.push(directory);
    const target = join(directory, 'target.yaml');
    const link = join(directory, 'client.yaml');
    writeFileSync(
      target,
      `username: pr-steward\npassword: ${'a'.repeat(64)}\n`,
    );
    chmodSync(target, 0o644);
    expect(() => loadCredential(target)).toThrow('mode must be 0600');
    chmodSync(target, 0o600);
    symlinkSync(target, link);
    expect(() => loadCredential(link)).toThrow('cannot be opened securely');
  });

  test('requires one positive PR and an absolute optional config', () => {
    expect(PrStewardInvocationCodec.parse(['--pr', '1560'])).toMatchObject({
      pullRequest: 1560,
    });
    expect(() => PrStewardInvocationCodec.parse(['--pr', '0'])).toThrow(
      'positive integer',
    );
    expect(() =>
      PrStewardInvocationCodec.parse(['--pr', '1560', '--config', 'relative']),
    ).toThrow('absolute');
  });
});

describe('compact routing hints', () => {
  test.each([
    {
      event: 'pull_request',
      source: PrStewardSource.PullRequest,
      body: {
        action: 'closed',
        repository,
        pull_request: {
          ...pullRequest,
          id: 40,
          html_url: 'https://github.com/meta-secret/nook/pull/1560?token=no#x',
          user: { login: 'pr-author' },
        },
      },
    },
    {
      event: 'pull_request_review',
      source: PrStewardSource.PullRequestReview,
      body: {
        action: 'submitted',
        repository,
        pull_request: pullRequest,
        review: {
          id: 41,
          commit_id: HEAD,
          state: 'changes_requested',
          html_url: 'https://github.com/meta-secret/nook/pull/1560#review-41',
          user: { login: 'reviewer' },
          body: 'DO_NOT_TRANSFER_REVIEW_BODY',
        },
      },
    },
    {
      event: 'pull_request_review_comment',
      source: PrStewardSource.PullRequestReviewComment,
      body: {
        action: 'created',
        repository,
        pull_request: pullRequest,
        comment: {
          id: 42,
          pull_request_review_id: 41,
          commit_id: HEAD,
          path: 'src/file.ts',
          line: 17,
          html_url: 'https://github.com/meta-secret/nook/pull/1560',
          user: { login: 'reviewer' },
          body: 'DO_NOT_TRANSFER_COMMENT_BODY',
        },
      },
    },
    {
      event: 'issue_comment',
      source: PrStewardSource.IssueComment,
      body: {
        action: 'created',
        repository,
        issue: { number: 1560, pull_request: {} },
        comment: {
          id: 43,
          html_url: 'https://github.com/meta-secret/nook/pull/1560',
          user: { login: 'reviewer' },
          body: 'DO_NOT_TRANSFER_ISSUE_BODY',
        },
      },
    },
    {
      event: 'check_run',
      source: PrStewardSource.CheckRun,
      body: {
        repository,
        check_run: {
          ...associated({ id: 44, head: HEAD }),
          conclusion: 'failure',
          target_url: 'https://ci.example/private/job/44?secret=value',
        },
      },
    },
    {
      event: 'check_suite',
      source: PrStewardSource.CheckSuite,
      body: {
        repository,
        check_suite: {
          ...associated({ id: 45, head: HEAD }),
          status: 'completed',
        },
      },
    },
    {
      event: 'workflow_run',
      source: PrStewardSource.WorkflowRun,
      body: {
        repository,
        workflow_run: {
          ...associated({ id: 146, head: HEAD }),
          conclusion: 'failure',
        },
      },
    },
  ])(
    'routes directly attributed $event metadata',
    async ({ event, source, body }) => {
      const [line] = await write([cloudEvent({ event, body })]);
      const hint = PrStewardNdjsonCodec.decode(line!).record;
      expect(hint).toMatchObject({
        kind: PrStewardRecordKind.Routing,
        repository: PR_STEWARD_REPOSITORY,
        pullRequest: 1560,
        headSha: HEAD,
        source,
      });
      expect(JSON.stringify(hint)).not.toContain('DO_NOT_TRANSFER');
      if (event === 'check_run')
        expect(hint).toMatchObject({
          url: {
            trust: PrStewardUrlTrust.UntrustedExternal,
            value: 'https://ci.example',
          },
        });
      if (event === 'pull_request_review_comment')
        expect(hint).toMatchObject({
          objectId: 42,
          commentId: 42,
          reviewId: 41,
          headSha: HEAD,
          path: 'src/file.ts',
          line: 17,
          author: 'reviewer',
          url: {
            trust: PrStewardUrlTrust.GithubOwned,
            value: 'https://github.com/meta-secret/nook/pull/1560',
          },
        });
    },
  );

  test('suppresses foreign, stale, status, ambiguous, and PR-less inputs', async () => {
    const rejected = ['check_run', 'check_suite', 'workflow_run'].flatMap(
      (event) =>
        ([STALE_HEAD, false] as const).map((head) =>
          cloudEvent({
            event,
            body: { repository, [event]: associated({ id: 50, head }) },
          }),
        ),
    );
    rejected.push(
      cloudEvent({
        event: 'pull_request',
        body: {
          repository: { full_name: 'attacker/nook' },
          pull_request: pullRequest,
        },
      }),
      cloudEvent({
        event: 'pull_request',
        body: {
          repository,
          pull_request: { number: 1559, head: { sha: HEAD } },
        },
      }),
      cloudEvent({
        event: 'pull_request',
        body: { repository, pull_request: { number: 1560, head: {} } },
      }),
      cloudEvent({
        event: 'pull_request_review',
        body: {
          repository,
          pull_request: pullRequest,
          review: { id: 41, commit_id: STALE_HEAD },
        },
      }),
      cloudEvent({
        event: 'status',
        body: { repository, sha: HEAD, id: 48, state: 'failure' },
      }),
      cloudEvent({
        event: 'check_run',
        body: {
          repository,
          check_run: {
            id: 50,
            head_sha: HEAD,
            pull_requests: [{ number: 1560 }, { number: 1559 }],
          },
        },
      }),
    );
    expect(await write(rejected)).toEqual([]);
  });

  test('binds a PR-less workflow job to the freshly observed assigned head', async () => {
    const [line] = await write([
      cloudEvent({
        event: 'workflow_job',
        body: {
          repository,
          workflow_job: { id: 49, run_id: 149, head_sha: HEAD },
        },
      }),
    ]);
    expect(PrStewardNdjsonCodec.decode(line!).record).toMatchObject({
      kind: PrStewardRecordKind.Routing,
      source: PrStewardSource.WorkflowJob,
      objectId: 49,
      runId: 149,
      headSha: HEAD,
    });
    expect(
      await write([
        cloudEvent({
          event: 'workflow_job',
          body: {
            repository,
            workflow_job: { id: 50, run_id: 150, head_sha: STALE_HEAD },
          },
        }),
      ]),
    ).toEqual([]);
  });

  test('bounds output, continues after decode errors, and propagates writer failures', async () => {
    const valid = cloudEvent({
      event: 'pull_request_review_comment',
      body: {
        repository,
        pull_request: pullRequest,
        comment: {
          id: 42,
          commit_id: HEAD,
          path: 'x'.repeat(241),
          line: -1,
          html_url: 'https://user:secret@github.com/meta-secret/nook/pull/1560',
          user: { login: 'x'.repeat(65) },
          body: 'RAW_PAYLOAD_SECRET',
        },
      },
    });
    const lines = await write([encoder.encode('RAW_MALFORMED_SECRET'), valid]);
    expect(lines).toHaveLength(2);
    const blocker = PrStewardNdjsonCodec.decode(lines[0]!).record;
    const parsed = PrStewardNdjsonCodec.decode(lines[1]!).record;
    expect(blocker).toMatchObject({
      code: PrStewardBlockerCode.MalformedEvent,
    });
    expect(PrStewardNdjsonCodec.encode(blocker)).toBe(lines[0]!);
    expect(parsed).toMatchObject({
      path: false,
      line: false,
      url: assignedUrl,
      author: false,
    });
    expect(lines[0]!.length).toBeLessThan(2_048);
    expect(lines.join('')).not.toContain('RAW_PAYLOAD_SECRET');
    expect(lines.join('')).not.toContain('RAW_MALFORMED_SECRET');
    const failure = new Error('operational failure');
    await expect(
      new PrStewardEventObserver({ reader: new FixturePrReader() }).observe({
        messages: (async function* () {
          yield { data: valid };
        })(),
        repository: PR_STEWARD_REPOSITORY,
        pullRequest: 1560,
        write: () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
  });

  test('emits a sanitized blocker when assigned-head observation is unavailable', async () => {
    const lines = await PrStewardEventFixture.observe({
      data: [
        cloudEvent({
          event: 'pull_request',
          body: { repository, pull_request: pullRequest },
        }),
      ],
      reader: new UnavailablePrReader(),
    });
    const blocker = PrStewardNdjsonCodec.decode(lines[0]!).record;
    expect(blocker).toMatchObject({
      kind: PrStewardRecordKind.Blocker,
      code: PrStewardBlockerCode.GithubObservationUnavailable,
      eventId: 'event-pull_request',
      headSha: HEAD,
    });
    expect(PrStewardNdjsonCodec.encode(blocker)).toBe(lines[0]!);
    expect(lines[0]).not.toContain('RAW_PAYLOAD_SECRET');
  });
});

describe('closed NDJSON and assigned-PR reader', () => {
  test('round trips v1 records and rejects unknown, missing, or unsafe shapes', async () => {
    const [line] = await write([
      cloudEvent({
        event: 'pull_request',
        body: { repository, pull_request: pullRequest },
      }),
    ]);
    const envelope = PrStewardNdjsonCodec.decode(line!);
    expect(envelope.schemaVersion).toBe(PrStewardSchemaVersion.V1);
    expect(PrStewardNdjsonCodec.encode(envelope.record)).toBe(line!);
    const invalid = [
      { ...envelope, body: 'SECRET_BODY' },
      { schemaVersion: PrStewardSchemaVersion.V1, record: { kind: 'future' } },
      {
        schemaVersion: PrStewardSchemaVersion.V1,
        record: { kind: PrStewardRecordKind.Routing },
      },
      {
        schemaVersion: PrStewardSchemaVersion.V1,
        record: { ...envelope.record, body: 'SECRET_BODY' },
      },
      {
        schemaVersion: PrStewardSchemaVersion.V1,
        record: {
          ...envelope.record,
          url: {
            trust: PrStewardUrlTrust.GithubOwned,
            value: 'https://user:secret@github.com/meta-secret/nook',
          },
        },
      },
    ];
    for (const value of invalid)
      expect(() => PrStewardNdjsonCodec.decode(JSON.stringify(value))).toThrow(
        PrStewardDecodeError,
      );
    expect(() =>
      PrStewardNdjsonCodec.decode(
        JSON.stringify({ schemaVersion: 'pr-steward-ndjson/v0', record: {} }),
      ),
    ).toThrow(PrStewardDecodeCode.UnsupportedVersion);
  });

  test('uses only the fixed bounded gh API read', () => {
    const command = new FixtureCommand({
      result: {
        status: 0,
        signal: false,
        stdout: JSON.stringify({
          head: { sha: HEAD },
          html_url: 'https://github.com/meta-secret/nook/pull/1560',
        }),
      },
    });
    const reader = new PrStewardGithubPrReader({ command });
    expect(
      reader.read({ repository: PR_STEWARD_REPOSITORY, pullRequest: 1560 }),
    ).toEqual({ headSha: HEAD, url: assignedUrl });
    expect(command.request).toEqual({
      executable: 'gh',
      arguments: [
        'api',
        '--hostname',
        'github.com',
        '--method',
        'GET',
        '/repos/meta-secret/nook/pulls/1560',
      ],
      timeoutMilliseconds: 10_000,
      outputLimitBytes: 2_097_152,
    });
  });

  test.each([
    `{"head":{"sha":"${HEAD}"}}`,
    `{"head":{"sha":"${HEAD}"},"html_url":42}`,
    `{"head":{"sha":"${HEAD}"},"html_url":"https://evil.example/meta-secret/nook/pull/1560"}`,
    `{"head":{"sha":"${HEAD}"},"html_url":"https://github.com/meta-secret/nook/pull/1559"}`,
    `{"head":{"sha":"${HEAD}"},"html_url":"https://github.com/meta-secret/nook/issues/1560"}`,
    `{"head":{"sha":"${HEAD}"},"html_url":"https://github.com:444/meta-secret/nook/pull/1560"}`,
    `SECRET${'x'.repeat(2_097_152)}`,
  ])('rejects noncanonical or oversized GitHub output', (stdout) => {
    const command = new FixtureCommand({
      result: {
        status: 0,
        signal: false,
        stdout,
      },
    });
    const reader = new PrStewardGithubPrReader({ command });
    expect(() =>
      reader.read({ repository: PR_STEWARD_REPOSITORY, pullRequest: 1560 }),
    ).toThrow('Assigned pull request observation is unavailable.');
  });
});

test('documents the direct foreground process', () => {
  const lifecycle = readFileSync(
    new URL(
      '../../../.cortex/teams/pr-steward/workflows/pull-request-lifecycle.md',
      import.meta.url,
    ),
    'utf8',
  );
  expect(lifecycle).toContain(
    'bun agentic-ai/loom/src/pr-steward-events.ts --pr <number>',
  );
});
