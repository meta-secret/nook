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

  test('rejects removal of either autonomous mission invariant', async () => {
    const invariants = [
      'Routine uncertainty, implementation breadth, validation failures, and\n  delivery sequencing are not blockers or reasons to ask the user.',
      'Continue implementation, validation, repair, and authorized delivery until\n  the user-selected terminal state is reached.',
    ] as const;
    for (const invariant of invariants) {
      const fixtureRoot = await autonomyDriftFixture(invariant);
      try {
        const report = auditTeamAgents({ repoRoot: fixtureRoot });
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

  test('rejects removal of the remote-only execution contract', async () => {
    const fixtureRoot = await mkdtemp(
      join(tmpdir(), 'loom-local-build-grant-'),
    );
    const cortexRoot = join(fixtureRoot, '.cortex');
    try {
      await mkdir(join(cortexRoot, 'gizmo'), CREATE_RECURSIVELY);
      await symlink(
        join(REPO_ROOT, '.cortex/teams'),
        join(cortexRoot, 'teams'),
      );
      const authority = await readFile(
        join(REPO_ROOT, '.cortex/AGENTS.md'),
        'utf8',
      );
      await writeFile(
        join(cortexRoot, 'AGENTS.md'),
        authority.replace(
          'Agents never run product compilation or repository validation locally.',
          'Agents may run focused project validation locally.',
        ),
        'utf8',
      );
      await symlink(
        join(REPO_ROOT, '.cortex/gizmo/AGENTS.md'),
        join(cortexRoot, 'gizmo/AGENTS.md'),
      );

      const report = auditTeamAgents({ repoRoot: fixtureRoot });
      expect(report.findings).toContainEqual({
        code: 'invalid-cortex-team-authority',
        path: '.cortex/AGENTS.md',
        message:
          'Canonical Cortex team authority is missing marker: Agents never run product compilation or repository validation locally.',
      });
    } finally {
      await rm(fixtureRoot, REMOVE_RECURSIVELY);
    }
  });

  test('rejects contradictory affirmative local product execution grants', async () => {
    const fixtureRoot = await writableCortexAuthorityFixture();
    try {
      const authorityPath = join(fixtureRoot, '.cortex/AGENTS.md');
      const gizmoPath = join(fixtureRoot, '.cortex/gizmo/AGENTS.md');
      await writeFile(
        authorityPath,
        `${await readFile(authorityPath, 'utf8')}\nAgents may run focused product tests locally.\n`,
        'utf8',
      );
      await writeFile(
        gizmoPath,
        `${await readFile(gizmoPath, 'utf8')}\nGizmo can ask a worker to execute repository validation on the local host.\n`,
        'utf8',
      );

      const report = auditTeamAgents({ repoRoot: fixtureRoot });
      expect(report.findings).toContainEqual({
        code: 'invalid-cortex-team-authority',
        path: '.cortex/AGENTS.md',
        message:
          'Canonical Cortex team authority grants prohibited local agent product execution: Agents may run focused product tests locally.',
      });
      expect(report.findings).toContainEqual({
        code: 'invalid-cortex-gizmo-authority',
        path: '.cortex/gizmo/AGENTS.md',
        message:
          'Canonical Cortex Gizmo authority grants prohibited local agent product execution: Gizmo can ask a worker to execute repository validation on the local host.',
      });
    } finally {
      await rm(fixtureRoot, REMOVE_RECURSIVELY);
    }
  });

  test('preserves affirmative authority context across Markdown lists', async () => {
    const fixtureRoot = await writableCortexAuthorityFixture();
    try {
      const authorityPath = join(fixtureRoot, '.cortex/AGENTS.md');
      const gizmoPath = join(fixtureRoot, '.cortex/gizmo/AGENTS.md');
      await writeFile(
        authorityPath,
        `${await readFile(authorityPath, 'utf8')}\nWorkers may:\n\n- run product tests locally.\n`,
        'utf8',
      );
      await writeFile(
        gizmoPath,
        `${await readFile(gizmoPath, 'utf8')}\nGizmo may ask workers to:\n\n- execute repository validation on the local host.\n`,
        'utf8',
      );

      const report = auditTeamAgents({ repoRoot: fixtureRoot });
      expect(report.findings).toContainEqual({
        code: 'invalid-cortex-team-authority',
        path: '.cortex/AGENTS.md',
        message:
          'Canonical Cortex team authority grants prohibited local agent product execution: Workers may run product tests locally.',
      });
      expect(report.findings).toContainEqual({
        code: 'invalid-cortex-gizmo-authority',
        path: '.cortex/gizmo/AGENTS.md',
        message:
          'Canonical Cortex Gizmo authority grants prohibited local agent product execution: Gizmo may ask workers to execute repository validation on the local host.',
      });
    } finally {
      await rm(fixtureRoot, REMOVE_RECURSIVELY);
    }
  });

  test('audits affirmative grants split across GFM table cells', async () => {
    const fixtureRoot = await writableCortexAuthorityFixture();
    try {
      const authorityPath = join(fixtureRoot, '.cortex/AGENTS.md');
      const gizmoPath = join(fixtureRoot, '.cortex/gizmo/AGENTS.md');
      await writeFile(
        authorityPath,
        `${await readFile(authorityPath, 'utf8')}\n| Actor | Authority |\n| --- | --- |\n| Workers | may run product tests locally. |\n`,
        'utf8',
      );
      await writeFile(
        gizmoPath,
        `${await readFile(gizmoPath, 'utf8')}\n| Actor | Authority |\n| --- | --- |\n| Gizmo | can ask a worker to execute repository validation on the local host. |\n`,
        'utf8',
      );

      const report = auditTeamAgents({ repoRoot: fixtureRoot });
      expect(report.findings).toContainEqual({
        code: 'invalid-cortex-team-authority',
        path: '.cortex/AGENTS.md',
        message:
          'Canonical Cortex team authority grants prohibited local agent product execution: Workers may run product tests locally.',
      });
      expect(report.findings).toContainEqual({
        code: 'invalid-cortex-gizmo-authority',
        path: '.cortex/gizmo/AGENTS.md',
        message:
          'Canonical Cortex Gizmo authority grants prohibited local agent product execution: Gizmo can ask a worker to execute repository validation on the local host.',
      });
    } finally {
      await rm(fixtureRoot, REMOVE_RECURSIVELY);
    }
  });

  test('does not mistake explicit local execution prohibitions for grants', async () => {
    const fixtureRoot = await writableCortexAuthorityFixture();
    try {
      const authorityPath = join(fixtureRoot, '.cortex/AGENTS.md');
      const gizmoPath = join(fixtureRoot, '.cortex/gizmo/AGENTS.md');
      await writeFile(
        authorityPath,
        `${await readFile(authorityPath, 'utf8')}\nAgents may not run product tests locally.\nWorkers must not run product tests locally.\nWorkers must not run cargo test locally.\nDo not run repository validation on the local host.\nDo not run bun test locally.\nWorkers cannot perform repository validation on the local host.\nAgents may locally run required non-compiling formatters.\nWorkers may run cargo fmt locally.\nWorkers may run a formatter over Cargo files locally.\n\nWorkers may not:\n\n- run product tests locally.\n\nWorkers may:\n\n- run required non-compiling formatters locally.\n`,
        'utf8',
      );
      await writeFile(
        gizmoPath,
        `${await readFile(gizmoPath, 'utf8')}\nGizmo does not ask workers to run local linting.\n`,
        'utf8',
      );

      expect(auditTeamAgents({ repoRoot: fixtureRoot }).findings).toEqual([]);
    } finally {
      await rm(fixtureRoot, REMOVE_RECURSIVELY);
    }
  });

  test('does not mistake an explicitly hosted grant for a local grant', async () => {
    const fixtureRoot = await writableCortexAuthorityFixture();
    try {
      const authorityPath = join(fixtureRoot, '.cortex/AGENTS.md');
      await writeFile(
        authorityPath,
        `${await readFile(authorityPath, 'utf8')}\nAgents may run product tests on hosted runners, never locally.\nWorkers must run product tests on hosted runners, never locally.\nWorkers must run cargo test on hosted runners, never locally.\nWorkers may execute repository validation on hosted runners, but not on the local host.\nAgents may run product tests locally, but results are not locally cached.\n`,
        'utf8',
      );

      const report = auditTeamAgents({ repoRoot: fixtureRoot });
      expect(report.findings).toHaveLength(1);
      expect(report.findings[0]?.message).toContain(
        'Agents may run product tests locally, but results are not locally cached.',
      );
    } finally {
      await rm(fixtureRoot, REMOVE_RECURSIVELY);
    }
  });

  test('rejects mandatory and imperative local product execution', async () => {
    const fixtureRoot = await writableCortexAuthorityFixture();
    try {
      const authorityPath = join(fixtureRoot, '.cortex/AGENTS.md');
      await writeFile(
        authorityPath,
        `${await readFile(authorityPath, 'utf8')}\nWorkers must run product tests locally.\n\n- Run repository validation on the local host.\n\nWorkers are required to:\n\n- run product builds locally.\n`,
        'utf8',
      );

      const report = auditTeamAgents({ repoRoot: fixtureRoot });
      expect(report.findings).toHaveLength(3);
      expect(report.findings.map((finding) => finding.message)).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Workers must run product tests locally.'),
          expect.stringContaining(
            'Run repository validation on the local host.',
          ),
          expect.stringContaining(
            'Workers are required to run product builds locally.',
          ),
        ]),
      );
    } finally {
      await rm(fixtureRoot, REMOVE_RECURSIVELY);
    }
  });

  test('rejects every prohibited natural-language execution category', async () => {
    const fixtureRoot = await writableCortexAuthorityFixture();
    try {
      const authorityPath = join(fixtureRoot, '.cortex/AGENTS.md');
      await writeFile(
        authorityPath,
        `${await readFile(authorityPath, 'utf8')}\nAgents may run product compilation locally.\nAgents may run checks locally.\nAgents may run product tests locally.\nAgents may perform linting locally.\nAgents may run typechecks locally.\nAgents may run product builds locally.\nAgents may perform bundling locally.\nAgents may perform dependency installation locally.\nAgents may run browser suites locally.\nAgents may execute repository validation locally.\nWorkers may run compilers locally.\nWorkers may run bundlers locally.\nWorkers may invoke test runners locally.\nWorkers may execute linters locally.\nWorkers may run typecheckers locally.\nWorkers may run package installers locally.\n`,
        'utf8',
      );

      const report = auditTeamAgents({ repoRoot: fixtureRoot });
      expect(report.findings).toHaveLength(16);
      for (const category of [
        'compilation',
        'checks',
        'tests',
        'linting',
        'typechecks',
        'builds',
        'bundling',
        'dependency installation',
        'browser suites',
        'validation',
        'compilers',
        'bundlers',
        'test runners',
        'linters',
        'typecheckers',
        'package installers',
      ]) {
        expect(report.findings.map((finding) => finding.message)).toEqual(
          expect.arrayContaining([expect.stringContaining(category)]),
        );
      }
    } finally {
      await rm(fixtureRoot, REMOVE_RECURSIVELY);
    }
  });

  test('binds local grants and denials to their own clauses', async () => {
    const fixtureRoot = await writableCortexAuthorityFixture();
    try {
      const authorityPath = join(fixtureRoot, '.cortex/AGENTS.md');
      await writeFile(
        authorityPath,
        `${await readFile(authorityPath, 'utf8')}\nAgents may run product tests locally, but must not run linting locally.\n`,
        'utf8',
      );

      const report = auditTeamAgents({ repoRoot: fixtureRoot });
      expect(report.findings).toHaveLength(1);
      expect(report.findings[0]?.message).toContain(
        'Agents may run product tests locally',
      );
    } finally {
      await rm(fixtureRoot, REMOVE_RECURSIVELY);
    }
  });

  test('rejects direct prohibited commands in local execution directions', async () => {
    const fixtureRoot = await writableCortexAuthorityFixture();
    try {
      const authorityPath = join(fixtureRoot, '.cortex/AGENTS.md');
      await writeFile(
        authorityPath,
        `${await readFile(authorityPath, 'utf8')}\nWorkers must run cargo test locally.\nAgents are required to invoke task web:check locally.\n\n- Run bun test locally.\n\nWorkers shall:\n\n- execute wasm-pack locally.\n`,
        'utf8',
      );

      const report = auditTeamAgents({ repoRoot: fixtureRoot });
      expect(report.findings).toHaveLength(4);
      expect(report.findings.map((finding) => finding.message)).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Workers must run cargo test locally.'),
          expect.stringContaining(
            'Agents are required to invoke task web:check locally.',
          ),
          expect.stringContaining('Run bun test locally.'),
          expect.stringContaining('Workers shall execute wasm-pack locally.'),
        ]),
      );
    } finally {
      await rm(fixtureRoot, REMOVE_RECURSIVELY);
    }
  });

  test('requires exact Task entrypoint names for local exceptions', async () => {
    const fixtureRoot = await writableCortexAuthorityFixture();
    try {
      const gizmoPath = join(fixtureRoot, '.cortex/gizmo/AGENTS.md');
      await writeFile(
        gizmoPath,
        `${await readFile(gizmoPath, 'utf8')}\nGizmo may run task loom:pre-push:full locally.\nGizmo may run task loom:delegation-visualization:unsafe locally.\nGizmo may run task remote:unsafe locally.\nGizmo may run task pr:validate-extra locally.\nGizmo may run task loom:pre-push locally.\nGizmo may run task loom:delegation-visualization locally.\nGizmo may run task remote locally.\nGizmo may run task pr:validate locally.\n`,
        'utf8',
      );

      const report = auditTeamAgents({ repoRoot: fixtureRoot });
      expect(report.findings).toHaveLength(4);
      expect(report.findings.map((finding) => finding.message)).toEqual(
        expect.arrayContaining([
          expect.stringContaining('task loom:pre-push:full locally'),
          expect.stringContaining(
            'task loom:delegation-visualization:unsafe locally',
          ),
          expect.stringContaining('task remote:unsafe locally'),
          expect.stringContaining('task pr:validate-extra locally'),
        ]),
      );
    } finally {
      await rm(fixtureRoot, REMOVE_RECURSIVELY);
    }
  });

  test('binds delegation visualization to a dependency-free control-plane task', async () => {
    const taskSource = await readFile(
      join(REPO_ROOT, '.task/agentic-ai.yml'),
      'utf8',
    );
    const renderStart = taskSource.indexOf(
      '\n  loom:delegation-visualization:\n',
    );
    const renderEnd = taskSource.indexOf('\n  loom:install:\n', renderStart);
    const renderSource = taskSource.slice(renderStart, renderEnd);

    expect(renderStart).toBeGreaterThan(-1);
    expect(renderEnd).toBeGreaterThan(renderStart);
    expect(renderSource).toContain(
      'delegation-visualization/scripts/src/cli.ts',
    );
    expect(renderSource).not.toContain('deps:');
    expect(renderSource).not.toContain('skills:install');
    expect(renderSource).not.toContain('bun install');
  });

  test('binds hosted Loom verification to the Cortex audit', async () => {
    const taskSource = await readFile(
      join(REPO_ROOT, '.task/agentic-ai.yml'),
      'utf8',
    );
    const verifyStart = taskSource.indexOf('\n  loom:verify:\n');
    const verifyEnd = taskSource.indexOf(
      '\n  loom:module-experts:validate:\n',
      verifyStart,
    );
    const verifySource = taskSource.slice(verifyStart, verifyEnd);
    const remoteSource = await readFile(
      join(REPO_ROOT, '.github/scripts/remote-task-batch.sh'),
      'utf8',
    );

    expect(verifyStart).toBeGreaterThan(-1);
    expect(verifyEnd).toBeGreaterThan(verifyStart);
    expect(verifySource).toContain('task: loom:cortex-audit');
    expect(remoteSource).toContain(
      'loom:verify) run_with_timeout "$timeout_minutes" task loom:verify',
    );
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

async function writableCortexAuthorityFixture(): Promise<string> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'loom-team-authority-'));
  const cortexRoot = join(fixtureRoot, '.cortex');
  await mkdir(join(cortexRoot, 'gizmo'), CREATE_RECURSIVELY);
  await symlink(join(REPO_ROOT, '.cortex/teams'), join(cortexRoot, 'teams'));
  await writeFile(
    join(cortexRoot, 'AGENTS.md'),
    await readFile(join(REPO_ROOT, '.cortex/AGENTS.md'), 'utf8'),
    'utf8',
  );
  await writeFile(
    join(cortexRoot, 'gizmo/AGENTS.md'),
    await readFile(join(REPO_ROOT, '.cortex/gizmo/AGENTS.md'), 'utf8'),
    'utf8',
  );
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

async function autonomyDriftFixture(invariant: string): Promise<string> {
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
