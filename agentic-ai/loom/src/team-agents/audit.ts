import { existsSync, readFileSync } from 'node:fs';

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
        gizmo.parent !== expected.parent ||
        gizmo.reportingBoundary !== expected.reportingBoundary ||
        gizmo.capabilityBoundary !== expected.capabilityBoundary ||
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
        message: 'The Team Gizmo catalog must contain one profile.',
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
        agent.parent !== expected.parent ||
        agent.reportingBoundary !== expected.reportingBoundary ||
        agent.capabilityBoundary !== expected.capabilityBoundary ||
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
        message: 'The internal Team Agent catalog must contain one profile.',
      });
    }
    return {
      findings,
      catalogCount: request.agents.length,
      auditOk: findings.length === 0,
    };
  }

  private static auditContextPaths(
    repoRoot: string,
    contextPaths: readonly string[],
    unsafeCode: string,
    missingCode: string,
    contextLabel: string,
  ): readonly TeamAuthorityAuditFinding[] {
    const findings: TeamAuthorityAuditFinding[] = [];
    for (const contextPath of contextPaths) {
      if (!TeamAgentContract.safeRepositoryPath(contextPath)) {
        findings.push({
          code: unsafeCode,
          path: contextPath,
          message: `${contextLabel} context paths must be normalized and repository-relative.`,
        });
      } else if (!existsSync(join(repoRoot, contextPath))) {
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
        } else if (!existsSync(join(request.repoRoot, contextPath))) {
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

const GIZMO_AUTHORITY_PATH = '.cortex/gizmo/AGENTS.md';

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
  'final verdict is bound to the exact pull-request head',
] as const;

const GIZMO_PROHIBITION_HEADING = 'Gizmo does not:';

const GIZMO_IMPLEMENTATION_PROHIBITION =
  '- implement or repair team-owned work;';

const PARENT_OWNED_LIFECYCLE_BOUNDARY =
  'The active harness owns creation, communication, scheduling, retries, cancellation, barriers, synthesis, and delivery lifecycle state.';

const EXPECTED_TEAM_GIZMOS = new Map<TeamGizmoKey, TeamGizmoProfile>([
  [
    TeamGizmoKey.DeliveryPipeline,
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
  ],
]);

const EXPECTED_TEAM_INTERNAL_AGENTS = new Map<
  TeamInternalAgentKey,
  TeamInternalAgentProfile
>([
  [
    TeamInternalAgentKey.PrSteward,
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
  ],
]);

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
