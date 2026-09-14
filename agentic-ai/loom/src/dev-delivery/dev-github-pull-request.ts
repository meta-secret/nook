import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import { CommandFailureMessage } from './dev-command.ts';
import { GitHubJsonDocument } from './dev-github-json.ts';
import type { JsonTransportNull } from '../lib/guards.ts';
import {
  CommandExecutable,
  type CommandOutput,
  type CommandRunner,
  CommitSha,
  DevFailureKind,
  type DevFailure,
  type DevelopmentPullRequest,
  PullRequestNumber,
  PullRequestReviewDecision,
  PullRequestState,
  type PullRequestStatus,
  RepositorySlug,
} from './dev-types.ts';

const repositoryReferenceSchema = z.object({ nameWithOwner: z.string() });

const pullRequestListEntrySchema = z.object({
  number: z.number().int().positive(),
  headRefName: z.string(),
  baseRefName: z.string(),
  headRefOid: z.string(),
  baseRefOid: z.string(),
  url: z.string(),
  isDraft: z.boolean(),
  headRepository: repositoryReferenceSchema,
  baseRepository: repositoryReferenceSchema,
  isCrossRepository: z.boolean(),
});
const pullRequestListSchema = z.array(pullRequestListEntrySchema);
type PullRequestListEntry = z.infer<typeof pullRequestListEntrySchema>;

const githubTransportNullSchema = z.custom<JsonTransportNull>(
  (value) => typeof value === 'object' && !value,
);
const githubNullableStringSchema = z
  .union([z.string(), githubTransportNullSchema])
  .transform((value) => (typeof value === 'string' ? value : ''));

const pullRequestViewSchema = z.object({
  number: z.number().int().positive(),
  headRefName: z.string(),
  baseRefName: z.string(),
  headRefOid: z.string(),
  baseRefOid: z.string(),
  url: z.string(),
  isDraft: z.boolean(),
  state: z.string(),
  headRepository: repositoryReferenceSchema,
  isCrossRepository: z.boolean(),
  reviewDecision: githubNullableStringSchema,
});
type PullRequestView = z.infer<typeof pullRequestViewSchema>;

const pullRequestStatusSchema = z.object({
  state: z.string(),
  mergedAt: githubNullableStringSchema,
});

const pageInfoSchema = z.object({
  hasNextPage: z.boolean(),
  endCursor: githubNullableStringSchema,
});

enum ReviewCommitBindingKind {
  Present = 'present',
  Missing = 'missing',
}

const reviewCommitBindingSchema = z
  .union([
    z.object({ oid: z.string() }).transform((value) => ({
      kind: ReviewCommitBindingKind.Present,
      oid: value.oid,
    })),
    githubTransportNullSchema.transform(() => ({
      kind: ReviewCommitBindingKind.Missing,
    })),
  ]);

const reviewRecordSchema = z.object({
  state: z.string(),
  body: githubNullableStringSchema,
  commit: reviewCommitBindingSchema,
});
type ReviewRecord = z.infer<typeof reviewRecordSchema>;

enum ReviewRecordDisposition {
  Ignore = 'ignore',
  Block = 'block',
}

const pullRequestReviewIdentitySchema = z.object({
  number: z.number().int().positive(),
  url: z.string(),
  headRefName: z.string(),
  baseRefName: z.string(),
  headRefOid: z.string(),
  baseRefOid: z.string(),
  headRepository: repositoryReferenceSchema,
  baseRepository: repositoryReferenceSchema,
});

const reviewPagesSchema = z.array(
  z.object({
    data: z.object({
      repository: z.object({
        nameWithOwner: z.string(),
        pullRequest: pullRequestReviewIdentitySchema.extend({
          reviews: z.object({
            pageInfo: pageInfoSchema,
            nodes: z.array(reviewRecordSchema),
          }),
        }),
      }),
    }),
  }).strict(),
);
type ReviewPage = z.infer<typeof reviewPagesSchema>[number];

const reviewThreadsPagesSchema = z.array(
  z.object({
    data: z.object({
      repository: z.object({
        nameWithOwner: z.string(),
        pullRequest: pullRequestReviewIdentitySchema.extend({
          reviewThreads: z.object({
            pageInfo: pageInfoSchema,
            nodes: z.array(
              z.object({ isResolved: z.boolean(), isOutdated: z.boolean() }),
            ),
          }),
        }),
      }),
    }),
  }).strict(),
);
type ReviewThreadsPage = z.infer<typeof reviewThreadsPagesSchema>[number];

interface GitHubInvocation {
  readonly args: readonly string[];
  readonly workingDirectory: string;
}

interface PullRequestSelection {
  readonly number: PullRequestNumber;
  readonly raw: PullRequestListEntry;
}

interface PullRequestReadRequest {
  readonly number: PullRequestNumber;
  readonly workingDirectory: string;
}

export enum DevelopmentPullRequestLookupKind {
  Found = 'found',
  Absent = 'absent',
}

export interface AdmittedDevelopmentPullRequest
  extends DevelopmentPullRequest {
  readonly repository: RepositorySlug;
}

export type DevelopmentPullRequestLookup =
  | {
      readonly kind: DevelopmentPullRequestLookupKind.Found;
      readonly pullRequest: AdmittedDevelopmentPullRequest;
    }
  | { readonly kind: DevelopmentPullRequestLookupKind.Absent };

export interface DevelopmentPullRequestMutationRequest {
  readonly expectedSha: CommitSha;
  readonly expectedBaseSha: CommitSha;
  readonly admitted: DevelopmentPullRequestLookup;
  readonly beforeMutation: () => Result<void, DevFailure>;
  readonly workingDirectory: string;
}

export interface PullRequestReviewEvidenceRequest {
  readonly pullRequest: AdmittedDevelopmentPullRequest;
  readonly workingDirectory: string;
}

/** Owns admission, mutation, status, and review evidence for the dev PR. */
export class DevelopmentPullRequestGateway {
  constructor(private readonly request: { readonly runner: CommandRunner }) {}

  ensureDevelopmentPullRequest(
    request: DevelopmentPullRequestMutationRequest,
  ): Result<DevelopmentPullRequest, DevFailure> {
    const title = 'Promote development to main';
    const body = [
      '## Summary',
      '',
      '- Promote the selected origin/dev snapshot to main through guarded fast-forward publication.',
      '',
      '## Agent task provenance',
      '',
      '- Harness: manually started Dev Manager',
      '- Task name: dev:pr-manager',
      '- Task ID: unavailable — local manager operation',
      '',
      '## Nook Workbench',
      '',
      '- Focused issue: unavailable — aggregate development snapshot',
      '- Immutable plan: unavailable — manager snapshot',
      '- Worklog: unavailable — aggregate snapshot has constituent Workbench records',
      '',
      '## Validation',
      '',
      `- Selected origin/dev SHA: \`${request.expectedSha.value()}\``,
      '- Full slow validation and final promotion are separate manager operations.',
    ].join('\n');
    const admission = this.revalidateDevelopmentPullRequest(request);
    if (admission.isErr()) return err(admission.error);
    const beforeMutation = request.beforeMutation();
    if (beforeMutation.isErr()) return err(beforeMutation.error);

    // The manager callback can perform slow local checks. Re-read the PR after
    // it returns and keep this admission immediately adjacent to the mutation.
    const finalAdmission = this.revalidateDevelopmentPullRequest(request);
    if (finalAdmission.isErr()) return err(finalAdmission.error);
    if (request.admitted.kind === DevelopmentPullRequestLookupKind.Found) {
      const existing = request.admitted.pullRequest;
      const edited = this.successful({
        args: [
          'pr',
          'edit',
          String(existing.number.value()),
          '--title',
          title,
          '--body',
          body,
        ],
        workingDirectory: request.workingDirectory,
      });
      if (edited.isErr()) return err(edited.error);
    } else {
      const created = this.successful({
        args: [
          'pr',
          'create',
          '--base',
          'main',
          '--head',
          'dev',
          '--title',
          title,
          '--body',
          body,
        ],
        workingDirectory: request.workingDirectory,
      });
      if (created.isErr()) return err(created.error);
    }
    const live = this.readDevelopmentPullRequest({
      workingDirectory: request.workingDirectory,
    });
    if (live.isErr()) return err(live.error);
    if (!live.value.headSha.equals(request.expectedSha)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The dev-to-main pull request head changed while it was being published',
      });
    }
    return ok(live.value);
  }

  readDevelopmentPullRequest(request: {
    readonly workingDirectory: string;
  }): Result<AdmittedDevelopmentPullRequest, DevFailure> {
    const selection = this.openPullRequests(request.workingDirectory);
    if (selection.isErr()) return err(selection.error);
    const selected = selection.value[0];
    if (selection.value.length > 1) {
      return err({
        kind: DevFailureKind.GitHub,
        message:
          'More than one open dev-to-main pull request exists; refusing to choose one',
      });
    }
    if (!selected) {
      return err({
        kind: DevFailureKind.GitHub,
        message: 'No open same-repository dev-to-main pull request exists',
      });
    }
    return this.readPullRequest({
      number: selected.number,
      workingDirectory: request.workingDirectory,
    });
  }

  findDevelopmentPullRequest(request: {
    readonly workingDirectory: string;
  }): Result<DevelopmentPullRequestLookup, DevFailure> {
    const selection = this.openPullRequests(request.workingDirectory);
    if (selection.isErr()) return err(selection.error);
    if (selection.value.length > 1) {
      return err({
        kind: DevFailureKind.GitHub,
        message:
          'More than one open dev-to-main pull request exists; refusing to choose one',
      });
    }
    const selected = selection.value.at(0);
    if (!selected) {
      return ok({ kind: DevelopmentPullRequestLookupKind.Absent });
    }
    const pullRequest = this.readPullRequest({
      number: selected.number,
      workingDirectory: request.workingDirectory,
    });
    if (pullRequest.isErr()) return err(pullRequest.error);
    return ok({
      kind: DevelopmentPullRequestLookupKind.Found,
      pullRequest: pullRequest.value,
    });
  }

  readPullRequestStatus(
    request: PullRequestReadRequest,
  ): Result<PullRequestStatus, DevFailure> {
    const output = this.successful({
      args: [
        'pr',
        'view',
        String(request.number.value()),
        '--json',
        'state,mergedAt',
      ],
      workingDirectory: request.workingDirectory,
    });
    if (output.isErr()) return err(output.error);
    const decoded = new GitHubJsonDocument(output.value.stdout).decode(
      pullRequestStatusSchema,
    );
    if (decoded.isErr()) return err(decoded.error);
    let state: PullRequestState;
    switch (decoded.value.state) {
      case PullRequestState.Open:
        state = PullRequestState.Open;
        break;
      case PullRequestState.Closed:
        state = PullRequestState.Closed;
        break;
      case PullRequestState.Merged:
        state = PullRequestState.Merged;
        break;
      default:
        return err({
          kind: DevFailureKind.GitHub,
          message: `GitHub returned an unsupported pull-request state: ${decoded.value.state}`,
        });
    }
    return ok({
      state,
      merged:
        state === PullRequestState.Merged &&
        typeof decoded.value.mergedAt === 'string',
    });
  }

  requireCleanReviews(
    request: PullRequestReviewEvidenceRequest,
  ): Result<void, DevFailure> {
    const admitted = this.readPullRequest({
      number: request.pullRequest.number,
      workingDirectory: request.workingDirectory,
    });
    if (admitted.isErr()) return err(admitted.error);
    if (!this.samePullRequest(admitted.value, request.pullRequest)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The admitted dev-to-main pull request changed identity, repository, or head before review collection',
      });
    }

    const reviews = this.readReviewPages({
      pullRequest: admitted.value,
      workingDirectory: request.workingDirectory,
    });
    if (reviews.isErr()) return err(reviews.error);
    let actionableReview = false;
    for (const page of reviews.value) {
      const reviewIdentity = this.reviewPageIdentity({
        page,
        pullRequest: admitted.value,
      });
      if (reviewIdentity.isErr()) return err(reviewIdentity.error);
      for (const review of page.data.repository.pullRequest.reviews.nodes) {
        const disposition = this.reviewRecordDisposition({
          review,
          pullRequest: admitted.value,
        });
        actionableReview ||=
          disposition === ReviewRecordDisposition.Block;
      }
    }

    const threads = this.readReviewThreadPages({
      pullRequest: admitted.value,
      workingDirectory: request.workingDirectory,
    });
    if (threads.isErr()) return err(threads.error);
    let unresolvedCurrentThread = false;
    for (const page of threads.value) {
      const threadIdentity = this.reviewPageIdentity({
        page,
        pullRequest: admitted.value,
      });
      if (threadIdentity.isErr()) return err(threadIdentity.error);
      unresolvedCurrentThread ||= page.data.repository.pullRequest.reviewThreads.nodes.some(
        (thread) => !thread.isResolved,
      );
    }

    const final = this.readPullRequest({
      number: request.pullRequest.number,
      workingDirectory: request.workingDirectory,
    });
    if (final.isErr()) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The admitted dev-to-main pull request became unavailable after review collection',
      });
    }
    if (!this.samePullRequest(final.value, request.pullRequest)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The dev-to-main pull request head, repository, or identity changed after review collection',
      });
    }
    if (actionableReview) {
      return err({
        kind: DevFailureKind.Reviews,
        message:
          'The dev-to-main pull request has unresolved actionable review feedback for its current head',
      });
    }
    if (unresolvedCurrentThread) {
      return err({
        kind: DevFailureKind.Reviews,
        message: 'The dev-to-main pull request has an unresolved review thread',
      });
    }
    return ok();
  }

  private readReviewPages(request: {
    readonly pullRequest: AdmittedDevelopmentPullRequest;
    readonly workingDirectory: string;
  }): Result<readonly ReviewPage[], DevFailure> {
    const query = [
      'query($owner:String!,$repo:String!,$number:Int!,$endCursor:String){',
      'repository(owner:$owner,name:$repo){',
      'nameWithOwner',
      'pullRequest(number:$number){',
      'number url headRefName baseRefName headRefOid baseRefOid',
      'headRepository{nameWithOwner} baseRepository{nameWithOwner}',
      'reviews(first:100,after:$endCursor){',
      'pageInfo{hasNextPage endCursor}',
      'nodes{state body commit{oid}}',
      '}}}}',
    ].join('');
    const output = this.successful({
      args: [
        'api',
        'graphql',
        '--paginate',
        '--slurp',
        '-f',
        `query=${query}`,
        '-F',
        `owner=${request.pullRequest.repository.owner}`,
        '-F',
        `repo=${request.pullRequest.repository.repository}`,
        '-F',
        `number=${request.pullRequest.number.value()}`,
      ],
      workingDirectory: request.workingDirectory,
    });
    if (output.isErr()) return err(output.error);
    const decoded = new GitHubJsonDocument(output.value.stdout).decode(
      reviewPagesSchema,
    );
    if (decoded.isErr()) return err(decoded.error);
    const pagination = this.requireCompletePagination({
      pageInfos: decoded.value.map(
        (page) => page.data.repository.pullRequest.reviews.pageInfo,
      ),
      evidence: 'submitted reviews',
    });
    if (pagination.isErr()) return err(pagination.error);
    return ok(decoded.value);
  }

  private readReviewThreadPages(request: {
    readonly pullRequest: AdmittedDevelopmentPullRequest;
    readonly workingDirectory: string;
  }): Result<readonly ReviewThreadsPage[], DevFailure> {
    const query = [
      'query($owner:String!,$repo:String!,$number:Int!,$endCursor:String){',
      'repository(owner:$owner,name:$repo){',
      'nameWithOwner',
      'pullRequest(number:$number){',
      'number url headRefName baseRefName headRefOid baseRefOid',
      'headRepository{nameWithOwner} baseRepository{nameWithOwner}',
      'reviewThreads(first:100,after:$endCursor){',
      'pageInfo{hasNextPage endCursor}',
      'nodes{isResolved isOutdated}',
      '}}}}',
    ].join('');
    const output = this.successful({
      args: [
        'api',
        'graphql',
        '--paginate',
        '--slurp',
        '-f',
        `query=${query}`,
        '-F',
        `owner=${request.pullRequest.repository.owner}`,
        '-F',
        `repo=${request.pullRequest.repository.repository}`,
        '-F',
        `number=${request.pullRequest.number.value()}`,
      ],
      workingDirectory: request.workingDirectory,
    });
    if (output.isErr()) return err(output.error);
    const decoded = new GitHubJsonDocument(output.value.stdout).decode(
      reviewThreadsPagesSchema,
    );
    if (decoded.isErr()) return err(decoded.error);
    const pagination = this.requireCompletePagination({
      pageInfos: decoded.value.map(
        (page) => page.data.repository.pullRequest.reviewThreads.pageInfo,
      ),
      evidence: 'review threads',
    });
    if (pagination.isErr()) return err(pagination.error);
    return ok(decoded.value);
  }

  private requireCompletePagination(request: {
    readonly pageInfos: readonly {
      readonly hasNextPage: boolean;
      readonly endCursor: string;
    }[];
    readonly evidence: string;
  }): Result<void, DevFailure> {
    if (request.pageInfos.length === 0) {
      return err({
        kind: DevFailureKind.Reviews,
        message: `GitHub returned no pagination pages for ${request.evidence}`,
      });
    }
    const seenCursors = new Set<string>();
    for (const [index, pageInfo] of request.pageInfos.entries()) {
      if (pageInfo.hasNextPage) {
        if (!pageInfo.endCursor || seenCursors.has(pageInfo.endCursor)) {
          return err({
            kind: DevFailureKind.Reviews,
            message: `GitHub returned incomplete or repeated pagination for ${request.evidence}`,
          });
        }
        seenCursors.add(pageInfo.endCursor);
        if (index === request.pageInfos.length - 1) {
          return err({
            kind: DevFailureKind.Reviews,
            message: `GitHub returned incomplete pagination for ${request.evidence}`,
          });
        }
        continue;
      }
      if (index !== request.pageInfos.length - 1) {
        return err({
          kind: DevFailureKind.Reviews,
          message: `GitHub returned pages after the terminal pagination page for ${request.evidence}`,
        });
      }
    }
    return ok();
  }

  private reviewPageIdentity(request: {
    readonly page: ReviewPage | ReviewThreadsPage;
    readonly pullRequest: AdmittedDevelopmentPullRequest;
  }): Result<void, DevFailure> {
    const repository = request.page.data.repository;
    const pullRequest = repository.pullRequest;
    if (
      repository.nameWithOwner !== request.pullRequest.repository.value() ||
      pullRequest.number !== request.pullRequest.number.value() ||
      pullRequest.url !== request.pullRequest.url ||
      pullRequest.headRefName !== 'dev' ||
      pullRequest.baseRefName !== 'main' ||
      pullRequest.headRefOid !== request.pullRequest.headSha.value() ||
      pullRequest.baseRefOid !== request.pullRequest.baseSha.value() ||
      pullRequest.headRepository.nameWithOwner !==
        request.pullRequest.repository.value() ||
      pullRequest.baseRepository.nameWithOwner !==
        request.pullRequest.repository.value()
    ) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'GitHub review evidence does not describe the admitted pull request, repository, or exact head',
      });
    }
    return ok();
  }

  private reviewRecordDisposition(request: {
    readonly review: ReviewRecord;
    readonly pullRequest: AdmittedDevelopmentPullRequest;
  }): ReviewRecordDisposition {
    const { review, pullRequest } = request;
    const substantive =
      typeof review.body === 'string' && review.body.trim().length > 0;
    const blockingState = review.state === 'CHANGES_REQUESTED';
    const knownNonActionableState =
      review.state === 'APPROVED' ||
      review.state === 'COMMENTED' ||
      review.state === 'DISMISSED' ||
      review.state === 'PENDING';
    const commit =
      'oid' in review.commit
        ? CommitSha.parse(review.commit.oid)
        : err<CommitSha, DevFailure>({
            kind: DevFailureKind.Reviews,
            message: 'GitHub review did not include a commit binding',
          });

    // A malformed, missing, or otherwise unprovable binding cannot establish
    // that a substantive, blocking, or unknown review is stale.
    if (commit.isErr()) {
      return substantive || blockingState || !knownNonActionableState
        ? ReviewRecordDisposition.Block
        : ReviewRecordDisposition.Ignore;
    }
    if (!commit.value.equals(pullRequest.headSha)) {
      return substantive || blockingState || !knownNonActionableState
        ? ReviewRecordDisposition.Block
        : ReviewRecordDisposition.Ignore;
    }

    // Once a review is proven current, unknown states are not safe to ignore.
    if (
      review.state !== 'APPROVED' &&
      review.state !== 'COMMENTED' &&
      review.state !== 'CHANGES_REQUESTED' &&
      review.state !== 'DISMISSED' &&
      review.state !== 'PENDING'
    ) {
      return ReviewRecordDisposition.Block;
    }
    return substantive || blockingState
      ? ReviewRecordDisposition.Block
      : ReviewRecordDisposition.Ignore;
  }

  private samePullRequest(
    ...[left, right]: [
      left: AdmittedDevelopmentPullRequest,
      right: AdmittedDevelopmentPullRequest,
    ]
  ): boolean {
    return (
      left.number.value() === right.number.value() &&
      left.url === right.url &&
      left.repository.value() === right.repository.value() &&
      left.headSha.equals(right.headSha) &&
      left.baseSha.equals(right.baseSha)
    );
  }

  private revalidateDevelopmentPullRequest(
    request: DevelopmentPullRequestMutationRequest,
  ): Result<void, DevFailure> {
    if (request.admitted.kind === DevelopmentPullRequestLookupKind.Absent) {
      const selection = this.openPullRequests(request.workingDirectory);
      if (selection.isErr()) return err(selection.error);
      if (selection.value.length > 0) {
        return err({
          kind: DevFailureKind.Race,
          message:
            'A dev-to-main pull request appeared after admission; refusing to select it for mutation',
        });
      }
      return ok();
    }

    const admitted = request.admitted.pullRequest;
    if (
      !admitted.headSha.equals(request.expectedSha) ||
      !admitted.baseSha.equals(request.expectedBaseSha)
    ) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The admitted dev-to-main pull request does not match the expected snapshots; refusing to mutate it',
      });
    }
    const live = this.readPullRequest({
      number: admitted.number,
      workingDirectory: request.workingDirectory,
    });
    if (live.isErr()) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The admitted dev-to-main pull request changed identity or repository before mutation; refusing to mutate it',
      });
    }
    if (
      live.value.number.value() !== admitted.number.value() ||
      live.value.url !== admitted.url ||
      live.value.repository.value() !== admitted.repository.value() ||
      !live.value.headSha.equals(request.expectedSha) ||
      !live.value.baseSha.equals(request.expectedBaseSha)
    ) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The admitted dev-to-main pull request changed identity, repository, or snapshots before mutation; refusing to mutate it',
      });
    }
    return ok();
  }

  private openPullRequests(
    workingDirectory: string,
  ): Result<readonly PullRequestSelection[], DevFailure> {
    const output = this.successful({
      args: [
        'pr',
        'list',
        '--state',
        'open',
        '--head',
        'dev',
        '--base',
        'main',
        '--limit',
        '10',
        '--json',
        'number,headRefName,baseRefName,headRefOid,baseRefOid,url,isDraft,headRepository,baseRepository,isCrossRepository',
      ],
      workingDirectory,
    });
    if (output.isErr()) return err(output.error);
    const decoded = new GitHubJsonDocument(output.value.stdout).decode(
      pullRequestListSchema,
    );
    if (decoded.isErr()) return err(decoded.error);
    const repository = this.repository(workingDirectory);
    if (repository.isErr()) return err(repository.error);
    const selections: PullRequestSelection[] = [];
    for (const raw of decoded.value) {
      if (
        raw.isCrossRepository ||
        raw.headRepository.nameWithOwner !== repository.value.value() ||
        raw.baseRepository.nameWithOwner !== repository.value.value()
      )
        continue;
      const number = PullRequestNumber.parse(raw.number);
      if (number.isErr()) return err(number.error);
      selections.push({ number: number.value, raw });
    }
    return ok(selections);
  }

  private readPullRequest(
    request: PullRequestReadRequest,
  ): Result<AdmittedDevelopmentPullRequest, DevFailure> {
    const output = this.successful({
      args: [
        'pr',
        'view',
        String(request.number.value()),
        '--json',
        'number,headRefName,baseRefName,headRefOid,baseRefOid,url,isDraft,state,headRepository,isCrossRepository,reviewDecision',
      ],
      workingDirectory: request.workingDirectory,
    });
    if (output.isErr()) return err(output.error);
    const decoded = new GitHubJsonDocument(output.value.stdout).decode(
      pullRequestViewSchema,
    );
    if (decoded.isErr()) return err(decoded.error);
    return this.admitDevelopmentPullRequest({
      view: decoded.value,
      workingDirectory: request.workingDirectory,
    });
  }

  private admitDevelopmentPullRequest(request: {
    readonly view: PullRequestView;
    readonly workingDirectory: string;
  }): Result<AdmittedDevelopmentPullRequest, DevFailure> {
    const { view } = request;
    const repository = this.repository(request.workingDirectory);
    if (repository.isErr()) return err(repository.error);
    // `gh pr view` is scoped to the current repository, so the supported
    // `isCrossRepository` field proves that the base repository is this repo.
    if (
      view.state !== PullRequestState.Open ||
      view.headRefName !== 'dev' ||
      view.baseRefName !== 'main' ||
      view.isCrossRepository ||
      view.headRepository.nameWithOwner !== repository.value.value()
    ) {
      return err({
        kind: DevFailureKind.GitHub,
        message:
          'The live pull request is not a same-repository open dev-to-main pull request',
      });
    }
    const headSha = CommitSha.parse(view.headRefOid);
    if (headSha.isErr()) return err(headSha.error);
    const baseSha = CommitSha.parse(view.baseRefOid);
    if (baseSha.isErr()) return err(baseSha.error);
    const number = PullRequestNumber.parse(view.number);
    if (number.isErr()) return err(number.error);
    return ok({
      number: number.value,
      headSha: headSha.value,
      baseSha: baseSha.value,
      url: view.url,
      repository: repository.value,
      isDraft: view.isDraft,
      reviewDecision: this.reviewDecision(view.reviewDecision),
    });
  }

  private repository(
    workingDirectory: string,
  ): Result<RepositorySlug, DevFailure> {
    const output = this.successful({
      args: [
        'repo',
        'view',
        '--json',
        'nameWithOwner',
        '--jq',
        '.nameWithOwner',
      ],
      workingDirectory,
    });
    if (output.isErr()) return err(output.error);
    return RepositorySlug.parse(output.value.stdout.trim());
  }

  private reviewDecision(input: string): PullRequestReviewDecision {
    switch (input) {
      case PullRequestReviewDecision.Approved:
        return PullRequestReviewDecision.Approved;
      case PullRequestReviewDecision.ChangesRequested:
        return PullRequestReviewDecision.ChangesRequested;
      case PullRequestReviewDecision.ReviewRequired:
        return PullRequestReviewDecision.ReviewRequired;
      case PullRequestReviewDecision.Empty:
      default:
        return PullRequestReviewDecision.Unknown;
    }
  }

  private execute(
    request: GitHubInvocation,
  ): Result<CommandOutput, DevFailure> {
    return this.request.runner.run({
      executable: CommandExecutable.GitHub,
      args: request.args,
      workingDirectory: request.workingDirectory,
    });
  }

  private successful(
    request: GitHubInvocation,
  ): Result<CommandOutput, DevFailure> {
    const output = this.execute(request);
    if (output.isErr()) return err(output.error);
    if (output.value.exitCode !== 0) {
      return err({
        kind: DevFailureKind.GitHub,
        message: `GitHub command failed: ${new CommandFailureMessage(output.value).text()}`,
      });
    }
    return ok(output.value);
  }
}
