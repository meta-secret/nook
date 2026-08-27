import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'bun:test';
import {
  listPersistentCortexMarkdownFiles,
  runCortexAuditFromDirectory,
} from '../src/commands/cortex-audit.ts';
import type { CortexAuditReport } from '../src/commands/cortex-audit.ts';
import { CortexStructureFindingCode } from '../src/lib/cortex-document-structure.ts';

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

test('fails the integrated Cortex audit for authored HTML', async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'cortex-html-audit-'));
  try {
    const cortexRoot = path.join(repoRoot, '.cortex');
    const skillsRoot = path.join(cortexRoot, 'dynamic-skills');
    const directoryOptions = { recursive: true } as const;
    mkdirSync(skillsRoot, directoryOptions);
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

test('does not cascade from an indexed skill rejected by syntax admission', async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'cortex-html-cascade-'));
  try {
    const cortexRoot = path.join(repoRoot, '.cortex');
    const teamsRoot = path.join(cortexRoot, 'teams');
    const aiRoot = path.join(teamsRoot, 'ai');
    const gizmoRoot = path.join(cortexRoot, 'gizmo');
    const skillsRoot = path.join(aiRoot, 'dynamic-skills');
    const directoryOptions = { recursive: true } as const;
    mkdirSync(skillsRoot, directoryOptions);
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
    for (const graphPath of [
      path.join(gizmoRoot, 'knowledge-graph.md'),
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
- [Rejected executable](../../../../.agents/skills/bad/SKILL.md)
`,
    );
    writeFileSync(
      path.join(skillsRoot, 'bad.md'),
      '# Rejected skill\n\n<div>forbidden</div>\n',
    );

    const request = { includeDensityLint: false };
    const auditArgs = { request, startDirectory: repoRoot };
    const report = await runCortexAuditFromDirectory(auditArgs);
    const expectedReport: CortexAuditReport = {
      brokenLinks: [],
      missingFromIndex: [],
      orphanIndexRows: [],
      missingExecutableSkills: [],
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
      auditOk: false,
    };
    expect(report).toEqual(expectedReport);
  } finally {
    const removeOptions = { recursive: true, force: true } as const;
    rmSync(repoRoot, removeOptions);
  }
});
