import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'bun:test';
import { ProjectContextContract } from '../../src/project-context/audit.ts';
import {
  TEAM_AUTHORITY_CATALOG,
  TeamAuthorityCatalog,
  TeamKey,
} from '../../src/project-context/catalog.ts';

class ProjectContextFixture {
  static readonly repositoryRoot = join(import.meta.dir, '../../../..');
  private constructor(readonly root: string) {}

  static fromSource(source: string): ProjectContextFixture {
    const root = mkdtempSync(join(tmpdir(), 'nook-project-context-'));
    mkdirSync(join(root, '.cortex'));
    symlinkSync(
      join(this.repositoryRoot, '.cortex/teams'),
      join(root, '.cortex/teams'),
    );
    writeFileSync(join(root, '.cortex/AGENTS.md'), source);
    return new ProjectContextFixture(root);
  }

  static source(): string {
    return readFileSync(join(this.repositoryRoot, '.cortex/AGENTS.md'), 'utf8');
  }

  static withOwnershipNode(kind: OwnershipNodeKind): ProjectContextFixture {
    const root = mkdtempSync(join(tmpdir(), 'nook-ownership-node-'));
    const directory = join(root, '.cortex/teams/ai/docs/spec');
    mkdirSync(directory, { recursive: true });
    const file = join(directory, 'functional-ownership.md');
    switch (kind) {
      case OwnershipNodeKind.Directory:
        mkdirSync(file);
        break;
      case OwnershipNodeKind.SymbolicLink:
        symlinkSync(
          join(
            this.repositoryRoot,
            '.cortex/teams/ai/docs/spec/functional-ownership.md',
          ),
          file,
        );
        break;
    }
    return new ProjectContextFixture(root);
  }

  audit() {
    return ProjectContextContract.auditProjectContexts({ repoRoot: this.root });
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}

enum OwnershipNodeKind {
  Directory = 'directory',
  SymbolicLink = 'symbolic-link',
}

describe('Nook functional project context', () => {
  test('loads six functional scopes without a local agent roster or installed role files', () => {
    const fixture = ProjectContextFixture.fromSource(
      ProjectContextFixture.source(),
    );
    try {
      expect(fixture.audit()).toMatchObject({
        authorityCount: 6,
        findings: [],
        auditOk: true,
      });
      expect(TEAM_AUTHORITY_CATALOG.map((context) => context.key)).toEqual([
        TeamKey.Ai,
        TeamKey.DevelopmentCore,
        TeamKey.Security,
        TeamKey.Sre,
        TeamKey.WebDevelopment,
        TeamKey.DeliveryPipeline,
      ]);
      for (const context of TEAM_AUTHORITY_CATALOG) {
        expect(context.contextPaths).toHaveLength(2);
        expect(context.contextPaths[0]).toEndWith(
          '/docs/spec/functional-ownership.md',
        );
        expect(context.contextPaths[1]).toEndWith('/index.md');
        expect(Object.hasOwn(context, 'model')).toBe(false);
        expect(Object.hasOwn(context, 'parent')).toBe(false);
      }
      expect(
        TeamAuthorityCatalog.teamCortexRoot(TeamKey.DeliveryPipeline),
      ).toBe('.cortex/teams/delivery-pipeline');
    } finally {
      fixture.dispose();
    }
  });

  test('rejects lost ownership, missing scopes, and duplicate functional identities', () => {
    const variants = [
      TEAM_AUTHORITY_CATALOG.slice(1),
      [...TEAM_AUTHORITY_CATALOG, ...TEAM_AUTHORITY_CATALOG],
      TEAM_AUTHORITY_CATALOG.map((context) => ({
        ...context,
        capabilityBoundary: '',
      })),
      TEAM_AUTHORITY_CATALOG.map((context) => ({
        ...context,
        contextPaths: ['../outside.md'],
      })),
    ];
    for (const authorities of variants) {
      expect(
        ProjectContextContract.auditTeamAuthorities({
          repoRoot: ProjectContextFixture.repositoryRoot,
          authorities,
        }).auditOk,
      ).toBe(false);
    }
  });

  test.each([
    '../.meta-cortex/teams/gizmo-team/agents/gizmo-prime/AGENTS.md',
    '../.meta-cortex/teams/gizmo-team/agents/gizmo/AGENTS.md',
    'docs/spec/upstream-role-routing.md',
    'Nook project root and shared Meta-Cortex library root',
    'applicable Nook checks',
  ])('rejects a missing upstream or project binding: %s', (binding) => {
    const fixture = ProjectContextFixture.fromSource(
      ProjectContextFixture.source().replaceAll(binding, 'removed'),
    );
    try {
      expect(fixture.audit().findings).toContainEqual({
        code: 'invalid-cortex-team-authority',
        path: '.cortex/AGENTS.md',
        message: `Canonical Cortex team authority is missing marker: ${binding}`,
      });
    } finally {
      fixture.dispose();
    }
  });

  test('reports missing ownership specifications without substituting an agent wrapper', () => {
    const root = mkdtempSync(join(tmpdir(), 'nook-missing-context-'));
    try {
      const report = ProjectContextContract.auditProjectContexts({
        repoRoot: root,
      });
      expect(report.auditOk).toBe(false);
      expect(report.findings.map((finding) => finding.path)).toContain(
        '.cortex/teams/sre/docs/spec/functional-ownership.md',
      );
      expect(
        report.findings
          .map((finding) => finding.path)
          .some((file) => file.includes('/gizmo/')),
      ).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test.each([OwnershipNodeKind.Directory, OwnershipNodeKind.SymbolicLink])(
    'requires an ownership specification to be a regular file: %s',
    (kind) => {
      const fixture = ProjectContextFixture.withOwnershipNode(kind);
      try {
        expect(fixture.audit().findings).toContainEqual({
          code: 'missing-team-context-path',
          path: '.cortex/teams/ai/docs/spec/functional-ownership.md',
          message:
            'Canonical Cortex team context is missing: .cortex/teams/ai/docs/spec/functional-ownership.md',
        });
      } finally {
        fixture.dispose();
      }
    },
  );
});
