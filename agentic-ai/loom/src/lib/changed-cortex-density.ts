import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  LoomFailureCode,
  loomFailureDetail,
  type LoomFailureDetailArgs,
} from '../loom-failure.ts';
import {
  lintProseDensitySpans,
  type DensityFinding,
  type DensityFindingSpan,
} from './density.ts';
import { runCommand, type RunCommandArgs } from './run.ts';
import { runValeFiles, type ValeNativeAlert } from './vale-files.ts';
import {
  auditCortexMarkdownSyntax,
  CortexStructureFindingCode,
  type CortexDocumentSource,
} from '../../../../.cortex/teams/ai/dynamic-skills/cortex-document-map/scripts/src/cortex-document-structure.ts';

export type ChangedCortexDensityReport = {
  readonly checkedPaths: readonly string[];
  readonly findings: readonly DensityFinding[];
  readonly valeAlerts: readonly ValeNativeAlert[];
};

export type LintChangedCortexDensityArgs = {
  readonly baseSha: string;
  readonly repoRoot: string;
};

export function lintChangedCortexDensity(
  args: LintChangedCortexDensityArgs,
): ChangedCortexDensityReport {
  const comparisonCommit = mergeBase(args);
  const trackedArgs: ChangedCortexPathsArgs = {
    comparisonCommit,
    repoRoot: args.repoRoot,
  };
  const tracked = changedCortexPaths(trackedArgs);
  const untrackedArgs: GitOutputArgs = {
    arguments: [
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
      '.cortex',
    ],
    repoRoot: args.repoRoot,
  };
  const untracked = gitPaths(untrackedArgs);
  const untrackedPaths = new Set(untracked);
  const trackedByCurrentPath = new Map(
    tracked.map((change) => [change.currentPath, change]),
  );
  const candidatePaths = [
    ...new Set([...trackedByCurrentPath.keys(), ...untracked]),
  ]
    .filter(isPersistentCortexMarkdownPath)
    .filter((relativePath) => {
      const fileArgs: IsRegularFileArgs = {
        relativePath,
        repoRoot: args.repoRoot,
      };
      return isRegularFile(fileArgs);
    })
    .sort();
  const candidateDocuments = candidatePaths.map((relativePath) => {
    const document: CortexDocumentSource = {
      absolutePath: path.join(args.repoRoot, relativePath),
      relativePath,
      content: readFileSync(path.join(args.repoRoot, relativePath), 'utf8'),
    };
    return document;
  });
  const syntaxInvalidPaths = new Set(
    auditCortexMarkdownSyntax({ documents: candidateDocuments })
      .filter(
        (finding) => finding.code === CortexStructureFindingCode.ProhibitedHtml,
      )
      .map((finding) => finding.file),
  );
  const documents = candidateDocuments.filter(
    (document) => !syntaxInvalidPaths.has(document.relativePath),
  );
  const checkedPaths = documents.map((document) => document.relativePath);
  const addedLinesByPath = new Map<string, readonly ChangedLineRange[]>();
  const findings = checkedPaths.flatMap((relativePath) => {
    const lintArgs = {
      filePath: relativePath,
      content: readFileSync(path.join(args.repoRoot, relativePath), 'utf8'),
    };
    const spans = lintProseDensitySpans(lintArgs);
    const trackedChange = trackedByCurrentPath.get(relativePath);
    const [defaulted1 = relativePath] = [trackedChange?.previousPath];
    const rangeArgs: ChangedLineRangesArgs = {
      comparisonCommit,
      currentPath: relativePath,
      previousPath: defaulted1,
      repoRoot: args.repoRoot,
    };
    const addedLines =
      untrackedPaths.has(relativePath) || trackedChange?.inspectAll === true
        ? [ALL_LINES]
        : changedLineRanges(rangeArgs);
    addedLinesByPath.set(relativePath, addedLines);
    return spans
      .filter((finding) => {
        const intersectionArgs: IntersectsAddedLinesArgs = {
          finding,
          ranges: addedLines,
        };
        return intersectsAddedLines(intersectionArgs);
      })
      .map(withoutSpan);
  });
  const valeAlerts =
    documents.length === 0
      ? []
      : runValeFiles({
          configPath: path.join(args.repoRoot, '.vale', 'density.ini'),
          files: documents.map((document) => document.absolutePath),
          repoRoot: args.repoRoot,
        }).alerts.filter((alert) => {
          const relativePath = path.relative(args.repoRoot, alert.file);
          return addedLinesByPath
            .get(relativePath)
            ?.some(
              (range) => alert.line >= range.start && alert.line <= range.end,
            );
        });
  return { checkedPaths, findings, valeAlerts };
}

type GitOutputArgs = {
  readonly arguments: readonly string[];
  readonly repoRoot: string;
};

type ChangedCortexPath = {
  readonly currentPath: string;
  readonly inspectAll: boolean;
  readonly previousPath: string;
};

type ChangedCortexPathsArgs = {
  readonly comparisonCommit: string;
  readonly repoRoot: string;
};

function changedCortexPaths(args: ChangedCortexPathsArgs): ChangedCortexPath[] {
  const statusArgs: GitOutputArgs = {
    arguments: [
      'diff',
      '--name-status',
      '--diff-filter=AMRT',
      '--find-renames',
      '-z',
      args.comparisonCommit,
      '--',
    ],
    repoRoot: args.repoRoot,
  };
  const tokens = gitPaths(statusArgs);
  const changes: ChangedCortexPath[] = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index];
    index += 1;
    if (typeof status !== 'string') failChangedCortexGit('missing diff status');
    if (/^R\d{1,3}$/u.test(status)) {
      const previousPath = tokens[index];
      const currentPath = tokens[index + 1];
      index += 2;
      if (typeof previousPath !== 'string' || typeof currentPath !== 'string') {
        failChangedCortexGit('incomplete rename record');
      }
      if (isPersistentCortexMarkdownPath(currentPath)) {
        const change: ChangedCortexPath = {
          currentPath,
          inspectAll: !isPersistentCortexMarkdownPath(previousPath),
          previousPath: isPersistentCortexMarkdownPath(previousPath)
            ? previousPath
            : currentPath,
        };
        changes.push(change);
      }
      continue;
    }
    if (status !== 'A' && status !== 'M' && status !== 'T') {
      failChangedCortexGit(`unsupported diff status ${status}`);
    }
    const currentPath = tokens[index];
    index += 1;
    if (typeof currentPath !== 'string') {
      failChangedCortexGit('missing changed path');
    }
    if (isPersistentCortexMarkdownPath(currentPath)) {
      const change: ChangedCortexPath = {
        currentPath,
        inspectAll: status === 'A' || status === 'T',
        previousPath: currentPath,
      };
      changes.push(change);
    }
  }
  return changes;
}

type ChangedLineRange = {
  readonly end: number;
  readonly start: number;
};

const ALL_LINES: ChangedLineRange = {
  start: 1,
  end: Number.MAX_SAFE_INTEGER,
};

type ChangedLineRangesArgs = {
  readonly comparisonCommit: string;
  readonly currentPath: string;
  readonly previousPath: string;
  readonly repoRoot: string;
};

function changedLineRanges(args: ChangedLineRangesArgs): ChangedLineRange[] {
  const pathArguments =
    args.previousPath === args.currentPath
      ? [args.currentPath]
      : [args.previousPath, args.currentPath];
  const diffArgs: GitOutputArgs = {
    arguments: [
      'diff',
      '--find-renames',
      '--unified=0',
      '--no-ext-diff',
      '--no-color',
      args.comparisonCommit,
      '--',
      ...pathArguments,
    ],
    repoRoot: args.repoRoot,
  };
  const diff = gitOutput(diffArgs);
  return [...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gmu)]
    .map((match) => {
      const start = Number(match[1]);
      const count = typeof match[2] === 'string' ? Number(match[2]) : 1;
      return { count, start };
    })
    .map((range) =>
      range.count > 0
        ? {
            start: range.start,
            end: range.start + range.count - 1,
          }
        : {
            start: Math.max(1, range.start - 1),
            end: Math.max(1, range.start),
          },
    );
}

function gitPaths(args: GitOutputArgs): string[] {
  return gitOutput(args)
    .split('\0')
    .filter((entry) => entry.length > 0);
}

function gitOutput(args: GitOutputArgs): string {
  const commandArgs: RunCommandArgs = {
    command: 'git',
    args: args.arguments,
    cwd: args.repoRoot,
  };
  const output = runCommand(commandArgs);
  if (output.exitCode !== 0) {
    const [defaulted2 = 'command'] = [args.arguments[0]];
    const failureArgs: LoomFailureDetailArgs = {
      code: LoomFailureCode.CommandFailed,
      text: `git ${defaulted2} failed while selecting changed Cortex Markdown: ${output.stderr}`,
    };
    loomFailureDetail(failureArgs);
  }
  return output.stdout;
}

function mergeBase(args: LintChangedCortexDensityArgs): string {
  const mergeBaseArgs: GitOutputArgs = {
    arguments: ['merge-base', 'HEAD', args.baseSha],
    repoRoot: args.repoRoot,
  };
  const comparisonCommit = gitOutput(mergeBaseArgs).trim();
  if (!/^[0-9a-f]{40}$/u.test(comparisonCommit)) {
    failChangedCortexGit(
      `git merge-base returned an invalid commit: ${comparisonCommit}`,
    );
  }
  return comparisonCommit;
}

function failChangedCortexGit(message: string): never {
  const failureArgs: LoomFailureDetailArgs = {
    code: LoomFailureCode.CommandFailed,
    text: `Unable to select changed Cortex Markdown: ${message}`,
  };
  return loomFailureDetail(failureArgs);
}

type IntersectsAddedLinesArgs = {
  readonly finding: DensityFindingSpan;
  readonly ranges: readonly ChangedLineRange[];
};

function intersectsAddedLines(args: IntersectsAddedLinesArgs): boolean {
  return args.ranges.some(
    (range) =>
      args.finding.line <= range.end && args.finding.endLine >= range.start,
  );
}

function withoutSpan(findingSpan: DensityFindingSpan): DensityFinding {
  const { endLine: _endLine, ...finding } = findingSpan;
  return finding;
}

function isPersistentCortexMarkdownPath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/');
  return (
    normalized.startsWith('.cortex/') &&
    !normalized.startsWith('.cortex/.session/') &&
    normalized.endsWith('.md')
  );
}

type IsRegularFileArgs = {
  readonly relativePath: string;
  readonly repoRoot: string;
};

function isRegularFile(args: IsRegularFileArgs): boolean {
  const absolutePath = path.join(args.repoRoot, args.relativePath);
  return existsSync(absolutePath) && lstatSync(absolutePath).isFile();
}
