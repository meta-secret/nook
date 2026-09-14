import type { GitCommit } from '../agent-workflow/domain.ts';
import {
  RepositoryCommand,
  RepositoryCommandExecutable,
  RepositoryGitSecurityPolicy,
} from './run.ts';

/** Bootstrap ancestry evidence is deliberately independent of the moving feature branch. */
export type PinnedDevBaseEvidence = Readonly<{
  originMainSha: GitCommit;
  pinnedLocalDevSha: GitCommit;
}>;

declare const CANONICAL_FEATURE_BRANCH: unique symbol;

/** The branch is the stable workflow authority; its head is resolved by Delivery at each stage. */
export type CanonicalFeatureBranch = string & {
  readonly [CANONICAL_FEATURE_BRANCH]: 'canonical-feature-branch';
};

export class CanonicalFeatureBranchContract {
  private constructor(private readonly value: string) {}

  static parse(value: string): CanonicalFeatureBranch {
    return new CanonicalFeatureBranchContract(value).execute();
  }

  private execute(): CanonicalFeatureBranch {
    const branch = this.value;
    if (!CanonicalFeatureBranchContract.isCanonicalFeatureBranch(branch))
      throw new Error('Canonical feature branch is malformed.');
    return branch;
  }

  private static isCanonicalFeatureBranch(
    branch: string,
  ): branch is CanonicalFeatureBranch {
    if (
      !branch ||
      branch.length > 120 ||
      branch === '@' ||
      branch.startsWith('-') ||
      branch.startsWith('/') ||
      branch.endsWith('/') ||
      branch.endsWith('.') ||
      branch.includes('..') ||
      branch.includes('//') ||
      branch.includes('@{') ||
      branch.split('').some((character) => {
        const code = character.charCodeAt(0);
        return (
          code <= 0x20 ||
          code === 0x7f ||
          character === '~' ||
          character === '^' ||
          character === ':' ||
          character === '?' ||
          character === '*' ||
          character === '[' ||
          character === '\\'
        );
      })
    )
      return false;
    const components = branch.split('/');
    if (
      components[0] !== 'codex' ||
      components.some((component) => component.length === 0)
    )
      throw new Error('Canonical feature branch must be a codex branch.');

    const segments = components.slice(1);
    const valid =
      (segments.length === 1 &&
        (CanonicalFeatureBranchContract.isKebabSegment(segments[0], 10, 20) ||
          CanonicalFeatureBranchContract.isEstablishedPrimeBranch(segments) ||
          CanonicalFeatureBranchContract.isCanonicalMachineBranch(segments))) ||
      (segments.length === 4 &&
        CanonicalFeatureBranchContract.isKebabSegment(segments[0], 10, 20) &&
        CanonicalFeatureBranchContract.isCanonicalTeam(segments[1]) &&
        CanonicalFeatureBranchContract.isCanonicalRole(
          segments[1],
          segments[2],
        ) &&
        CanonicalFeatureBranchContract.isKebabSegment(segments[3], 20, 50) &&
        segments[3] !== 'cleanup');
    return valid;
  }

  /** Preserves the authorized delivery branch created before the current length bound. */
  private static isEstablishedPrimeBranch(
    segments: readonly string[],
  ): boolean {
    return segments.length === 1 && segments[0] === 'agentic-pipeline-delivery';
  }

  private static isKebabSegment(
    ...[segment, minimum, maximum]: [
      segment: string | undefined,
      minimum: number,
      maximum: number,
    ]
  ): boolean {
    return (
      typeof segment === 'string' &&
      segment.length >= minimum &&
      segment.length <= maximum &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(segment)
    );
  }

  private static isCanonicalTeam(team: string | undefined): boolean {
    return (
      team === 'ai' ||
      team === 'dev-core' ||
      team === 'security' ||
      team === 'sre' ||
      team === 'web-dev' ||
      team === 'delivery-pipeline'
    );
  }

  private static isCanonicalRole(
    ...[team, role]: [team: string | undefined, role: string | undefined]
  ): boolean {
    if (typeof team !== 'string' || typeof role !== 'string') return false;
    switch (team) {
      case 'ai':
        return (
          role === 'gizmo' ||
          role === 'loom-specialist' ||
          role === 'cortex-specialist'
        );
      case 'dev-core':
        return (
          role === 'gizmo' ||
          role === 'rust-core-developer' ||
          role === 'rust-auth2-developer'
        );
      case 'security':
        return (
          role === 'gizmo' ||
          role === 'cryptography-specialist' ||
          role === 'security-review-specialist'
        );
      case 'sre':
        return (
          role === 'gizmo' || role === 'provisioning' || role === 'cloud-native'
        );
      case 'web-dev':
        return (
          role === 'gizmo' ||
          role === 'typescript-specialist' ||
          role === 'svelte-specialist'
        );
      case 'delivery-pipeline':
        return (
          role === 'gizmo' || role === 'dev-manager' || role === 'pr-lifecycle'
        );
      default:
        return false;
    }
  }

  private static isCanonicalMachineBranch(
    segments: readonly string[],
  ): boolean {
    if (segments.length !== 1) return false;
    const segment = segments[0];
    if (typeof segment !== 'string' || !segment.startsWith('hive-')) return false;
    const suffix = segment.slice('hive-'.length);
    return (
      suffix.length > 0 &&
      !suffix.startsWith('-') &&
      !suffix.endsWith('-') &&
      !suffix.includes('--') &&
      /^[a-z0-9-]+$/u.test(suffix)
    );
  }
}

export type PinnedDevBaseAncestryRequest = PinnedDevBaseEvidence &
  Readonly<{
    workingDirectory: string;
    sourceCommit?: GitCommit;
  }>;

/** Owns fail-closed validation of the bootstrap commit chain. */
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
    if (request.sourceCommit) {
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
    if (request.sourceCommit) {
      PinnedDevBaseEvidenceContract.assertAncestor({
        ancestor: request.pinnedLocalDevSha,
        descendant: request.sourceCommit,
        workingDirectory: request.workingDirectory,
        message:
          'sourceCommit must be descended from the feature head.',
      });
    }
  }

  private static assertCommitShape(
    ...[name, sha]: [name: string, sha: GitCommit]
  ): void {
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
