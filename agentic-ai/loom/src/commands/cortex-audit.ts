import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import path from 'node:path';
import type { CortexAuditRequest } from '../codec/args/cortex-audit.ts';
import { lintProseDensity, type DensityFinding } from '../lib/density.ts';
import { findBrokenRelativeLinks, type BrokenLink } from '../lib/links.ts';
import { findRepoRoot } from '../lib/repo.ts';
import { listCortexMarkdownFiles } from '../lib/cortex-markdown-files.ts';
import { runCortexVale } from '../lib/cortex-vale.ts';
import { runValeFiles, type ValeNativeAlert } from '../lib/vale-files.ts';
import {
  LoomFailureCode,
  loomFailure,
  loomFailureDetail,
} from '../loom-failure.ts';

import type { LintProseDensityArgs } from '../lib/density.ts';
import type { FindBrokenRelativeLinksArgs } from '../lib/links.ts';
import type { LoomFailureDetailArgs } from '../loom-failure.ts';
import {
  CortexStructureFindingCode,
  normalizedCortexMarkdown,
  type CortexDocumentSource,
  type CortexStructureFinding,
} from '../../../../.cortex/teams/ai/dynamic-skills/cortex-document-map/scripts/src/cortex-document-structure.ts';
import { executeCortexDocumentMapApplication } from '../../../../.cortex/teams/ai/dynamic-skills/cortex-document-map/scripts/src/application.ts';
import { CortexDocumentMapContractKind } from '../../../../.cortex/teams/ai/dynamic-skills/cortex-document-map/scripts/src/domain.ts';
import {
  auditCortexArticleStructure,
  type AuditCortexArticleStructureArgs,
  type CortexArticleFinding,
} from '../lib/cortex-article-structure.ts';
import {
  auditTrackedExecutableSkillPackages,
  type ExecutableSkillPackageFinding,
} from '../executable-skills/repository.ts';
import {
  auditCortexIdentifierStability,
  auditCortexIdentifierRegistry,
  CORTEX_IDENTIFIER_REGISTRY_PATH,
  decodeCortexIdentifierRegistry,
  type CortexIdentifierRegistry,
  type CortexIdentifierFinding,
} from '../lib/cortex-identifiers.ts';
import {
  compileCortexContracts,
  type CortexContractFinding,
} from '../lib/cortex-contracts.ts';
export type CortexAuditReport = {
  readonly brokenLinks: BrokenLink[];
  readonly invalidExecutableSkillPackages: readonly ExecutableSkillPackageFinding[];
  readonly missingFromIndex: string[];
  readonly orphanIndexRows: string[];
  readonly prohibitedHarnessSkillPaths: string[];
  readonly densityFindings: DensityFinding[];
  readonly densityValeAlerts: readonly ValeNativeAlert[];
  readonly structureFindings: CortexStructureFinding[];
  readonly articleStructureFindings: CortexArticleFinding[];
  readonly identifierFindings: readonly CortexIdentifierFinding[];
  readonly contractFindings: readonly CortexContractFinding[];
  readonly auditOk: boolean;
};

export type RunCortexAuditFromDirectoryArgs = {
  readonly request: CortexAuditRequest;
  readonly startDirectory: string;
};

type PublishedIdentifierRegistryResolution = {
  readonly registry: CortexIdentifierRegistry | false;
  readonly findings: readonly CortexIdentifierFinding[];
};

export type GitHubRepositoryPolicyEvent = {
  readonly before?: string;
  readonly pull_request?: {
    readonly base?: { readonly sha?: string };
  };
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
  runCortexVale({ cortexRoot, repoRoot });
  const brokenLinks: BrokenLink[] = [];
  const densityFindings: DensityFinding[] = [];
  let densityValeAlerts: readonly ValeNativeAlert[] = [];
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
  const excludedDocumentPaths = syntaxDocuments
    .filter((document) => {
      const persistenceArgs: IsPersistentCortexMarkdownFileArgs = {
        cortexRoot,
        filePath: document.absolutePath,
      };
      return !isPersistentCortexMarkdownFile(persistenceArgs);
    })
    .map((document) => document.relativePath);
  const documentMapResult = executeCortexDocumentMapApplication({
    kind: CortexDocumentMapContractKind.Request,
    documents: syntaxDocuments.map((document) => ({
      relativePath: document.relativePath,
      content: document.content,
    })),
    excludedDocumentPaths,
  });
  const structureFindings = [...documentMapResult.findings];
  const syntaxInvalidPaths = new Set(
    structureFindings
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

  if (args.request.includeDensityLint && documents.length > 0) {
    densityValeAlerts = runValeFiles({
      configPath: path.join(repoRoot, '.vale', 'density.ini'),
      files: documents.map((document) => document.absolutePath),
      repoRoot,
    }).alerts;
  }

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

  const articleStructureAuditArgs: AuditCortexArticleStructureArgs = {
    documents,
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
  const executableSkillPackageFindings =
    auditTrackedExecutableSkillPackages(repoRoot);
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
      .map((match) => {
        const [, target = ''] = match;
        return target;
      })
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
  const identifierAudit = auditCortexIdentifierRegistry(repoRoot);
  const publishedResolution = publishedIdentifierRegistry(repoRoot);
  const stabilityFindings =
    identifierAudit.registry && publishedResolution.registry
      ? auditCortexIdentifierStability({
          current: identifierAudit.registry,
          published: publishedResolution.registry,
        })
      : [];
  const identifierFindings = [
    ...identifierAudit.findings,
    ...publishedResolution.findings,
    ...stabilityFindings,
  ];
  const contractFindings = compileCortexContracts({
    documents: allDocuments,
  });

  return {
    brokenLinks,
    invalidExecutableSkillPackages: executableSkillPackageFindings,
    missingFromIndex,
    orphanIndexRows,
    prohibitedHarnessSkillPaths,
    densityFindings,
    densityValeAlerts,
    structureFindings,
    articleStructureFindings,
    identifierFindings,
    contractFindings,
    auditOk:
      brokenLinks.length === 0 &&
      executableSkillPackageFindings.length === 0 &&
      missingFromIndex.length === 0 &&
      orphanIndexRows.length === 0 &&
      prohibitedHarnessSkillPaths.length === 0 &&
      densityFindings.length === 0 &&
      densityValeAlerts.length === 0 &&
      structureFindings.length === 0 &&
      articleStructureFindings.length === 0 &&
      identifierFindings.length === 0 &&
      contractFindings.length === 0,
  };
}

function publishedIdentifierRegistry(
  repoRoot: string,
): PublishedIdentifierRegistryResolution {
  if (!existsSync(path.join(repoRoot, '.git'))) {
    return { registry: false, findings: [] };
  }
  const options: ExecFileSyncOptionsWithStringEncoding = {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  };
  const candidates = publishedBaseCandidates();
  const baseCommit = candidates.find((candidate) => {
    try {
      execFileSync(
        'git',
        ['rev-parse', '--verify', `${candidate}^{commit}`],
        options,
      );
      return true;
    } catch {
      return false;
    }
  });
  if (!baseCommit) {
    return {
      registry: false,
      findings: [
        {
          file: CORTEX_IDENTIFIER_REGISTRY_PATH,
          message:
            'Published Cortex identifier baseline could not be resolved.',
        },
      ],
    };
  }
  try {
    const serialized = execFileSync(
      'git',
      ['show', `${baseCommit}:${CORTEX_IDENTIFIER_REGISTRY_PATH}`],
      options,
    );
    const registry = decodeCortexIdentifierRegistry(serialized);
    return registry
      ? { registry, findings: [] }
      : {
          registry: false,
          findings: [
            {
              file: CORTEX_IDENTIFIER_REGISTRY_PATH,
              message: 'Published Cortex identifier registry is invalid.',
            },
          ],
        };
  } catch {
    return { registry: false, findings: [] };
  }
}

function publishedBaseCandidates(): readonly string[] {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath && existsSync(eventPath)) {
    try {
      const event = JSON.parse(
        readFileSync(eventPath, 'utf8'),
      ) as GitHubRepositoryPolicyEvent;
      return publishedBaseCandidatesForEvent(event);
    } catch {
      return ['origin/main'];
    }
  }
  return ['origin/main'];
}

export function publishedBaseCandidatesForEvent(
  event: GitHubRepositoryPolicyEvent,
): readonly string[] {
  const baseSha = event.pull_request?.base?.sha;
  if (baseSha && /^[0-9a-f]{40}$/u.test(baseSha)) {
    return [baseSha];
  }
  const beforeSha = event.before;
  if (
    beforeSha &&
    /^[0-9a-f]{40}$/u.test(beforeSha) &&
    beforeSha !== '0000000000000000000000000000000000000000'
  ) {
    return [beforeSha];
  }
  return ['origin/main'];
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

function readCortexMarkdown(filePath: string): string {
  const content = readFileSync(filePath, 'utf8');
  return normalizedCortexMarkdown({
    relativePath: filePath.replaceAll(path.sep, '/'),
    content,
  });
}

function skillDiagnosticName(filePath: string): string {
  return path.basename(filePath) === 'SKILL.md'
    ? path.dirname(filePath)
    : path.basename(filePath);
}
