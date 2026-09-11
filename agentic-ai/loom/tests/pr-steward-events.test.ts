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
  PrStewardEventObserver,
  PrStewardInvocationCodec,
  PrStewardCredentialFile,
  PrStewardBoundedMessageStream,
  PrStewardSubscriptionKind,
  PrStewardSubscriptionOverloadError,
} from '../src/pr-steward-events.ts';
import {
  PR_STEWARD_REPOSITORY,
  PrStewardNdjsonCodec,
  PrStewardRecordKind,
  PrStewardSource,
  PrStewardUrlTrust,
} from '../src/pr-steward-contract.ts';
import { PrStewardGithubUnavailableError } from '../src/pr-steward-github.ts';
import type {
  PrStewardHeadSha,
  PrStewardPullRequest,
} from '../src/pr-steward-contract.ts';
import type {
  PrStewardAssignedPullRequest,
  PrStewardAssignedPrReader,
  PrStewardAssignedPrRequest,
} from '../src/pr-steward-github.ts';
import type { UntrustedYamlMap } from '../src/lib/guards.ts';

const HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ASSIGNED_HEAD: PrStewardHeadSha = PrStewardNdjsonCodec.headSha(HEAD);
const ASSIGNED_PR: PrStewardPullRequest =
  PrStewardNdjsonCodec.pullRequest(1560);
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
  async read(_request: PrStewardAssignedPrRequest) {
    return { headSha: ASSIGNED_HEAD, url: assignedUrl } as const;
  }
}
class UnavailablePrReader implements PrStewardAssignedPrReader {
  async read(_request: PrStewardAssignedPrRequest): Promise<never> {
    throw new PrStewardGithubUnavailableError({ cause: false });
  }
}
class PendingPrReader implements PrStewardAssignedPrReader {
  readonly pending = Promise.withResolvers<PrStewardAssignedPullRequest>();
  reads = 0;

  read(_request: PrStewardAssignedPrRequest) {
    this.reads += 1;
    return this.pending.promise;
  }
}
class OrderedPrReader implements PrStewardAssignedPrReader {
  readonly first = Promise.withResolvers<PrStewardAssignedPullRequest>();
  readonly second = Promise.withResolvers<PrStewardAssignedPullRequest>();
  reads = 0;

  read(_request: PrStewardAssignedPrRequest) {
    this.reads += 1;
    return this.reads === 1 ? this.first.promise : this.second.promise;
  }
}
class UnexpectedPrReader implements PrStewardAssignedPrReader {
  readonly #error: Error;

  constructor(request: { readonly error: Error }) {
    this.#error = request.error;
  }

  async read(_request: PrStewardAssignedPrRequest): Promise<never> {
    throw this.#error;
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
      pullRequest: ASSIGNED_PR,
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
    expect(PrStewardCredentialFile.load(path)).toEqual({
      username: 'pr-steward',
      password: 'a'.repeat(64),
    });
    writeFileSync(
      path,
      `username: pr-steward\npassword: ${'a'.repeat(64)}\nextra: true\n`,
    );
    expect(() => PrStewardCredentialFile.load(path)).toThrow(
      'credential schema is invalid',
    );
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
    expect(() => PrStewardCredentialFile.load(target)).toThrow(
      'mode must be 0600',
    );
    chmodSync(target, 0o600);
    symlinkSync(target, link);
    expect(() => PrStewardCredentialFile.load(link)).toThrow(
      'cannot be opened securely',
    );
  });

  test('requires one positive PR and an absolute optional config', () => {
    const invocation = PrStewardInvocationCodec.parse(['--pr', '1560']);
    const assignedPullRequest: PrStewardPullRequest = invocation.pullRequest;
    expect(Number(assignedPullRequest)).toBe(1560);
    expect(() => PrStewardInvocationCodec.parse(['--pr', '0'])).toThrow(
      'positive integer',
    );
    expect(() =>
      PrStewardInvocationCodec.parse(['--pr', '1560', '--config', 'relative']),
    ).toThrow('absolute');
  });
});

describe('exact-head routing observations', () => {
  test('admits four messages and synchronously unsubscribes on overflow', async () => {
    const messages = new PrStewardBoundedMessageStream();
    let unsubscribed = 0;
    const unsubscribe = (): void => {
      unsubscribed += 1;
    };
    messages.admit({ data: encoder.encode('0'), unsubscribe });
    const iterator = messages[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.done) throw new Error('expected first admitted message');
    for (let index = 1; index < 5; index += 1)
      messages.admit({ data: encoder.encode(String(index)), unsubscribe });
    expect(unsubscribed).toBe(1);
    const admitted = [new TextDecoder().decode(first.value.data)];
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      admitted.push(new TextDecoder().decode(next.value.data));
    }
    expect(admitted).toEqual(['0', '1', '2', '3']);
    const outcome = messages.outcome();
    expect(outcome).toEqual({
      kind: PrStewardSubscriptionKind.Overloaded,
      pending: 4,
    });
    if (outcome.kind !== PrStewardSubscriptionKind.Overloaded)
      throw new Error('expected overload outcome');
    const failure = new PrStewardSubscriptionOverloadError({
      pending: outcome.pending,
    });
    expect(failure.pending).toBe(4);
    expect(failure.message).toContain('4 pending messages');
  });

  test('settles admitted messages before reporting normal closure', async () => {
    const messages = new PrStewardBoundedMessageStream();
    let unsubscribed = false;
    messages.admit({
      data: encoder.encode('admitted'),
      unsubscribe: () => {
        unsubscribed = true;
      },
    });
    messages.terminate({ kind: PrStewardSubscriptionKind.Closed });
    const admitted: string[] = [];
    for await (const message of messages)
      admitted.push(new TextDecoder().decode(message.data));
    expect(admitted).toEqual(['admitted']);
    const outcome = messages.outcome();
    expect(outcome).toEqual({
      kind: PrStewardSubscriptionKind.Closed,
    });
    expect(unsubscribed).toBe(false);
  });

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
          path: 'untrusted/path',
          line: 9,
          pull_request_review_id: 8,
          user: { login: 'untrusted-author' },
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
      const lines = await write([cloudEvent({ event, body })]);
      expect(lines).toHaveLength(1);
      const hint = PrStewardNdjsonCodec.decode(lines[0]!).record;
      expect(hint).toMatchObject({
        kind: PrStewardRecordKind.Routing,
        repository: PR_STEWARD_REPOSITORY,
        pullRequest: ASSIGNED_PR,
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
    const rejected: Uint8Array[] = [];
    for (const event of ['check_run', 'check_suite', 'workflow_run'])
      for (const head of [STALE_HEAD, false] as const)
        rejected.push(
          cloudEvent({
            event,
            body: { repository, [event]: associated({ id: 50, head }) },
          }),
        );
    rejected.push(
      cloudEvent({
        event: 'pull_request',
        id: '',
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
        body: {
          repository,
          pull_request: { number: 1560, head: { sha: STALE_HEAD } },
        },
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
        event: 'workflow_job',
        body: {
          repository,
          workflow_job: {
            head_sha: HEAD,
            pull_requests: [{ number: 1560 }, { number: 1559 }],
          },
        },
      }),
      cloudEvent({
        event: 'workflow_job',
        body: { repository, workflow_job: { id: 49, head_sha: HEAD } },
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
    const assignedMalformed = cloudEvent({
      event: 'pull_request',
      body: { repository, pull_request: pullRequest },
      id: '',
    });
    const malformedJob = cloudEvent({
      event: 'workflow_job',
      body: { repository, workflow_job: associated({ id: 43, head: HEAD }) },
      id: '',
    });
    const lines = await write([
      encoder.encode('RAW_UNATTRIBUTED_SECRET'),
      assignedMalformed,
      malformedJob,
      valid,
    ]);
    expect(lines).toHaveLength(2);
    expect(PrStewardNdjsonCodec.decode(lines[0]!).record).toMatchObject({
      kind: PrStewardRecordKind.Blocker,
      pullRequest: 1560,
    });
    const parsed = PrStewardNdjsonCodec.decode(lines[1]!).record;
    expect(parsed).toMatchObject({
      kind: PrStewardRecordKind.Routing,
      path: false,
      line: false,
      url: false,
      author: false,
    });
    expect(lines[1]!.length).toBeLessThan(2_048);
    expect(lines.join('')).not.toContain('RAW_PAYLOAD_SECRET');
    expect(lines.join('')).not.toContain('RAW_UNATTRIBUTED_SECRET');
    const failure = new Error('operational failure');
    await expect(
      new PrStewardEventObserver({ reader: new FixturePrReader() }).observe({
        messages: (async function* () {
          yield { data: valid };
        })(),
        pullRequest: ASSIGNED_PR,
        write: () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    await expect(
      new PrStewardEventObserver({ reader: new FixturePrReader() }).observe({
        messages: (async function* () {
          yield { data: valid };
          throw failure;
        })(),
        pullRequest: ASSIGNED_PR,
        write: () => false,
      }),
    ).rejects.toBe(failure);
  });

  test('emits a safe unavailable blocker and propagates unexpected reader errors', async () => {
    const event = cloudEvent({
      event: 'pull_request',
      body: { repository, pull_request: pullRequest },
    });
    const lines = await PrStewardEventFixture.observe({
      data: [event],
      reader: new UnavailablePrReader(),
    });
    expect(lines).toHaveLength(1);
    expect(PrStewardNdjsonCodec.decode(lines[0]!).record).toMatchObject({
      kind: PrStewardRecordKind.Blocker,
      eventId: 'event-pull_request',
      headSha: HEAD,
    });
    const failure = new Error('unexpected reader failure');
    await expect(
      PrStewardEventFixture.observe({
        data: [event],
        reader: new UnexpectedPrReader({ error: failure }),
      }),
    ).rejects.toBe(failure);
  });

  test('processes one admitted observation at a time', async () => {
    const reader = new PendingPrReader();
    const event = cloudEvent({
      event: 'pull_request',
      body: { repository, pull_request: pullRequest },
    });
    const observation = PrStewardEventFixture.observe({
      data: [event, event, event, event, event],
      reader,
    });
    await Bun.sleep(0);
    expect(reader.reads).toBe(1);
    reader.pending.resolve({ headSha: ASSIGNED_HEAD, url: assignedUrl });
    expect(await observation).toHaveLength(5);
  });

  test('emits independently resolved observations in input order', async () => {
    const reader = new OrderedPrReader();
    const lines: string[] = [];
    const observation = new PrStewardEventObserver({ reader }).observe({
      messages: (async function* () {
        yield {
          data: cloudEvent({
            event: 'pull_request',
            body: { repository, pull_request: pullRequest },
            id: 'first',
          }),
        };
        yield {
          data: cloudEvent({
            event: 'pull_request',
            body: { repository, pull_request: pullRequest },
            id: 'second',
          }),
        };
      })(),
      pullRequest: ASSIGNED_PR,
      write: (line) => lines.push(line),
    });
    await Bun.sleep(0);
    reader.second.resolve({ headSha: ASSIGNED_HEAD, url: assignedUrl });
    await Bun.sleep(0);
    expect(lines).toHaveLength(0);
    reader.first.resolve({ headSha: ASSIGNED_HEAD, url: assignedUrl });
    await observation;
    expect(
      lines.map((line) => PrStewardNdjsonCodec.decode(line).record),
    ).toMatchObject([{ eventId: 'first' }, { eventId: 'second' }]);
  });

  test('settles admitted work before propagating stream failure', async () => {
    const reader = new PendingPrReader();
    const failure = new Error('stream failure');
    const lines: string[] = [];
    const observation = new PrStewardEventObserver({ reader }).observe({
      messages: (async function* () {
        yield {
          data: cloudEvent({
            event: 'pull_request',
            body: { repository, pull_request: pullRequest },
          }),
        };
        throw failure;
      })(),
      pullRequest: ASSIGNED_PR,
      write: (line) => lines.push(line),
    });
    await Bun.sleep(0);
    expect(reader.reads).toBe(1);
    reader.pending.resolve({ headSha: ASSIGNED_HEAD, url: assignedUrl });
    await expect(observation).rejects.toBe(failure);
    expect(lines).toHaveLength(1);
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
  expect(lifecycle).toContain('closed `pr-steward-ndjson/v2` envelope');
  expect(lifecycle).toContain('No compatibility reader exists.');
  expect(lifecycle).toContain('Stop the subscriber and report a blocker.');
  expect(lifecycle).not.toContain('Roll back');
  expect(lifecycle).not.toContain('pr-steward-ndjson/v1');
});
