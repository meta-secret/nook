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
  auditGizmoCortexAuthority,
  auditTeamAgents,
  auditTeamAuthorities,
  auditTeamCortexAuthority,
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

  test('rejects semantic drift in context, isolation, and lifecycle authority', async () => {
    const source = await readFile(join(REPO_ROOT, '.cortex/AGENTS.md'), 'utf8');
    const driftedSource = source.replace(
      'It does not grant parent-owned lifecycle authority.',
      'It may grant lifecycle authority to a child.',
    );
    const authorityRequest = { source: driftedSource };

    expect(
      auditTeamCortexAuthority(authorityRequest).map((finding) => finding.code),
    ).toContain('cortex-team-contract-semantic-drift');
  });

  test('rejects omission of automatic Cortex authoring context', async () => {
    const source = await readFile(join(REPO_ROOT, '.cortex/AGENTS.md'), 'utf8');
    const driftedSource = source.replace(
      'A write claim that overlaps `.cortex/**` automatically requires the canonical\n  Cortex authoring bundle:',
      'Cortex writing context is optional.',
    );
    const authorityRequest = { source: driftedSource };

    expect(
      auditTeamCortexAuthority(authorityRequest).map((finding) => finding.code),
    ).toContain('cortex-team-contract-semantic-drift');
  });

  test('rejects drift in any canonical authoring bundle member', async () => {
    const source = await readFile(join(REPO_ROOT, '.cortex/AGENTS.md'), 'utf8');
    const driftedSource = source.replace(
      '`teams/ai/dynamic-skills/cortex-consistency.md`.',
      '`teams/ai/dynamic-skills/another-writer.md`.',
    );
    const authorityRequest = { source: driftedSource };

    expect(
      auditTeamCortexAuthority(authorityRequest).map((finding) => finding.code),
    ).toContain('cortex-team-contract-semantic-drift');
  });

  test('rejects a local handoff as an implementation mission terminal', async () => {
    const source = await readFile(join(REPO_ROOT, '.cortex/AGENTS.md'), 'utf8');
    const driftedSource = source.replace(
      "A Team Agent's local commit completes only that worker task.",
      'A local commit completes the mission.',
    );
    const authorityRequest = { source: driftedSource };

    expect(
      auditTeamCortexAuthority(authorityRequest).map((finding) => finding.code),
    ).toContain('cortex-team-contract-semantic-drift');
  });

  test('rejects Gizmo stopping at a committed handoff', async () => {
    const source = await readFile(
      join(REPO_ROOT, '.cortex/gizmo/AGENTS.md'),
      'utf8',
    );
    const driftedSource = source.replace(
      'It is not completion of the user-visible mission.',
      'It completes the user-visible mission.',
    );
    const authorityRequest = { source: driftedSource };

    expect(
      auditGizmoCortexAuthority(authorityRequest).map(
        (finding) => finding.code,
      ),
    ).toContain('cortex-gizmo-contract-semantic-drift');
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
