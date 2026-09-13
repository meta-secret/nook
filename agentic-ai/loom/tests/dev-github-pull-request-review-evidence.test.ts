import { expect, test } from 'bun:test';
import { ok, type Result } from 'neverthrow';

import {
  DevelopmentPullRequestGateway,
  type AdmittedDevelopmentPullRequest,
} from '../src/dev-delivery/dev-github-pull-request.ts';
import {
  CommandExecutable,
  type CommandOutput,
  type CommandRequest,
  type CommandRunner,
  CommitSha,
  DevFailureKind,
  type DevFailure,
  PullRequestNumber,
  PullRequestReviewDecision,
  RepositorySlug,
} from '../src/dev-delivery/dev-types.ts';

const HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const STALE = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const BASE = '1111111111111111111111111111111111111111';
const REPOSITORY = 'nook/example';
const REVIEWED_AT = '2026-09-13T17:00:00Z';

interface ReviewFixture {
  readonly state?: string;
  readonly body?: string | null;
  readonly submittedAt?: string | null;
  readonly commit?: string | null;
}

interface ReviewPageFixture {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
  readonly reviews: readonly ReviewFixture[];
}

interface PageInfoResponse {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

interface PullRequestIdentityResponse {
  readonly number: number;
  readonly headRefName: string;
  readonly baseRefName: string;
  readonly headRefOid: string;
  readonly baseRefOid: string;
  readonly url: string;
  readonly isDraft: boolean;
  readonly headRepository: { readonly nameWithOwner: string };
  readonly baseRepository: { readonly nameWithOwner: string };
}

interface ReviewPageResponse {
  readonly data: {
    readonly repository: {
      readonly nameWithOwner: string;
      readonly pullRequest: PullRequestIdentityResponse & {
        readonly reviews: {
          readonly pageInfo: PageInfoResponse;
          readonly nodes: readonly {
            readonly state: string;
            readonly body: string | null;
            readonly submittedAt: string | null;
            readonly commit: { readonly oid: string } | null;
          }[];
        };
      };
    };
  };
}

interface ThreadPageResponse {
  readonly data: {
    readonly repository: {
      readonly nameWithOwner: string;
      readonly pullRequest: PullRequestIdentityResponse & {
        readonly reviewThreads: {
          readonly pageInfo: PageInfoResponse;
          readonly nodes: readonly {
            readonly isResolved: boolean;
            readonly isOutdated: boolean;
          }[];
        };
      };
    };
  };
}

interface PullRequestViewResponse extends PullRequestIdentityResponse {
  readonly state: string;
  readonly reviewDecision: string;
}

interface ReviewScenario {
  readonly reviewPages: readonly ReviewPageFixture[];
  readonly threadPages?: readonly {
    readonly hasNextPage: boolean;
    readonly endCursor: string | null;
    readonly unresolved?: boolean;
  }[];
  readonly finalHead?: string;
}

/** Supplies bounded GraphQL pages and PR snapshots without contacting GitHub. */
class ReviewEvidenceRunner implements CommandRunner {
  readonly requests: CommandRequest[] = [];
  private pullRequestViews = 0;

  constructor(private readonly scenario: ReviewScenario) {}

  run(request: CommandRequest): Result<CommandOutput, DevFailure> {
    this.requests.push(request);
    if (request.executable === CommandExecutable.GitHub) {
      return ok(this.github(request));
    }
    return ok({ exitCode: 0, stdout: '', stderr: '' });
  }

  private github(request: CommandRequest): CommandOutput {
    const args = request.args;
    if (args[0] === 'repo' && args[1] === 'view') {
      return this.output(`${REPOSITORY}\n`);
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      this.pullRequestViews += 1;
      const head =
        this.pullRequestViews > 1
          ? (this.scenario.finalHead ?? HEAD)
          : HEAD;
      return this.output(JSON.stringify(this.pullRequestView(head)));
    }
    if (args[0] === 'api' && args[1] === 'graphql') {
      return args.some((arg) => arg.includes('reviews(first:100'))
        ? this.output(JSON.stringify(this.reviewPages()))
        : this.output(JSON.stringify(this.threadPages()));
    }
    return this.output();
  }

  private reviewPages(): readonly ReviewPageResponse[] {
    return this.scenario.reviewPages.map((page) => ({
      data: {
        repository: {
          nameWithOwner: REPOSITORY,
          pullRequest: {
            ...this.pullRequestIdentity(HEAD),
            reviews: {
              pageInfo: {
                hasNextPage: page.hasNextPage,
                endCursor: page.endCursor,
              },
              nodes: page.reviews.map((review) => ({
                state: review.state ?? 'APPROVED',
                body: review.body === undefined ? '' : review.body,
                submittedAt:
                  review.submittedAt === undefined
                    ? REVIEWED_AT
                    : review.submittedAt,
                commit:
                  review.commit === undefined
                    ? { oid: HEAD }
                    : review.commit === null
                      ? null
                      : { oid: review.commit },
              })),
            },
          },
        },
      },
    }));
  }

  private threadPages(): readonly ThreadPageResponse[] {
    const pages = this.scenario.threadPages ?? [
      { hasNextPage: false, endCursor: null },
    ];
    return pages.map((page) => ({
      data: {
        repository: {
          nameWithOwner: REPOSITORY,
          pullRequest: {
            ...this.pullRequestIdentity(HEAD),
            reviewThreads: {
              pageInfo: {
                hasNextPage: page.hasNextPage,
                endCursor: page.endCursor,
              },
              nodes: [
                {
                  isResolved: !page.unresolved,
                  isOutdated: false,
                },
              ],
            },
          },
        },
      },
    }));
  }

  private pullRequestView(headSha: string): PullRequestViewResponse {
    return {
      number: 42,
      ...this.pullRequestIdentity(headSha),
      state: 'OPEN',
      reviewDecision: 'APPROVED',
    };
  }

  private pullRequestIdentity(headSha: string): PullRequestIdentityResponse {
    return {
      number: 42,
      headRefName: 'dev',
      baseRefName: 'main',
      headRefOid: headSha,
      baseRefOid: BASE,
      url: 'https://github.example/pr/42',
      isDraft: false,
      headRepository: { nameWithOwner: REPOSITORY },
      baseRepository: { nameWithOwner: REPOSITORY },
    };
  }

  private output(stdout = ''): CommandOutput {
    return { exitCode: 0, stdout, stderr: '' };
  }
}

function admitted(): AdmittedDevelopmentPullRequest {
  const number = PullRequestNumber.parse(42);
  const headSha = CommitSha.parse(HEAD);
  const baseSha = CommitSha.parse(BASE);
  const repository = RepositorySlug.parse(REPOSITORY);
  if (
    number.isErr() ||
    headSha.isErr() ||
    baseSha.isErr() ||
    repository.isErr()
  ) {
    throw new Error('review evidence fixture identity is invalid');
  }
  return {
    number: number.value,
    headSha: headSha.value,
    baseSha: baseSha.value,
    url: 'https://github.example/pr/42',
    isDraft: false,
    reviewDecision: PullRequestReviewDecision.Approved,
    repository: repository.value,
  };
}

function reviewPage(
  request: {
    readonly reviews: readonly ReviewFixture[];
    readonly pagination?: Partial<ReviewPageFixture>;
  },
): ReviewPageFixture {
  return {
    hasNextPage: request.pagination?.hasNextPage ?? false,
    endCursor: request.pagination?.endCursor ?? null,
    reviews: request.reviews,
  };
}

function reviewResult(scenario: ReviewScenario) {
  const runner = new ReviewEvidenceRunner(scenario);
  const result = new DevelopmentPullRequestGateway({ runner }).requireCleanReviews(
    {
      pullRequest: admitted(),
      workingDirectory: '/tmp/review-evidence-fixture',
    },
  );
  return { result, runner };
}

test('accepts complete multi-page current-head review and thread evidence', () => {
  const { result, runner } = reviewResult({
    reviewPages: [
      reviewPage({
        reviews: [{ state: 'COMMENTED', body: '' }],
        pagination: { hasNextPage: true, endCursor: 'cursor-1' },
      }),
      reviewPage({ reviews: [{ state: 'APPROVED', body: '' }] }),
    ],
  });

  expect(result.isOk()).toBe(true);
  expect(
    runner.requests.filter((request) => request.args[0] === 'api').length,
  ).toBe(2);
});

test('rejects an incomplete review pagination sequence', () => {
  const { result } = reviewResult({
    reviewPages: [
      reviewPage({
        reviews: [{ state: 'APPROVED', body: '' }],
        pagination: { hasNextPage: true, endCursor: 'cursor-1' },
      }),
    ],
  });

  expect(result.isErr()).toBe(true);
  if (result.isErr()) expect(result.error.kind).toBe(DevFailureKind.Reviews);
});

test('does not let an approval mask a substantive current or stale comment', () => {
  for (const comment of [
    { state: 'COMMENTED', body: 'Please address this.' },
    { state: 'COMMENTED', body: 'Please address this.', commit: STALE },
  ]) {
    const { result } = reviewResult({
      reviewPages: [
        reviewPage({ reviews: [{ state: 'APPROVED', body: '' }, comment] }),
      ],
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe(DevFailureKind.Reviews);
    }
  }
});

test('rejects unknown, dismissed, and pending review states', () => {
  for (const state of ['UNRECOGNIZED', 'DISMISSED', 'PENDING']) {
    const { result } = reviewResult({
      reviewPages: [reviewPage({ reviews: [{ state, body: '' }] })],
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe(DevFailureKind.Reviews);
    }
  }
});

test('rejects a noncanonical submittedAt timestamp', () => {
  const { result } = reviewResult({
    reviewPages: [
      reviewPage({
        reviews: [
          { state: 'APPROVED', body: '', submittedAt: '2026-09-13' },
        ],
      }),
    ],
  });

  expect(result.isErr()).toBe(true);
  if (result.isErr()) expect(result.error.kind).toBe(DevFailureKind.Reviews);
});

test('rejects stale-head approval and unresolved review threads', () => {
  const stale = reviewResult({
    reviewPages: [
      reviewPage({
        reviews: [{ state: 'APPROVED', body: '', commit: STALE }],
      }),
    ],
  });
  expect(stale.result.isErr()).toBe(true);
  if (stale.result.isErr()) {
    expect(stale.result.error.kind).toBe(DevFailureKind.Race);
  }

  const unresolved = reviewResult({
    reviewPages: [reviewPage({ reviews: [{ state: 'APPROVED', body: '' }] })],
    threadPages: [
      { hasNextPage: false, endCursor: null, unresolved: true },
    ],
  });
  expect(unresolved.result.isErr()).toBe(true);
  if (unresolved.result.isErr()) {
    expect(unresolved.result.error.kind).toBe(DevFailureKind.Reviews);
  }
});

test('reports a pull-request head race after collecting review evidence', () => {
  const { result } = reviewResult({
    reviewPages: [reviewPage({ reviews: [{ state: 'APPROVED', body: '' }] })],
    finalHead: STALE,
  });

  expect(result.isErr()).toBe(true);
  if (result.isErr()) expect(result.error.kind).toBe(DevFailureKind.Race);
});
