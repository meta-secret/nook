import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import { CommandFailureMessage } from './dev-command.ts';
import { GitHubJsonDocument } from './dev-github-json.ts';
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

const pullRequestListEntrySchema = z.object({
  number: z.number().int().positive(),
  headRefName: z.string(),
  baseRefName: z.string(),
  headRefOid: z.string(),
  baseRefOid: z.string(),
  url: z.string(),
  isDraft: z.boolean(),
});
const pullRequestListSchema = z.array(pullRequestListEntrySchema);
type PullRequestListEntry = z.infer<typeof pullRequestListEntrySchema>;

const repositoryReferenceSchema = z.object({ nameWithOwner: z.string() });
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
  baseRepository: repositoryReferenceSchema,
  reviewDecision: z.string().nullable(),
});
type PullRequestView = z.infer<typeof pullRequestViewSchema>;

const pullRequestStatusSchema = z.object({
  state: z.string(),
  mergedAt: z.string().nullable(),
});

const reviewThreadsSchema = z.object({
  data: z.object({
    repository: z.object({
      pullRequest: z.object({
        reviewThreads: z.object({
          nodes: z.array(
            z.object({ isResolved: z.boolean(), isOutdated: z.boolean() }),
          ),
        }),
      }),
    }),
  }),
});

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
  readonly pullRequest: DevelopmentPullRequest;
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
  }): Result<DevelopmentPullRequest, DevFailure> {
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
    const output = this.successful({
      args: [
        'pr',
        'view',
        String(request.pullRequest.number.value()),
        '--json',
        'reviewDecision',
      ],
      workingDirectory: request.workingDirectory,
    });
    if (output.isErr()) return err(output.error);
    const decoded = new GitHubJsonDocument(output.value.stdout).decode(
      z.object({ reviewDecision: z.string().nullable() }),
    );
    if (decoded.isErr()) return err(decoded.error);
    const reviewDecision = this.reviewDecision(decoded.value.reviewDecision);
    if (reviewDecision !== PullRequestReviewDecision.Approved) {
      return err({
        kind: DevFailureKind.Reviews,
        message: `The current dev-to-main review decision is ${reviewDecision}; promotion requires APPROVED`,
      });
    }

    const repository = this.repository(request.workingDirectory);
    if (repository.isErr()) return err(repository.error);
    const query = [
      'query($owner:String!,$repo:String!,$number:Int!){',
      'repository(owner:$owner,name:$repo){',
      'pullRequest(number:$number){',
      'reviewThreads(first:100){nodes{isResolved isOutdated}}',
      '}}}}',
    ].join('');
    const threads = this.successful({
      args: [
        'api',
        'graphql',
        '-f',
        `query=${query}`,
        '-F',
        `owner=${repository.value.owner}`,
        '-F',
        `repo=${repository.value.repository}`,
        '-F',
        `number=${request.pullRequest.number.value()}`,
      ],
      workingDirectory: request.workingDirectory,
    });
    if (threads.isErr()) return err(threads.error);
    const decodedThreads = new GitHubJsonDocument(threads.value.stdout).decode(
      reviewThreadsSchema,
    );
    if (decodedThreads.isErr()) return err(decodedThreads.error);
    if (
      decodedThreads.value.data.repository.pullRequest.reviewThreads.nodes.some(
        (thread) => !thread.isResolved,
      )
    ) {
      return err({
        kind: DevFailureKind.Reviews,
        message: 'The dev-to-main pull request has an unresolved review thread',
      });
    }
    return ok();
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
        'number,headRefName,baseRefName,headRefOid,baseRefOid,url,isDraft',
      ],
      workingDirectory,
    });
    if (output.isErr()) return err(output.error);
    const decoded = new GitHubJsonDocument(output.value.stdout).decode(
      pullRequestListSchema,
    );
    if (decoded.isErr()) return err(decoded.error);
    const selections: PullRequestSelection[] = [];
    for (const raw of decoded.value) {
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
        'number,headRefName,baseRefName,headRefOid,baseRefOid,url,isDraft,state,headRepository,baseRepository,reviewDecision',
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
    if (
      view.state !== PullRequestState.Open ||
      view.headRefName !== 'dev' ||
      view.baseRefName !== 'main' ||
      view.headRepository.nameWithOwner !== repository.value.value() ||
      view.baseRepository.nameWithOwner !== repository.value.value()
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

  private reviewDecision(input: string | null): PullRequestReviewDecision {
    switch (input) {
      case PullRequestReviewDecision.Approved:
        return PullRequestReviewDecision.Approved;
      case PullRequestReviewDecision.ChangesRequested:
        return PullRequestReviewDecision.ChangesRequested;
      case PullRequestReviewDecision.ReviewRequired:
        return PullRequestReviewDecision.ReviewRequired;
      case PullRequestReviewDecision.Empty:
      case null:
        return PullRequestReviewDecision.Empty;
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
