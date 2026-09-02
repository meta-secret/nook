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
import {
  auditTeamAgents,
  auditTeamAuthorities,
} from '../../src/team-agents/audit.ts';
import type {
  AuditTeamAgentsRequest,
  AuditTeamAuthoritiesRequest,
} from '../../src/team-agents/audit.ts';
import {
  TEAM_AUTHORITY_CATALOG,
  TeamKey,
  teamAuthority,
} from '../../src/team-agents/catalog.ts';
import type { TeamAuthority } from '../../src/team-agents/catalog.ts';

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
    expect(teamAuthority(TeamKey.Ai)).not.toBe(false);
  });

  test('audits canonical Cortex paths and capability boundaries', () => {
    const auditRequest: AuditTeamAgentsRequest = { repoRoot: REPO_ROOT };
    const report = auditTeamAgents(auditRequest);

    expect(report.findings).toEqual([]);
    expect(report.authorityCount).toBe(5);
    expect(report.auditOk).toBe(true);
  });

  test('rejects stable-key, identity, context, and capability drift', () => {
    const aiAuthority = requiredAiAuthority();
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
      expect(auditTeamAuthorities(auditRequest).auditOk).toBe(false);
    }
  });

  test('rejects root authorities that lose compact semantic contracts', async () => {
    const fixtureRoot = await driftedAuthorityFixture();
    try {
      const auditRequest: AuditTeamAgentsRequest = { repoRoot: fixtureRoot };
      const report = auditTeamAgents(auditRequest);
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

  test('rejects removal of autonomous mission execution', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'loom-autonomy-drift-'));
    const cortexRoot = join(fixtureRoot, '.cortex');
    try {
      await mkdir(cortexRoot, CREATE_RECURSIVELY);
      await symlink(
        join(REPO_ROOT, '.cortex/teams'),
        join(cortexRoot, 'teams'),
      );
      await symlink(
        join(REPO_ROOT, '.cortex/gizmo'),
        join(cortexRoot, 'gizmo'),
      );
      const authority = await readFile(
        join(REPO_ROOT, '.cortex/AGENTS.md'),
        'utf8',
      );
      await writeFile(
        join(cortexRoot, 'AGENTS.md'),
        authority.replace(
          'Routine uncertainty, implementation breadth, validation failures, and\n  delivery sequencing are not blockers or reasons to ask the user.',
          'Routine uncertainty may require user confirmation.',
        ),
        'utf8',
      );

      const report = auditTeamAgents({ repoRoot: fixtureRoot });
      expect(report.findings).toContainEqual({
        code: 'invalid-cortex-team-authority',
        path: '.cortex/AGENTS.md',
        message:
          'Canonical Cortex team authority is missing marker: Routine uncertainty, implementation breadth, validation failures, and\n  delivery sequencing are not blockers or reasons to ask the user.',
      });
    } finally {
      await rm(fixtureRoot, REMOVE_RECURSIVELY);
    }
  });

  test('rejects an affirmative Gizmo implementation grant', async () => {
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
      await writeFile(
        join(cortexRoot, 'gizmo/AGENTS.md'),
        gizmoAuthority.replace(
          'Gizmo does not:\n\n- implement or repair team-owned work;',
          'Gizmo may:\n\n- implement or repair team-owned work;',
        ),
        'utf8',
      );

      const report = auditTeamAgents({ repoRoot: fixtureRoot });
      expect(report.findings.map((finding) => finding.code)).toContain(
        'invalid-cortex-gizmo-authority',
      );
    } finally {
      await rm(fixtureRoot, REMOVE_RECURSIVELY);
    }
  });

  test('does not require or treat vendor profile TOMLs as authority', async () => {
    const fixtureRoot = await cortexAuthorityFixture();
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
      const reportWithVendorProfile = auditTeamAgents(auditRequest);
      await rm(join(fixtureRoot, '.codex'), REMOVE_RECURSIVELY);
      const reportWithoutVendorProfiles = auditTeamAgents(auditRequest);

      expect(reportWithVendorProfile).toEqual(reportWithoutVendorProfiles);
      expect(reportWithoutVendorProfiles.auditOk).toBe(true);
    } finally {
      await rm(fixtureRoot, REMOVE_RECURSIVELY);
    }
  });
});

function requiredAiAuthority(): TeamAuthority {
  const authority = teamAuthority(TeamKey.Ai);
  if (!authority) throw new Error('The AI team authority is required.');
  return authority;
}

async function cortexAuthorityFixture(): Promise<string> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'loom-team-authority-'));
  await symlink(join(REPO_ROOT, '.cortex'), join(fixtureRoot, '.cortex'));
  return fixtureRoot;
}

async function driftedAuthorityFixture(): Promise<string> {
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
