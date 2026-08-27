import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { TEAM_AGENT_CATALOG } from './catalog.ts';
import type { TeamAgentProfile } from './catalog.ts';

export type TeamAgentAuditFinding = {
  readonly code: string;
  readonly path: string;
  readonly message: string;
};

export type TeamAgentAuditReport = {
  readonly findings: readonly TeamAgentAuditFinding[];
  readonly profileCount: number;
  readonly auditOk: boolean;
};

export type AuditTeamAgentsRequest = {
  readonly repoRoot: string;
};

type TeamAgentDefinitionDiscoveryRequest = {
  readonly directory: string;
  readonly repoRoot: string;
};

type TeamAgentDefinitionDiscovery = {
  readonly paths: readonly string[];
  readonly unsafePaths: readonly string[];
};

type ValidateTeamAgentDefinitionRequest = {
  readonly findings: TeamAgentAuditFinding[];
  readonly profile: TeamAgentProfile;
  readonly repoRoot: string;
};

const TEAM_AGENT_DIRECTORY = '.codex/agents/team-agents';

export function auditTeamAgents(
  request: AuditTeamAgentsRequest,
): TeamAgentAuditReport {
  const findings: TeamAgentAuditFinding[] = [];
  const directory = join(request.repoRoot, TEAM_AGENT_DIRECTORY);
  if (!existsSync(directory)) {
    const finding: TeamAgentAuditFinding = {
      code: 'missing-team-agent-directory',
      path: TEAM_AGENT_DIRECTORY,
      message: 'The team-agent definition directory is missing.',
    };
    findings.push(finding);
    return teamAgentAuditReport(findings);
  }
  if (!lstatSync(directory).isDirectory()) {
    const finding: TeamAgentAuditFinding = {
      code: 'unsafe-team-agent-directory',
      path: TEAM_AGENT_DIRECTORY,
      message: 'The team-agent definition root must be a real directory.',
    };
    findings.push(finding);
    return teamAgentAuditReport(findings);
  }

  const discoveryRequest: TeamAgentDefinitionDiscoveryRequest = {
    directory,
    repoRoot: request.repoRoot,
  };
  const discovery = discoverTeamAgentDefinitions(discoveryRequest);
  for (const unsafePath of discovery.unsafePaths) {
    const finding: TeamAgentAuditFinding = {
      code: 'unsafe-team-agent-definition-entry',
      path: unsafePath,
      message: `Team-agent discovery does not permit symbolic links: ${unsafePath}`,
    };
    findings.push(finding);
  }

  const expectedPaths = new Set(
    TEAM_AGENT_CATALOG.map((profile) => profile.agentDefinitionPath),
  );
  const actualPaths = new Set(discovery.paths);
  for (const actualPath of actualPaths) {
    if (expectedPaths.has(actualPath)) continue;
    const roleName = basename(actualPath, '.toml');
    const finding: TeamAgentAuditFinding = {
      code: 'uncataloged-team-agent-definition',
      path: actualPath,
      message: `Team-agent definition is not cataloged: ${roleName}`,
    };
    findings.push(finding);
  }
  for (const profile of TEAM_AGENT_CATALOG) {
    if (!actualPaths.has(profile.agentDefinitionPath)) {
      const finding: TeamAgentAuditFinding = {
        code: 'missing-team-agent-definition',
        path: profile.agentDefinitionPath,
        message: `Required team-agent definition is missing: ${profile.name}`,
      };
      findings.push(finding);
      continue;
    }
    const validationRequest: ValidateTeamAgentDefinitionRequest = {
      findings,
      profile,
      repoRoot: request.repoRoot,
    };
    validateTeamAgentDefinition(validationRequest);
  }
  return teamAgentAuditReport(findings);
}

export function renderTeamAgentDefinition(profile: TeamAgentProfile): string {
  return `name = "${profile.name}"
description = "${profile.description}"
sandbox_mode = "${profile.sandboxMode}"

developer_instructions = """
${profile.developerInstructions}
"""
`;
}

function teamAgentAuditReport(
  findings: readonly TeamAgentAuditFinding[],
): TeamAgentAuditReport {
  return {
    findings,
    profileCount: TEAM_AGENT_CATALOG.length,
    auditOk: findings.length === 0,
  };
}

function validateTeamAgentDefinition(
  request: ValidateTeamAgentDefinitionRequest,
): void {
  const path = join(request.repoRoot, request.profile.agentDefinitionPath);
  const source = readFileSync(path, 'utf8');
  if (source === renderTeamAgentDefinition(request.profile)) return;
  const finding: TeamAgentAuditFinding = {
    code: 'team-agent-definition-contract-drift',
    path: request.profile.agentDefinitionPath,
    message:
      'Team-agent TOML must exactly match its cataloged name, description, sandbox mode, and developer instructions; model settings and extra fields are forbidden.',
  };
  request.findings.push(finding);
}

function discoverTeamAgentDefinitions(
  request: TeamAgentDefinitionDiscoveryRequest,
): TeamAgentDefinitionDiscovery {
  const paths: string[] = [];
  const unsafePaths: string[] = [];
  const directories = [request.directory];
  const directoryOptions = { withFileTypes: true } as const;
  while (directories.length > 0) {
    const directory = directories.pop();
    if (!directory) continue;
    for (const entry of readdirSync(directory, directoryOptions)) {
      const absolutePath = join(directory, entry.name);
      const repoPath = relative(request.repoRoot, absolutePath);
      if (entry.isSymbolicLink()) {
        unsafePaths.push(repoPath);
      } else if (entry.isDirectory()) {
        directories.push(absolutePath);
      } else if (entry.isFile() && entry.name.endsWith('.toml')) {
        paths.push(repoPath);
      }
    }
  }
  return {
    paths: paths.sort(),
    unsafePaths: unsafePaths.sort(),
  };
}
