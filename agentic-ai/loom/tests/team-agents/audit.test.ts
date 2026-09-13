import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';

import type { MakeDirectoryOptions, RmOptions } from 'node:fs';

import { tmpdir } from 'node:os';

import { dirname, join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { TeamAgentContract } from '../../src/team-agents/audit.ts';

import type {
  AuditTeamAgentsRequest,
  AuditTeamAuthoritiesRequest,
} from '../../src/team-agents/audit.ts';

import {
  TEAM_AUTHORITY_CATALOG,
  TEAM_GIZMO_CATALOG,
  TEAM_INTERNAL_AGENT_CATALOG,
  TeamGizmoKey,
  TeamInternalAgentKey,
  TeamKey,
  TeamAuthorityCatalog,
} from '../../src/team-agents/catalog.ts';

import type {
  TeamAuthority,
  TeamGizmoProfile,
  TeamInternalAgentProfile,
} from '../../src/team-agents/catalog.ts';

export class TeamAgentsAuditScenario {
  private constructor(private readonly request: string) {}

  static requiredAiAuthority(): TeamAuthority {
    const authority = TeamAuthorityCatalog.teamAuthority(TeamKey.Ai);
    if (!authority) throw new Error('The AI team authority is required.');
    return authority;
  }

  static async cortexAuthorityFixture(): Promise<string> {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'loom-team-authority-'));
    await symlink(join(REPO_ROOT, '.cortex'), join(fixtureRoot, '.cortex'));
    return fixtureRoot;
  }

  static async driftedAuthorityFixture(): Promise<string> {
    const fixtureRoot = await mkdtemp(
      join(tmpdir(), 'loom-team-authority-drift-'),
    );
    const cortexRoot = join(fixtureRoot, '.cortex');
    await mkdir(join(cortexRoot, 'gizmo-prime'), CREATE_RECURSIVELY);
    await symlink(join(REPO_ROOT, '.cortex/teams'), join(cortexRoot, 'teams'));
    await writeFile(join(cortexRoot, 'AGENTS.md'), 'routing only\n', 'utf8');
    await writeFile(
      join(cortexRoot, 'gizmo-prime/AGENTS.md'),
      'delivery only\n',
      'utf8',
    );
    return fixtureRoot;
  }

  static autonomyDriftFixture(invariant: string): Promise<string> {
    return new TeamAgentsAuditScenario(invariant).execute();
  }

  private async execute(): Promise<string> {
    const invariant = this.request;
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'loom-autonomy-drift-'));
    const cortexRoot = join(fixtureRoot, '.cortex');
    await mkdir(cortexRoot, CREATE_RECURSIVELY);
    await symlink(join(REPO_ROOT, '.cortex/teams'), join(cortexRoot, 'teams'));
    await symlink(
      join(REPO_ROOT, '.cortex/gizmo-prime'),
      join(cortexRoot, 'gizmo-prime'),
    );
    const authority = await readFile(
      join(REPO_ROOT, '.cortex/AGENTS.md'),
      'utf8',
    );
    await writeFile(
      join(cortexRoot, 'AGENTS.md'),
      authority.replace(invariant, 'Autonomous mission invariant removed.'),
      'utf8',
    );
    return fixtureRoot;
  }
}

const REPO_ROOT = join(import.meta.dir, '../../../..');

const REMOVE_RECURSIVELY: RmOptions = { recursive: true, force: true };

const CREATE_RECURSIVELY: MakeDirectoryOptions = { recursive: true };

describe('canonical Cortex team authority', () => {
  test('defines six stable keys and human-readable identities', () => {
    expect(TEAM_AUTHORITY_CATALOG.map((authority) => authority.key)).toEqual([
      TeamKey.Ai,
      TeamKey.DevelopmentCore,
      TeamKey.Security,
      TeamKey.Sre,
      TeamKey.WebDevelopment,
      TeamKey.DeliveryPipeline,
    ]);
    expect(
      TEAM_AUTHORITY_CATALOG.map((authority) => authority.identity),
    ).toEqual([
      'AI',
      'Development core',
      'Security',
      'SRE',
      'Web development',
      'Delivery Pipeline',
    ]);
    expect(TeamAuthorityCatalog.teamAuthority(TeamKey.Ai)).not.toBe(false);
    expect(TeamAuthorityCatalog.teamCortexRoot(TeamKey.DeliveryPipeline)).toBe(
      '.cortex/teams/delivery-pipeline',
    );
  });

  test('audits canonical Cortex paths and capability boundaries', () => {
    const auditRequest: AuditTeamAgentsRequest = { repoRoot: REPO_ROOT };
    const report = TeamAgentContract.auditTeamAgents(auditRequest);

    expect(report.findings).toEqual([]);
    expect(report.authorityCount).toBe(6);
    expect(report.teamGizmoCount).toBe(6);
    expect(report.teamInternalAgentCount).toBe(12);
    expect(report.auditOk).toBe(true);
  });

  test('models every Team Gizmo and internal-agent hierarchy', () => {
    expect(TEAM_AUTHORITY_CATALOG).toHaveLength(6);
    expect(TEAM_GIZMO_CATALOG).toHaveLength(6);
    expect(TEAM_INTERNAL_AGENT_CATALOG).toHaveLength(12);

    for (const gizmo of TEAM_GIZMO_CATALOG) {
      expect(gizmo.model).toBe('gpt-5.6-sol');
      expect(gizmo.reasoningEffort).toBe('low');
      expect(gizmo.parent).toBe('Gizmo Prime');
    }
    const teamGizmoByTeam = new Map(
      TEAM_GIZMO_CATALOG.map((gizmo) => [gizmo.team, gizmo.key]),
    );
    for (const agent of TEAM_INTERNAL_AGENT_CATALOG) {
      expect(agent.model).toBe('gpt-5.6-luna');
      expect(agent.reasoningEffort).toBe('xhigh');
      expect(agent.serviceTier).toBe('fast');
      expect(teamGizmoByTeam.get(agent.team)).toBe(agent.parent);
    }

    const teamGizmo = TEAM_GIZMO_CATALOG.find(
      (candidate) => candidate.key === TeamGizmoKey.DeliveryPipeline,
    );
    const internalAgent = TEAM_INTERNAL_AGENT_CATALOG.find(
      (candidate) => candidate.key === TeamInternalAgentKey.PrLifecycle,
    );
    if (!teamGizmo || !internalAgent)
      throw new Error('Delivery Pipeline profiles are incomplete.');

    expect(teamGizmo).toMatchObject({
      key: TeamGizmoKey.DeliveryPipeline,
      team: TeamKey.DeliveryPipeline,
      identity: 'Delivery Pipeline Team Gizmo',
      parent: 'Gizmo Prime',
      contextPaths: [
        '.cortex/teams/delivery-pipeline/gizmo/AGENTS.md',
        '.cortex/teams/delivery-pipeline/gizmo/knowledge-graph.md',
      ],
    });
    expect(internalAgent).toMatchObject({
      key: TeamInternalAgentKey.PrLifecycle,
      team: TeamKey.DeliveryPipeline,
      identity: 'PR Lifecycle',
      parent: TeamGizmoKey.DeliveryPipeline,
      contextPaths: [
        '.cortex/teams/delivery-pipeline/pr-lifecycle/AGENTS.md',
        '.cortex/teams/delivery-pipeline/pr-lifecycle/knowledge-graph.md',
      ],
    });
    expect(
      TeamAuthorityCatalog.teamGizmoProfile(TeamGizmoKey.DeliveryPipeline),
    ).toEqual(teamGizmo);
    expect(
      TeamAuthorityCatalog.teamInternalAgentProfile(
        TeamInternalAgentKey.PrLifecycle,
      ),
    ).toEqual(internalAgent);
    expect(
      TeamAuthorityCatalog.teamAgentProfile(TeamKey.DeliveryPipeline),
    ).toEqual(TEAM_AUTHORITY_CATALOG[5]);
    expect(
      TeamAuthorityCatalog.teamAgentProfile(TeamGizmoKey.DeliveryPipeline),
    ).toEqual(teamGizmo);
    expect(
      TeamAuthorityCatalog.teamAgentProfile(TeamInternalAgentKey.PrLifecycle),
    ).toEqual(internalAgent);
  });

  test('rejects Team Gizmo and internal-agent contract, hierarchy, count, and path drift', () => {
    const teamGizmo = TEAM_GIZMO_CATALOG[0];
    const internalAgent = TEAM_INTERNAL_AGENT_CATALOG[0];
    if (!teamGizmo || !internalAgent)
      throw new Error('Delivery Pipeline profiles are incomplete.');

    const driftedGizmos: readonly TeamGizmoProfile[][] = [
      [],
      [{ ...teamGizmo, reportingBoundary: '' }],
      [{ ...teamGizmo, contextPaths: ['../outside/AGENTS.md'] }],
      [teamGizmo, teamGizmo],
    ];
    for (const gizmos of driftedGizmos) {
      expect(
        TeamAgentContract.auditTeamGizmos({
          repoRoot: REPO_ROOT,
          gizmos,
        }).auditOk,
      ).toBe(false);
    }

    const driftedAgents: readonly TeamInternalAgentProfile[][] = [
      [],
      [{ ...internalAgent, team: TeamKey.Ai }],
      [{ ...internalAgent, capabilityBoundary: '' }],
      [internalAgent, internalAgent],
    ];
    for (const agents of driftedAgents) {
      expect(
        TeamAgentContract.auditTeamInternalAgents({
          repoRoot: REPO_ROOT,
          agents,
        }).auditOk,
      ).toBe(false);
    }

    const unsafeAgentReport = TeamAgentContract.auditTeamInternalAgents({
      repoRoot: REPO_ROOT,
      agents: [
        { ...internalAgent, contextPaths: ['.cortex/../outside/AGENTS.md'] },
      ],
    });
    expect(unsafeAgentReport.findings.map((finding) => finding.code)).toContain(
      'unsafe-team-internal-agent-context-path',
    );
  });

  test('rejects directories and symlinks as Team Gizmo context paths', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'loom-context-node-'));
    const contextFile = join(fixtureRoot, 'context.md');
    const contextDirectory = join(fixtureRoot, 'context-directory');
    const contextSymlink = join(fixtureRoot, 'context-symlink.md');
    const teamGizmo = TEAM_GIZMO_CATALOG[0];
    if (!teamGizmo)
      throw new Error('Delivery Pipeline Team Gizmo profile is incomplete.');

    try {
      await writeFile(contextFile, 'context\n', 'utf8');
      await mkdir(contextDirectory);
      await symlink(contextFile, contextSymlink);

      for (const contextPath of ['context-directory', 'context-symlink.md']) {
        const report = TeamAgentContract.auditTeamGizmos({
          repoRoot: fixtureRoot,
          gizmos: [{ ...teamGizmo, contextPaths: [contextPath] }],
        });

        expect(report.auditOk).toBe(false);
        expect(report.findings).toContainEqual({
          code: 'missing-team-gizmo-context-path',
          path: contextPath,
          message: `Team Gizmo context is missing: ${contextPath}`,
        });
      }
    } finally {
      await rm(fixtureRoot, REMOVE_RECURSIVELY);
    }
  });

  test('rejects directories and symlinks as canonical Team Authority context paths', async () => {
    for (const contextNode of ['directory', 'symlink'] as const) {
      const fixtureRoot = await mkdtemp(
        join(tmpdir(), `loom-authority-${contextNode}-`),
      );
      const cortexRoot = join(fixtureRoot, '.cortex');
      const teamsRoot = join(cortexRoot, 'teams');
      const aiRoot = join(teamsRoot, 'ai');
      const aiAgentsPath = join(aiRoot, 'AGENTS.md');

      try {
        await mkdir(teamsRoot, CREATE_RECURSIVELY);
        await symlink(
          join(REPO_ROOT, '.cortex/AGENTS.md'),
          join(cortexRoot, 'AGENTS.md'),
        );
        await symlink(
          join(REPO_ROOT, '.cortex/gizmo-prime'),
          join(cortexRoot, 'gizmo-prime'),
        );
        for (const teamDirectory of [
          'dev-core',
          'security',
          'sre',
          'web-dev',
          'delivery-pipeline',
        ]) {
          await symlink(
            join(REPO_ROOT, '.cortex/teams', teamDirectory),
            join(teamsRoot, teamDirectory),
          );
        }
        await mkdir(aiRoot, CREATE_RECURSIVELY);
        await symlink(
          join(REPO_ROOT, '.cortex/teams/ai/dynamic-skills'),
          join(aiRoot, 'dynamic-skills'),
        );
        await writeFile(join(aiRoot, 'knowledge-graph.md'), 'knowledge\n');
        if (contextNode === 'directory') {
          await mkdir(aiAgentsPath);
        } else {
          await symlink(
            join(REPO_ROOT, '.cortex/teams/ai/AGENTS.md'),
            aiAgentsPath,
          );
        }

        const report = TeamAgentContract.auditTeamAuthorities({
          repoRoot: fixtureRoot,
          authorities: TEAM_AUTHORITY_CATALOG,
        });

        expect(report.auditOk).toBe(false);
        expect(report.findings).toContainEqual({
          code: 'missing-team-context-path',
          path: '.cortex/teams/ai/AGENTS.md',
          message:
            'Canonical Cortex team context is missing: .cortex/teams/ai/AGENTS.md',
        });
      } finally {
        await rm(fixtureRoot, REMOVE_RECURSIVELY);
      }
    }
  });

  test('rejects stable-key, identity, context, and capability drift', () => {
    const aiAuthority = TeamAgentsAuditScenario.requiredAiAuthority();
    const driftedAuthorities: readonly TeamAuthority[][] = [
      TEAM_AUTHORITY_CATALOG.slice(1),
      [
        { ...aiAuthority, identity: 'Automation' },
        ...TEAM_AUTHORITY_CATALOG.slice(1),
      ],
      [
        {
          ...aiAuthority,
          contextPaths: ['.cortex/teams/ai/AGENTS.md'],
        },
        ...TEAM_AUTHORITY_CATALOG.slice(1),
      ],
      [
        { ...aiAuthority, capabilityBoundary: '' },
        ...TEAM_AUTHORITY_CATALOG.slice(1),
      ],
    ];
    for (const authorities of driftedAuthorities) {
      const auditRequest: AuditTeamAuthoritiesRequest = {
        repoRoot: REPO_ROOT,
        authorities,
      };
      expect(TeamAgentContract.auditTeamAuthorities(auditRequest).auditOk).toBe(
        false,
      );
    }
  });

  test('rejects root authorities that lose compact semantic contracts', async () => {
    const fixtureRoot = await TeamAgentsAuditScenario.driftedAuthorityFixture();
    try {
      const auditRequest: AuditTeamAgentsRequest = { repoRoot: fixtureRoot };
      const report = TeamAgentContract.auditTeamAgents(auditRequest);
      expect(report.auditOk).toBe(false);
      expect(report.findings.map((finding) => finding.code)).toContain(
        'invalid-cortex-team-authority',
      );
      expect(report.findings.map((finding) => finding.code)).toContain(
        'invalid-cortex-gizmo-authority',
      );
    } finally {
      await rm(fixtureRoot, REMOVE_RECURSIVELY);
    }
  });

  test('rejects removal of any autonomous mission or delivery invariant', async () => {
    const invariants = [
      'Routine uncertainty, implementation breadth, validation failures, and\n  delivery sequencing are not blockers or reasons to ask the user.',
      'Continue implementation, validation, repair, and authorized delivery until\n  complete delivery or an explicitly requested intermediate stop is reached.',
      'An implementation request defaults to complete delivery.',
      'Silence about\nmerge is not an intermediate selection.',
    ] as const;
    for (const invariant of invariants) {
      const fixtureRoot =
        await TeamAgentsAuditScenario.autonomyDriftFixture(invariant);
      try {
        const report = TeamAgentContract.auditTeamAgents({
          repoRoot: fixtureRoot,
        });
        expect(report.findings).toContainEqual({
          code: 'invalid-cortex-team-authority',
          path: '.cortex/AGENTS.md',
          message: `Canonical Cortex team authority is missing marker: ${invariant}`,
        });
      } finally {
        await rm(fixtureRoot, REMOVE_RECURSIVELY);
      }
    }
  });

  test('rejects drift of the Gizmo prohibition heading or implementation boundary', async () => {
    const drifts = [
      {
        current: 'Gizmo does not:',
        replacement: 'Gizmo may:',
      },
      {
        current: '- implement or repair team-owned work;',
        replacement:
          '- implement or repair team-owned work when requested;\n\n## Relocated marker\n\n- implement or repair team-owned work;',
      },
    ] as const;
    for (const drift of drifts) {
      const fixtureRoot = await mkdtemp(join(tmpdir(), 'loom-gizmo-grant-'));
      const cortexRoot = join(fixtureRoot, '.cortex');
      try {
        await mkdir(join(cortexRoot, 'gizmo-prime'), CREATE_RECURSIVELY);
        await symlink(
          join(REPO_ROOT, '.cortex/teams'),
          join(cortexRoot, 'teams'),
        );
        await writeFile(
          join(cortexRoot, 'AGENTS.md'),
          await readFile(join(REPO_ROOT, '.cortex/AGENTS.md'), 'utf8'),
          'utf8',
        );
        const gizmoAuthority = await readFile(
          join(REPO_ROOT, '.cortex/gizmo-prime/AGENTS.md'),
          'utf8',
        );
        expect(gizmoAuthority).toContain(drift.current);
        await writeFile(
          join(cortexRoot, 'gizmo-prime/AGENTS.md'),
          gizmoAuthority.replace(drift.current, drift.replacement),
          'utf8',
        );

        const report = TeamAgentContract.auditTeamAgents({
          repoRoot: fixtureRoot,
        });
        expect(report.findings).toContainEqual({
          code: 'invalid-cortex-gizmo-authority',
          path: '.cortex/gizmo-prime/AGENTS.md',
          message: `Canonical Gizmo authority is missing marker: ${drift.current}`,
        });
      } finally {
        await rm(fixtureRoot, REMOVE_RECURSIVELY);
      }
    }
  });

  test('does not require or treat vendor profile TOMLs as authority', async () => {
    const fixtureRoot = await TeamAgentsAuditScenario.cortexAuthorityFixture();
    const vendorProfilePath = join(
      fixtureRoot,
      '.codex/agents/vendor/profiles/ai.toml',
    );
    try {
      await mkdir(dirname(vendorProfilePath), CREATE_RECURSIVELY);
      await writeFile(
        vendorProfilePath,
        'name = "vendor-ai"\nsandbox_mode = "danger-full-access"\n',
        'utf8',
      );
      const auditRequest: AuditTeamAgentsRequest = { repoRoot: fixtureRoot };
      const reportWithVendorProfile =
        TeamAgentContract.auditTeamAgents(auditRequest);
      await rm(join(fixtureRoot, '.codex'), REMOVE_RECURSIVELY);
      const reportWithoutVendorProfiles =
        TeamAgentContract.auditTeamAgents(auditRequest);

      expect(reportWithVendorProfile).toEqual(reportWithoutVendorProfiles);
      expect(reportWithoutVendorProfiles.auditOk).toBe(true);
    } finally {
      await rm(fixtureRoot, REMOVE_RECURSIVELY);
    }
  });
});
