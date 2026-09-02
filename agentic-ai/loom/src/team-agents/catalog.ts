export enum TeamKey {
  Ai = 'ai',
  DevelopmentCore = 'development-core',
  Security = 'security',
  Sre = 'sre',
  WebDevelopment = 'web-development',
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
      '.cortex/teams/ai/AGENTS.md',
      '.cortex/teams/ai/knowledge-graph.md',
    ],
    capabilityBoundary: `AI defines agent capability semantics and acceptance. ${PARENT_OWNED_LIFECYCLE_BOUNDARY}`,
  },
  {
    key: TeamKey.DevelopmentCore,
    identity: 'Development core',
    description:
      'Owns portable Rust behavior, vault behavior, security-control implementation, and typed WASM contracts.',
    contextPaths: [
      '.cortex/teams/dev-core/AGENTS.md',
      '.cortex/teams/dev-core/knowledge-graph.md',
    ],
    capabilityBoundary: `Development core does not own browser presentation, infrastructure operations, or another team's Cortex authority. ${PARENT_OWNED_LIFECYCLE_BOUNDARY}`,
  },
  {
    key: TeamKey.Security,
    identity: 'Security',
    description:
      'Owns security architecture, cryptographic policy, trust boundaries, and security acceptance.',
    contextPaths: [
      '.cortex/teams/security/AGENTS.md',
      '.cortex/teams/security/knowledge-graph.md',
    ],
    capabilityBoundary: `Security owns invariants and acceptance without taking implementation ownership from another team. ${PARENT_OWNED_LIFECYCLE_BOUNDARY}`,
  },
  {
    key: TeamKey.Sre,
    identity: 'SRE',
    description:
      'Owns CI/CD, clusters, deployments, runners, containers, and operations.',
    contextPaths: [
      '.cortex/teams/sre/AGENTS.md',
      '.cortex/teams/sre/knowledge-graph.md',
    ],
    capabilityBoundary: `SRE does not own product rules, browser presentation, or another team's Cortex authority. ${PARENT_OWNED_LIFECYCLE_BOUNDARY}`,
  },
  {
    key: TeamKey.WebDevelopment,
    identity: 'Web development',
    description:
      'Owns TypeScript and Svelte engineering expertise, browser presentation, frontend behavior, and extension interaction.',
    contextPaths: [
      '.cortex/teams/web-dev/AGENTS.md',
      '.cortex/teams/web-dev/knowledge-graph.md',
    ],
    capabilityBoundary: `Web development may implement bounded TypeScript expertise without taking consumer capability semantics or Cortex authority. ${PARENT_OWNED_LIFECYCLE_BOUNDARY}`,
  },
] as const;

export function teamAuthority(teamKey: TeamKey): TeamAuthority | false {
  const [defaulted1 = false] = [
    TEAM_AUTHORITY_CATALOG.find((authority) => authority.key === teamKey),
  ];
  return defaulted1;
}

export function teamCortexRoot(teamKey: TeamKey): string {
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
  }
}
