import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'bun:test';
import {
  listPersistentCortexMarkdownFiles,
  runCortexAuditFromDirectory,
} from '../src/commands/cortex-audit.ts';
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
      '# Agent Map\n\n## Policy\n\n<!-- forbidden -->\n',
    );
    writeFileSync(
      path.join(cortexRoot, 'knowledge-graph.md'),
      '# Knowledge Graph\n',
    );
    writeFileSync(path.join(skillsRoot, 'index.md'), '# Skills\n');
    const request = { includeDensityLint: false };
    const auditArgs = { request, startDirectory: repoRoot };
    const report = await runCortexAuditFromDirectory(auditArgs);
    expect(report.auditOk).toBe(false);
    expect(report.structureFindings.map((finding) => finding.code)).toContain(
      CortexStructureFindingCode.ProhibitedHtml,
    );
  } finally {
    const removeOptions = { recursive: true, force: true } as const;
    rmSync(repoRoot, removeOptions);
  }
});
