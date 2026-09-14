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

interface ReviewFixture {
  readonly state?: string;
  readonly body?: string | null;
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
  readonly isCrossRepository: boolean;
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
    readonly outdated?: boolean;
  }[];
  readonly finalHead?: string;
  readonly reviewDecision?: string;
}

/** Supplies bounded GraphQL pages and PR snapshots without contacting GitHub. */
class ReviewEvidenceRunner implements CommandRunner {
  readonly requests: CommandRequest[] = [];
  private pullRequestViews = 0;

  constructor(private readonly scenario: ReviewScenario) {}

  static admitted(): AdmittedDevelopmentPullRequest {
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

  static reviewPage(request: {
    readonly reviews: readonly ReviewFixture[];
    readonly pagination?: Partial<ReviewPageFixture>;
  }): ReviewPageFixture {
    return {
      hasNextPage: request.pagination?.hasNextPage ?? false,
      endCursor: request.pagination?.endCursor ?? null,
      reviews: request.reviews,
    };
  }

  reviewResult() {
    const result = new DevelopmentPullRequestGateway({ runner: this }).requireCleanReviews(
      {
        pullRequest: ReviewEvidenceRunner.admitted(),
        workingDirectory: '/tmp/review-evidence-fixture',
      },
    );
    return { result, runner: this };
  }

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
                  isOutdated: page.outdated ?? false,
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
      ...this.pullRequestIdentity(headSha),
      state: 'OPEN',
      reviewDecision: this.scenario.reviewDecision ?? 'APPROVED',
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
      isCrossRepository: false,
    };
  }

  private output(stdout = ''): CommandOutput {
    return { exitCode: 0, stdout, stderr: '' };
  }
}

test('accepts complete multi-page current-head review and thread evidence', () => {
  const { result, runner } = new ReviewEvidenceRunner({
    reviewPages: [
      ReviewEvidenceRunner.reviewPage({
        reviews: [{ state: 'COMMENTED', body: '' }],
        pagination: { hasNextPage: true, endCursor: 'cursor-1' },
      }),
      ReviewEvidenceRunner.reviewPage({ reviews: [{ state: 'APPROVED', body: '' }] }),
    ],
  }).reviewResult();

  expect(result.isOk()).toBe(true);
  expect(
    runner.requests.filter((request) => request.args[0] === 'api').length,
  ).toBe(2);
});

test('rejects an incomplete review pagination sequence', () => {
  const { result } = new ReviewEvidenceRunner({
    reviewPages: [
      ReviewEvidenceRunner.reviewPage({
        reviews: [{ state: 'APPROVED', body: '' }],
        pagination: { hasNextPage: true, endCursor: 'cursor-1' },
      }),
    ],
  }).reviewResult();

  expect(result.isErr()).toBe(true);
  if (result.isErr()) expect(result.error.kind).toBe(DevFailureKind.Reviews);
});

test('blocks current-head actionable feedback but ignores stale feedback', () => {
  const current = new ReviewEvidenceRunner({
    reviewPages: [
      ReviewEvidenceRunner.reviewPage({
        reviews: [
          { state: 'APPROVED', body: '' },
          { state: 'COMMENTED', body: 'Please address this.' },
        ],
      }),
    ],
  }).reviewResult();
  expect(current.result.isErr()).toBe(true);
  if (current.result.isErr()) {
    expect(current.result.error.kind).toBe(DevFailureKind.Reviews);
  }

  const stale = new ReviewEvidenceRunner({
    reviewPages: [
      ReviewEvidenceRunner.reviewPage({
        reviews: [
          { state: 'APPROVED', body: '' },
          { state: 'COMMENTED', body: 'Please address this.', commit: STALE },
        ],
      }),
    ],
  }).reviewResult();
  expect(stale.result.isOk()).toBe(true);
});

test('blocks an unknown current-head review state', () => {
  const { result } = new ReviewEvidenceRunner({
    reviewPages: [
      ReviewEvidenceRunner.reviewPage({
        reviews: [{ state: 'UNRECOGNIZED', body: '' }],
      }),
    ],
  }).reviewResult();

  expect(result.isErr()).toBe(true);
  if (result.isErr()) expect(result.error.kind).toBe(DevFailureKind.Reviews);
});

test('fails closed for unprovable unknown review bindings unless stale', () => {
  for (const body of ['', null]) {
    for (const commit of [null, 'not-a-sha']) {
      const { result } = new ReviewEvidenceRunner({
        reviewPages: [
          ReviewEvidenceRunner.reviewPage({
            reviews: [{ state: 'UNRECOGNIZED', body, commit }],
          }),
        ],
      }).reviewResult();

      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error.kind).toBe(DevFailureKind.Reviews);
    }
  }

  const stale = new ReviewEvidenceRunner({
    reviewPages: [
      ReviewEvidenceRunner.reviewPage({
        reviews: [{ state: 'UNRECOGNIZED', body: null, commit: STALE }],
      }),
    ],
  }).reviewResult();
  expect(stale.result.isOk()).toBe(true);
});

test('ignores known non-actionable states without substantive feedback', () => {
  for (const state of ['DISMISSED', 'PENDING']) {
    const { result } = new ReviewEvidenceRunner({
      reviewPages: [
        ReviewEvidenceRunner.reviewPage({ reviews: [{ state, body: '' }] }),
      ],
    }).reviewResult();
    expect(result.isOk()).toBe(true);
  }
});

test('does not require an aggregate approved review when feedback is clean', () => {
  const { result } = new ReviewEvidenceRunner({
    reviewDecision: 'REVIEW_REQUIRED',
    reviewPages: [
      ReviewEvidenceRunner.reviewPage({
        reviews: [{ state: 'APPROVED', body: '' }],
      }),
    ],
  }).reviewResult();

  expect(result.isOk()).toBe(true);
});

test('ignores stale-head reviews but blocks unresolved current threads', () => {
  const stale = new ReviewEvidenceRunner({
    reviewPages: [
      ReviewEvidenceRunner.reviewPage({
        reviews: [{ state: 'APPROVED', body: '', commit: STALE }],
      }),
    ],
  }).reviewResult();
  expect(stale.result.isOk()).toBe(true);

  const unresolved = new ReviewEvidenceRunner({
    reviewPages: [
      ReviewEvidenceRunner.reviewPage({ reviews: [{ state: 'APPROVED', body: '' }] }),
    ],
    threadPages: [
      { hasNextPage: false, endCursor: null, unresolved: true },
    ],
  }).reviewResult();
  expect(unresolved.result.isErr()).toBe(true);
  if (unresolved.result.isErr()) {
    expect(unresolved.result.error.kind).toBe(DevFailureKind.Reviews);
  }

  const outdated = new ReviewEvidenceRunner({
    reviewPages: [
      ReviewEvidenceRunner.reviewPage({
        reviews: [{ state: 'APPROVED', body: '' }],
      }),
    ],
    threadPages: [
      { hasNextPage: false, endCursor: null, unresolved: true, outdated: true },
    ],
  }).reviewResult();
  expect(outdated.result.isOk()).toBe(true);
});

test('reports a pull-request head race after collecting review evidence', () => {
  const { result } = new ReviewEvidenceRunner({
    reviewPages: [
      ReviewEvidenceRunner.reviewPage({ reviews: [{ state: 'APPROVED', body: '' }] }),
    ],
    finalHead: STALE,
  }).reviewResult();

  expect(result.isErr()).toBe(true);
  if (result.isErr()) expect(result.error.kind).toBe(DevFailureKind.Race);
});

test('fails closed for unprovable bindings on substantive or blocking reviews', () => {
  for (const review of [
    { state: 'COMMENTED', body: 'Please address this.', commit: null },
    { state: 'COMMENTED', body: 'Please address this.', commit: 'not-a-sha' },
    { state: 'CHANGES_REQUESTED', body: '', commit: null },
  ]) {
    const { result } = new ReviewEvidenceRunner({
      reviewPages: [ReviewEvidenceRunner.reviewPage({ reviews: [review] })],
    }).reviewResult();

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe(DevFailureKind.Reviews);
  }
});

test('blocks current-head substantive feedback regardless of review state', () => {
  for (const state of ['APPROVED', 'COMMENTED']) {
    const { result } = new ReviewEvidenceRunner({
      reviewPages: [
        ReviewEvidenceRunner.reviewPage({
          reviews: [{ state, body: 'Please address this.' }],
        }),
      ],
    }).reviewResult();

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe(DevFailureKind.Reviews);
  }
});

test('blocks current-head CHANGES_REQUESTED with an empty body', () => {
  const { result } = new ReviewEvidenceRunner({
    reviewPages: [
      ReviewEvidenceRunner.reviewPage({
        reviews: [{ state: 'CHANGES_REQUESTED', body: '' }],
      }),
    ],
  }).reviewResult();

  expect(result.isErr()).toBe(true);
  if (result.isErr()) expect(result.error.kind).toBe(DevFailureKind.Reviews);
});

test('ignores an empty non-actionable COMMENTED review', () => {
  const { result } = new ReviewEvidenceRunner({
    reviewPages: [
      ReviewEvidenceRunner.reviewPage({
        reviews: [{ state: 'COMMENTED', body: '' }],
      }),
    ],
  }).reviewResult();

  expect(result.isOk()).toBe(true);
});
