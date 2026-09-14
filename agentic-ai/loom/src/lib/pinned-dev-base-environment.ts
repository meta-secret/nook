import { err, ok, type Result } from 'neverthrow';

import type { GitCommit } from '../agent-workflow/domain.ts';

import {
  PinnedDevBaseEvidenceContract,
  type PinnedDevBaseEvidence,
} from './base-evidence.ts';

import {
  RepositoryCommand,
  RepositoryCommandExecutable,
  RepositoryGitSecurityPolicy,
} from './run.ts';

const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/u;

/** Resolves and validates Prime-issued bootstrap evidence for local comparisons. */
export class PinnedDevBaseEnvironment {
  private constructor(
    private readonly request: PinnedDevBaseEnvironmentRequest,
  ) {}

  static resolve(
    args: PinnedDevBaseEnvironmentRequest,
  ): Result<PinnedDevBaseEvidence, PinnedDevBaseEnvironmentFailure> {
    return new PinnedDevBaseEnvironment(args).execute();
  }

  private execute(): Result<
    PinnedDevBaseEvidence,
    PinnedDevBaseEnvironmentFailure
  > {
    const { environment, repoRoot } = this.request;
    const originMainShaValue = environment.ORIGIN_MAIN_SHA;
    const originMainSha =
      typeof originMainShaValue === 'string' ? originMainShaValue.trim() : '';
    const pinnedLocalDevShaValue = environment.PINNED_LOCAL_DEV_SHA;
    const pinnedLocalDevSha =
      typeof pinnedLocalDevShaValue === 'string'
        ? pinnedLocalDevShaValue.trim()
        : '';
    if (!FULL_COMMIT_SHA.test(originMainSha)) {
      return err({
        message:
          'ORIGIN_MAIN_SHA must be an exact lowercase 40-hex commit SHA.',
      });
    }
    if (!FULL_COMMIT_SHA.test(pinnedLocalDevSha)) {
      return err({
        message:
          'PINNED_LOCAL_DEV_SHA must be an exact lowercase 40-hex commit SHA.',
      });
    }
    const evidence: PinnedDevBaseEvidence = {
      originMainSha,
      pinnedLocalDevSha,
    };
    const currentOriginMain = this.gitSha({
      ref: 'refs/remotes/origin/main^{commit}',
      repoRoot,
    });
    if (currentOriginMain.isErr()) return err(currentOriginMain.error);
    if (currentOriginMain.value !== evidence.originMainSha) {
      return err({
        message:
          'Recorded ORIGIN_MAIN_SHA is stale; fetched origin/main changed after bootstrap.',
      });
    }

    const head = this.gitSha({ ref: 'HEAD^{commit}', repoRoot });
    if (head.isErr()) return err(head.error);
    try {
      PinnedDevBaseEvidenceContract.assertAncestry({
        ...evidence,
        sourceCommit: head.value,
        workingDirectory: repoRoot,
      });
    } catch (cause) {
      return err({
        message:
          cause instanceof Error
            ? cause.message
            : 'Pinned local-dev bootstrap ancestry evidence is invalid.',
      });
    }
    return ok(evidence);
  }

  private gitSha(
    args: GitShaRequest,
  ): Result<GitCommit, PinnedDevBaseEnvironmentFailure> {
    const result = new RepositoryCommand({
      command: RepositoryCommandExecutable.Git,
      args: ['rev-parse', '--verify', args.ref],
      gitSecurity: RepositoryGitSecurityPolicy.ImmutableObjects,
      rootDirectory: args.repoRoot,
      workingDirectory: args.repoRoot,
    }).execute();
    if (result.isErr() || result.value.exitCode !== 0) {
      return err({
        message: `Unable to resolve ${args.ref} for pinned local-dev bootstrap evidence.`,
      });
    }
    const sha = result.value.stdout.trim();
    if (!FULL_COMMIT_SHA.test(sha)) {
      return err({
        message: `${args.ref} did not resolve to an exact lowercase 40-hex commit SHA.`,
      });
    }
    return ok(sha);
  }
}

export type PinnedDevBaseEnvironmentRequest = Readonly<{
  readonly environment: NodeJS.ProcessEnv;
  readonly repoRoot: string;
}>;

export type PinnedDevBaseEnvironmentFailure = Readonly<{
  readonly message: string;
}>;

type GitShaRequest = Readonly<{
  readonly ref: string;
  readonly repoRoot: string;
}>;
