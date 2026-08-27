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
  auditCortexMarkdownSyntax,
  auditCortexDocumentStructure,
  CortexStructureFindingCode,
  type AuditCortexMarkdownSyntaxArgs,
  type AuditCortexDocumentStructureArgs,
  type CortexDocumentSource,
  type CortexStructureFinding,
} from '../lib/cortex-document-structure.ts';
import {
  auditCortexArticleStructure,
  type AuditCortexArticleStructureArgs,
  type CortexArticleFinding,
} from '../lib/cortex-article-structure.ts';
export type CortexAuditReport = {
  readonly brokenLinks: BrokenLink[];
  readonly missingFromIndex: string[];
  readonly orphanIndexRows: string[];
  readonly missingExecutableSkills: string[];
  readonly densityFindings: DensityFinding[];
  readonly structureFindings: CortexStructureFinding[];
  readonly articleStructureFindings: CortexArticleFinding[];
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

  const allMarkdownFiles = listCortexMarkdownFiles(cortexRoot);
  const brokenLinks: BrokenLink[] = [];
  const densityFindings: DensityFinding[] = [];
  const allDocuments = allMarkdownFiles.map((filePath) => {
    const documentSource: CortexDocumentSource = {
      absolutePath: filePath,
      relativePath: path.relative(repoRoot, filePath),
      content: readFileSync(filePath, 'utf8'),
    };
    return documentSource;
  });
  const syntaxAuditArgs: AuditCortexMarkdownSyntaxArgs = {
    documents: allDocuments,
  };
  const syntaxFindings = auditCortexMarkdownSyntax(syntaxAuditArgs);
  const syntaxInvalidPaths = new Set(
    syntaxFindings
      .filter(
        (finding) => finding.code === CortexStructureFindingCode.ProhibitedHtml,
      )
      .map((finding) => finding.file),
  );
  const syntaxInvalidSkillNames = new Set(
    [...syntaxInvalidPaths]
      .filter((filePath) => filePath.includes('/dynamic-skills/'))
      .map((filePath) => path.basename(filePath)),
  );
  const documents = allDocuments.filter((document) => {
    const persistenceArgs: IsPersistentCortexMarkdownFileArgs = {
      cortexRoot,
      filePath: document.absolutePath,
    };
    return (
      isPersistentCortexMarkdownFile(persistenceArgs) &&
      !syntaxInvalidPaths.has(document.relativePath)
    );
  });
  const admittedDocumentPaths = new Set(
    documents.map((document) => document.relativePath),
  );

  for (const documentSource of documents) {
    const filePath = documentSource.absolutePath;
    const findBrokenRelativeLinksArgs: FindBrokenRelativeLinksArgs = {
      filePath,
      content: documentSource.content,
      repoRoot,
    };
    brokenLinks.push(...findBrokenRelativeLinks(findBrokenRelativeLinksArgs));
    if (args.request.includeDensityLint) {
      const lintProseDensityArgs: LintProseDensityArgs = {
        filePath: path.relative(repoRoot, filePath),
        content: documentSource.content,
      };
      densityFindings.push(...lintProseDensity(lintProseDensityArgs));
    }
  }

  const documentMapBaselineArgs: MigrationBaselineEntriesArgs = {
    ledgerPath: DOCUMENT_MAP_MIGRATION_LEDGER_PATH,
    markerPath: DOCUMENT_MAP_SKILL_PATH,
    repoRoot,
  };
  const structureAuditArgs: AuditCortexDocumentStructureArgs = {
    documents,
    excludedDocumentPaths: syntaxInvalidPaths,
    migrationBaselineEntries: migrationBaselineEntries(documentMapBaselineArgs),
    migrationLedgerPath: path.join(cortexRoot, 'document-map-migration.txt'),
    repoRoot,
  };
  const downstreamStructureFindings = auditCortexDocumentStructure(
    structureAuditArgs,
  ).filter((finding) => !syntaxInvalidPaths.has(finding.file));
  const structureFindings = [...syntaxFindings, ...downstreamStructureFindings];
  const articleBaselineArgs: MigrationBaselineEntriesArgs = {
    ledgerPath: ARTICLE_MIGRATION_LEDGER_PATH,
    markerPath: ARTICLE_STRUCTURE_SKILL_PATH,
    repoRoot,
  };
  const articleStructureAuditArgs: AuditCortexArticleStructureArgs = {
    documents,
    migrationBaselineEntries: migrationBaselineEntries(articleBaselineArgs),
    migrationLedgerPath: path.join(
      cortexRoot,
      'article-structure-migration.txt',
    ),
    repoRoot,
  };
  const articleStructureFindings = auditCortexArticleStructure(
    articleStructureAuditArgs,
  );

  const aiSkillsDir = path.join(cortexRoot, 'teams', 'ai', 'dynamic-skills');
  const skillDirectories = [
    aiSkillsDir,
    path.join(cortexRoot, 'shared', 'dynamic-skills'),
    path.join(cortexRoot, 'teams', 'dev-core', 'dynamic-skills'),
    path.join(cortexRoot, 'teams', 'sre', 'dynamic-skills'),
    path.join(cortexRoot, 'teams', 'web-dev', 'dynamic-skills'),
  ];
  const skillFiles = skillDirectories
    .flatMap((skillsDir) =>
      existsSync(skillsDir)
        ? readdirSync(skillsDir)
            .filter((name) => name.endsWith('.md'))
            .filter((name) => name !== 'index.md' && name !== '_template.md')
            .map((name) => path.join(skillsDir, name))
        : [],
    )
    .map((filePath) => path.relative(repoRoot, filePath))
    .filter((filePath) => admittedDocumentPaths.has(filePath))
    .sort();
  const indexPath = path.join(aiSkillsDir, 'index.md');
  const indexRelativePath = path.relative(repoRoot, indexPath);
  const indexIsAdmitted = admittedDocumentPaths.has(indexRelativePath);
  const indexContent = indexIsAdmitted ? readFileSync(indexPath, 'utf8') : '';
  const indexed = new Set(
    [...indexContent.matchAll(/\(([^)]+\.md)\)/g)]
      .map((match) => match[1] ?? '')
      .filter((target) => !target.includes('.agents/'))
      .map((target) => path.resolve(path.dirname(indexPath), target))
      .map((target) => path.relative(repoRoot, target))
      .filter((target) => target.includes('/dynamic-skills/')),
  );

  const missingFromIndex = indexIsAdmitted
    ? skillFiles
        .filter((filePath) => !indexed.has(filePath))
        .map((filePath) => path.basename(filePath))
    : [];
  const orphanIndexRows = indexIsAdmitted
    ? [...indexed]
        .filter(
          (filePath) =>
            path.basename(filePath) !== 'index.md' &&
            path.basename(filePath) !== '_template.md' &&
            !syntaxInvalidSkillNames.has(path.basename(filePath)) &&
            !skillFiles.includes(filePath),
        )
        .map((filePath) => path.basename(filePath))
    : [];

  const missingExecutableSkills: string[] = [];
  for (const match of indexContent.matchAll(
    /\((?:\.\.\/)+\.agents\/skills\/([^/]+)\/SKILL\.md\)/g,
  )) {
    const slug = match[1];
    if (typeof slug !== 'string') {
      continue;
    }
    if (syntaxInvalidSkillNames.has(`${slug}.md`)) {
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
  const admittedBrokenLinks = brokenLinks.filter((finding) => {
    if (finding.file !== '.cortex/teams/ai/dynamic-skills/index.md') {
      return true;
    }
    const mirrorMatch =
      /^(?:\.\.\/)+\.agents\/skills\/([^/]+)\/SKILL\.md(?:#.*)?$/.exec(
        finding.target,
      );
    const slug = mirrorMatch?.[1];
    return (
      typeof slug !== 'string' || !syntaxInvalidSkillNames.has(`${slug}.md`)
    );
  });

  return {
    brokenLinks: admittedBrokenLinks,
    missingFromIndex,
    orphanIndexRows,
    missingExecutableSkills,
    densityFindings,
    structureFindings,
    articleStructureFindings,
    auditOk:
      admittedBrokenLinks.length === 0 &&
      missingFromIndex.length === 0 &&
      orphanIndexRows.length === 0 &&
      missingExecutableSkills.length === 0 &&
      densityFindings.length === 0 &&
      structureFindings.length === 0 &&
      articleStructureFindings.length === 0,
  };
}

const DOCUMENT_MAP_MIGRATION_LEDGER_PATH = '.cortex/document-map-migration.txt';
const DOCUMENT_MAP_SKILL_PATH =
  '.cortex/teams/ai/dynamic-skills/cortex-document-map.md';
const ARTICLE_MIGRATION_LEDGER_PATH = '.cortex/article-structure-migration.txt';
const ARTICLE_STRUCTURE_SKILL_PATH =
  '.cortex/teams/ai/dynamic-skills/cortex-article-structure.md';

type ReadGitTextArgs = {
  readonly relativePath: string;
  readonly repoRoot: string;
  readonly revision: string;
};

type MigrationBaselineEntriesArgs = {
  readonly ledgerPath: string;
  readonly markerPath: string;
  readonly repoRoot: string;
};

function migrationBaselineEntries(
  args: MigrationBaselineEntriesArgs,
): readonly string[] | false {
  const headLedgerArgs: ReadGitTextArgs = {
    relativePath: args.ledgerPath,
    repoRoot: args.repoRoot,
    revision: 'HEAD',
  };
  const headLedger = readGitText(headLedgerArgs);
  if (headLedger === false) {
    const headSkillArgs: GitRevisionHasMarkerArgs = {
      markerPath: args.markerPath,
      repoRoot: args.repoRoot,
      revision: 'HEAD',
    };
    return gitRevisionHasMarker(headSkillArgs) ? [] : false;
  }
  if (!worktreeLedgerMatchesHead(args)) {
    return ledgerEntries(headLedger);
  }
  const parentLedgerArgs: ReadGitTextArgs = {
    relativePath: args.ledgerPath,
    repoRoot: args.repoRoot,
    revision: 'HEAD^',
  };
  const parentLedger = readGitText(parentLedgerArgs);
  if (parentLedger !== false) {
    return ledgerEntries(parentLedger);
  }
  const parentSkillArgs: GitRevisionHasMarkerArgs = {
    markerPath: args.markerPath,
    repoRoot: args.repoRoot,
    revision: 'HEAD^',
  };
  return gitRevisionHasMarker(parentSkillArgs) ? [] : false;
}

type GitRevisionHasMarkerArgs = {
  readonly markerPath: string;
  readonly repoRoot: string;
  readonly revision: string;
};

function gitRevisionHasMarker(args: GitRevisionHasMarkerArgs): boolean {
  const readArgs: ReadGitTextArgs = {
    relativePath: args.markerPath,
    repoRoot: args.repoRoot,
    revision: args.revision,
  };
  return readGitText(readArgs) !== false;
}

function worktreeLedgerMatchesHead(
  args: MigrationBaselineEntriesArgs,
): boolean {
  const commandArgs = ['diff', '--quiet', 'HEAD', '--', args.ledgerPath];
  const options: ExecFileSyncOptionsWithStringEncoding = {
    cwd: args.repoRoot,
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

export function listPersistentCortexMarkdownFiles(root: string): string[] {
  return listCortexMarkdownFiles(root).filter((filePath) => {
    const args: IsPersistentCortexMarkdownFileArgs = {
      cortexRoot: root,
      filePath,
    };
    return isPersistentCortexMarkdownFile(args);
  });
}

type IsPersistentCortexMarkdownFileArgs = {
  readonly cortexRoot: string;
  readonly filePath: string;
};

function isPersistentCortexMarkdownFile(
  args: IsPersistentCortexMarkdownFileArgs,
): boolean {
  const relativePath = path.relative(args.cortexRoot, args.filePath);
  return (
    relativePath !== '.session' &&
    !relativePath.startsWith(`.session${path.sep}`)
  );
}

export function listCortexMarkdownFiles(root: string): string[] {
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
