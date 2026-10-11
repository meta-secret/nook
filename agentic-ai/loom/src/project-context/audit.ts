import { existsSync, lstatSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { TEAM_AUTHORITY_CATALOG, TeamKey } from './catalog.ts';
import type { TeamAuthority } from './catalog.ts';
import { CORTEX_AUTHORING_SKILL_PATHS } from './context.ts';

export class ProjectContextContract {
  private constructor(private readonly request: AuditProjectContextsRequest) {}

  static auditProjectContexts(
    request: AuditProjectContextsRequest,
  ): TeamAuthorityAuditReport {
    return new ProjectContextContract(request).execute();
  }

  private execute(): TeamAuthorityAuditReport {
    const request: AuditTeamAuthoritiesRequest = {
      repoRoot: this.request.repoRoot,
      authorities: TEAM_AUTHORITY_CATALOG,
    };
    return ProjectContextContract.auditTeamAuthorities(request);
  }

  static auditTeamAuthorities(
    request: AuditTeamAuthoritiesRequest,
  ): TeamAuthorityAuditReport {
    const findings: TeamAuthorityAuditFinding[] = [];
    const seenKeys = new Set<TeamKey>();
    const seenIdentities = new Set<string>();
    if (
      !ProjectContextContract.isNonemptyRegularFile(
        join(request.repoRoot, TEAM_AUTHORITY_PATH),
      )
    ) {
      findings.push({
        code: 'missing-cortex-team-authority',
        path: TEAM_AUTHORITY_PATH,
        message: 'Canonical Cortex team authority is missing.',
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
            `.cortex/teams/${expected.contextDirectory}/docs/spec/functional-ownership.md`,
            `.cortex/teams/${expected.contextDirectory}/index.md`,
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
        authority.description.trim().length === 0 ||
        authority.capabilityBoundary.trim().length === 0
      ) {
        const finding: TeamAuthorityAuditFinding = {
          code: 'invalid-team-authority-contract',
          path: TEAM_CATALOG_PATH,
          message: `Team authority contract is incomplete or drifted: ${authority.key}`,
        };
        findings.push(finding);
      }
      for (const contextPath of authority.contextPaths) {
        if (!ProjectContextContract.safeRepositoryPath(contextPath)) {
          const finding: TeamAuthorityAuditFinding = {
            code: 'unsafe-team-context-path',
            path: contextPath,
            message:
              'Team context paths must be normalized and repository-relative.',
          };
          findings.push(finding);
        } else if (
          !ProjectContextContract.isNonemptyRegularFile(
            join(request.repoRoot, contextPath),
          )
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

  private static isNonemptyRegularFile(path: string): boolean {
    try {
      const metadata = lstatSync(path);
      return metadata.isFile() && metadata.size > 0;
    } catch {
      return false;
    }
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
export type AuditProjectContextsRequest = { readonly repoRoot: string };
type ExpectedTeamAuthority = {
  readonly identity: string;
  readonly contextDirectory: string;
};
const TEAM_CATALOG_PATH = 'agentic-ai/loom/src/project-context/catalog.ts';
const TEAM_AUTHORITY_PATH = '.cortex/AGENTS.md';
const EXPECTED_TEAM_AUTHORITIES = new Map<TeamKey, ExpectedTeamAuthority>([
  [
    TeamKey.Ai,
    {
      identity: 'AI',
      contextDirectory: 'ai',
    },
  ],
  [
    TeamKey.DevelopmentCore,
    {
      identity: 'Development core',
      contextDirectory: 'dev-core',
    },
  ],
  [
    TeamKey.Security,
    {
      identity: 'Security',
      contextDirectory: 'security',
    },
  ],
  [
    TeamKey.Sre,
    {
      identity: 'SRE',
      contextDirectory: 'sre',
    },
  ],
  [
    TeamKey.WebDevelopment,
    {
      identity: 'Web development',
      contextDirectory: 'web-dev',
    },
  ],
  [
    TeamKey.DeliveryPipeline,
    {
      identity: 'Delivery Pipeline',
      contextDirectory: 'delivery-pipeline',
    },
  ],
]);
