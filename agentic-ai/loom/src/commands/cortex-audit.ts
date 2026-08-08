import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { CortexAuditRequest } from '../codec/args/cortex-audit.ts';
import { lintProseDensity, type DensityFinding } from '../lib/density.ts';
import { findBrokenRelativeLinks, type BrokenLink } from '../lib/links.ts';
import { findRepoRoot } from '../lib/repo.ts';
import { ResultKind, err, ok, type Result } from '../result.ts';

export type CortexAuditReport = {
  readonly brokenLinks: BrokenLink[];
  readonly missingFromIndex: string[];
  readonly orphanIndexRows: string[];
  readonly missingExecutableSkills: string[];
  readonly densityFindings: DensityFinding[];
  readonly auditOk: boolean;
};

export async function runCortexAudit(
  request: CortexAuditRequest,
): Promise<Result<CortexAuditReport>> {
  const repo = findRepoRoot();
  if (repo.kind === ResultKind.Err) {
    return repo;
  }
  const repoRoot = repo.value;
  const cortexRoot = path.join(repoRoot, '.cortex');
  if (!existsSync(cortexRoot)) {
    return err('.cortex directory is missing');
  }

  const mdFiles = listMarkdownFiles(cortexRoot);
  const brokenLinks: BrokenLink[] = [];
  const densityFindings: DensityFinding[] = [];

  for (const filePath of mdFiles) {
    const content = readFileSync(filePath, 'utf8');
    brokenLinks.push(...findBrokenRelativeLinks(filePath, content, repoRoot));
    if (request.includeDensityLint) {
      densityFindings.push(
        ...lintProseDensity(path.relative(repoRoot, filePath), content),
      );
    }
  }

  const skillsDir = path.join(cortexRoot, 'dynamic-skills');
  const skillFiles = readdirSync(skillsDir)
    .filter((name) => name.endsWith('.md'))
    .filter((name) => name !== 'index.md' && name !== '_template.md')
    .sort();

  const indexPath = path.join(skillsDir, 'index.md');
  const indexContent = readFileSync(indexPath, 'utf8');
  const indexed = new Set(
    [...indexContent.matchAll(/\(([^)]+\.md)\)/g)]
      .map((match) => match[1] ?? '')
      .filter((target) => !target.includes('/') && target.endsWith('.md')),
  );

  const missingFromIndex = skillFiles.filter((name) => !indexed.has(name));
  const orphanIndexRows = [...indexed].filter(
    (name) =>
      name !== 'index.md' &&
      name !== '_template.md' &&
      !skillFiles.includes(name),
  );

  const missingExecutableSkills: string[] = [];
  for (const match of indexContent.matchAll(
    /\(\.\.\/\.\.\/\.agents\/skills\/([^/]+)\/SKILL\.md\)/g,
  )) {
    const slug = match[1];
    if (typeof slug !== 'string') {
      continue;
    }
    const skillPath = path.join(
      repoRoot,
      '.agents',
      'skills',
      slug,
      'SKILL.md',
    );
    if (!existsSync(skillPath)) {
      missingExecutableSkills.push(slug);
    }
  }

  return ok({
    brokenLinks,
    missingFromIndex,
    orphanIndexRows,
    missingExecutableSkills,
    densityFindings,
    auditOk:
      brokenLinks.length === 0 &&
      missingFromIndex.length === 0 &&
      orphanIndexRows.length === 0 &&
      missingExecutableSkills.length === 0 &&
      densityFindings.length === 0,
  });
}

function listMarkdownFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current !== 'string') {
      break;
    }
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.md')) {
        out.push(full);
      }
    }
  }
  return out.sort();
}
