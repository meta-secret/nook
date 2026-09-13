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
  GIZMO_OWNED_AGENT_CATALOG,
  GizmoOwnedAgentKey,
  TEAM_AUTHORITY_CATALOG,
  TeamKey,
  TeamAuthorityCatalog,
} from '../../src/team-agents/catalog.ts';

import type { TeamAuthority } from '../../src/team-agents/catalog.ts';

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
    await mkdir(join(cortexRoot, 'gizmo'), CREATE_RECURSIVELY);
    await symlink(join(REPO_ROOT, '.cortex/teams'), join(cortexRoot, 'teams'));
    await writeFile(join(cortexRoot, 'AGENTS.md'), 'routing only\n', 'utf8');
    await writeFile(
      join(cortexRoot, 'gizmo/AGENTS.md'),
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
    await symlink(join(REPO_ROOT, '.cortex/gizmo'), join(cortexRoot, 'gizmo'));
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
  test('defines five stable keys and human-readable identities', () => {
    expect(TEAM_AUTHORITY_CATALOG.map((authority) => authority.key)).toEqual([
      TeamKey.Ai,
      TeamKey.DevelopmentCore,
      TeamKey.Security,
      TeamKey.Sre,
      TeamKey.WebDevelopment,
    ]);
    expect(
      TEAM_AUTHORITY_CATALOG.map((authority) => authority.identity),
    ).toEqual(['AI', 'Development core', 'Security', 'SRE', 'Web development']);
    expect(TeamAuthorityCatalog.teamAuthority(TeamKey.Ai)).not.toBe(false);
  });

  test('audits canonical Cortex paths and capability boundaries', () => {
    const auditRequest: AuditTeamAgentsRequest = { repoRoot: REPO_ROOT };
    const report = TeamAgentContract.auditTeamAgents(auditRequest);

    expect(report.findings).toEqual([]);
    expect(report.authorityCount).toBe(5);
    expect(report.auditOk).toBe(true);
  });

  test('keeps PR Steward outside the five functional authorities', () => {
    expect(TEAM_AUTHORITY_CATALOG).toHaveLength(5);
    expect(GIZMO_OWNED_AGENT_CATALOG).toEqual([
      {
        key: GizmoOwnedAgentKey.PrSteward,
        identity: 'PR Steward',
        description:
          'Executes explicitly authorized pull-request metadata, review, validation, readiness-evidence, merge, and merge-verification operations for Gizmo Prime.',
        model: 'gpt-5.6-luna',
        reasoningEffort: 'xhigh',
        contextPaths: [
          '.cortex/teams/pr-steward/AGENTS.md',
          '.cortex/teams/pr-steward/knowledge-graph.md',
        ],
        capabilityBoundary:
          'PR Steward never edits functional code, adjudicates technical findings, sequences shared-branch writers, owns Workbench outcomes, or issues the final delivery verdict.',
      },
    ]);
    const firstAgent = GIZMO_OWNED_AGENT_CATALOG[0];
    if (!firstAgent) throw new Error('Gizmo agent catalog is empty.');
    expect(
      TeamAuthorityCatalog.gizmoOwnedAgentProfile(GizmoOwnedAgentKey.PrSteward),
    ).toEqual(firstAgent);
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
        await mkdir(join(cortexRoot, 'gizmo'), CREATE_RECURSIVELY);
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
          join(REPO_ROOT, '.cortex/gizmo/AGENTS.md'),
          'utf8',
        );
        expect(gizmoAuthority).toContain(drift.current);
        await writeFile(
          join(cortexRoot, 'gizmo/AGENTS.md'),
          gizmoAuthority.replace(drift.current, drift.replacement),
          'utf8',
        );

        const report = TeamAgentContract.auditTeamAgents({
          repoRoot: fixtureRoot,
        });
        expect(report.findings).toContainEqual({
          code: 'invalid-cortex-gizmo-authority',
          path: '.cortex/gizmo/AGENTS.md',
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
