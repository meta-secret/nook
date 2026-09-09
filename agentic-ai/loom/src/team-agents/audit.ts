import { existsSync, readFileSync } from 'node:fs';

import { join, normalize } from 'node:path';

import {
  GIZMO_OWNED_AGENT_CATALOG,
  TEAM_AUTHORITY_CATALOG,
  GizmoOwnedAgentKey,
  TeamKey,
} from './catalog.ts';

import type { GizmoOwnedAgentProfile, TeamAuthority } from './catalog.ts';

import { CORTEX_AUTHORING_SKILL_PATHS } from './context.ts';

export class TeamAgentContract {
  private constructor(private readonly request: AuditTeamAgentsRequest) {}

  static auditTeamAgents(
    request: AuditTeamAgentsRequest,
  ): TeamAuthorityAuditReport {
    return new TeamAgentContract(request).execute();
  }

  private execute(): TeamAuthorityAuditReport {
    const request = this.request;
    const authorityRequest: AuditTeamAuthoritiesRequest = {
      repoRoot: request.repoRoot,
      authorities: TEAM_AUTHORITY_CATALOG,
    };
    const authorityReport =
      TeamAgentContract.auditTeamAuthorities(authorityRequest);
    const operationalFindings = TeamAgentContract.auditGizmoOwnedAgents(
      request.repoRoot,
    );
    return {
      ...authorityReport,
      findings: [...authorityReport.findings, ...operationalFindings],
      auditOk: authorityReport.auditOk && operationalFindings.length === 0,
    };
  }

  private static auditGizmoOwnedAgents(
    repoRoot: string,
  ): readonly TeamAuthorityAuditFinding[] {
    const findings: TeamAuthorityAuditFinding[] = [];
    const seenKeys = new Set<GizmoOwnedAgentKey>();
    const seenIdentities = new Set<string>();
    for (const agent of GIZMO_OWNED_AGENT_CATALOG) {
      const expected = EXPECTED_GIZMO_OWNED_AGENTS.get(agent.key);
      if (
        !expected ||
        agent.identity !== expected.identity ||
        seenKeys.has(agent.key) ||
        seenIdentities.has(agent.identity) ||
        agent.description !== expected.description ||
        agent.model !== 'gpt-5.6-luna' ||
        agent.reasoningEffort !== 'xhigh' ||
        agent.capabilityBoundary !== expected.capabilityBoundary ||
        JSON.stringify(agent.contextPaths) !==
          JSON.stringify(expected.contextPaths)
      ) {
        findings.push({
          code: 'invalid-operational-team-agent-contract',
          path: TEAM_CATALOG_PATH,
          message: `Operational Team Agent contract is missing, duplicated, or drifted: ${agent.key}`,
        });
      }
      seenKeys.add(agent.key);
      seenIdentities.add(agent.identity);
      for (const contextPath of agent.contextPaths) {
        if (!TeamAgentContract.safeRepositoryPath(contextPath)) {
          findings.push({
            code: 'unsafe-operational-team-context-path',
            path: contextPath,
            message:
              'Operational Team Agent context paths must be normalized and repository-relative.',
          });
        } else if (!existsSync(join(repoRoot, contextPath))) {
          findings.push({
            code: 'missing-operational-team-context-path',
            path: contextPath,
            message: `Operational Team Agent context is missing: ${contextPath}`,
          });
        }
      }
    }
    if (GIZMO_OWNED_AGENT_CATALOG.length !== EXPECTED_GIZMO_OWNED_AGENTS.size) {
      findings.push({
        code: 'invalid-operational-team-agent-count',
        path: TEAM_CATALOG_PATH,
        message: 'The operational Team Agent catalog has drifted.',
      });
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
        message: 'The canonical Cortex team catalog must contain five teams.',
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

export type AuditTeamAuthoritiesRequest = {
  readonly repoRoot: string;
  readonly authorities: readonly TeamAuthority[];
};

export type AuditTeamAgentsRequest = {
  readonly repoRoot: string;
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
  'Gizmo does not:\n\n- implement or repair team-owned work;',
  'exactly one team identity',
  'final verdict is bound to the exact pull-request head',
] as const;

const PARENT_OWNED_LIFECYCLE_BOUNDARY =
  'The active harness owns creation, communication, scheduling, retries, cancellation, barriers, synthesis, and delivery lifecycle state.';

const EXPECTED_GIZMO_OWNED_AGENTS = new Map<
  GizmoOwnedAgentKey,
  Omit<GizmoOwnedAgentProfile, 'key' | 'model' | 'reasoningEffort'>
>([
  [
    GizmoOwnedAgentKey.PrSteward,
    {
      identity: 'PR Steward',
      description:
        'Executes explicitly authorized pull-request metadata, review, validation, readiness-evidence, merge, and merge-verification operations for Gizmo Prime.',
      contextPaths: [
        '.cortex/teams/pr-steward/AGENTS.md',
        '.cortex/teams/pr-steward/knowledge-graph.md',
      ],
      capabilityBoundary:
        'PR Steward never edits functional code, adjudicates technical findings, sequences shared-branch writers, owns Workbench outcomes, or issues the final delivery verdict.',
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
]);
