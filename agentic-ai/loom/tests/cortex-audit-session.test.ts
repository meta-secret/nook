import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'bun:test';
import {
  listPersistentCortexMarkdownFiles,
  runCortexAuditFromDirectory,
} from '../src/commands/cortex-audit.ts';
import type { CortexAuditRequest } from '../src/codec/args/cortex-audit.ts';
import { ExecutableSkillRegistryFindingCode } from '../src/executable-skills/domain.ts';

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

test('returns precise registry findings without launching an invalid capability', async () => {
  const repositoryRoot = mkdtempSync(
    path.join(tmpdir(), 'cortex-registry-audit-'),
  );
  const removeOptions = { recursive: true, force: true } as const;
  try {
    const skillRoot = path.join(
      repositoryRoot,
      '.agents/skills/cortex-article-structure',
    );
    const directoryOptions = { recursive: true } as const;
    mkdirSync(path.join(repositoryRoot, '.cortex'), directoryOptions);
    mkdirSync(skillRoot, directoryOptions);
    writeFileSync(
      path.join(repositoryRoot, '.cortex/AGENTS.md'),
      '# Agent map\n',
    );
    writeFileSync(path.join(skillRoot, 'executable-skill.json'), '{}');
    const gitOptions = { cwd: repositoryRoot };
    execFileSync('git', ['init', '--quiet'], gitOptions);

    const request: CortexAuditRequest = { includeDensityLint: false };
    const auditArgs = {
      request,
      signal: false,
      startDirectory: repositoryRoot,
    } as const;
    const report = await runCortexAuditFromDirectory(auditArgs);

    expect(report.auditOk).toBe(false);
    expect(report.articleStructureFindings).toEqual([]);
    expect(
      report.executableSkillRegistryFindings.map((finding) => finding.code),
    ).toContain(ExecutableSkillRegistryFindingCode.InvalidManifest);
  } finally {
    rmSync(repositoryRoot, removeOptions);
  }
});
