import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import path from 'node:path';
import type { CortexAuditRequest } from '../codec/args/cortex-audit.ts';
import { lintProseDensity, type DensityFinding } from '../lib/density.ts';
import { findBrokenRelativeLinks, type BrokenLink } from '../lib/links.ts';
import { findRepoRoot } from '../lib/repo.ts';
import {
  LoomFailureCode,
  loomFailure,
  loomFailureDetail,
} from '../loom-failure.ts';

import type { LintProseDensityArgs } from '../lib/density.ts';
import type { FindBrokenRelativeLinksArgs } from '../lib/links.ts';
import type { LoomFailureDetailArgs } from '../loom-failure.ts';
import {
  auditCortexDocumentStructure,
  type AuditCortexDocumentStructureArgs,
  type CortexDocumentSource,
  type CortexStructureFinding,
} from '../lib/cortex-document-structure.ts';
export type CortexAuditReport = {
  readonly brokenLinks: BrokenLink[];
  readonly missingFromIndex: string[];
  readonly orphanIndexRows: string[];
  readonly missingExecutableSkills: string[];
  readonly densityFindings: DensityFinding[];
  readonly structureFindings: CortexStructureFinding[];
  readonly auditOk: boolean;
};

export type RunCortexAuditFromDirectoryArgs = {
  readonly request: CortexAuditRequest;
  readonly startDirectory: string;
};

export async function runCortexAudit(
  request: CortexAuditRequest,
): Promise<CortexAuditReport> {
  const args: RunCortexAuditFromDirectoryArgs = {
    request,
    startDirectory: process.cwd(),
  };
  return runCortexAuditFromDirectory(args);
}

export async function runCortexAuditFromDirectory(
  args: RunCortexAuditFromDirectoryArgs,
): Promise<CortexAuditReport> {
  const repoRoot = findRepoRoot(args.startDirectory);
  const cortexRoot = path.join(repoRoot, '.cortex');
  if (!existsSync(cortexRoot)) {
    const loomFailureDetailArgs: LoomFailureDetailArgs = {
      code: LoomFailureCode.CortexAuditFailed,
      text: '.cortex directory is missing',
    };
    loomFailureDetail(loomFailureDetailArgs);
  }

  const mdFiles = listMarkdownFiles(cortexRoot);
  const brokenLinks: BrokenLink[] = [];
  const densityFindings: DensityFinding[] = [];
  const documents: CortexDocumentSource[] = [];

  for (const filePath of mdFiles) {
    const content = readFileSync(filePath, 'utf8');
    const documentSource: CortexDocumentSource = {
      absolutePath: filePath,
      relativePath: path.relative(repoRoot, filePath),
      content,
    };
    documents.push(documentSource);
    const findBrokenRelativeLinksArgs: FindBrokenRelativeLinksArgs = {
      filePath,
      content,
      repoRoot,
    };
    brokenLinks.push(...findBrokenRelativeLinks(findBrokenRelativeLinksArgs));
    if (args.request.includeDensityLint) {
      const lintProseDensityArgs: LintProseDensityArgs = {
        filePath: path.relative(repoRoot, filePath),
        content,
      };
      densityFindings.push(...lintProseDensity(lintProseDensityArgs));
    }
  }

  const structureAuditArgs: AuditCortexDocumentStructureArgs = {
    documents,
    migrationBaselineEntries: migrationBaselineEntries(repoRoot),
    migrationLedgerPath: path.join(cortexRoot, 'document-map-migration.txt'),
    repoRoot,
  };
  const structureFindings = auditCortexDocumentStructure(structureAuditArgs);

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

  return {
    brokenLinks,
    missingFromIndex,
    orphanIndexRows,
    missingExecutableSkills,
    densityFindings,
    structureFindings,
    auditOk:
      brokenLinks.length === 0 &&
      missingFromIndex.length === 0 &&
      orphanIndexRows.length === 0 &&
      missingExecutableSkills.length === 0 &&
      densityFindings.length === 0 &&
      structureFindings.length === 0,
  };
}

const MIGRATION_LEDGER_PATH = '.cortex/document-map-migration.txt';
const DOCUMENT_MAP_SKILL_PATH = '.cortex/dynamic-skills/cortex-document-map.md';

type ReadGitTextArgs = {
  readonly relativePath: string;
  readonly repoRoot: string;
  readonly revision: string;
};

function migrationBaselineEntries(repoRoot: string): readonly string[] | false {
  const headLedgerArgs: ReadGitTextArgs = {
    relativePath: MIGRATION_LEDGER_PATH,
    repoRoot,
    revision: 'HEAD',
  };
  const headLedger = readGitText(headLedgerArgs);
  if (headLedger === false) {
    const headSkillArgs: GitRevisionHasDocumentMapSkillArgs = {
      repoRoot,
      revision: 'HEAD',
    };
    return gitRevisionHasDocumentMapSkill(headSkillArgs) ? [] : false;
  }
  if (!worktreeLedgerMatchesHead(repoRoot)) {
    return ledgerEntries(headLedger);
  }
  const parentLedgerArgs: ReadGitTextArgs = {
    relativePath: MIGRATION_LEDGER_PATH,
    repoRoot,
    revision: 'HEAD^',
  };
  const parentLedger = readGitText(parentLedgerArgs);
  if (parentLedger !== false) {
    return ledgerEntries(parentLedger);
  }
  const parentSkillArgs: GitRevisionHasDocumentMapSkillArgs = {
    repoRoot,
    revision: 'HEAD^',
  };
  return gitRevisionHasDocumentMapSkill(parentSkillArgs) ? [] : false;
}

type GitRevisionHasDocumentMapSkillArgs = {
  readonly repoRoot: string;
  readonly revision: string;
};

function gitRevisionHasDocumentMapSkill(
  args: GitRevisionHasDocumentMapSkillArgs,
): boolean {
  const readArgs: ReadGitTextArgs = {
    relativePath: DOCUMENT_MAP_SKILL_PATH,
    repoRoot: args.repoRoot,
    revision: args.revision,
  };
  return readGitText(readArgs) !== false;
}

function worktreeLedgerMatchesHead(repoRoot: string): boolean {
  const commandArgs = ['diff', '--quiet', 'HEAD', '--', MIGRATION_LEDGER_PATH];
  const options: ExecFileSyncOptionsWithStringEncoding = {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'ignore'],
  };
  try {
    execFileSync('git', commandArgs, options);
    return true;
  } catch {
    return false;
  }
}

function readGitText(args: ReadGitTextArgs): string | false {
  const commandArgs = ['show', `${args.revision}:${args.relativePath}`];
  const options: ExecFileSyncOptionsWithStringEncoding = {
    cwd: args.repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  };
  try {
    return execFileSync('git', commandArgs, options);
  } catch {
    return false;
  }
}

function ledgerEntries(content: string): readonly string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function listMarkdownFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  const directoryReadOptions: { readonly withFileTypes: true } = {
    withFileTypes: true,
  };
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current !== 'string') {
      break;
    }
    for (const entry of readdirSync(current, directoryReadOptions)) {
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
