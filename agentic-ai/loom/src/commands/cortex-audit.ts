import { readdirSync, readFileSync, existsSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import path from 'node:path';
import type { CortexAuditRequest } from '../codec/args/cortex-audit.ts';
import {
  asUntrustedYamlNode,
  isRecord,
  type UntrustedYamlNode,
} from '../lib/guards.ts';
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
  readonly invalidExecutableSkillPackages: string[];
  readonly missingFromIndex: string[];
  readonly orphanIndexRows: string[];
  readonly prohibitedHarnessSkillPaths: string[];
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
  const syntaxDocuments = allMarkdownFiles.map((filePath) => {
    const documentSource: CortexDocumentSource = {
      absolutePath: filePath,
      relativePath: path.relative(repoRoot, filePath),
      content: readFileSync(filePath, 'utf8'),
    };
    return documentSource;
  });
  const allDocuments = allMarkdownFiles.map((filePath) => {
    const documentSource: CortexDocumentSource = {
      absolutePath: filePath,
      relativePath: path.relative(repoRoot, filePath),
      content: readCortexMarkdown(filePath),
    };
    return documentSource;
  });
  const syntaxAuditArgs: AuditCortexMarkdownSyntaxArgs = {
    documents: syntaxDocuments,
  };
  const syntaxFindings = auditCortexMarkdownSyntax(syntaxAuditArgs);
  const syntaxInvalidPaths = new Set(
    syntaxFindings
      .filter(
        (finding) => finding.code === CortexStructureFindingCode.ProhibitedHtml,
      )
      .map((finding) => finding.file),
  );
  const syntaxInvalidSkillPaths = new Set(
    [...syntaxInvalidPaths].filter((filePath) =>
      filePath.includes('/dynamic-skills/'),
    ),
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
    path.join(cortexRoot, 'gizmo', 'dynamic-skills'),
    path.join(cortexRoot, 'shared', 'dynamic-skills'),
    path.join(cortexRoot, 'teams', 'dev-core', 'dynamic-skills'),
    path.join(cortexRoot, 'teams', 'security', 'dynamic-skills'),
    path.join(cortexRoot, 'teams', 'sre', 'dynamic-skills'),
    path.join(cortexRoot, 'teams', 'web-dev', 'dynamic-skills'),
  ];
  const executableSkillPackageFindings = skillDirectories.flatMap(
    (skillsDir) => {
      const packageAuditArgs: AuditExecutableSkillPackagesArgs = {
        repoRoot,
        skillsDir,
      };
      return auditExecutableSkillPackages(packageAuditArgs);
    },
  );
  const skillFiles = skillDirectories
    .flatMap((skillsDir) =>
      existsSync(skillsDir)
        ? readdirSync(skillsDir)
            .flatMap((name) => {
              const candidate = path.join(skillsDir, name);
              if (name.endsWith('.md')) return [candidate];
              const skill = path.join(candidate, 'SKILL.md');
              return existsSync(skill) ? [skill] : [];
            })
            .filter(
              (file) =>
                !file.endsWith('/index.md') && !file.endsWith('/_template.md'),
            )
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
      .map((target) => path.resolve(path.dirname(indexPath), target))
      .map((target) => path.relative(repoRoot, target))
      .filter((target) => target.includes('/dynamic-skills/')),
  );

  const missingFromIndex = indexIsAdmitted
    ? skillFiles.filter((filePath) => !indexed.has(filePath))
    : [];
  const orphanIndexRows = indexIsAdmitted
    ? [...indexed]
        .filter(
          (filePath) =>
            path.basename(filePath) !== 'index.md' &&
            path.basename(filePath) !== '_template.md' &&
            !syntaxInvalidSkillPaths.has(filePath) &&
            !skillFiles.includes(filePath),
        )
        .map(skillDiagnosticName)
    : [];

  const prohibitedHarnessSkillPaths = trackedHarnessSkillPaths(repoRoot);

  return {
    brokenLinks,
    invalidExecutableSkillPackages: executableSkillPackageFindings,
    missingFromIndex,
    orphanIndexRows,
    prohibitedHarnessSkillPaths,
    densityFindings,
    structureFindings,
    articleStructureFindings,
    auditOk:
      brokenLinks.length === 0 &&
      executableSkillPackageFindings.length === 0 &&
      missingFromIndex.length === 0 &&
      orphanIndexRows.length === 0 &&
      prohibitedHarnessSkillPaths.length === 0 &&
      densityFindings.length === 0 &&
      structureFindings.length === 0 &&
      articleStructureFindings.length === 0,
  };
}

const HARNESS_SKILL_ROOTS = [
  '.agents/skills',
  '.cursor/skills',
  '.claude/skills',
] as const;

function trackedHarnessSkillPaths(repoRoot: string): string[] {
  if (!existsSync(path.join(repoRoot, '.git'))) {
    return [];
  }
  const commandArgs = ['ls-files', '--', ...HARNESS_SKILL_ROOTS];
  const options: ExecFileSyncOptionsWithStringEncoding = {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  };
  try {
    return execFileSync('git', commandArgs, options)
      .split(/\r?\n/u)
      .filter((entry) => entry.length > 0)
      .sort();
  } catch {
    return [...HARNESS_SKILL_ROOTS];
  }
}

const DOCUMENT_MAP_MIGRATION_LEDGER_PATH = '.cortex/document-map-migration.txt';
const DOCUMENT_MAP_SKILL_PATH =
  '.cortex/teams/ai/dynamic-skills/cortex-document-map.md';
const ARTICLE_MIGRATION_LEDGER_PATH = '.cortex/article-structure-migration.txt';
const ARTICLE_STRUCTURE_SKILL_PATH =
  '.cortex/teams/ai/dynamic-skills/cortex-article-structure/SKILL.md';

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
        const scriptsDirectoryArgs: IsExecutableSkillScriptsDirectoryArgs = {
          cortexRoot: root,
          candidate: full,
        };
        if (isExecutableSkillScriptsDirectory(scriptsDirectoryArgs)) continue;
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

const EXECUTABLE_SKILL_PROJECT_FILES = [
  '.gitignore',
  '.prettierrc',
  'bun.lock',
  'eslint.config.js',
  'executable-skill.json',
  'package.json',
  'tsconfig.json',
] as const;

export type AuditExecutableSkillPackagesArgs = {
  readonly repoRoot: string;
  readonly skillsDir: string;
};

export function auditExecutableSkillPackages(
  args: AuditExecutableSkillPackagesArgs,
): string[] {
  if (!existsSync(args.skillsDir)) return [];
  const findings: string[] = [];
  const directoryOptions: { readonly withFileTypes: true } = {
    withFileTypes: true,
  };
  for (const entry of readdirSync(args.skillsDir, directoryOptions)) {
    if (entry.isSymbolicLink()) {
      findings.push(
        `${path.relative(args.repoRoot, path.join(args.skillsDir, entry.name))}: dynamic skill entries cannot be symlinks`,
      );
      continue;
    }
    if (!entry.isDirectory()) continue;
    const packageRoot = path.join(args.skillsDir, entry.name);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.name)) {
      findings.push(
        `${path.relative(args.repoRoot, packageRoot)}: executable skill directory must use a canonical kebab-case slug`,
      );
      continue;
    }
    const skillPath = path.join(packageRoot, 'SKILL.md');
    if (!isRegularFile(skillPath)) {
      findings.push(
        `${path.relative(args.repoRoot, packageRoot)}: executable skill directory is missing SKILL.md`,
      );
      continue;
    }
    const frontmatterArgs: AuditExecutableSkillFrontmatterArgs = {
      repoRoot: args.repoRoot,
      skillPath,
      slug: entry.name,
    };
    findings.push(...auditExecutableSkillFrontmatter(frontmatterArgs));
    const scriptsRoot = path.join(packageRoot, 'scripts');
    if (!isRegularDirectory(scriptsRoot)) {
      findings.push(
        `${path.relative(args.repoRoot, scriptsRoot)}: executable skill package is missing scripts`,
      );
      continue;
    }
    for (const required of EXECUTABLE_SKILL_PROJECT_FILES) {
      const requiredPath = path.join(scriptsRoot, required);
      if (!isRegularFile(requiredPath)) {
        findings.push(
          `${path.relative(args.repoRoot, requiredPath)}: executable skill package file is missing`,
        );
      }
    }
    for (const required of ['src', 'tests'] as const) {
      const requiredPath = path.join(scriptsRoot, required);
      if (!isRegularDirectory(requiredPath)) {
        findings.push(
          `${path.relative(args.repoRoot, requiredPath)}: executable skill package directory is missing`,
        );
      }
    }
    for (const nestedSkillPath of nestedSkillCards(scriptsRoot)) {
      findings.push(
        `${path.relative(args.repoRoot, nestedSkillPath)}: scripts cannot contain a skill-card mirror`,
      );
    }
  }
  return findings.sort();
}

function nestedSkillCards(scriptsRoot: string): readonly string[] {
  const skillCards: string[] = [];
  const pending = [scriptsRoot];
  const directoryOptions: { readonly withFileTypes: true } = {
    withFileTypes: true,
  };
  while (pending.length > 0) {
    const directory = pending.pop();
    if (typeof directory !== 'string') break;
    for (const entry of readdirSync(directory, directoryOptions)) {
      if (entry.name === 'node_modules') continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      if (entry.isFile() && entry.name === 'SKILL.md')
        skillCards.push(entryPath);
    }
  }
  return skillCards.sort();
}

type AuditExecutableSkillFrontmatterArgs = {
  readonly repoRoot: string;
  readonly skillPath: string;
  readonly slug: string;
};

function auditExecutableSkillFrontmatter(
  args: AuditExecutableSkillFrontmatterArgs,
): string[] {
  const relativeSkillPath = path.relative(args.repoRoot, args.skillPath);
  const content = readFileSync(args.skillPath, 'utf8');
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u
    .exec(content)
    ?.at(1);
  if (typeof frontmatter !== 'string') {
    return [`${relativeSkillPath}: SKILL.md is missing YAML frontmatter`];
  }
  const fields = new Set<string>();
  for (const line of frontmatter.split(/\r?\n/u)) {
    const field = /^(name|description):/u.exec(line);
    const name = field?.at(1);
    if (typeof name === 'string') {
      if (fields.has(name)) {
        return [
          `${relativeSkillPath}: SKILL.md frontmatter duplicates ${name}`,
        ];
      }
      fields.add(name);
    }
  }
  let parsed: UntrustedYamlNode;
  try {
    parsed = asUntrustedYamlNode(
      Bun.YAML.parse(frontmatter) as UntrustedYamlNode,
    );
  } catch {
    return [`${relativeSkillPath}: SKILL.md frontmatter is invalid YAML`];
  }
  const entries = isRecord(parsed) ? Object.entries(parsed) : [];
  const nameEntry = entries.find(([key]) => key === 'name');
  const descriptionEntry = entries.find(([key]) => key === 'description');
  const name = nameEntry ? nameEntry[1] : false;
  const description = descriptionEntry ? descriptionEntry[1] : false;
  const findings: string[] = [];
  if (name !== args.slug) {
    findings.push(
      `${relativeSkillPath}: SKILL.md name must equal directory slug ${args.slug}`,
    );
  }
  if (typeof description !== 'string' || description.trim().length === 0) {
    findings.push(
      `${relativeSkillPath}: SKILL.md description must be a nonempty string`,
    );
  }
  return findings;
}

type IsExecutableSkillScriptsDirectoryArgs = {
  readonly cortexRoot: string;
  readonly candidate: string;
};

function isExecutableSkillScriptsDirectory(
  args: IsExecutableSkillScriptsDirectoryArgs,
): boolean {
  if (path.basename(args.candidate) !== 'scripts') return false;
  const skillRoot = path.dirname(args.candidate);
  const slug = path.basename(skillRoot);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) return false;
  const skillPath = path.join(skillRoot, 'SKILL.md');
  if (!isRegularFile(skillPath)) return false;
  const ownerRoot = path.dirname(skillRoot);
  if (path.basename(ownerRoot) !== 'dynamic-skills') return false;
  const relativeOwner = path.relative(args.cortexRoot, ownerRoot);
  const canonicalOwner =
    relativeOwner === path.join('gizmo', 'dynamic-skills') ||
    relativeOwner === path.join('shared', 'dynamic-skills') ||
    ['ai', 'dev-core', 'security', 'sre', 'web-dev'].some(
      (team) => relativeOwner === path.join('teams', team, 'dynamic-skills'),
    );
  if (!canonicalOwner) return false;
  const frontmatterArgs: AuditExecutableSkillFrontmatterArgs = {
    repoRoot: path.dirname(args.cortexRoot),
    skillPath,
    slug,
  };
  return (
    auditExecutableSkillFrontmatter(frontmatterArgs).length === 0 &&
    EXECUTABLE_SKILL_PROJECT_FILES.every((name) =>
      isRegularFile(path.join(args.candidate, name)),
    ) &&
    ['src', 'tests'].every((name) =>
      isRegularDirectory(path.join(args.candidate, name)),
    ) &&
    nestedSkillCards(args.candidate).length === 0
  );
}

function readCortexMarkdown(filePath: string): string {
  const content = readFileSync(filePath, 'utf8');
  return filePath.endsWith(`${path.sep}SKILL.md`)
    ? content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, (frontmatter) =>
        frontmatter.replace(/[^\r\n]/gu, ' '),
      )
    : content;
}

function skillDiagnosticName(filePath: string): string {
  return path.basename(filePath) === 'SKILL.md'
    ? path.dirname(filePath)
    : path.basename(filePath);
}

function isRegularFile(filePath: string): boolean {
  try {
    const metadata = lstatSync(filePath);
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

function isRegularDirectory(directoryPath: string): boolean {
  try {
    const metadata = lstatSync(directoryPath);
    return metadata.isDirectory() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}
