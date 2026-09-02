import { existsSync, readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import type { Nodes } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
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

enum CortexAuthorityName {
  Team = 'team',
  Gizmo = 'Gizmo',
}

type LocalExecutionGrantAudit = {
  readonly findings: TeamAuthorityAuditFinding[];
  readonly source: string;
  readonly path: string;
  readonly authorityName: CortexAuthorityName;
};

type AuthorityStatementInspection = {
  readonly nodes: readonly Nodes[];
  readonly inheritedGrant: string | false;
  readonly statements: string[];
};

type AppendAuthoritySentencesRequest = {
  readonly statements: string[];
  readonly text: string;
};

const TEAM_CATALOG_PATH = 'agentic-ai/loom/src/team-agents/catalog.ts';
const TEAM_AUTHORITY_PATH = '.cortex/AGENTS.md';
const GIZMO_AUTHORITY_PATH = '.cortex/gizmo/AGENTS.md';
const TEAM_AUTHORITY_MARKERS = [
  '## Mandatory context selection',
  '## Team worker contract',
  '## Remote-only agent execution',
  'Agents never run product compilation or repository validation locally.',
  'A missing remote task is a blocker. Never substitute local execution.',
  'exactly one team identity',
  'canonical typed\nCortex authoring composition',
  'Routine uncertainty, implementation breadth, validation failures, and\n  delivery sequencing are not blockers or reasons to ask the user.',
  'Continue implementation, validation, repair, and authorized delivery until\n  the user-selected terminal state is reached.',
] as const;
const GIZMO_AUTHORITY_MARKERS = [
  'single root delivery owner',
  'Gizmo does not:\n\n- implement or repair team-owned work;',
  'Gizmo never asks a worker to run local compilation or validation.',
  'exactly one team identity',
  'final verdict is bound to the exact pull-request head',
] as const;
const AGENT_EXECUTION_DIRECTION =
  /\b(?:agents?|team agents?|workers?|gizmo)\s+(?:may|can|must|shall|need to|are allowed to|is allowed to|are permitted to|is permitted to|are required to|is required to)\s+(?:ask\s+(?:an?\s+)?(?:team\s+)?(?:agent|worker)s?\s+to\s+)?(?:locally\s+)?(?:(?:run|invoke|perform|execute)\s+(?:(?:focused|required|shared|product|project|repository|source|package|local)\s+){0,4}(?:compilation|compilers?|checks?|checking|tests?|testing|test runners?|linting|linters?|typechecks?|typechecking|typecheckers?|builds?|bundles?|bundling|bundlers?|validation|installs?|installing|dependency installation|package installers?|browser suites?)|(?:compile|compiling|check(?:ing)?|test(?:ing)?|lint(?:ing)?|typecheck(?:ing)?|validate|validating|bundle|bundling|install(?:ing)?)(?:\s+(?:the\s+)?(?:product|project|repository|source|package|dependencies|browser suites?))?|build(?:ing)?\s+(?:the\s+)?(?:product|project|repository|source|package))\b/iu;
const IMPERATIVE_EXECUTION_DIRECTION =
  /^(?:locally\s+)?(?:(?:run|invoke|perform|execute)\s+(?:(?:focused|required|shared|product|project|repository|source|package|local)\s+){0,4}(?:compilation|compilers?|checks?|checking|tests?|testing|test runners?|linting|linters?|typechecks?|typechecking|typecheckers?|builds?|bundles?|bundling|bundlers?|validation|installs?|installing|dependency installation|package installers?|browser suites?)|(?:compile|compiling|check(?:ing)?|test(?:ing)?|lint(?:ing)?|typecheck(?:ing)?|validate|validating|bundle|bundling|install(?:ing)?)(?:\s+(?:the\s+)?(?:product|project|repository|source|package|dependencies|browser suites?))?|build(?:ing)?\s+(?:the\s+)?(?:product|project|repository|source|package))\b/iu;
const PROHIBITED_COMMAND =
  /^(?:cargo\s+(?:test|build|check|run|clippy|install|add|update)\b|rustc\b|wasm-pack\b|bun\s+(?:test|install|add|build|x\s+(?:tsc|eslint)|run\s+(?:test|lint|check|typecheck|build|bundle))\b|(?:npm|pnpm|yarn)\s+(?:test|install|add|exec\s+(?:tsc|eslint)|run\s+(?:test|lint|check|typecheck|build|bundle))\b|tsc\b|eslint\b|task\s+(?!(?:loom:pre-push|loom:cortex-session-clean|loom:delegation-visualization|loom:agent-stats-control|remote|loom:pr-land|pr:validate|pr:review|pr:ready)(?=\s|$))\S+)/iu;
const AGENT_COMMAND_DIRECTION =
  /\b(?:agents?|team agents?|workers?|gizmo)\s+(?:may|can|must|shall|need to|are allowed to|is allowed to|are permitted to|is permitted to|are required to|is required to)\s+(?:ask\s+(?:an?\s+)?(?:team\s+)?(?:agent|worker)s?\s+to\s+)?(?:locally\s+)?(?:run|invoke|perform|execute)\s+/iu;
const IMPERATIVE_COMMAND_DIRECTION = /^(?:run|invoke|perform|execute)\s+/iu;
const PROHIBITED_EXECUTION_OBJECT =
  /(?:compilation|compilers?|checks?|checking|tests?|testing|test runners?|test suites?|linting|linters?|typechecks?|typechecking|typecheckers?|builds?|bundles?|bundling|bundlers?|validation|installs?|installing|dependency installation|package installers?|browser suites?)$/iu;
const EXECUTION_LIST_DIRECTION =
  /^(?:agents?|team agents?|workers?|gizmo)\s+(?:may|can|must|shall|need to|are allowed to|is allowed to|are permitted to|is permitted to|are required to|is required to)(?:\s+not)?(?:\s+ask\s+(?:an?\s+)?(?:team\s+)?(?:agent|worker)s?\s+to)?\s*:$/iu;
const QUALIFIED_AUTHORITY_DIRECTION =
  /(\b(?:agents?|team agents?|workers?|gizmo)\s+(?:may|can|must|shall|need to|are allowed to|is allowed to|are permitted to|is permitted to|are required to|is required to))\s*,\s*(?:(?:only\s+)?when|while|during|for|if|unless|after|before)\b[^,.;!?]*,\s*/iu;
const AUTHORITY_ACTOR = /^(?:agents?|team agents?|workers?|gizmo)\b/iu;
const ELLIPTICAL_AUTHORITY_DIRECTION =
  /^(?:may|can|must|shall|need to|are allowed to|is allowed to|are permitted to|is permitted to|are required to|is required to)\b/iu;
const LOCAL_EXECUTION = /\b(?:local(?:ly)?|on (?:a|the) local host)\b/iu;
const NEGATED_LOCAL_EXECUTION =
  /\b(?:never|not)\s+(?:(?:run|invoke|perform|execute|compile|test|lint|validate|build)\b[^;.!?]*\s+)?(?:locally|on (?:a|the) local host)(?:\s+(?:at all|under any circumstances))?(?=\s*[,.;!?]|$)/iu;
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
  appendLocalExecutionGrantFindings({
    findings,
    source: authoritySource,
    path: TEAM_AUTHORITY_PATH,
    authorityName: CortexAuthorityName.Team,
  });
  appendLocalExecutionGrantFindings({
    findings,
    source: gizmoSource,
    path: GIZMO_AUTHORITY_PATH,
    authorityName: CortexAuthorityName.Gizmo,
  });
  for (const authority of request.authorities) {
    const teamAuthorityPath = authority.contextPaths.find((contextPath) =>
      contextPath.endsWith('/AGENTS.md'),
    );
    if (
      teamAuthorityPath &&
      safeRepositoryPath(teamAuthorityPath) &&
      existsSync(join(request.repoRoot, teamAuthorityPath))
    ) {
      appendLocalExecutionGrantFindings({
        findings,
        source: readFileSync(join(request.repoRoot, teamAuthorityPath), 'utf8'),
        path: teamAuthorityPath,
        authorityName: CortexAuthorityName.Team,
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

function appendLocalExecutionGrantFindings(
  request: LocalExecutionGrantAudit,
): void {
  for (const statement of markdownStatements(request.source)) {
    const normalizedStatement = statement.replace(
      QUALIFIED_AUTHORITY_DIRECTION,
      '$1 ',
    );
    const commandDirection = [
      AGENT_COMMAND_DIRECTION.exec(normalizedStatement),
      IMPERATIVE_COMMAND_DIRECTION.exec(normalizedStatement),
    ].some((match) =>
      match
        ? prohibitedExecutionObject(
            normalizedStatement.slice(match.index + match[0].length),
          )
        : false,
    );
    const localExecutionDirection =
      (AGENT_EXECUTION_DIRECTION.test(normalizedStatement) ||
        IMPERATIVE_EXECUTION_DIRECTION.test(normalizedStatement)) &&
      LOCAL_EXECUTION.test(statement) &&
      !NEGATED_LOCAL_EXECUTION.test(statement);
    if (commandDirection || localExecutionDirection) {
      request.findings.push({
        code: `invalid-cortex-${request.authorityName.toLowerCase()}-authority`,
        path: request.path,
        message: `Canonical Cortex ${request.authorityName} authority grants prohibited local agent product execution: ${statement}`,
      });
    }
  }
}

function prohibitedExecutionObject(text: string): boolean {
  const localExecutionIndex = text.search(LOCAL_EXECUTION);
  const normalizedObject = text
    .slice(0, localExecutionIndex === -1 ? text.length : localExecutionIndex)
    .trim()
    .replace(/[,:;]+$/u, '')
    .trim();
  return (
    PROHIBITED_COMMAND.test(text) ||
    PROHIBITED_EXECUTION_OBJECT.test(normalizedObject)
  );
}

function markdownStatements(source: string): readonly string[] {
  const root = unified().use(remarkParse).use(remarkGfm).parse(source);
  const statements: string[] = [];
  inspectAuthorityStatements({
    nodes: root.children,
    inheritedGrant: false,
    statements,
  });
  return statements;
}

function inspectAuthorityStatements(
  request: AuthorityStatementInspection,
): void {
  let listGrant = request.inheritedGrant;
  for (const node of request.nodes) {
    if (node.type === 'paragraph') {
      const text = markdownText(node).replace(/\s+/gu, ' ').trim();
      const ownDirection = executionListDirection(text);
      appendAuthoritySentences({
        statements: request.statements,
        text: listGrant && !ownDirection ? `${listGrant} ${text}` : text,
      });
      listGrant = ownDirection;
      continue;
    }
    if (node.type === 'list') {
      for (const item of node.children) {
        inspectAuthorityStatements({
          nodes: item.children,
          inheritedGrant: listGrant,
          statements: request.statements,
        });
      }
    }
    if (node.type === 'table') {
      for (const row of node.children) {
        appendAuthoritySentences({
          statements: request.statements,
          text: row.children
            .map(markdownText)
            .join(' ')
            .replace(/\s+/gu, ' ')
            .trim(),
        });
      }
    }
    if (node.type === 'blockquote') {
      inspectAuthorityStatements({
        nodes: node.children,
        inheritedGrant: listGrant,
        statements: request.statements,
      });
    }
    listGrant = false;
  }
}

function executionListDirection(text: string): string | false {
  return EXECUTION_LIST_DIRECTION.test(text) ? text.slice(0, -1).trim() : false;
}

function appendAuthoritySentences(
  request: AppendAuthoritySentencesRequest,
): void {
  for (const sentence of request.text.split(/(?<=[.!?])\s+/u)) {
    const clauses = sentence
      .split(
        /\s*;\s*|\s*,?\s+(?:but|yet)\s+|\s+and\s+(?=(?:may|can|must|shall|need to|are allowed to|is allowed to|are permitted to|is permitted to|are required to|is required to)\b)/iu,
      )
      .map((clause) => clause.trim())
      .filter((clause) => clause !== '');
    const actor = AUTHORITY_ACTOR.exec(clauses[0] ?? '')?.[0] ?? false;
    request.statements.push(
      ...clauses.map((clause, index) =>
        index > 0 && actor && ELLIPTICAL_AUTHORITY_DIRECTION.test(clause)
          ? `${actor} ${clause}`
          : clause,
      ),
    );
  }
}

function markdownText(node: Nodes): string {
  if (node.type === 'image' || node.type === 'imageReference') return '';
  if (node.type === 'break') return ' ';
  if ('value' in node && typeof node.value === 'string') return node.value;
  if (!('children' in node)) return '';
  return node.children.map(markdownText).join('');
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
