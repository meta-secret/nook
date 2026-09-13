export class TeamAuthorityCatalog {
  private constructor(private readonly request: TeamKey) {}

  static teamAuthority(teamKey: TeamKey): TeamAuthority | false {
    return new TeamAuthorityCatalog(teamKey).execute();
  }

  private execute(): TeamAuthority | false {
    const teamKey = this.request;
    const [defaulted1 = false] = [
      TEAM_AUTHORITY_CATALOG.find((authority) => authority.key === teamKey),
    ];
    return defaulted1;
  }

  static gizmoOwnedAgentProfile(
    agentKey: GizmoOwnedAgentKey,
  ): GizmoOwnedAgentProfile | false {
    const [defaulted1 = false] = [
      GIZMO_OWNED_AGENT_CATALOG.find((agent) => agent.key === agentKey),
    ];
    return defaulted1;
  }

  static teamAgentProfile(
    agentKey: TeamAgentKey,
  ): TeamAuthority | GizmoOwnedAgentProfile | false {
    if (Object.values(TeamKey).some((key) => key === agentKey)) {
      const teamKey = Object.values(TeamKey).find((key) => key === agentKey);
      if (!teamKey) return false;
      return TeamAuthorityCatalog.teamAuthority(teamKey);
    }
    const gizmoKey = Object.values(GizmoOwnedAgentKey).find(
      (key) => key === agentKey,
    );
    return gizmoKey
      ? TeamAuthorityCatalog.gizmoOwnedAgentProfile(gizmoKey)
      : false;
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
    }
  }
}
export enum TeamKey {
  Ai = 'ai',
  DevelopmentCore = 'development-core',
  Security = 'security',
  Sre = 'sre',
  WebDevelopment = 'web-development',
}

export enum GizmoOwnedAgentKey {
  PrSteward = 'pr-steward',
}

export type TeamAgentKey = TeamKey | GizmoOwnedAgentKey;

export type TeamAuthority = {
  readonly key: TeamKey;
  readonly identity: string;
  readonly description: string;
  readonly contextPaths: readonly string[];
  readonly capabilityBoundary: string;
};

export type GizmoOwnedAgentProfile = {
  readonly key: GizmoOwnedAgentKey;
  readonly identity: string;
  readonly description: string;
  readonly model: 'gpt-5.6-luna';
  readonly reasoningEffort: 'xhigh';
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

export const GIZMO_OWNED_AGENT_CATALOG: readonly GizmoOwnedAgentProfile[] = [
  {
    key: GizmoOwnedAgentKey.PrSteward,
    identity: 'PR Steward',
    description:
      'Executes explicitly authorized pull-request metadata, review, validation, readiness-evidence, merge, and merge-verification operations for Gizmo Prime.',
    model: 'gpt-5.6-luna',
    reasoningEffort: 'xhigh',
    contextPaths: [
      '.cortex/teams/pr-steward/AGENTS.md',
      '.cortex/teams/pr-steward/knowledge-graph.md',
    ],
    capabilityBoundary:
      'PR Steward never edits functional code, adjudicates technical findings, sequences shared-branch writers, owns Workbench outcomes, or issues the final delivery verdict.',
  },
] as const;
