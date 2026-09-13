import type { GitCommit } from '../agent-workflow/domain.ts';
import {
  RepositoryCommand,
  RepositoryCommandExecutable,
  RepositoryGitSecurityPolicy,
} from './run.ts';

/** The fetched main reference is evidence; the pinned local-dev commit is the feature base. */
export type PinnedDevBaseEvidence = Readonly<{
  originMainSha: GitCommit;
  pinnedLocalDevSha: GitCommit;
}>;

export type PinnedDevBaseAncestryRequest = PinnedDevBaseEvidence &
  Readonly<{
    workingDirectory: string;
    sourceCommit?: GitCommit;
  }>;

/** Owns fail-closed validation of the two distinct bootstrap commits. */
export class PinnedDevBaseEvidenceContract {
  private constructor() {}

  static assertShape(evidence: PinnedDevBaseEvidence): void {
    const keys = Object.keys(evidence);
    if (
      keys.length !== 2 ||
      !keys.includes('originMainSha') ||
      !keys.includes('pinnedLocalDevSha')
    ) {
      throw new Error(
        'Bootstrap evidence must declare originMainSha and pinnedLocalDevSha exactly once.',
      );
    }
    for (const [name, sha] of Object.entries(evidence)) {
      if (!/^[0-9a-f]{40}$/u.test(sha)) {
        throw new Error(
          `${name} must be an exact lowercase 40-hex commit SHA.`,
        );
      }
    }
  }

  static assertAncestry(request: PinnedDevBaseAncestryRequest): void {
    PinnedDevBaseEvidenceContract.assertShape({
      originMainSha: request.originMainSha,
      pinnedLocalDevSha: request.pinnedLocalDevSha,
    });
    if (request.sourceCommit !== undefined) {
      PinnedDevBaseEvidenceContract.assertCommitShape(
        'sourceCommit',
        request.sourceCommit,
      );
    }
    PinnedDevBaseEvidenceContract.assertOriginMainRef(request);
    PinnedDevBaseEvidenceContract.assertAncestor({
      ancestor: request.originMainSha,
      descendant: request.pinnedLocalDevSha,
      workingDirectory: request.workingDirectory,
      message:
        'pinnedLocalDevSha must include the fetched origin/main commit as an ancestor.',
    });
    if (request.sourceCommit !== undefined) {
      PinnedDevBaseEvidenceContract.assertAncestor({
        ancestor: request.pinnedLocalDevSha,
        descendant: request.sourceCommit,
        workingDirectory: request.workingDirectory,
        message:
          'sourceCommit must be descended from the pinned local-dev base.',
      });
    }
  }

  private static assertCommitShape(name: string, sha: GitCommit): void {
    if (!/^[0-9a-f]{40}$/u.test(sha)) {
      throw new Error(`${name} must be an exact lowercase 40-hex commit SHA.`);
    }
  }

  private static assertAncestor(request: AncestorCheckRequest): void {
    const result = new RepositoryCommand({
      command: RepositoryCommandExecutable.Git,
      args: ['merge-base', '--is-ancestor', request.ancestor, request.descendant],
      gitSecurity: RepositoryGitSecurityPolicy.ImmutableObjects,
      rootDirectory: request.workingDirectory,
      workingDirectory: request.workingDirectory,
    }).execute();
    if (result.isErr() || result.value.exitCode !== 0) {
      throw new Error(request.message);
    }
  }

  private static assertOriginMainRef(
    request: PinnedDevBaseAncestryRequest,
  ): void {
    const result = new RepositoryCommand({
      command: RepositoryCommandExecutable.Git,
      args: [
        'rev-parse',
        '--verify',
        'refs/remotes/origin/main^{commit}',
      ],
      gitSecurity: RepositoryGitSecurityPolicy.ImmutableObjects,
      rootDirectory: request.workingDirectory,
      workingDirectory: request.workingDirectory,
    }).execute();
    if (
      result.isErr() ||
      result.value.exitCode !== 0 ||
      result.value.stdout.trim() !== request.originMainSha
    ) {
      throw new Error(
        'originMainSha must match the exact fetched refs/remotes/origin/main commit.',
      );
    }
  }
}

type AncestorCheckRequest = Readonly<{
  ancestor: GitCommit;
  descendant: GitCommit;
  workingDirectory: string;
  message: string;
}>;
