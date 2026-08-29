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
  const trackedArgs: GitPathsArgs = {
    arguments: [
      'diff',
      '--name-only',
      '--diff-filter=ACMR',
      '-z',
      args.baseSha,
      '--',
      '.cortex',
    ],
    repoRoot: args.repoRoot,
  };
  const tracked = gitPaths(trackedArgs);
  const untrackedArgs: GitPathsArgs = {
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
  const checkedPaths = [...new Set([...tracked, ...untracked])]
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
    const rangeArgs: ChangedLineRangesArgs = {
      baseSha: args.baseSha,
      relativePath,
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

type GitPathsArgs = {
  readonly arguments: readonly string[];
  readonly repoRoot: string;
};

type ChangedLineRange = {
  readonly end: number;
  readonly start: number;
};

const ALL_LINES: ChangedLineRange = {
  start: 1,
  end: Number.MAX_SAFE_INTEGER,
};

type ChangedLineRangesArgs = {
  readonly baseSha: string;
  readonly relativePath: string;
  readonly repoRoot: string;
};

function changedLineRanges(args: ChangedLineRangesArgs): ChangedLineRange[] {
  const diffArgs: GitPathsArgs = {
    arguments: [
      'diff',
      '--unified=0',
      '--no-ext-diff',
      '--no-color',
      args.baseSha,
      '--',
      args.relativePath,
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
    .filter((range) => range.count > 0)
    .map((range) => ({
      start: range.start,
      end: range.start + range.count - 1,
    }));
}

function gitPaths(args: GitPathsArgs): string[] {
  return gitOutput(args)
    .split('\0')
    .filter((entry) => entry.length > 0);
}

function gitOutput(args: GitPathsArgs): string {
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
