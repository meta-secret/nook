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

export type ChangedCortexDensityReport = {
  readonly checkedPaths: readonly string[];
  readonly findings: readonly DensityFinding[];
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
  const checkedPaths = [
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
  const findings = checkedPaths.flatMap((relativePath) => {
    const lintArgs = {
      filePath: relativePath,
      content: readFileSync(path.join(args.repoRoot, relativePath), 'utf8'),
    };
    const spans = lintProseDensitySpans(lintArgs);
    const trackedChange = trackedByCurrentPath.get(relativePath);
    const rangeArgs: ChangedLineRangesArgs = {
      comparisonCommit,
      currentPath: relativePath,
      previousPath: trackedChange?.previousPath ?? relativePath,
      repoRoot: args.repoRoot,
    };
    const addedLines = untrackedPaths.has(relativePath)
      ? [ALL_LINES]
      : changedLineRanges(rangeArgs);
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
  return { checkedPaths, findings };
}

type GitOutputArgs = {
  readonly arguments: readonly string[];
  readonly repoRoot: string;
};

type ChangedCortexPath = {
  readonly currentPath: string;
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
      '--diff-filter=AMR',
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
    if (status === undefined) failChangedCortexGit('missing diff status');
    if (/^R\d{1,3}$/u.test(status)) {
      const previousPath = tokens[index];
      const currentPath = tokens[index + 1];
      index += 2;
      if (previousPath === undefined || currentPath === undefined) {
        failChangedCortexGit('incomplete rename record');
      }
      if (isPersistentCortexMarkdownPath(currentPath)) {
        const change: ChangedCortexPath = { currentPath, previousPath };
        changes.push(change);
      }
      continue;
    }
    if (status !== 'A' && status !== 'M') {
      failChangedCortexGit(`unsupported diff status ${status}`);
    }
    const currentPath = tokens[index];
    index += 1;
    if (currentPath === undefined) {
      failChangedCortexGit('missing changed path');
    }
    if (isPersistentCortexMarkdownPath(currentPath)) {
      const change: ChangedCortexPath = {
        currentPath,
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
      const count = match[2] === undefined ? 1 : Number(match[2]);
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
    const failureArgs: LoomFailureDetailArgs = {
      code: LoomFailureCode.CommandFailed,
      text: `git ${args.arguments[0] ?? 'command'} failed while selecting changed Cortex Markdown: ${output.stderr}`,
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
