import assert from 'node:assert/strict';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';

import { tmpdir } from 'node:os';

import path from 'node:path';

import { expect, test } from 'bun:test';
import { ok } from 'neverthrow';

import { CortexAuditCommand } from '../src/commands/cortex-audit.ts';
import { RepositoryRoot } from '../src/lib/repo.ts';
import { LoomFailureCode } from '../src/loom-failure.ts';

import { CortexMarkdownInventory } from '../src/lib/cortex-markdown-files.ts';

import type { CortexAuditReport } from '../src/commands/cortex-audit.ts';

import { CortexStructureFindingCode } from '../../../.cortex/teams/ai/dynamic-skills/cortex-document-map/scripts/src/cortex-document-structure.ts';

import { CortexContractFindingCode } from '../src/lib/cortex-contracts.ts';

import { CortexArticleFindingCode } from '../src/lib/cortex-article-structure.ts';

export class CortexAuditSessionScenario {
  private constructor(private readonly request: string) {}

  static installValeConfiguration(repoRoot: string): void {
    return new CortexAuditSessionScenario(repoRoot).execute();
  }

  private execute(): void {
    const repoRoot = this.request;
    copyFileSync(
      path.join(REPOSITORY_ROOT, '.vale.ini'),
      path.join(repoRoot, '.vale.ini'),
    );
    cpSync(
      path.join(REPOSITORY_ROOT, '.vale', 'styles'),
      path.join(repoRoot, '.vale', 'styles'),
      { recursive: true },
    );
    copyFileSync(
      path.join(REPOSITORY_ROOT, '.vale', 'density.ini'),
      path.join(repoRoot, '.vale', 'density.ini'),
    );
  }
}

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../../..');

test('returns a typed failure when a discovered repository loses its Cortex root', async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'cortex-missing-root-'));
  const originalLocate = RepositoryRoot.prototype.locate;
  RepositoryRoot.prototype.locate = () => ok(repoRoot);
  try {
    const result = await CortexAuditCommand.runCortexAuditFromDirectory({
      request: { includeDensityLint: false },
      startDirectory: repoRoot,
    });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error).toEqual({
      code: LoomFailureCode.CortexAuditFailed,
      message: '.cortex directory is missing',
    });
  } finally {
    RepositoryRoot.prototype.locate = originalLocate;
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('uses the event commit for publication stability audits', () => {
  const before = '1'.repeat(40);
  const base = '2'.repeat(40);
  expect(
    CortexAuditCommand.publishedBaseCandidatesForEvent({ before }),
  ).toEqual([before]);
  expect(
    CortexAuditCommand.publishedBaseCandidatesForEvent({
      before,
      pull_request: { base: { sha: base } },
    }),
  ).toEqual([base]);
});

test('excludes temporary session memory from persistent Cortex documents', () => {
  const cortexRoot = mkdtempSync(path.join(tmpdir(), 'cortex-session-audit-'));
  try {
    const sessionRoot = path.join(cortexRoot, '.session');
    const skillsRoot = path.join(cortexRoot, 'dynamic-skills');
    const directoryOptions = { recursive: true } as const;
    mkdirSync(sessionRoot, directoryOptions);
    mkdirSync(skillsRoot, directoryOptions);
    writeFileSync(path.join(cortexRoot, 'AGENTS.md'), '# Agent Map\n');
    writeFileSync(path.join(sessionRoot, 'current-task.md'), '# Session\n');
    writeFileSync(path.join(skillsRoot, 'durable.md'), '# Durable\n');

    const relativeFiles =
      CortexMarkdownInventory.listPersistentCortexMarkdownFiles(cortexRoot).map(
        (filePath) => path.relative(cortexRoot, filePath),
      );

    expect(relativeFiles).toEqual([
      'AGENTS.md',
      path.join('dynamic-skills', 'durable.md'),
    ]);
  } finally {
    const removeOptions = { recursive: true, force: true } as const;
    rmSync(cortexRoot, removeOptions);
  }
});

test('excludes workspace dependencies and canonical executable package scripts', () => {
  const cortexRoot = mkdtempSync(path.join(tmpdir(), 'cortex-scripts-scope-'));
  try {
    const skillRoot = path.join(
      cortexRoot,
      'teams',
      'ai',
      'dynamic-skills',
      'article-audit',
    );
    const unrelatedScripts = path.join(cortexRoot, 'teams', 'ai', 'scripts');
    const unknownSkillRoot = path.join(
      cortexRoot,
      'teams',
      'unknown',
      'dynamic-skills',
      'hidden',
    );
    const directoryOptions = { recursive: true } as const;
    mkdirSync(path.join(skillRoot, 'scripts', 'src'), directoryOptions);
    mkdirSync(path.join(skillRoot, 'scripts', 'tests'), directoryOptions);
    mkdirSync(
      path.join(skillRoot, 'scripts', 'node_modules', '.bin'),
      directoryOptions,
    );
    mkdirSync(unrelatedScripts, directoryOptions);
    mkdirSync(path.join(unknownSkillRoot, 'scripts'), directoryOptions);
    mkdirSync(
      path.join(cortexRoot, 'node_modules', 'workspace-tool'),
      directoryOptions,
    );
    writeFileSync(
      path.join(cortexRoot, 'node_modules', 'workspace-tool', 'README.md'),
      '# Generated dependency\n',
    );
    writeFileSync(
      path.join(skillRoot, 'SKILL.md'),
      '---\nname: article-audit\ndescription: Audit articles.\n---\n\n# Article Audit\n',
    );
    for (const name of [
      '.gitignore',
      '.prettierrc',
      'eslint.config.js',
      'executable-skill.json',
      'package.json',
      'tsconfig.json',
    ]) {
      writeFileSync(path.join(skillRoot, 'scripts', name), '{}\n');
    }
    writeFileSync(path.join(skillRoot, 'scripts', 'README.md'), '# Code\n');
    writeFileSync(
      path.join(skillRoot, 'scripts', 'node_modules', 'tool'),
      '#!/bin/sh\n',
    );
    symlinkSync(
      '../tool',
      path.join(skillRoot, 'scripts', 'node_modules', '.bin', 'tool'),
    );
    writeFileSync(path.join(unrelatedScripts, 'policy.md'), '# Policy\n');
    writeFileSync(path.join(unknownSkillRoot, 'SKILL.md'), '# Hidden\n');
    writeFileSync(
      path.join(unknownSkillRoot, 'scripts', 'README.md'),
      '# Must remain audited\n',
    );

    const relativeFiles = CortexMarkdownInventory.listCortexMarkdownFiles(
      cortexRoot,
    ).map((filePath) => path.relative(cortexRoot, filePath));
    expect(relativeFiles).toContain(
      path.join('teams', 'ai', 'scripts', 'policy.md'),
    );
    expect(relativeFiles).not.toContain(
      path.join('node_modules', 'workspace-tool', 'README.md'),
    );
    expect(relativeFiles).toContain(
      path.join('teams', 'ai', 'dynamic-skills', 'article-audit', 'SKILL.md'),
    );
    expect(relativeFiles).not.toContain(
      path.join(
        'teams',
        'ai',
        'dynamic-skills',
        'article-audit',
        'scripts',
        'README.md',
      ),
    );
    expect(relativeFiles).toContain(
      path.join(
        'teams',
        'unknown',
        'dynamic-skills',
        'hidden',
        'scripts',
        'README.md',
      ),
    );
  } finally {
    const removeOptions = { recursive: true, force: true } as const;
    rmSync(cortexRoot, removeOptions);
  }
});

test('enforces Vale through the common Cortex audit execution path', async () => {
  const repoRoot = realpathSync(
    mkdtempSync(path.join(tmpdir(), 'cortex-vale-audit-')),
  );
  try {
    CortexAuditSessionScenario.installValeConfiguration(repoRoot);
    const cortexRoot = path.join(repoRoot, '.cortex');
    mkdirSync(cortexRoot, { recursive: true });
    writeFileSync(
      path.join(cortexRoot, 'AGENTS.md'),
      '# Agent Map\n\n## Relationships\n\nObsolete navigation.\n',
    );
    const audit = CortexAuditCommand.runCortexAuditFromDirectory({
      request: { includeDensityLint: false },
      startDirectory: repoRoot,
    });
    const failure = await audit;
    assert(failure.isErr());
    expect(failure.error.message).toContain('Vale Cortex lint failed');
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('fails the integrated Cortex audit for rendered Markdown tables', async () => {
  const repoRoot = realpathSync(
    mkdtempSync(path.join(tmpdir(), 'cortex-table-audit-')),
  );
  try {
    CortexAuditSessionScenario.installValeConfiguration(repoRoot);
    const cortexRoot = path.join(repoRoot, '.cortex');
    const skillsRoot = path.join(cortexRoot, 'dynamic-skills');
    const directoryOptions = { recursive: true } as const;
    mkdirSync(skillsRoot, directoryOptions);
    writeFileSync(
      path.join(cortexRoot, 'AGENTS.md'),
      `# Agent Map

## Context

- None.

## Navigation

- [Policy](#policy)
  - Defines the policy.
  - Read for the rule.

## Policy

| Shape | Use |
| --- | --- |
| Rule | Parallel constraints |
`,
    );
    writeFileSync(path.join(cortexRoot, 'index.md'), '# Index\n');
    writeFileSync(path.join(skillsRoot, 'index.md'), '# Skills\n');
    const request = { includeDensityLint: true };
    const auditArgs = { request, startDirectory: repoRoot };
    const reportOutcome =
      await CortexAuditCommand.runCortexAuditFromDirectory(auditArgs);
    expect(reportOutcome.isOk()).toBe(true);
    if (reportOutcome.isErr()) return;
    const report = reportOutcome.value;
    expect(report.auditOk).toBe(false);
    expect(report.articleStructureFindings).toContainEqual({
      code: CortexArticleFindingCode.MarkdownTable,
      file: '.cortex/AGENTS.md',
      line: 15,
      message:
        'Rendered Markdown table in .cortex/AGENTS.md is prohibited; use an enclosed structured list.',
    });
  } finally {
    const removeOptions = { recursive: true, force: true } as const;
    rmSync(repoRoot, removeOptions);
  }
});

test('fails the integrated Cortex audit for authored HTML', async () => {
  const repoRoot = realpathSync(
    mkdtempSync(path.join(tmpdir(), 'cortex-html-audit-')),
  );
  try {
    CortexAuditSessionScenario.installValeConfiguration(repoRoot);
    const cortexRoot = path.join(repoRoot, '.cortex');
    const skillsRoot = path.join(cortexRoot, 'dynamic-skills');
    const directoryOptions = { recursive: true } as const;
    mkdirSync(skillsRoot, directoryOptions);
    const frontmatterSkillRoot = path.join(
      cortexRoot,
      'teams',
      'ai',
      'dynamic-skills',
      'html-frontmatter',
    );
    mkdirSync(frontmatterSkillRoot, directoryOptions);
    writeFileSync(
      path.join(cortexRoot, 'AGENTS.md'),
      `Text before the title with a [broken link](missing.md).

# Agent Map

## Navigation

- [Policy](#policy)
  - Defines the policy.
  - Read for the rule.

## Policy

First paragraph; another clause; and another clause that makes this sentence deliberately dense enough for the density audit.

Second paragraph.

Third paragraph.

Fourth paragraph.

<!-- forbidden -->
`,
    );
    writeFileSync(
      path.join(cortexRoot, 'index.md'),
      '# Index\n\nRoute one; route two; route three.\n',
    );
    writeFileSync(path.join(skillsRoot, 'index.md'), '# Skills\n');
    writeFileSync(
      path.join(frontmatterSkillRoot, 'SKILL.md'),
      '---\nname: html-frontmatter\ndescription: <span>forbidden</span>\n---\n\n# HTML Frontmatter\n',
    );
    const request = { includeDensityLint: true };
    const auditArgs = { request, startDirectory: repoRoot };
    const reportOutcome =
      await CortexAuditCommand.runCortexAuditFromDirectory(auditArgs);
    expect(reportOutcome.isOk()).toBe(true);
    if (reportOutcome.isErr()) return;
    const report = reportOutcome.value;
    expect(report.auditOk).toBe(false);
    const agentFindings = report.structureFindings.filter(
      (finding) => finding.file === '.cortex/AGENTS.md',
    );
    expect(agentFindings).toHaveLength(1);
    expect(agentFindings[0]?.code).toBe(
      CortexStructureFindingCode.ProhibitedHtml,
    );
    const expectedFrontmatterFinding = {
      code: CortexStructureFindingCode.ProhibitedHtml,
      file: '.cortex/teams/ai/dynamic-skills/html-frontmatter/SKILL.md',
      line: 3,
      message:
        'Authored HTML is prohibited in Cortex Markdown. Use Markdown syntax, escaped text, or inline or block code.',
    };
    expect(report.structureFindings).toContainEqual(expectedFrontmatterFinding);
    expect(
      report.articleStructureFindings.some(
        (finding) => finding.file === '.cortex/AGENTS.md',
      ),
    ).toBe(false);
    expect(
      report.brokenLinks.some(
        (finding) => finding.file === '.cortex/AGENTS.md',
      ),
    ).toBe(false);
    expect(
      report.densityFindings.some(
        (finding) => finding.file === '.cortex/AGENTS.md',
      ),
    ).toBe(false);
    expect(
      report.densityValeAlerts.some((alert) =>
        alert.file.endsWith('/.cortex/AGENTS.md'),
      ),
    ).toBe(false);
    expect(
      report.densityValeAlerts.some(
        (alert) =>
          alert.check === 'NookDensity.Semicolons' &&
          alert.file.endsWith('/.cortex/index.md'),
      ),
    ).toBe(true);
  } finally {
    const removeOptions = { recursive: true, force: true } as const;
    rmSync(repoRoot, removeOptions);
  }
});

test('admits session Markdown only through the global HTML syntax gate', async () => {
  const repoRoot = realpathSync(
    mkdtempSync(path.join(tmpdir(), 'cortex-session-html-')),
  );
  try {
    CortexAuditSessionScenario.installValeConfiguration(repoRoot);
    const cortexRoot = path.join(repoRoot, '.cortex');
    const sessionRoot = path.join(cortexRoot, '.session', 'nested');
    const skillsRoot = path.join(cortexRoot, 'dynamic-skills');
    const directoryOptions = { recursive: true } as const;
    mkdirSync(sessionRoot, directoryOptions);
    mkdirSync(skillsRoot, directoryOptions);
    writeFileSync(path.join(cortexRoot, 'AGENTS.md'), '# Agent Map\n');
    writeFileSync(path.join(cortexRoot, 'index.md'), '# Index\n');
    writeFileSync(path.join(skillsRoot, 'index.md'), '# Skills\n');
    const sessionPath = path.join(sessionRoot, 'current-task.md');
    writeFileSync(
      sessionPath,
      'Session scratch without a title and with many clauses and constraints and failure modes and commands until it becomes too dense for a reader. [Broken](missing.md).\n',
    );
    const request = { includeDensityLint: true };
    const auditArgs = { request, startDirectory: repoRoot };
    const ordinaryReportOutcome =
      await CortexAuditCommand.runCortexAuditFromDirectory(auditArgs);
    expect(ordinaryReportOutcome.isOk()).toBe(true);
    if (ordinaryReportOutcome.isErr()) return;
    const ordinaryReport = ordinaryReportOutcome.value;
    expect(
      ordinaryReport.structureFindings.some((finding) =>
        finding.file.includes('.session'),
      ),
    ).toBe(false);
    expect(
      ordinaryReport.brokenLinks.some((finding) =>
        finding.file.includes('.session'),
      ),
    ).toBe(false);
    expect(
      ordinaryReport.densityFindings.some((finding) =>
        finding.file.includes('.session'),
      ),
    ).toBe(false);

    writeFileSync(sessionPath, '<!-- forbidden session HTML -->\n');
    const htmlReportOutcome =
      await CortexAuditCommand.runCortexAuditFromDirectory(auditArgs);
    expect(htmlReportOutcome.isOk()).toBe(true);
    if (htmlReportOutcome.isErr()) return;
    const htmlReport = htmlReportOutcome.value;
    expect(htmlReport.auditOk).toBe(false);
    const sessionHtmlFindings = htmlReport.structureFindings.filter(
      (finding) =>
        finding.code === CortexStructureFindingCode.ProhibitedHtml &&
        finding.file.includes('.session'),
    );
    expect(sessionHtmlFindings).toHaveLength(1);
    expect(
      htmlReport.articleStructureFindings.some((finding) =>
        finding.file.includes('.session'),
      ),
    ).toBe(false);
  } finally {
    const removeOptions = { recursive: true, force: true } as const;
    rmSync(repoRoot, removeOptions);
  }
});

test('admits project specifications without cascading from rejected syntax', async () => {
  const repoRoot = realpathSync(
    mkdtempSync(path.join(tmpdir(), 'cortex-html-cascade-')),
  );
  try {
    CortexAuditSessionScenario.installValeConfiguration(repoRoot);
    const cortexRoot = path.join(repoRoot, '.cortex');
    const teamsRoot = path.join(cortexRoot, 'teams');
    const aiRoot = path.join(teamsRoot, 'ai');
    const gizmoRoot = path.join(cortexRoot, 'docs', 'spec');
    const gizmoSkillsRoot = gizmoRoot;
    const skillsRoot = path.join(aiRoot, 'dynamic-skills');
    const gizmoSkillSlugs = [
      'team-oriented-development',
      'agent-feature-ownership',
      'code-review-comments',
      'efficient-pr-delivery',
      'feature-issue-planning',
      'issue-scope-management',
    ] as const;
    const gizmoGraphRows = gizmoSkillSlugs
      .map((slug) => `- [${slug}](${slug}.md)`)
      .join('\n');
    const directoryOptions = { recursive: true } as const;
    mkdirSync(skillsRoot, directoryOptions);
    mkdirSync(gizmoSkillsRoot, directoryOptions);
    mkdirSync(path.join(teamsRoot, 'dev-core'), directoryOptions);
    mkdirSync(path.join(teamsRoot, 'security'), directoryOptions);
    mkdirSync(path.join(teamsRoot, 'sre'), directoryOptions);
    mkdirSync(path.join(teamsRoot, 'web-dev'), directoryOptions);
    mkdirSync(gizmoRoot, directoryOptions);
    mkdirSync(path.join(cortexRoot, 'docs', 'architecture'), directoryOptions);
    writeFileSync(
      path.join(cortexRoot, 'docs', 'architecture', 'index.md'),
      '# Architecture\n',
    );
    mkdirSync(path.join(cortexRoot, 'shared'), directoryOptions);
    writeFileSync(path.join(cortexRoot, 'AGENTS.md'), '# Agent Map\n');
    writeFileSync(
      path.join(cortexRoot, 'index.md'),
      `# Index

- [Agent Map](AGENTS.md)
- [Project specifications](docs/spec/index.md)
- [Project architecture](docs/architecture/index.md)
- [AI](teams/ai/index.md)
- [Development core](teams/dev-core/index.md)
- [Security](teams/security/index.md)
- [SRE](teams/sre/index.md)
- [Web development](teams/web-dev/index.md)
- [Shared](shared/index.md)
`,
    );
    writeFileSync(
      path.join(aiRoot, 'index.md'),
      `# AI Index

- [Skill index](dynamic-skills/index.md)
- [Rejected skill](dynamic-skills/bad.md)
`,
    );
    writeFileSync(
      path.join(gizmoRoot, 'index.md'),
      `# Gizmo Index

${gizmoGraphRows}
`,
    );
    for (const graphPath of [
      path.join(teamsRoot, 'dev-core', 'index.md'),
      path.join(teamsRoot, 'security', 'index.md'),
      path.join(teamsRoot, 'sre', 'index.md'),
      path.join(teamsRoot, 'web-dev', 'index.md'),
      path.join(cortexRoot, 'shared', 'index.md'),
    ]) {
      writeFileSync(graphPath, '# Index\n');
    }
    writeFileSync(
      path.join(skillsRoot, 'index.md'),
      `# Skills

- [Rejected skill](bad.md)
`,
    );
    writeFileSync(
      path.join(skillsRoot, 'bad.md'),
      '# Rejected skill\n\n<div>forbidden</div>\n',
    );
    for (const slug of gizmoSkillSlugs) {
      writeFileSync(path.join(gizmoSkillsRoot, `${slug}.md`), `# ${slug}\n`);
    }

    unlinkSync(path.join(repoRoot, '.vale', 'density.ini'));
    const request = { includeDensityLint: false };
    const auditArgs = { request, startDirectory: repoRoot };
    const reportOutcome =
      await CortexAuditCommand.runCortexAuditFromDirectory(auditArgs);
    expect(reportOutcome.isOk()).toBe(true);
    if (reportOutcome.isErr()) return;
    const report = reportOutcome.value;
    const expectedReport: CortexAuditReport = {
      brokenLinks: [],
      invalidExecutableSkillPackages: [],
      missingFromIndex: [],
      orphanIndexRows: [],
      prohibitedHarnessSkillPaths: [],
      densityFindings: [],
      densityValeAlerts: [],
      structureFindings: [
        {
          code: CortexStructureFindingCode.ProhibitedHtml,
          file: '.cortex/teams/ai/dynamic-skills/bad.md',
          line: 3,
          message:
            'Authored HTML is prohibited in Cortex Markdown. Use Markdown syntax, escaped text, or inline or block code.',
        },
        {
          code: CortexStructureFindingCode.MissingIndex,
          file: '.cortex/teams/delivery-pipeline/index.md',
          line: 1,
          message:
            'Required owner index is missing: .cortex/teams/delivery-pipeline/index.md',
        },
        {
          code: CortexStructureFindingCode.MissingFromIndex,
          file: '.cortex/index.md',
          line: 1,
          message:
            'Root index must link the owner graph: .cortex/teams/delivery-pipeline/index.md',
        },
      ],
      articleStructureFindings: [],
      identifierFindings: [
        {
          file: '.cortex/identifiers.json',
          message: 'Cortex identifier registry is missing.',
        },
      ],
      contractFindings: [
        {
          code: CortexContractFindingCode.MissingPolicyDocument,
          file: '.cortex/teams/ai/dynamic-skills/cortex-writer.md',
          message:
            'Cortex policy references a missing document: .cortex/teams/ai/dynamic-skills/cortex-writer.md',
        },
        {
          code: CortexContractFindingCode.MissingPolicyDocument,
          file: '.cortex/teams/ai/dynamic-skills/cortex-article-structure/SKILL.md',
          message:
            'Cortex policy references a missing document: .cortex/teams/ai/dynamic-skills/cortex-article-structure/SKILL.md',
        },
        {
          code: CortexContractFindingCode.MissingPolicyDocument,
          file: '.cortex/teams/ai/dynamic-skills/cortex-consistency/SKILL.md',
          message:
            'Cortex policy references a missing document: .cortex/teams/ai/dynamic-skills/cortex-consistency/SKILL.md',
        },
        {
          code: CortexContractFindingCode.MissingPolicyReference,
          file: '.cortex/AGENTS.md',
          message:
            'Cortex context .cortex/AGENTS.md imports policy .cortex/teams/ai/dynamic-skills/cortex-writer.md but its authority document does not reference it.',
        },
        {
          code: CortexContractFindingCode.MissingPolicyReference,
          file: '.cortex/AGENTS.md',
          message:
            'Cortex context .cortex/AGENTS.md imports policy .cortex/teams/ai/dynamic-skills/cortex-article-structure/SKILL.md but its authority document does not reference it.',
        },
        {
          code: CortexContractFindingCode.MissingPolicyReference,
          file: '.cortex/AGENTS.md',
          message:
            'Cortex context .cortex/AGENTS.md imports policy .cortex/teams/ai/dynamic-skills/cortex-consistency/SKILL.md but its authority document does not reference it.',
        },
        {
          code: CortexContractFindingCode.MissingRuntimeDocument,
          file: '.cortex/docs/spec/subagent-delegation.md',
          message:
            'Cortex runtime references a missing document: .cortex/docs/spec/subagent-delegation.md',
        },
      ],
      auditOk: false,
    };
    expect(report).toEqual(expectedReport);
  } finally {
    const removeOptions = { recursive: true, force: true } as const;
    rmSync(repoRoot, removeOptions);
  }
});

test('discovers project-local Cortex without scanning framework, dependencies, or symlinks', () => {
  const repository = mkdtempSync(path.join(tmpdir(), 'loom-local-context-'));
  const contexts = [
    '.cortex',
    'nook-app/.cortex/docs/spec',
    'nook-app/nook-platform/nook-core/.cortex/docs/architecture',
    '.meta-cortex/teams/project/.cortex',
    'node_modules/dependency/.cortex',
    '.git/fixture/.cortex',
    '.vale/fixtures/synthetic/.cortex',
  ];
  try {
    for (const context of contexts) {
      const directory = path.join(repository, context);
      mkdirSync(directory, { recursive: true });
      writeFileSync(path.join(directory, 'index.md'), '# Context\n');
    }
    symlinkSync(
      path.join(repository, '.meta-cortex'),
      path.join(repository, 'linked-framework'),
    );
    const files = new CortexMarkdownInventory(repository)
      .repositoryFiles()
      .map((file) => path.relative(repository, file));
    expect(files).toEqual([
      '.cortex/index.md',
      'nook-app/.cortex/docs/spec/index.md',
      'nook-app/nook-platform/nook-core/.cortex/docs/architecture/index.md',
    ]);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});
