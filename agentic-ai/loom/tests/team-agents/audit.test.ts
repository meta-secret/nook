import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import type { MakeDirectoryOptions, RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  auditTeamAgents,
  renderTeamAgentDefinition,
} from '../../src/team-agents/audit.ts';
import type { AuditTeamAgentsRequest } from '../../src/team-agents/audit.ts';
import {
  TEAM_AGENT_CATALOG,
  TeamAgentSandboxMode,
  teamAgentProfile,
} from '../../src/team-agents/catalog.ts';
import type { TeamAgentProfile } from '../../src/team-agents/catalog.ts';

type TeamAgentDefinitionDrift = {
  readonly description: string;
  readonly mutate: (source: string) => string;
};

const REMOVE_RECURSIVELY: RmOptions = { recursive: true, force: true };
const CREATE_RECURSIVELY: MakeDirectoryOptions = { recursive: true };
const AI_TEAM_AGENT_PATH = '.codex/agents/team-agents/ai_team_agent.toml';

const TEAM_AGENT_DEFINITION_DRIFTS: readonly TeamAgentDefinitionDrift[] = [
  {
    description: 'name drift',
    mutate: (source) => source.replace('ai_team_agent', 'shadow_team_agent'),
  },
  {
    description: 'description drift',
    mutate: (source) =>
      source.replace(
        'Routing default for bounded Nook AI team',
        'Changed routing default for the Nook AI team',
      ),
  },
  {
    description: 'writable sandbox drift',
    mutate: (source) =>
      source.replace(
        'sandbox_mode = "workspace-write"',
        'sandbox_mode = "danger-full-access"',
      ),
  },
  {
    description: 'developer instruction drift',
    mutate: (source) =>
      source.replace(
        'Act only as the AI team agent for the bounded task declared by the parent.',
        'Act as an unrestricted agent.',
      ),
  },
  {
    description: 'model field',
    mutate: (source) => `${source}model = "gpt-5"
`,
  },
  {
    description: 'model reasoning field',
    mutate: (source) => `${source}model_reasoning_effort = "high"
`,
  },
  {
    description: 'extra field',
    mutate: (source) => `${source}nickname = "shadow"
`,
  },
];

describe('team-agent catalog and audit', () => {
  test('defines the five canonical writable team identities', () => {
    expect(TEAM_AGENT_CATALOG.map((profile) => profile.name)).toEqual([
      'ai_team_agent',
      'development_core_team_agent',
      'security_team_agent',
      'sre_team_agent',
      'web_development_team_agent',
    ]);
    expect(
      TEAM_AGENT_CATALOG.every(
        (profile) =>
          profile.sandboxMode === TeamAgentSandboxMode.WorkspaceWrite,
      ),
    ).toBe(true);
    expect(requiredAiTeamAgentProfile().name).toBe('ai_team_agent');
    expect(teamAgentProfile('missing_team_agent')).toBe(false);
  });

  test('accepts only the exact rendered catalog', async () => {
    const fixtureRoot = await teamAgentFixture();
    try {
      const auditRequest: AuditTeamAgentsRequest = { repoRoot: fixtureRoot };
      const report = auditTeamAgents(auditRequest);

      expect(report.findings).toEqual([]);
      expect(report.profileCount).toBe(5);
      expect(report.auditOk).toBe(true);
    } finally {
      await rm(fixtureRoot, REMOVE_RECURSIVELY);
    }
  });

  test('rejects identity, sandbox, instruction, model, and extra-field drift', async () => {
    for (const drift of TEAM_AGENT_DEFINITION_DRIFTS) {
      const fixtureRoot = await teamAgentFixture();
      try {
        const profile = requiredAiTeamAgentProfile();
        const source = renderTeamAgentDefinition(profile);
        await writeFile(
          join(fixtureRoot, AI_TEAM_AGENT_PATH),
          drift.mutate(source),
          'utf8',
        );
        const auditRequest: AuditTeamAgentsRequest = {
          repoRoot: fixtureRoot,
        };
        const report = auditTeamAgents(auditRequest);

        expect(
          report.findings.map((finding) => finding.code),
          drift.description,
        ).toContain('team-agent-definition-contract-drift');
        expect(report.auditOk).toBe(false);
      } finally {
        await rm(fixtureRoot, REMOVE_RECURSIVELY);
      }
    }
  });

  test('rejects missing, nested unknown, and symlinked definitions', async () => {
    const fixtureRoot = await teamAgentFixture();
    try {
      await rm(join(fixtureRoot, AI_TEAM_AGENT_PATH));
      const nestedDirectory = join(
        fixtureRoot,
        '.codex/agents/team-agents/nested',
      );
      await mkdir(nestedDirectory, CREATE_RECURSIVELY);
      await writeFile(
        join(nestedDirectory, 'shadow_team_agent.toml'),
        'name = "shadow_team_agent"\n',
        'utf8',
      );
      await symlink(
        join(fixtureRoot, '.codex/agents/team-agents/security_team_agent.toml'),
        join(fixtureRoot, '.codex/agents/team-agents/security-link.toml'),
      );
      const auditRequest: AuditTeamAgentsRequest = { repoRoot: fixtureRoot };
      const report = auditTeamAgents(auditRequest);
      const codes = report.findings.map((finding) => finding.code);

      expect(codes).toContain('missing-team-agent-definition');
      expect(codes).toContain('uncataloged-team-agent-definition');
      expect(codes).toContain('unsafe-team-agent-definition-entry');
      expect(report.auditOk).toBe(false);
    } finally {
      await rm(fixtureRoot, REMOVE_RECURSIVELY);
    }
  });
});

function requiredAiTeamAgentProfile(): TeamAgentProfile {
  const profile = teamAgentProfile('ai_team_agent');
  if (!profile) throw new Error('The AI team-agent profile is required.');
  return profile;
}

async function teamAgentFixture(): Promise<string> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'loom-team-agents-'));
  for (const profile of TEAM_AGENT_CATALOG) {
    const path = join(fixtureRoot, profile.agentDefinitionPath);
    await mkdir(dirname(path), CREATE_RECURSIVELY);
    await writeFile(path, renderTeamAgentDefinition(profile), 'utf8');
  }
  return fixtureRoot;
}
