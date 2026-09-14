import { existsSync, lstatSync, readFileSync } from 'node:fs';

import { join, normalize } from 'node:path';

import {
  TEAM_GIZMO_CATALOG,
  TEAM_INTERNAL_AGENT_CATALOG,
  TEAM_AUTHORITY_CATALOG,
  TeamGizmoKey,
  TeamInternalAgentKey,
  TeamKey,
} from './catalog.ts';

import type {
  TeamAuthority,
  TeamGizmoProfile,
  TeamInternalAgentProfile,
} from './catalog.ts';

import { CORTEX_AUTHORING_SKILL_PATHS } from './context.ts';

export class TeamAgentContract {
  private constructor(private readonly request: AuditTeamAgentsRequest) {}

  static auditTeamAgents(
    request: AuditTeamAgentsRequest,
  ): TeamAgentAuditReport {
    return new TeamAgentContract(request).execute();
  }

  private execute(): TeamAgentAuditReport {
    const request = this.request;
    const authorityRequest: AuditTeamAuthoritiesRequest = {
      repoRoot: request.repoRoot,
      authorities: TEAM_AUTHORITY_CATALOG,
    };
    const authorityReport =
      TeamAgentContract.auditTeamAuthorities(authorityRequest);
    const gizmoReport = TeamAgentContract.auditTeamGizmos({
      repoRoot: request.repoRoot,
      gizmos: TEAM_GIZMO_CATALOG,
    });
    const internalAgentReport = TeamAgentContract.auditTeamInternalAgents({
      repoRoot: request.repoRoot,
      agents: TEAM_INTERNAL_AGENT_CATALOG,
    });
    return {
      ...authorityReport,
      findings: [
        ...authorityReport.findings,
        ...gizmoReport.findings,
        ...internalAgentReport.findings,
      ],
      auditOk:
        authorityReport.auditOk &&
        gizmoReport.auditOk &&
        internalAgentReport.auditOk,
      teamGizmoCount: gizmoReport.catalogCount,
      teamInternalAgentCount: internalAgentReport.catalogCount,
    };
  }

  static auditTeamGizmos(
    request: AuditTeamGizmosRequest,
  ): TeamAgentCatalogAuditReport {
    const findings: TeamAuthorityAuditFinding[] = [];
    const seenKeys = new Set<TeamGizmoKey>();
    const seenIdentities = new Set<string>();
    for (const gizmo of request.gizmos) {
      const expected = EXPECTED_TEAM_GIZMOS.get(gizmo.key);
      if (
        !expected ||
        gizmo.team !== expected.team ||
        gizmo.identity !== expected.identity ||
        seenKeys.has(gizmo.key) ||
        seenIdentities.has(gizmo.identity) ||
        gizmo.description !== expected.description ||
        gizmo.model !== expected.model ||
        gizmo.reasoningEffort !== expected.reasoningEffort ||
        gizmo.serviceTier !== expected.serviceTier ||
        gizmo.parent !== expected.parent ||
        gizmo.reportingBoundary !== expected.reportingBoundary ||
        gizmo.capabilityBoundary !== EXPECTED_TEAM_GIZMO_CAPABILITY_BOUNDARY ||
        JSON.stringify(gizmo.contextPaths) !==
          JSON.stringify(expected.contextPaths)
      ) {
        findings.push({
          code: 'invalid-team-gizmo-contract',
          path: TEAM_CATALOG_PATH,
          message: `Team Gizmo contract is missing, duplicated, or drifted: ${gizmo.key}`,
        });
      }
      seenKeys.add(gizmo.key);
      seenIdentities.add(gizmo.identity);
      findings.push(
        ...TeamAgentContract.auditContextPaths(
          request.repoRoot,
          gizmo.contextPaths,
          'unsafe-team-gizmo-context-path',
          'missing-team-gizmo-context-path',
          'Team Gizmo',
        ),
      );
    }
    if (request.gizmos.length !== EXPECTED_TEAM_GIZMOS.size) {
      findings.push({
        code: 'invalid-team-gizmo-count',
        path: TEAM_CATALOG_PATH,
        message: `The Team Gizmo catalog must contain one profile per team (${EXPECTED_TEAM_GIZMOS.size} total).`,
      });
    }
    return {
      findings,
      catalogCount: request.gizmos.length,
      auditOk: findings.length === 0,
    };
  }

  static auditTeamInternalAgents(
    request: AuditTeamInternalAgentsRequest,
  ): TeamAgentCatalogAuditReport {
    const findings: TeamAuthorityAuditFinding[] = [];
    const seenKeys = new Set<TeamInternalAgentKey>();
    const seenIdentities = new Set<string>();
    for (const agent of request.agents) {
      const expected = EXPECTED_TEAM_INTERNAL_AGENTS.get(agent.key);
      if (
        !expected ||
        agent.team !== expected.team ||
        agent.identity !== expected.identity ||
        seenKeys.has(agent.key) ||
        seenIdentities.has(agent.identity) ||
        agent.description !== expected.description ||
        agent.model !== expected.model ||
        agent.reasoningEffort !== expected.reasoningEffort ||
        agent.serviceTier !== expected.serviceTier ||
        agent.parent !== expected.parent ||
        agent.reportingBoundary !== expected.reportingBoundary ||
        JSON.stringify(agent.activationContract) !==
          JSON.stringify(expected.activationContract) ||
        agent.capabilityBoundary !==
          EXPECTED_TEAM_INTERNAL_AGENT_CAPABILITY_BOUNDARY ||
        JSON.stringify(agent.contextPaths) !==
          JSON.stringify(expected.contextPaths)
      ) {
        findings.push({
          code: 'invalid-team-internal-agent-contract',
          path: TEAM_CATALOG_PATH,
          message: `Internal Team Agent contract is missing, duplicated, or drifted: ${agent.key}`,
        });
      }
      seenKeys.add(agent.key);
      seenIdentities.add(agent.identity);
      findings.push(
        ...TeamAgentContract.auditContextPaths(
          request.repoRoot,
          agent.contextPaths,
          'unsafe-team-internal-agent-context-path',
          'missing-team-internal-agent-context-path',
          'Internal Team Agent',
        ),
      );
    }
    if (request.agents.length !== EXPECTED_TEAM_INTERNAL_AGENTS.size) {
      findings.push({
        code: 'invalid-team-internal-agent-count',
        path: TEAM_CATALOG_PATH,
        message: `The internal Team Agent catalog must contain the canonical roster (${EXPECTED_TEAM_INTERNAL_AGENTS.size} total).`,
      });
    }
    return {
      findings,
      catalogCount: request.agents.length,
      auditOk: findings.length === 0,
    };
  }

  private static auditContextPaths(
    ...[repoRoot, contextPaths, unsafeCode, missingCode, contextLabel]: [
      repoRoot: string,
      contextPaths: readonly string[],
      unsafeCode: string,
      missingCode: string,
      contextLabel: string,
    ]
  ): readonly TeamAuthorityAuditFinding[] {
    const findings: TeamAuthorityAuditFinding[] = [];
    for (const contextPath of contextPaths) {
      if (!TeamAgentContract.safeRepositoryPath(contextPath)) {
        findings.push({
          code: unsafeCode,
          path: contextPath,
          message: `${contextLabel} context paths must be normalized and repository-relative.`,
        });
      } else if (
        !TeamAgentContract.isRegularFile(join(repoRoot, contextPath))
      ) {
        findings.push({
          code: missingCode,
          path: contextPath,
          message: `${contextLabel} context is missing: ${contextPath}`,
        });
      }
    }
    return findings;
  }

  static auditTeamAuthorities(
    request: AuditTeamAuthoritiesRequest,
  ): TeamAuthorityAuditReport {
    const findings: TeamAuthorityAuditFinding[] = [];
    const seenKeys = new Set<TeamKey>();
    const seenIdentities = new Set<string>();
    const authoritySource = existsSync(
      join(request.repoRoot, TEAM_AUTHORITY_PATH),
    )
      ? readFileSync(join(request.repoRoot, TEAM_AUTHORITY_PATH), 'utf8')
      : '';
    const gizmoSource = existsSync(join(request.repoRoot, GIZMO_AUTHORITY_PATH))
      ? readFileSync(join(request.repoRoot, GIZMO_AUTHORITY_PATH), 'utf8')
      : '';
    if (authoritySource.length === 0) {
      findings.push({
        code: 'missing-cortex-team-authority',
        path: TEAM_AUTHORITY_PATH,
        message: 'Canonical Cortex team authority is missing.',
      });
    }
    if (gizmoSource.length === 0) {
      findings.push({
        code: 'missing-cortex-gizmo-authority',
        path: GIZMO_AUTHORITY_PATH,
        message: 'Canonical Gizmo authority is missing.',
      });
    }
    for (const marker of TEAM_AUTHORITY_MARKERS) {
      if (!authoritySource.includes(marker)) {
        findings.push({
          code: 'invalid-cortex-team-authority',
          path: TEAM_AUTHORITY_PATH,
          message: `Canonical Cortex team authority is missing marker: ${marker}`,
        });
      }
    }
    for (const marker of GIZMO_AUTHORITY_MARKERS) {
      if (!gizmoSource.includes(marker)) {
        findings.push({
          code: 'invalid-cortex-gizmo-authority',
          path: GIZMO_AUTHORITY_PATH,
          message: `Canonical Gizmo authority is missing marker: ${marker}`,
        });
      }
    }
    if (!gizmoSource.includes(`\n${GIZMO_PROHIBITION_HEADING}\n`)) {
      findings.push({
        code: 'invalid-cortex-gizmo-authority',
        path: GIZMO_AUTHORITY_PATH,
        message: `Canonical Gizmo authority is missing marker: ${GIZMO_PROHIBITION_HEADING}`,
      });
    }
    const gizmoProhibitionSection =
      TeamAgentContract.gizmoProhibitionSection(gizmoSource);
    if (!gizmoProhibitionSection.includes(GIZMO_IMPLEMENTATION_PROHIBITION)) {
      findings.push({
        code: 'invalid-cortex-gizmo-authority',
        path: GIZMO_AUTHORITY_PATH,
        message: `Canonical Gizmo authority is missing marker: ${GIZMO_IMPLEMENTATION_PROHIBITION}`,
      });
    }
    for (const skillPath of CORTEX_AUTHORING_SKILL_PATHS) {
      if (!existsSync(join(request.repoRoot, skillPath))) {
        const finding: TeamAuthorityAuditFinding = {
          code: 'missing-cortex-authoring-skill',
          path: skillPath,
          message: `Canonical Cortex authoring skill is missing: ${skillPath}`,
        };
        findings.push(finding);
      }
    }
    if (request.authorities.length !== EXPECTED_TEAM_AUTHORITIES.size) {
      const finding: TeamAuthorityAuditFinding = {
        code: 'invalid-team-authority-count',
        path: TEAM_CATALOG_PATH,
        message: 'The canonical Cortex team catalog must contain six teams.',
      };
      findings.push(finding);
    }
    for (const authority of request.authorities) {
      const expected = EXPECTED_TEAM_AUTHORITIES.get(authority.key);
      const expectedContextPaths = expected
        ? [
            `.cortex/teams/${expected.contextDirectory}/AGENTS.md`,
            `.cortex/teams/${expected.contextDirectory}/knowledge-graph.md`,
          ]
        : [];
      if (
        !expected ||
        authority.identity !== expected.identity ||
        seenKeys.has(authority.key) ||
        seenIdentities.has(authority.identity)
      ) {
        const finding: TeamAuthorityAuditFinding = {
          code: 'invalid-team-authority-identity',
          path: TEAM_CATALOG_PATH,
          message: `Team authority identity is missing, duplicated, or drifted: ${authority.key}`,
        };
        findings.push(finding);
      }
      seenKeys.add(authority.key);
      seenIdentities.add(authority.identity);
      if (
        JSON.stringify(authority.contextPaths) !==
          JSON.stringify(expectedContextPaths) ||
        authority.description !== expected?.description ||
        authority.capabilityBoundary !== expected?.capabilityBoundary
      ) {
        const finding: TeamAuthorityAuditFinding = {
          code: 'invalid-team-authority-contract',
          path: TEAM_CATALOG_PATH,
          message: `Team authority contract is incomplete or drifted: ${authority.key}`,
        };
        findings.push(finding);
      }
      for (const contextPath of authority.contextPaths) {
        if (!TeamAgentContract.safeRepositoryPath(contextPath)) {
          const finding: TeamAuthorityAuditFinding = {
            code: 'unsafe-team-context-path',
            path: contextPath,
            message:
              'Team context paths must be normalized and repository-relative.',
          };
          findings.push(finding);
        } else if (
          !TeamAgentContract.isRegularFile(join(request.repoRoot, contextPath))
        ) {
          const finding: TeamAuthorityAuditFinding = {
            code: 'missing-team-context-path',
            path: contextPath,
            message: `Canonical Cortex team context is missing: ${contextPath}`,
          };
          findings.push(finding);
        }
      }
    }
    return {
      findings,
      authorityCount: request.authorities.length,
      auditOk: findings.length === 0,
    };
  }

  private static safeRepositoryPath(path: string): boolean {
    return (
      path !== '' &&
      !path.startsWith('/') &&
      !path.includes('\\') &&
      !path.includes('\u0000') &&
      !path.split('/').includes('..') &&
      normalize(path) === path
    );
  }

  private static isRegularFile(path: string): boolean {
    try {
      return lstatSync(path).isFile();
    } catch {
      return false;
    }
  }

  private static gizmoProhibitionSection(source: string): string {
    const headingMarker = `\n${GIZMO_PROHIBITION_HEADING}\n`;
    const headingStart = source.indexOf(headingMarker);
    if (headingStart < 0) return '';
    const bodyStart = headingStart + headingMarker.length;
    const nextSectionStart = source.indexOf('\n## ', bodyStart);
    return nextSectionStart < 0
      ? source.slice(bodyStart)
      : source.slice(bodyStart, nextSectionStart);
  }
}

export type TeamAuthorityAuditFinding = {
  readonly code: string;
  readonly path: string;
  readonly message: string;
};

export type TeamAuthorityAuditReport = {
  readonly findings: readonly TeamAuthorityAuditFinding[];
  readonly authorityCount: number;
  readonly auditOk: boolean;
};

export type TeamAgentAuditReport = TeamAuthorityAuditReport & {
  readonly teamGizmoCount: number;
  readonly teamInternalAgentCount: number;
};

export type TeamAgentCatalogAuditReport = {
  readonly findings: readonly TeamAuthorityAuditFinding[];
  readonly catalogCount: number;
  readonly auditOk: boolean;
};

export type AuditTeamAuthoritiesRequest = {
  readonly repoRoot: string;
  readonly authorities: readonly TeamAuthority[];
};

export type AuditTeamAgentsRequest = {
  readonly repoRoot: string;
};

export type AuditTeamGizmosRequest = {
  readonly repoRoot: string;
  readonly gizmos: readonly TeamGizmoProfile[];
};

export type AuditTeamInternalAgentsRequest = {
  readonly repoRoot: string;
  readonly agents: readonly TeamInternalAgentProfile[];
};

type ExpectedTeamAuthority = {
  readonly identity: string;
  readonly contextDirectory: string;
  readonly description: string;
  readonly capabilityBoundary: string;
};

const TEAM_CATALOG_PATH = 'agentic-ai/loom/src/team-agents/catalog.ts';

const TEAM_AUTHORITY_PATH = '.cortex/AGENTS.md';

const GIZMO_AUTHORITY_PATH = '.cortex/gizmo-prime/AGENTS.md';

const TEAM_AUTHORITY_MARKERS = [
  '## Mandatory context selection',
  '## Team worker contract',
  'exactly one team identity',
  'canonical typed\nCortex authoring composition',
  'Routine uncertainty, implementation breadth, validation failures, and\n  delivery sequencing are not blockers or reasons to ask the user.',
  'Continue implementation, validation, repair, and authorized delivery until\n  complete delivery or an explicitly requested intermediate stop is reached.',
  'An implementation request defaults to complete delivery.',
  'Silence about\nmerge is not an intermediate selection.',
] as const;

const GIZMO_AUTHORITY_MARKERS = [
  'single root delivery owner',
  'exactly one team identity',
  'The branch name is the workflow authority.',
] as const;

const GIZMO_PROHIBITION_HEADING = 'Gizmo does not:';

const GIZMO_IMPLEMENTATION_PROHIBITION =
  '- implement or repair team-owned work;';

const PARENT_OWNED_LIFECYCLE_BOUNDARY =
  'The active harness owns creation, communication, scheduling, retries, cancellation, barriers, synthesis, and delivery lifecycle state.';

type ExpectedTeamGizmoProfile = Pick<
  TeamGizmoProfile,
  | 'key'
  | 'team'
  | 'identity'
  | 'description'
  | 'model'
  | 'reasoningEffort'
  | 'serviceTier'
  | 'contextPaths'
  | 'parent'
  | 'reportingBoundary'
>;

type ExpectedTeamInternalAgentProfile = Pick<
  TeamInternalAgentProfile,
  | 'key'
  | 'team'
  | 'identity'
  | 'description'
  | 'model'
  | 'reasoningEffort'
  | 'serviceTier'
  | 'contextPaths'
  | 'parent'
  | 'reportingBoundary'
  | 'activationContract'
>;

const EXPECTED_TEAM_GIZMO_PROFILES: readonly ExpectedTeamGizmoProfile[] = [
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
  },
] as const;

const EXPECTED_TEAM_INTERNAL_AGENT_PROFILES: readonly ExpectedTeamInternalAgentProfile[] =
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
          'sccache-read-only-startup-fallback',
          'sccache-read-only-transport-fallback',
          'sccache-read-only-circuit-open',
          'sccache-compiler-failure',
          'sccache-read-write-transport-failure',
          'sccache-readiness-contract-violation',
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
        sccacheReadOnlyPolicy:
          'optional-accelerator-two-second-single-start-shared-run-circuit-structured-fallback-direct-compiler-zero-writes',
        sccacheReadWritePolicy:
          'publication-startup-credential-read-and-write-failures-remain-terminal',
        sccacheFaultProofPolicy:
          'simulator-and-proof-cover-startup-dns-read-open-circuit-compiler-read-write-and-healthy-single-start',
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
    },
  ] as const;

const EXPECTED_TEAM_GIZMO_CAPABILITY_BOUNDARY =
  'Team Gizmo coordinates only its team mechanics. It does not implement product code, choose functional ownership, decide readiness or promotion, or issue the final delivery verdict. It never creates or updates pull requests and never performs squash, rebase, or force-push operations.';

const EXPECTED_TEAM_INTERNAL_AGENT_CAPABILITY_BOUNDARY =
  'Internal Team Agent operates only within its bounded team expertise. It never creates or updates pull requests, performs squash, rebase, or force-push operations, changes parent ownership, or issues the final delivery verdict.';

const EXPECTED_TEAM_GIZMOS = new Map<TeamGizmoKey, ExpectedTeamGizmoProfile>(
  EXPECTED_TEAM_GIZMO_PROFILES.map((gizmo) => [gizmo.key, gizmo]),
);

const EXPECTED_TEAM_INTERNAL_AGENTS = new Map<
  TeamInternalAgentKey,
  ExpectedTeamInternalAgentProfile
>(EXPECTED_TEAM_INTERNAL_AGENT_PROFILES.map((agent) => [agent.key, agent]));

const EXPECTED_TEAM_AUTHORITIES = new Map<TeamKey, ExpectedTeamAuthority>([
  [
    TeamKey.Ai,
    {
      identity: 'AI',
      contextDirectory: 'ai',
      description:
        'Owns Cortex, Loom, agent skills, expert routing, and agent automation.',
      capabilityBoundary: `AI defines agent capability semantics and acceptance. ${PARENT_OWNED_LIFECYCLE_BOUNDARY}`,
    },
  ],
  [
    TeamKey.DevelopmentCore,
    {
      identity: 'Development core',
      contextDirectory: 'dev-core',
      description:
        'Owns portable Rust behavior, vault behavior, security-control implementation, and typed WASM contracts.',
      capabilityBoundary: `Development core does not own browser presentation, infrastructure operations, or another team's Cortex authority. ${PARENT_OWNED_LIFECYCLE_BOUNDARY}`,
    },
  ],
  [
    TeamKey.Security,
    {
      identity: 'Security',
      contextDirectory: 'security',
      description:
        'Owns security architecture, cryptographic policy, trust boundaries, and security acceptance.',
      capabilityBoundary: `Security owns invariants and acceptance without taking implementation ownership from another team. ${PARENT_OWNED_LIFECYCLE_BOUNDARY}`,
    },
  ],
  [
    TeamKey.Sre,
    {
      identity: 'SRE',
      contextDirectory: 'sre',
      description:
        'Owns CI/CD, clusters, deployments, runners, containers, and operations.',
      capabilityBoundary: `SRE does not own product rules, browser presentation, or another team's Cortex authority. ${PARENT_OWNED_LIFECYCLE_BOUNDARY}`,
    },
  ],
  [
    TeamKey.WebDevelopment,
    {
      identity: 'Web development',
      contextDirectory: 'web-dev',
      description:
        'Owns TypeScript and Svelte engineering expertise, browser presentation, frontend behavior, and extension interaction.',
      capabilityBoundary: `Web development may implement bounded TypeScript expertise without taking consumer capability semantics or Cortex authority. ${PARENT_OWNED_LIFECYCLE_BOUNDARY}`,
    },
  ],
  [
    TeamKey.DeliveryPipeline,
    {
      identity: 'Delivery Pipeline',
      contextDirectory: 'delivery-pipeline',
      description:
        'Owns delivery mechanics across CI, pull-request lifecycle, development-branch publication, workflow execution, validation evidence, local landing, and guarded promotion.',
      capabilityBoundary: `Delivery Pipeline executes authorized delivery mechanics without owning functional product implementation or policy verdicts. ${PARENT_OWNED_LIFECYCLE_BOUNDARY}`,
    },
  ],
]);
