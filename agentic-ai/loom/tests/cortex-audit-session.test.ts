import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'bun:test';
import {
  listCortexMarkdownFiles,
  listPersistentCortexMarkdownFiles,
  publishedBaseCandidatesForEvent,
  runCortexAuditFromDirectory,
} from '../src/commands/cortex-audit.ts';
import type { CortexAuditReport } from '../src/commands/cortex-audit.ts';
import { CortexStructureFindingCode } from '../src/lib/cortex-document-structure.ts';

test('uses the pre-push commit for push stability audits', () => {
  const before = '1'.repeat(40);
  const base = '2'.repeat(40);
  expect(publishedBaseCandidatesForEvent({ before })).toEqual([before]);
  expect(
    publishedBaseCandidatesForEvent({
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

    const relativeFiles = listPersistentCortexMarkdownFiles(cortexRoot).map(
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

test('excludes only canonical executable package scripts from Cortex Markdown', () => {
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
    writeFileSync(
      path.join(skillRoot, 'SKILL.md'),
      '---\nname: article-audit\ndescription: Audit articles.\n---\n\n# Article Audit\n',
    );
    for (const name of [
      '.gitignore',
      '.prettierrc',
      'bun.lock',
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

    const relativeFiles = listCortexMarkdownFiles(cortexRoot).map((filePath) =>
      path.relative(cortexRoot, filePath),
    );
    expect(relativeFiles).toContain(
      path.join('teams', 'ai', 'scripts', 'policy.md'),
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

test('fails the integrated Cortex audit for authored HTML', async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'cortex-html-audit-'));
  try {
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

## Document map

- [Policy](#policy)
  - Defines the policy.
  - Read for the rule.

## Policy

First paragraph and another clause and another clause and another clause that makes this sentence deliberately dense enough for the density audit.

Second paragraph.

Third paragraph.

Fourth paragraph.

<!-- forbidden -->
`,
    );
    writeFileSync(
      path.join(cortexRoot, 'knowledge-graph.md'),
      '# Knowledge Graph\n',
    );
    writeFileSync(path.join(skillsRoot, 'index.md'), '# Skills\n');
    writeFileSync(
      path.join(frontmatterSkillRoot, 'SKILL.md'),
      '---\nname: html-frontmatter\ndescription: <span>forbidden</span>\n---\n\n# HTML Frontmatter\n',
    );
    const request = { includeDensityLint: true };
    const auditArgs = { request, startDirectory: repoRoot };
    const report = await runCortexAuditFromDirectory(auditArgs);
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
  } finally {
    const removeOptions = { recursive: true, force: true } as const;
    rmSync(repoRoot, removeOptions);
  }
});

test('admits session Markdown only through the global HTML syntax gate', async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'cortex-session-html-'));
  try {
    const cortexRoot = path.join(repoRoot, '.cortex');
    const sessionRoot = path.join(cortexRoot, '.session', 'nested');
    const skillsRoot = path.join(cortexRoot, 'dynamic-skills');
    const directoryOptions = { recursive: true } as const;
    mkdirSync(sessionRoot, directoryOptions);
    mkdirSync(skillsRoot, directoryOptions);
    writeFileSync(path.join(cortexRoot, 'AGENTS.md'), '# Agent Map\n');
    writeFileSync(
      path.join(cortexRoot, 'knowledge-graph.md'),
      '# Knowledge Graph\n',
    );
    writeFileSync(path.join(skillsRoot, 'index.md'), '# Skills\n');
    const sessionPath = path.join(sessionRoot, 'current-task.md');
    writeFileSync(
      sessionPath,
      'Session scratch without a title and with many clauses and constraints and failure modes and commands until it becomes too dense for a reader. [Broken](missing.md).\n',
    );
    const request = { includeDensityLint: true };
    const auditArgs = { request, startDirectory: repoRoot };
    const ordinaryReport = await runCortexAuditFromDirectory(auditArgs);
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
    const htmlReport = await runCortexAuditFromDirectory(auditArgs);
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

test('admits Gizmo skill rows without cascading from rejected syntax', async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'cortex-html-cascade-'));
  try {
    const cortexRoot = path.join(repoRoot, '.cortex');
    const teamsRoot = path.join(cortexRoot, 'teams');
    const aiRoot = path.join(teamsRoot, 'ai');
    const gizmoRoot = path.join(cortexRoot, 'gizmo');
    const gizmoSkillsRoot = path.join(gizmoRoot, 'dynamic-skills');
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
      .map((slug) => `- [${slug}](dynamic-skills/${slug}.md)`)
      .join('\n');
    const gizmoIndexRows = gizmoSkillSlugs
      .map((slug) => `- [${slug}](../../../gizmo/dynamic-skills/${slug}.md)`)
      .join('\n');
    const directoryOptions = { recursive: true } as const;
    mkdirSync(skillsRoot, directoryOptions);
    mkdirSync(gizmoSkillsRoot, directoryOptions);
    mkdirSync(path.join(teamsRoot, 'dev-core'), directoryOptions);
    mkdirSync(path.join(teamsRoot, 'security'), directoryOptions);
    mkdirSync(path.join(teamsRoot, 'sre'), directoryOptions);
    mkdirSync(path.join(teamsRoot, 'web-dev'), directoryOptions);
    mkdirSync(gizmoRoot, directoryOptions);
    mkdirSync(path.join(cortexRoot, 'shared'), directoryOptions);
    writeFileSync(path.join(cortexRoot, 'AGENTS.md'), '# Agent Map\n');
    writeFileSync(
      path.join(cortexRoot, 'knowledge-graph.md'),
      `# Knowledge Graph

- [Agent Map](AGENTS.md)
- [Gizmo](gizmo/knowledge-graph.md)
- [AI](teams/ai/knowledge-graph.md)
- [Development core](teams/dev-core/knowledge-graph.md)
- [Security](teams/security/knowledge-graph.md)
- [SRE](teams/sre/knowledge-graph.md)
- [Web development](teams/web-dev/knowledge-graph.md)
- [Shared](shared/knowledge-graph.md)
`,
    );
    writeFileSync(
      path.join(aiRoot, 'knowledge-graph.md'),
      `# AI Knowledge Graph

- [Skill index](dynamic-skills/index.md)
- [Rejected skill](dynamic-skills/bad.md)
`,
    );
    writeFileSync(
      path.join(gizmoRoot, 'knowledge-graph.md'),
      `# Gizmo Knowledge Graph

${gizmoGraphRows}
`,
    );
    for (const graphPath of [
      path.join(teamsRoot, 'dev-core', 'knowledge-graph.md'),
      path.join(teamsRoot, 'security', 'knowledge-graph.md'),
      path.join(teamsRoot, 'sre', 'knowledge-graph.md'),
      path.join(teamsRoot, 'web-dev', 'knowledge-graph.md'),
      path.join(cortexRoot, 'shared', 'knowledge-graph.md'),
    ]) {
      writeFileSync(graphPath, '# Knowledge Graph\n');
    }
    writeFileSync(
      path.join(skillsRoot, 'index.md'),
      `# Skills

- [Rejected skill](bad.md)
${gizmoIndexRows}
`,
    );
    writeFileSync(
      path.join(skillsRoot, 'bad.md'),
      '# Rejected skill\n\n<div>forbidden</div>\n',
    );
    for (const slug of gizmoSkillSlugs) {
      writeFileSync(path.join(gizmoSkillsRoot, `${slug}.md`), `# ${slug}\n`);
    }

    const request = { includeDensityLint: false };
    const auditArgs = { request, startDirectory: repoRoot };
    const report = await runCortexAuditFromDirectory(auditArgs);
    const expectedReport: CortexAuditReport = {
      brokenLinks: [],
      invalidExecutableSkillPackages: [],
      missingFromIndex: [],
      orphanIndexRows: [],
      prohibitedHarnessSkillPaths: [],
      densityFindings: [],
      structureFindings: [
        {
          code: CortexStructureFindingCode.ProhibitedHtml,
          file: '.cortex/teams/ai/dynamic-skills/bad.md',
          line: 3,
          message:
            'Authored HTML is prohibited in Cortex Markdown. Use Markdown syntax, escaped text, or inline or block code.',
        },
      ],
      articleStructureFindings: [],
      identifierFindings: [
        {
          file: '.cortex/identifiers.json',
          message: 'Cortex identifier registry is missing.',
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
