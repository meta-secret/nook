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

  static teamRuntimeProfile(
    agentKey: TeamAgentKey,
  ): TeamRuntimeProfile | false {
    const directProfile = TEAM_GIZMO_CATALOG.find(
      (candidate) => candidate.key === agentKey,
    );
    const internalProfile = TEAM_INTERNAL_AGENT_CATALOG.find(
      (candidate) => candidate.key === agentKey,
    );
    const selectedProfile = directProfile || internalProfile;
    if (selectedProfile) return selectedProfile;
    const teamAuthority = TEAM_AUTHORITY_CATALOG.find(
      (candidate) => candidate.key === agentKey,
    );
    if (!teamAuthority) return false;
    const [teamGizmo = false] = [
      TEAM_GIZMO_CATALOG.find(
        (candidate) => candidate.team === teamAuthority.key,
      ),
    ];
    return teamGizmo;
  }

  static teamRuntimeProfileByName(
    agentName: string,
  ): TeamRuntimeProfile | false {
    const gizmo = TEAM_GIZMO_CATALOG.find(
      (candidate) => candidate.key === agentName,
    );
    const internalAgent = TEAM_INTERNAL_AGENT_CATALOG.find(
      (candidate) => candidate.key === agentName,
    );
    return gizmo || internalAgent || false;
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
    return internalAgent || false;
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
  Ai = 'ai-gizmo',
  DevelopmentCore = 'development-core-gizmo',
  Security = 'security-gizmo',
  Sre = 'sre-gizmo',
  WebDevelopment = 'web-development-gizmo',
  DeliveryPipeline = 'delivery-pipeline-gizmo',
}

export enum TeamInternalAgentKey {
  LoomSpecialist = 'loom-specialist',
  CortexSpecialist = 'cortex-specialist',
  RustCoreDeveloper = 'rust-core-developer',
  RustAuth2Developer = 'rust-auth2-developer',
  CryptographySpecialist = 'cryptography-specialist',
  SecurityReviewSpecialist = 'security-review-specialist',
  Provisioning = 'provisioning',
  CloudNative = 'cloud-native',
  DockerCacheSpecialist = 'docker-cache-specialist',
  TypeScriptSpecialist = 'typescript-specialist',
  SvelteSpecialist = 'svelte-specialist',
  DevManager = 'dev-manager',
  PrLifecycle = 'pr-lifecycle',
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
  readonly reasoningEffort: 'low';
  readonly serviceTier: 'fast';
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
  readonly serviceTier: 'fast';
  readonly contextPaths: readonly string[];
  readonly parent: TeamGizmoKey;
  readonly reportingBoundary: string;
  readonly capabilityBoundary: string;
  readonly activationContract?: TeamInternalAgentActivationContract;
};

export type TeamInternalAgentActivationContract = {
  readonly workflowScope: string;
  readonly decisionSource: 'canonical-json';
  readonly markdownRole: 'human-context-only';
  readonly reasonCodes: readonly string[];
  readonly greenPath: 'no-specialist-dispatch';
  readonly generationBaselinePolicy: string;
  readonly ordinaryCommitPolicy: string;
  readonly exactSourcePolicy: string;
  readonly readOnlyPolicy: string;
  readonly timeoutDiagnosisPolicy: string;
  readonly bakeInheritancePolicy: string;
  readonly effectiveSolveParityPolicy: string;
  readonly inputDomainIsolationPolicy: string;
  readonly perHeadBoundaryPolicy: string;
  readonly domainIsolationProofPolicy: string;
  readonly repairLoop: readonly string[];
};

export type TeamRuntimeProfile = TeamGizmoProfile | TeamInternalAgentProfile;

const PARENT_OWNED_LIFECYCLE_BOUNDARY =
  'The active harness owns creation, communication, scheduling, retries, cancellation, barriers, synthesis, and delivery lifecycle state.';

const TEAM_GIZMO_CAPABILITY_BOUNDARY =
  'Team Gizmo coordinates only its team mechanics. It does not implement product code, choose functional ownership, decide readiness or promotion, or issue the final delivery verdict. It never creates or updates pull requests and never performs squash, rebase, or force-push operations.';

const INTERNAL_AGENT_CAPABILITY_BOUNDARY =
  'Internal Team Agent operates only within its bounded team expertise. It never creates or updates pull requests, performs squash, rebase, or force-push operations, changes parent ownership, or issues the final delivery verdict.';

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
    key: TeamGizmoKey.Ai,
    team: TeamKey.Ai,
    identity: 'AI Team Gizmo',
    description:
      'High-level internal orchestrator for AI packets, bounded internal dispatch, context synthesis, and reporting to Gizmo Prime.',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'low',
    serviceTier: 'fast',
    contextPaths: [
      '.cortex/teams/ai/gizmo/AGENTS.md',
      '.cortex/teams/ai/gizmo/knowledge-graph.md',
    ],
    parent: 'Gizmo Prime',
    reportingBoundary:
      "Reports high-level AI summaries and blockers to Gizmo Prime; it preserves Prime's controller and exact-SHA target without becoming a second root delivery owner.",
    capabilityBoundary: TEAM_GIZMO_CAPABILITY_BOUNDARY,
  },
  {
    key: TeamGizmoKey.DevelopmentCore,
    team: TeamKey.DevelopmentCore,
    identity: 'Development Core Team Gizmo',
    description:
      'High-level internal orchestrator for Development Core packets, bounded internal dispatch, context synthesis, and reporting to Gizmo Prime.',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'low',
    serviceTier: 'fast',
    contextPaths: [
      '.cortex/teams/dev-core/gizmo/AGENTS.md',
      '.cortex/teams/dev-core/gizmo/knowledge-graph.md',
    ],
    parent: 'Gizmo Prime',
    reportingBoundary:
      "Reports high-level Development Core summaries and blockers to Gizmo Prime; it preserves Prime's controller and exact-SHA target without becoming a second root delivery owner.",
    capabilityBoundary: TEAM_GIZMO_CAPABILITY_BOUNDARY,
  },
  {
    key: TeamGizmoKey.Security,
    team: TeamKey.Security,
    identity: 'Security Team Gizmo',
    description:
      'High-level internal orchestrator for Security packets, bounded internal dispatch, context synthesis, and reporting to Gizmo Prime.',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'low',
    serviceTier: 'fast',
    contextPaths: [
      '.cortex/teams/security/gizmo/AGENTS.md',
      '.cortex/teams/security/gizmo/knowledge-graph.md',
    ],
    parent: 'Gizmo Prime',
    reportingBoundary:
      "Reports high-level Security summaries and blockers to Gizmo Prime; it preserves Prime's controller and exact-SHA target without becoming a second root delivery owner.",
    capabilityBoundary: TEAM_GIZMO_CAPABILITY_BOUNDARY,
  },
  {
    key: TeamGizmoKey.Sre,
    team: TeamKey.Sre,
    identity: 'SRE Team Gizmo',
    description:
      'High-level internal orchestrator for SRE packets, bounded internal dispatch, context synthesis, and reporting to Gizmo Prime.',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'low',
    serviceTier: 'fast',
    contextPaths: [
      '.cortex/teams/sre/gizmo/AGENTS.md',
      '.cortex/teams/sre/gizmo/knowledge-graph.md',
    ],
    parent: 'Gizmo Prime',
    reportingBoundary:
      "Reports high-level SRE summaries and blockers to Gizmo Prime; it preserves Prime's controller and exact-SHA target without becoming a second root delivery owner.",
    capabilityBoundary: TEAM_GIZMO_CAPABILITY_BOUNDARY,
  },
  {
    key: TeamGizmoKey.WebDevelopment,
    team: TeamKey.WebDevelopment,
    identity: 'Web Development Team Gizmo',
    description:
      'High-level internal orchestrator for Web Development packets, bounded internal dispatch, context synthesis, and reporting to Gizmo Prime.',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'low',
    serviceTier: 'fast',
    contextPaths: [
      '.cortex/teams/web-dev/gizmo/AGENTS.md',
      '.cortex/teams/web-dev/gizmo/knowledge-graph.md',
    ],
    parent: 'Gizmo Prime',
    reportingBoundary:
      "Reports high-level Web Development summaries and blockers to Gizmo Prime; it preserves Prime's controller and exact-SHA target without becoming a second root delivery owner.",
    capabilityBoundary: TEAM_GIZMO_CAPABILITY_BOUNDARY,
  },
  {
    key: TeamGizmoKey.DeliveryPipeline,
    team: TeamKey.DeliveryPipeline,
    identity: 'Delivery Pipeline Team Gizmo',
    description:
      'High-level internal orchestrator for Delivery Pipeline packets, bounded mechanics, internal dispatch, evidence synthesis, and reporting to Gizmo Prime.',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'low',
    serviceTier: 'fast',
    contextPaths: [
      '.cortex/teams/delivery-pipeline/gizmo/AGENTS.md',
      '.cortex/teams/delivery-pipeline/gizmo/knowledge-graph.md',
    ],
    parent: 'Gizmo Prime',
    reportingBoundary:
      'Reports high-level delivery-pipeline summaries and blockers to Gizmo Prime; it does not replace Prime or create a second root delivery owner.',
    capabilityBoundary: TEAM_GIZMO_CAPABILITY_BOUNDARY,
  },
] as const;

export const TEAM_INTERNAL_AGENT_CATALOG: readonly TeamInternalAgentProfile[] =
  [
    {
      key: TeamInternalAgentKey.LoomSpecialist,
      team: TeamKey.Ai,
      identity: 'Loom specialist',
      description:
        'Maintains Loom typed workflows, team-agent catalogs, context resolution, and deterministic AI tooling.',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'xhigh',
      serviceTier: 'fast',
      contextPaths: [
        '.cortex/teams/ai/loom-specialist/AGENTS.md',
        '.cortex/teams/ai/loom-specialist/knowledge-graph.md',
      ],
      parent: TeamGizmoKey.Ai,
      reportingBoundary:
        'Reports bounded Loom evidence and blockers to AI Team Gizmo for synthesis and handoff to Gizmo Prime.',
      capabilityBoundary: INTERNAL_AGENT_CAPABILITY_BOUNDARY,
    },
    {
      key: TeamInternalAgentKey.CortexSpecialist,
      team: TeamKey.Ai,
      identity: 'Cortex specialist',
      description:
        'Maintains Cortex routing, knowledge-graph consistency, context contracts, and agent-authority semantics.',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'xhigh',
      serviceTier: 'fast',
      contextPaths: [
        '.cortex/teams/ai/cortex-specialist/AGENTS.md',
        '.cortex/teams/ai/cortex-specialist/knowledge-graph.md',
      ],
      parent: TeamGizmoKey.Ai,
      reportingBoundary:
        'Reports bounded Cortex evidence and blockers to AI Team Gizmo for synthesis and handoff to Gizmo Prime.',
      capabilityBoundary: INTERNAL_AGENT_CAPABILITY_BOUNDARY,
    },
    {
      key: TeamInternalAgentKey.RustCoreDeveloper,
      team: TeamKey.DevelopmentCore,
      identity: 'Rust core developer',
      description:
        'Implements bounded portable Rust core behavior and its behavior-focused tests under Development Core ownership.',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'xhigh',
      serviceTier: 'fast',
      contextPaths: [
        '.cortex/teams/dev-core/rust-core-developer/AGENTS.md',
        '.cortex/teams/dev-core/rust-core-developer/knowledge-graph.md',
      ],
      parent: TeamGizmoKey.DevelopmentCore,
      reportingBoundary:
        'Reports the committed Rust core SHA, evidence, and blockers to Development Core Team Gizmo.',
      capabilityBoundary: INTERNAL_AGENT_CAPABILITY_BOUNDARY,
    },
    {
      key: TeamInternalAgentKey.RustAuth2Developer,
      team: TeamKey.DevelopmentCore,
      identity: 'Rust auth2 developer',
      description:
        'Implements bounded Rust auth2 behavior and its behavior-focused tests under Development Core ownership.',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'xhigh',
      serviceTier: 'fast',
      contextPaths: [
        '.cortex/teams/dev-core/rust-auth2-developer/AGENTS.md',
        '.cortex/teams/dev-core/rust-auth2-developer/knowledge-graph.md',
      ],
      parent: TeamGizmoKey.DevelopmentCore,
      reportingBoundary:
        'Reports the committed Rust auth2 SHA, evidence, and blockers to Development Core Team Gizmo.',
      capabilityBoundary: INTERNAL_AGENT_CAPABILITY_BOUNDARY,
    },
    {
      key: TeamInternalAgentKey.CryptographySpecialist,
      team: TeamKey.Security,
      identity: 'Cryptography specialist',
      description:
        'Reviews cryptographic invariants, secret-handling boundaries, and security evidence within the assigned scope.',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'xhigh',
      serviceTier: 'fast',
      contextPaths: [
        '.cortex/teams/security/cryptography-specialist/AGENTS.md',
        '.cortex/teams/security/cryptography-specialist/knowledge-graph.md',
      ],
      parent: TeamGizmoKey.Security,
      reportingBoundary:
        'Reports bounded cryptographic findings, evidence, and blockers to Security Team Gizmo.',
      capabilityBoundary: INTERNAL_AGENT_CAPABILITY_BOUNDARY,
    },
    {
      key: TeamInternalAgentKey.SecurityReviewSpecialist,
      team: TeamKey.Security,
      identity: 'Security review specialist',
      description:
        'Performs bounded security review of trust boundaries, authorization, and release-impacting changes.',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'xhigh',
      serviceTier: 'fast',
      contextPaths: [
        '.cortex/teams/security/security-review-specialist/AGENTS.md',
        '.cortex/teams/security/security-review-specialist/knowledge-graph.md',
      ],
      parent: TeamGizmoKey.Security,
      reportingBoundary:
        'Reports bounded security findings, evidence, and blockers to Security Team Gizmo.',
      capabilityBoundary: INTERNAL_AGENT_CAPABILITY_BOUNDARY,
    },
    {
      key: TeamInternalAgentKey.Provisioning,
      team: TeamKey.Sre,
      identity: 'Provisioning specialist',
      description:
        'Maintains bounded infrastructure provisioning mechanics, manifests, and operational evidence under SRE ownership.',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'xhigh',
      serviceTier: 'fast',
      contextPaths: [
        '.cortex/teams/sre/provisioning/AGENTS.md',
        '.cortex/teams/sre/provisioning/knowledge-graph.md',
      ],
      parent: TeamGizmoKey.Sre,
      reportingBoundary:
        'Reports bounded provisioning evidence and blockers to SRE Team Gizmo.',
      capabilityBoundary: INTERNAL_AGENT_CAPABILITY_BOUNDARY,
    },
    {
      key: TeamInternalAgentKey.CloudNative,
      team: TeamKey.Sre,
      identity: 'Cloud-native specialist',
      description:
        'Maintains bounded cloud-native deployment, cluster, and runner mechanics under SRE ownership.',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'xhigh',
      serviceTier: 'fast',
      contextPaths: [
        '.cortex/teams/sre/cloud-native/AGENTS.md',
        '.cortex/teams/sre/cloud-native/knowledge-graph.md',
      ],
      parent: TeamGizmoKey.Sre,
      reportingBoundary:
        'Reports bounded cloud-native evidence and blockers to SRE Team Gizmo.',
      capabilityBoundary: INTERNAL_AGENT_CAPABILITY_BOUNDARY,
    },
    {
      key: TeamInternalAgentKey.DockerCacheSpecialist,
      team: TeamKey.Sre,
      identity: 'Docker cache specialist',
      description:
        'Owns Docker and BuildKit cache correctness, cache proofs, telemetry, and latency for every Docker or BuildKit job in pr.yml under SRE ownership.',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'xhigh',
      serviceTier: 'fast',
      contextPaths: [
        '.cortex/teams/sre/docker-cache-specialist/AGENTS.md',
        '.cortex/teams/sre/docker-cache-specialist/knowledge-graph.md',
        '.cortex/teams/ai/architecture/docker-cache-specialist-activation.md',
      ],
      parent: TeamGizmoKey.Sre,
      reportingBoundary:
        'Reports bounded Docker cache diagnoses, repair evidence, latency measurements, and blockers to SRE Team Gizmo.',
      capabilityBoundary: INTERNAL_AGENT_CAPABILITY_BOUNDARY,
      activationContract: {
        workflowScope:
          'Every Docker or BuildKit-bearing job in .github/workflows/pr.yml.',
        decisionSource: 'canonical-json',
        markdownRole: 'human-context-only',
        reasonCodes: [
          'job-timeout',
          'job-cancelled',
          'cache-health-gate-failed',
          'telemetry-missing-or-incomplete',
          'required-import-miss',
          'generation-baseline-missing',
          'generation-baseline-invalid',
          'effective-solve-input-mismatch',
          'unrelated-input-cache-invalidation',
          'recipe-or-dependency-generation-changed',
          'unexpected-read-only-write-or-export',
          'severe-cache-hit-regression',
          'diagnostic-flag',
        ],
        greenPath: 'no-specialist-dispatch',
        generationBaselinePolicy:
          'seed-exactly-one-immutable-mode-max-compiler-baseline-per-recipe-and-dependency-fingerprint-generation',
        ordinaryCommitPolicy:
          'import-generation-baseline-plus-dependency-cache',
        exactSourcePolicy:
          'optional-mode-min-same-head-retry-only-never-maintenance-seed-per-head',
        readOnlyPolicy: 'zero-cache-writes-and-zero-exports',
        timeoutDiagnosisPolicy:
          'diagnose-missing-or-invalid-generation-baseline-or-legitimate-generation-change-never-blindly-seed-head',
        bakeInheritancePolicy:
          'cli-set-overrides-do-not-retroactively-propagate-to-inheriting-targets',
        effectiveSolveParityPolicy:
          'mirror-seed-and-consumer-args-contexts-platforms-and-outputs-in-recipe-fingerprint-and-docker-proof',
        inputDomainIsolationPolicy:
          'rust-wasm-hive-and-web-compiler-stages-copy-only-semantic-domain-inputs-never-repository-root',
        perHeadBoundaryPolicy:
          'introduce-per-head-args-at-latest-semantic-consumer-and-preserve-explicit-narrow-wasm-handoffs',
        domainIsolationProofPolicy:
          'policy-and-domain-specific-simulator-proof-must-show-unrelated-compiler-domains-remain-cached',
        repairLoop: [
          'diagnose-telemetry-before-editing',
          'prove-with-docker-simulator-and-proof',
          'route-github-mechanics-through-delivery',
          'repeat-until-current-head-is-green',
        ],
      },
    },
    {
      key: TeamInternalAgentKey.TypeScriptSpecialist,
      team: TeamKey.WebDevelopment,
      identity: 'TypeScript specialist',
      description:
        'Implements bounded TypeScript state, typed projections, and focused web behavior under Web Development ownership.',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'xhigh',
      serviceTier: 'fast',
      contextPaths: [
        '.cortex/teams/web-dev/typescript-specialist/AGENTS.md',
        '.cortex/teams/web-dev/typescript-specialist/knowledge-graph.md',
      ],
      parent: TeamGizmoKey.WebDevelopment,
      reportingBoundary:
        'Reports the committed TypeScript SHA, evidence, and blockers to Web Development Team Gizmo.',
      capabilityBoundary: INTERNAL_AGENT_CAPABILITY_BOUNDARY,
    },
    {
      key: TeamInternalAgentKey.SvelteSpecialist,
      team: TeamKey.WebDevelopment,
      identity: 'Svelte specialist',
      description:
        'Implements bounded Svelte presentation, browser interaction, and focused web-flow tests under Web Development ownership.',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'xhigh',
      serviceTier: 'fast',
      contextPaths: [
        '.cortex/teams/web-dev/svelte-specialist/AGENTS.md',
        '.cortex/teams/web-dev/svelte-specialist/knowledge-graph.md',
      ],
      parent: TeamGizmoKey.WebDevelopment,
      reportingBoundary:
        'Reports the committed Svelte SHA, evidence, and blockers to Web Development Team Gizmo.',
      capabilityBoundary: INTERNAL_AGENT_CAPABILITY_BOUNDARY,
    },
    {
      key: TeamInternalAgentKey.DevManager,
      team: TeamKey.DeliveryPipeline,
      identity: 'Dev Manager',
      description:
        'Executes bounded development-manager snapshot, validation-evidence, readiness, and promotion mechanics under Delivery Pipeline ownership.',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'xhigh',
      serviceTier: 'fast',
      contextPaths: [
        '.cortex/teams/delivery-pipeline/dev-manager/AGENTS.md',
        '.cortex/teams/delivery-pipeline/dev-manager/knowledge-graph.md',
      ],
      parent: TeamGizmoKey.DeliveryPipeline,
      reportingBoundary:
        'Reports bounded manager-cycle evidence and blockers to Delivery Pipeline Team Gizmo.',
      capabilityBoundary: INTERNAL_AGENT_CAPABILITY_BOUNDARY,
    },
    {
      key: TeamInternalAgentKey.PrLifecycle,
      team: TeamKey.DeliveryPipeline,
      identity: 'PR Lifecycle',
      description:
        'Executes explicitly authorized pull-request observation, check, review, status, publication, promotion, and bounded local-dev mechanics for Delivery Pipeline.',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'xhigh',
      serviceTier: 'fast',
      contextPaths: [
        '.cortex/teams/delivery-pipeline/pr-lifecycle/AGENTS.md',
        '.cortex/teams/delivery-pipeline/pr-lifecycle/knowledge-graph.md',
      ],
      parent: TeamGizmoKey.DeliveryPipeline,
      reportingBoundary:
        'Reports bounded PR lifecycle evidence and blockers to Delivery Pipeline Team Gizmo, which forwards policy-owned evidence to the issuing controller.',
      capabilityBoundary: INTERNAL_AGENT_CAPABILITY_BOUNDARY,
    },
  ] as const;
