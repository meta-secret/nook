import { existsSync, readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { TEAM_AUTHORITY_CATALOG, TeamKey } from './catalog.ts';
import type { TeamAuthority } from './catalog.ts';
import { CORTEX_AUTHORING_SKILL_PATHS } from './context.ts';

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
] as const;
const GIZMO_AUTHORITY_MARKERS = [
  'single root delivery owner',
  'does not implement or repair team-owned work',
  'exactly one team identity',
  'final verdict is bound to the exact delivery head',
] as const;
const PARENT_OWNED_LIFECYCLE_BOUNDARY =
  'The active harness owns creation, communication, scheduling, retries, cancellation, barriers, synthesis, and delivery lifecycle state.';
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

export function auditTeamAgents(
  request: AuditTeamAgentsRequest,
): TeamAuthorityAuditReport {
  const authorityRequest: AuditTeamAuthoritiesRequest = {
    repoRoot: request.repoRoot,
    authorities: TEAM_AUTHORITY_CATALOG,
  };
  return auditTeamAuthorities(authorityRequest);
}

export function auditTeamAuthorities(
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
      if (!safeRepositoryPath(contextPath)) {
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

function safeRepositoryPath(path: string): boolean {
  return (
    path !== '' &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.includes('\u0000') &&
    !path.split('/').includes('..') &&
    normalize(path) === path
  );
}
