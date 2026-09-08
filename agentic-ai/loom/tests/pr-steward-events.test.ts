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
  assignedPrEvent,
  decodePrStewardEvent,
  loadCredential,
  parsePrStewardInvocation,
  PR_STEWARD_REPOSITORY,
  PrStewardRoutingVersion,
  PrStewardSource,
  PrStewardUrlTrust,
  writeAssignedEvents,
} from '../src/pr-steward-events.ts';
import type { UntrustedYamlMap } from '../src/lib/guards.ts';

const HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const STALE_HEAD = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const encoder = new TextEncoder();
const temporaryPaths: string[] = [];
const repository = { full_name: PR_STEWARD_REPOSITORY };
const pullRequest = { number: 1560, head: { sha: HEAD } };

function associated(args: {
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

function cloudEvent(args: {
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

async function write(data: readonly Uint8Array[]): Promise<readonly string[]> {
  const lines: string[] = [];
  await writeAssignedEvents({
    messages: (async function* () {
      for (const item of data) yield { data: item };
    })(),
    pullRequest: 1560,
    write: (line) => lines.push(line),
  });
  return lines;
}

afterEach(() => {
  for (const path of temporaryPaths.splice(0))
    rmSync(path, { recursive: true, force: true });
});

describe('PR Steward credentials and invocation', () => {
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
    expect(parsePrStewardInvocation(['--pr', '1560'])).toMatchObject({
      pullRequest: 1560,
    });
    expect(() => parsePrStewardInvocation(['--pr', '0'])).toThrow(
      'positive integer',
    );
    expect(() =>
      parsePrStewardInvocation(['--pr', '1560', '--config', 'relative']),
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
          html_url:
            'https://github.com/meta-secret/nook/pull/1560#discussion-42',
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
          html_url:
            'https://github.com/meta-secret/nook/pull/1560#issuecomment-43',
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
    {
      event: 'workflow_job',
      source: PrStewardSource.WorkflowJob,
      body: {
        repository,
        workflow_job: {
          ...associated({ id: 47, head: HEAD }),
          run_id: 147,
          status: 'completed',
        },
      },
    },
  ])(
    'routes directly attributed $event metadata',
    ({ event, source, body }) => {
      const hint = assignedPrEvent({
        data: cloudEvent({ event, body }),
        pullRequest: 1560,
      });
      expect(hint).toMatchObject({
        schemaVersion: PrStewardRoutingVersion.V1,
        repository: PR_STEWARD_REPOSITORY,
        pullRequest: 1560,
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
    },
  );

  test.each(['check_run', 'check_suite', 'workflow_run', 'workflow_job'])(
    'suppresses %s with a missing or mismatched associated PR head',
    (event) => {
      for (const head of [STALE_HEAD, false] as const)
        expect(
          assignedPrEvent({
            data: cloudEvent({
              event,
              body: { repository, [event]: associated({ id: 50, head }) },
            }),
            pullRequest: 1560,
          }),
        ).toBe(false);
    },
  );

  test('keeps bounded review identifiers and location without body content', () => {
    const hint = assignedPrEvent({
      data: cloudEvent({
        event: 'pull_request_review_comment',
        body: {
          repository,
          pull_request: pullRequest,
          comment: {
            id: 42,
            pull_request_review_id: 41,
            commit_id: HEAD,
            path: 'src/file.ts',
            line: 17,
            html_url: 'https://github.com/meta-secret/nook/pull/1560#private',
            user: { login: 'reviewer' },
            body: 'private review text and raw log',
          },
        },
      }),
      pullRequest: 1560,
    });
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
    expect(JSON.stringify(hint)).not.toContain('private review text');
  });

  test('suppresses foreign, stale, status, ambiguous, and PR-less inputs', async () => {
    const rejected = [
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
    ];
    expect(await write(rejected)).toEqual([]);
  });

  test('bounds optional scalar fields and output', async () => {
    const lines = await write([
      cloudEvent({
        event: 'pull_request_review_comment',
        body: {
          repository,
          pull_request: pullRequest,
          comment: {
            id: 42,
            commit_id: HEAD,
            path: 'x'.repeat(241),
            line: -1,
            html_url:
              'https://user:secret@github.com/meta-secret/nook/pull/1560',
            user: { login: 'x'.repeat(65) },
            body: 'RAW_PAYLOAD_SECRET',
          },
        },
      }),
    ]);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as UntrustedYamlMap;
    expect(parsed).toMatchObject({
      path: false,
      line: false,
      url: false,
      author: false,
    });
    expect(lines[0]!.length).toBeLessThan(2_048);
    expect(lines[0]).not.toContain('RAW_PAYLOAD_SECRET');
  });

  test('suppresses malformed input and continues the live stream', async () => {
    const valid = cloudEvent({
      event: 'pull_request',
      body: { repository, pull_request: pullRequest },
    });
    const lines = await write([encoder.encode('RAW_MALFORMED_SECRET'), valid]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('RAW_MALFORMED_SECRET');
    expect(JSON.parse(lines[0]!).pullRequest).toBe(1560);
  });
});

test('documents the direct foreground process', () => {
  const lifecycle = readFileSync(
    join(
      import.meta.dir,
      '../../../.cortex/teams/pr-steward/workflows/pull-request-lifecycle.md',
    ),
    'utf8',
  );
  expect(lifecycle).toContain(
    'bun agentic-ai/loom/src/pr-steward-events.ts --pr <number>',
  );
});
