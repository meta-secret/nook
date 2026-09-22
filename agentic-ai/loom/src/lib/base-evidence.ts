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
declare const CANONICAL_WORKER_BRANCH: unique symbol;

/** The branch is the stable workflow authority; its head is resolved by Delivery at each stage. */
export type CanonicalFeatureBranch = string & {
  readonly [CANONICAL_FEATURE_BRANCH]: 'canonical-feature-branch';
};

export type CanonicalWorkerBranch = string & {
  readonly [CANONICAL_WORKER_BRANCH]: 'canonical-worker-branch';
};

class CanonicalBranchNameSyntax {
  private constructor() {}

  static assertSafeGitRef(branch: string): void {
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
      throw new Error('Canonical branch is not a safe Git ref.');
  }

  static isKebabSegment(
    ...[segment, minimum, maximum]: [
      segment: string | false,
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

  static isCanonicalTeam(team: string | false): boolean {
    return (
      team === 'ai' ||
      team === 'dev-core' ||
      team === 'security' ||
      team === 'sre' ||
      team === 'web-dev' ||
      team === 'delivery-pipeline'
    );
  }

  static isCanonicalWorkerRole(
    ...[team, role]: [team: string | false, role: string | false]
  ): boolean {
    if (typeof team !== 'string' || typeof role !== 'string') return false;
    switch (team) {
      case 'ai':
        return role === 'loom-specialist' || role === 'cortex-specialist';
      case 'dev-core':
        return (
          role === 'rust-core-developer' || role === 'rust-auth2-developer'
        );
      case 'security':
        return (
          role === 'cryptography-specialist' ||
          role === 'security-review-specialist'
        );
      case 'sre':
        return (
          role === 'provisioning' ||
          role === 'cloud-native' ||
          role === 'docker-cache-specialist'
        );
      case 'web-dev':
        return (
          role === 'typescript-specialist' ||
          role === 'svelte-specialist' ||
          role === 'web-designer'
        );
      case 'delivery-pipeline':
        return role === 'pr-lifecycle';
      default:
        return false;
    }
  }
}

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
    CanonicalBranchNameSyntax.assertSafeGitRef(branch);
    const components = branch.split('/');
    if (
      components[0] !== 'codex' ||
      components.some((component) => component.length === 0)
    )
      throw new Error('Canonical feature branch must be a codex branch.');

    const segments = components.slice(1);
    return (
      segments.length === 1 &&
      (CanonicalBranchNameSyntax.isKebabSegment(segments[0] || false, 10, 20) ||
        CanonicalFeatureBranchContract.isEstablishedPrimeBranch(segments))
    );
  }

  /** Preserves the Prime-authorized delivery branch created before the current length bound. */
  private static isEstablishedPrimeBranch(
    segments: readonly string[],
  ): boolean {
    return segments.length === 1 && segments[0] === 'agentic-pipeline-delivery';
  }
}

export class CanonicalWorkerBranchContract {
  private constructor(private readonly value: string) {}

  static parse(value: string): CanonicalWorkerBranch {
    return new CanonicalWorkerBranchContract(value).execute();
  }

  private execute(): CanonicalWorkerBranch {
    const branch = this.value;
    if (!CanonicalWorkerBranchContract.isCanonicalWorkerBranch(branch))
      throw new Error('Canonical worker branch is malformed.');
    return branch;
  }

  private static isCanonicalWorkerBranch(
    branch: string,
  ): branch is CanonicalWorkerBranch {
    CanonicalBranchNameSyntax.assertSafeGitRef(branch);
    const segments = branch.split('/');
    return (
      segments.length === 6 &&
      segments[0] === 'codex' &&
      segments[1] === 'child' &&
      CanonicalBranchNameSyntax.isCanonicalTeam(segments[2] || false) &&
      CanonicalBranchNameSyntax.isCanonicalWorkerRole(
        segments[2] || false,
        segments[3] || false,
      ) &&
      CanonicalWorkerBranchContract.isCanonicalFeatureSegment(
        segments[4] || false,
      ) &&
      CanonicalBranchNameSyntax.isKebabSegment(segments[5] || false, 20, 50) &&
      !CanonicalWorkerBranchContract.isProhibitedWorkSegment(
        segments[5] || false,
      )
    );
  }

  private static isProhibitedWorkSegment(segment: string | false): boolean {
    if (segment === false || segment === 'cleanup') return true;
    return (
      /(?:^|-)v\d+$/u.test(segment) ||
      /(?:^|-)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-|$)/u.test(
        segment,
      ) ||
      /(?:^|-)(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?:-|$)/u.test(
        segment,
      ) ||
      /(?:^|-)\d{8}-?\d{6}(?:-|$)/u.test(segment)
    );
  }

  private static isCanonicalFeatureSegment(segment: string | false): boolean {
    return (
      CanonicalBranchNameSyntax.isKebabSegment(segment, 10, 20) ||
      segment === 'agentic-pipeline-delivery'
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
        message: 'sourceCommit must be descended from the feature head.',
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
      args: [
        'merge-base',
        '--is-ancestor',
        request.ancestor,
        request.descendant,
      ],
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
      args: ['rev-parse', '--verify', 'refs/remotes/origin/main^{commit}'],
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
