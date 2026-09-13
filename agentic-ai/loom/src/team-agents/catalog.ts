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

  static teamGizmoProfile(gizmoKey: TeamGizmoKey): TeamGizmoProfile | false {
    const [profile = false] = [
      TEAM_GIZMO_CATALOG.find((candidate) => candidate.key === gizmoKey),
    ];
    return profile;
  }

  static teamInternalAgentProfile(
    agentKey: TeamInternalAgentKey,
  ): TeamInternalAgentProfile | false {
    const [profile = false] = [
      TEAM_INTERNAL_AGENT_CATALOG.find(
        (candidate) => candidate.key === agentKey,
      ),
    ];
    return profile;
  }

  static teamAgentProfile(
    agentKey: TeamAgentKey,
  ): TeamAuthority | TeamGizmoProfile | TeamInternalAgentProfile | false {
    const authority = TEAM_AUTHORITY_CATALOG.find(
      (candidate) => candidate.key === agentKey,
    );
    if (authority) return authority;

    const gizmo = TEAM_GIZMO_CATALOG.find(
      (candidate) => candidate.key === agentKey,
    );
    if (gizmo) return gizmo;

    const internalAgent = TEAM_INTERNAL_AGENT_CATALOG.find(
      (candidate) => candidate.key === agentKey,
    );
    return internalAgent ?? false;
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

export enum TeamGizmoKey {
  DeliveryPipeline = 'delivery-pipeline-gizmo',
}

export enum TeamInternalAgentKey {
  PrSteward = 'delivery-pipeline-pr-steward',
}

export type TeamAgentKey = TeamKey | TeamGizmoKey | TeamInternalAgentKey;

export type TeamAuthority = {
  readonly key: TeamKey;
  readonly identity: string;
  readonly description: string;
  readonly contextPaths: readonly string[];
  readonly capabilityBoundary: string;
};

export type TeamGizmoProfile = {
  readonly key: TeamGizmoKey;
  readonly team: TeamKey;
  readonly identity: string;
  readonly description: string;
  readonly model: 'gpt-5.6-sol';
  readonly reasoningEffort: 'xhigh';
  readonly contextPaths: readonly string[];
  readonly parent: 'Gizmo Prime';
  readonly reportingBoundary: string;
  readonly capabilityBoundary: string;
};

export type TeamInternalAgentProfile = {
  readonly key: TeamInternalAgentKey;
  readonly team: TeamKey;
  readonly identity: string;
  readonly description: string;
  readonly model: 'gpt-5.6-luna';
  readonly reasoningEffort: 'xhigh';
  readonly contextPaths: readonly string[];
  readonly parent: TeamGizmoKey;
  readonly reportingBoundary: string;
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
  {
    key: TeamKey.DeliveryPipeline,
    identity: 'Delivery Pipeline',
    description:
      'Owns delivery mechanics across CI, pull-request lifecycle, development-branch publication, workflow execution, validation evidence, local landing, and guarded promotion.',
    contextPaths: [
      '.cortex/teams/delivery-pipeline/AGENTS.md',
      '.cortex/teams/delivery-pipeline/knowledge-graph.md',
    ],
    capabilityBoundary: `Delivery Pipeline executes authorized delivery mechanics without owning functional product implementation or policy verdicts. ${PARENT_OWNED_LIFECYCLE_BOUNDARY}`,
  },
] as const;

export const TEAM_GIZMO_CATALOG: readonly TeamGizmoProfile[] = [
  {
    key: TeamGizmoKey.DeliveryPipeline,
    team: TeamKey.DeliveryPipeline,
    identity: 'Delivery Pipeline Team Gizmo',
    description:
      'High-level internal orchestrator for Delivery Pipeline packets, bounded mechanics, internal dispatch, evidence synthesis, and reporting to Gizmo Prime.',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'xhigh',
    contextPaths: [
      '.cortex/teams/delivery-pipeline/internal/gizmo/AGENTS.md',
      '.cortex/teams/delivery-pipeline/internal/gizmo/knowledge-graph.md',
    ],
    parent: 'Gizmo Prime',
    reportingBoundary:
      'Reports high-level delivery-pipeline summaries and blockers to Gizmo Prime; it does not replace Prime or create a second root delivery owner.',
    capabilityBoundary:
      'Team Gizmo coordinates only Delivery Pipeline mechanics. It does not implement product code, choose functional ownership, decide readiness or promotion, or issue the final delivery verdict.',
  },
] as const;

export const TEAM_INTERNAL_AGENT_CATALOG: readonly TeamInternalAgentProfile[] =
  [
    {
      key: TeamInternalAgentKey.PrSteward,
      team: TeamKey.DeliveryPipeline,
      identity: 'PR Steward',
      description:
        'Executes explicitly authorized pull-request, check, review, status, publication, promotion, and bounded local-dev mechanics for Delivery Pipeline.',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'xhigh',
      contextPaths: [
        '.cortex/teams/delivery-pipeline/internal/pr-steward/AGENTS.md',
        '.cortex/teams/delivery-pipeline/internal/pr-steward/knowledge-graph.md',
      ],
      parent: TeamGizmoKey.DeliveryPipeline,
      reportingBoundary:
        'Reports bounded operation evidence and blockers to Delivery Pipeline Team Gizmo, which forwards policy-owned evidence to the issuing controller.',
      capabilityBoundary:
        'PR Steward never edits functional code, creates or updates pull requests, chooses functional ownership, decides readiness or promotion, or issues the final delivery verdict.',
    },
  ] as const;
