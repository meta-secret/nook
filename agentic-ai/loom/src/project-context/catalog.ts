export class TeamAuthorityCatalog {
  private constructor(private readonly request: TeamKey) {}

  static teamAuthority(teamKey: TeamKey): TeamAuthority | false {
    return new TeamAuthorityCatalog(teamKey).execute();
  }

  private execute(): TeamAuthority | false {
    const teamKey = this.request;
    const [authority = false] = [
      TEAM_AUTHORITY_CATALOG.find((candidate) => candidate.key === teamKey),
    ];
    return authority;
  }

  static teamCortexRoot(teamKey: TeamKey): string {
    switch (teamKey) {
      case TeamKey.Ai:
        return '.cortex/teams/ai';
      case TeamKey.DevelopmentCore:
        return '.cortex/teams/dev-core';
      case TeamKey.Security:
        return '.cortex/teams/security';
      case TeamKey.Sre:
        return '.cortex/teams/sre';
      case TeamKey.WebDevelopment:
        return '.cortex/teams/web-dev';
      case TeamKey.DeliveryPipeline:
        return '.cortex/teams/delivery-pipeline';
    }
  }
}

export enum TeamKey {
  Ai = 'ai',
  DevelopmentCore = 'development-core',
  Security = 'security',
  Sre = 'sre',
  WebDevelopment = 'web-development',
  DeliveryPipeline = 'delivery-pipeline',
}

export type TeamAuthority = {
  readonly key: TeamKey;
  readonly identity: string;
  readonly description: string;
  readonly contextPaths: readonly string[];
  readonly capabilityBoundary: string;
};

const PARENT_OWNED_LIFECYCLE_BOUNDARY =
  'The active harness owns creation, communication, scheduling, retries, cancellation, barriers, synthesis, and delivery lifecycle state.';

export const TEAM_AUTHORITY_CATALOG: readonly TeamAuthority[] = [
  {
    key: TeamKey.Ai,
    identity: 'AI',
    description:
      'Owns Cortex, Loom, agent skills, expert routing, and agent automation.',
    contextPaths: [
      '.cortex/teams/ai/docs/spec/functional-ownership.md',
      '.cortex/teams/ai/index.md',
    ],
    capabilityBoundary: `AI defines agent capability semantics and acceptance. ${PARENT_OWNED_LIFECYCLE_BOUNDARY}`,
  },
  {
    key: TeamKey.DevelopmentCore,
    identity: 'Development core',
    description:
      'Owns portable Rust behavior, vault behavior, security-control implementation, and typed WASM contracts.',
    contextPaths: [
      '.cortex/teams/dev-core/docs/spec/functional-ownership.md',
      '.cortex/teams/dev-core/index.md',
    ],
    capabilityBoundary: `Development core does not own browser presentation, infrastructure operations, or another team's Cortex authority. ${PARENT_OWNED_LIFECYCLE_BOUNDARY}`,
  },
  {
    key: TeamKey.Security,
    identity: 'Security',
    description:
      'Owns security architecture, cryptographic policy, trust boundaries, and security acceptance.',
    contextPaths: [
      '.cortex/teams/security/docs/spec/functional-ownership.md',
      '.cortex/teams/security/index.md',
    ],
    capabilityBoundary: `Security owns invariants and acceptance without taking implementation ownership from another team. ${PARENT_OWNED_LIFECYCLE_BOUNDARY}`,
  },
  {
    key: TeamKey.Sre,
    identity: 'SRE',
    description:
      'Owns CI/CD, clusters, deployments, runners, containers, and operations.',
    contextPaths: [
      '.cortex/teams/sre/docs/spec/functional-ownership.md',
      '.cortex/teams/sre/index.md',
    ],
    capabilityBoundary: `SRE does not own product rules, browser presentation, or another team's Cortex authority. ${PARENT_OWNED_LIFECYCLE_BOUNDARY}`,
  },
  {
    key: TeamKey.WebDevelopment,
    identity: 'Web development',
    description:
      'Owns TypeScript and Svelte engineering expertise, browser presentation, frontend behavior, and extension interaction.',
    contextPaths: [
      '.cortex/teams/web-dev/docs/spec/functional-ownership.md',
      '.cortex/teams/web-dev/index.md',
    ],
    capabilityBoundary: `Web development may implement bounded TypeScript expertise without taking consumer capability semantics or Cortex authority. ${PARENT_OWNED_LIFECYCLE_BOUNDARY}`,
  },
  {
    key: TeamKey.DeliveryPipeline,
    identity: 'Delivery Pipeline',
    description:
      'Owns authorized pull-request lifecycle mechanics, including publication, check observation, squash merge, and remote feature-branch cleanup.',
    contextPaths: [
      '.cortex/teams/delivery-pipeline/docs/spec/functional-ownership.md',
      '.cortex/teams/delivery-pipeline/index.md',
    ],
    capabilityBoundary: `Delivery Pipeline executes authorized GitHub pull-request, merge, and branch-cleanup mechanics. Local feature integration belongs to the upstream integration agent, and Delivery Pipeline does not own functional product implementation or policy verdicts. ${PARENT_OWNED_LIFECYCLE_BOUNDARY}`,
  },
] as const;
