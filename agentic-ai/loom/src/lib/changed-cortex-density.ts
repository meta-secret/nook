import { err, ok, type Result } from 'neverthrow';
import type { ValeFailure } from './vale-files.ts';
import { CortexMarkdownSyntaxAudit } from '../../../../.cortex/teams/ai/dynamic-skills/cortex-document-map/scripts/src/cortex-document-structure.ts';
import { existsSync, lstatSync, readFileSync } from 'node:fs';

import path from 'node:path';

import {
  LoomFailureCode,
  type LoomFailureDetailArgs,
} from '../loom-failure.ts';

import {
  type DensityFinding,
  type DensityFindingSpan,
  CortexProseDensity,
} from './density.ts';

import { type RunCommandArgs, HostCommand } from './run.ts';

import { type ValeNativeAlert, ValeFileDiagnostics } from './vale-files.ts';

import {
  CortexStructureFindingCode,
  type CortexDocumentSource,
} from '../../../../.cortex/teams/ai/dynamic-skills/cortex-document-map/scripts/src/cortex-document-structure.ts';

export class ChangedCortexDensity {
  constructor(private readonly request: LintChangedCortexDensityArgs) {}
  execute(): Result<ChangedCortexDensityReport, ChangedCortexDensityFailure> {
    const args = this.request;
    const selection1 = this.mergeBase(args);
    if (selection1.isErr()) return err(selection1.error);
    const comparisonCommit = selection1.value;
    const trackedArgs: ChangedCortexPathsArgs = {
      comparisonCommit,
      repoRoot: args.repoRoot,
    };
    const selection2 = this.changedCortexPaths(trackedArgs);
    if (selection2.isErr()) return err(selection2.error);
    const tracked = selection2.value;
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
    const selection3 = this.gitPaths(untrackedArgs);
    if (selection3.isErr()) return err(selection3.error);
    const untracked = selection3.value;
    const untrackedPaths = new Set(untracked);
    const trackedByCurrentPath = new Map(
      tracked.map((change) => [change.currentPath, change]),
    );
    const candidatePaths = [
      ...new Set([...trackedByCurrentPath.keys(), ...untracked]),
    ]
      .filter((value) => this.isPersistentCortexMarkdownPath(value))
      .sort();
    const candidateDocuments: CortexDocumentSource[] = [];
    for (const relativePath of candidatePaths) {
      const regular = this.isRegularFile({
        relativePath,
        repoRoot: args.repoRoot,
      });
      if (regular.isErr()) return err(regular.error);
      if (!regular.value) continue;
      const absolutePath = path.join(args.repoRoot, relativePath);
      let content: string;
      try {
        content = readFileSync(absolutePath, 'utf8');
      } catch {
        return err({
          code: LoomFailureCode.CommandFailed,
          message: `Could not read changed Cortex Markdown: ${relativePath}`,
        });
      }
      candidateDocuments.push({ absolutePath, relativePath, content });
    }
    const syntaxInvalidPaths = new Set(
      new CortexMarkdownSyntaxAudit({
        documents: candidateDocuments,
      })
        .execute()
        .filter(
          (finding) =>
            finding.code === CortexStructureFindingCode.ProhibitedHtml,
        )
        .map((finding) => finding.file),
    );
    const documents = candidateDocuments.filter(
      (document) => !syntaxInvalidPaths.has(document.relativePath),
    );
    const checkedPaths = documents.map((document) => document.relativePath);
    const addedLinesByPath = new Map<string, readonly ChangedLineRange[]>();
    const findings: DensityFinding[] = [];
    for (const document of documents) {
      const relativePath = document.relativePath;
      const lintArgs = {
        filePath: relativePath,
        content: document.content,
      };
      const spans = CortexProseDensity.lintProseDensitySpans(lintArgs);
      const trackedChange = trackedByCurrentPath.get(relativePath);
      const [defaulted1 = relativePath] = [trackedChange?.previousPath];
      const rangeArgs: ChangedLineRangesArgs = {
        comparisonCommit,
        currentPath: relativePath,
        previousPath: defaulted1,
        repoRoot: args.repoRoot,
      };
      const addedLinesResult =
        untrackedPaths.has(relativePath) || trackedChange?.inspectAll === true
          ? ok([ALL_LINES])
          : this.changedLineRanges(rangeArgs);
      if (addedLinesResult.isErr()) return err(addedLinesResult.error);
      const addedLines = addedLinesResult.value;
      addedLinesByPath.set(relativePath, addedLines);
      findings.push(
        ...spans
          .filter((finding) => {
            const intersectionArgs: IntersectsAddedLinesArgs = {
              finding,
              ranges: addedLines,
            };
            return this.intersectsAddedLines(intersectionArgs);
          })
          .map((value) => this.withoutSpan(value)),
      );
    }
    let valeAlerts: readonly ValeNativeAlert[] = [];
    if (documents.length > 0) {
      const lint = new ValeFileDiagnostics({
        configPath: path.join(args.repoRoot, '.vale', 'density.ini'),
        files: documents.map((document) => document.absolutePath),
        repoRoot: args.repoRoot,
      }).execute();
      if (lint.isErr()) return err(lint.error);
      valeAlerts = lint.value.alerts.filter((alert) => {
        const relativePath = path.relative(args.repoRoot, alert.file);
        return addedLinesByPath
          .get(relativePath)
          ?.some(
            (range) => alert.line >= range.start && alert.line <= range.end,
          );
      });
    }
    return ok({ checkedPaths, findings, valeAlerts });
  }

  private changedCortexPaths(
    args: ChangedCortexPathsArgs,
  ): Result<ChangedCortexPath[], ChangedCortexDensityFailure> {
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
    const selection4 = this.gitPaths(statusArgs);
    if (selection4.isErr()) return err(selection4.error);
    const tokens = selection4.value;
    const changes: ChangedCortexPath[] = [];
    for (let index = 0; index < tokens.length;) {
      const status = tokens[index];
      index += 1;
      if (typeof status !== 'string')
        return err({
          code: LoomFailureCode.CommandFailed,
          message:
            'Unable to select changed Cortex Markdown: ' +
            'missing diff status',
        });
      if (/^R\d{1,3}$/u.test(status)) {
        const previousPath = tokens[index];
        const currentPath = tokens[index + 1];
        index += 2;
        if (
          typeof previousPath !== 'string' ||
          typeof currentPath !== 'string'
        ) {
          return err({
            code: LoomFailureCode.CommandFailed,
            message:
              'Unable to select changed Cortex Markdown: ' +
              'incomplete rename record',
          });
        }
        if (this.isPersistentCortexMarkdownPath(currentPath)) {
          const change: ChangedCortexPath = {
            currentPath,
            inspectAll: !this.isPersistentCortexMarkdownPath(previousPath),
            previousPath: this.isPersistentCortexMarkdownPath(previousPath)
              ? previousPath
              : currentPath,
          };
          changes.push(change);
        }
        continue;
      }
      if (status !== 'A' && status !== 'M' && status !== 'T') {
        return err({
          code: LoomFailureCode.CommandFailed,
          message:
            'Unable to select changed Cortex Markdown: ' +
            `unsupported diff status ${status}`,
        });
      }
      const currentPath = tokens[index];
      index += 1;
      if (typeof currentPath !== 'string') {
        return err({
          code: LoomFailureCode.CommandFailed,
          message:
            'Unable to select changed Cortex Markdown: ' +
            'missing changed path',
        });
      }
      if (this.isPersistentCortexMarkdownPath(currentPath)) {
        const change: ChangedCortexPath = {
          currentPath,
          inspectAll: status === 'A' || status === 'T',
          previousPath: currentPath,
        };
        changes.push(change);
      }
    }
    return ok(changes);
  }

  private changedLineRanges(
    args: ChangedLineRangesArgs,
  ): Result<ChangedLineRange[], ChangedCortexDensityFailure> {
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
    const selection5 = this.gitOutput(diffArgs);
    if (selection5.isErr()) return err(selection5.error);
    const diff = selection5.value;
    return ok(
      [...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gmu)]
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
        ),
    );
  }

  private gitPaths(
    args: GitOutputArgs,
  ): Result<string[], ChangedCortexDensityFailure> {
    const selection6 = this.gitOutput(args);
    if (selection6.isErr()) return err(selection6.error);
    return ok(selection6.value.split('\0').filter((entry) => entry.length > 0));
  }

  private gitOutput(
    args: GitOutputArgs,
  ): Result<string, ChangedCortexDensityFailure> {
    const commandArgs: RunCommandArgs = {
      command: 'git',
      args: args.arguments,
      cwd: args.repoRoot,
    };
    const output = HostCommand.run(commandArgs);
    if (output.exitCode !== 0) {
      const [defaulted2 = 'command'] = [args.arguments[0]];
      const failureArgs: LoomFailureDetailArgs = {
        code: LoomFailureCode.CommandFailed,
        text: `git ${defaulted2} failed while selecting changed Cortex Markdown: ${output.stderr}`,
      };
      return err({
        code: LoomFailureCode.CommandFailed,
        message: failureArgs.text,
      });
    }
    return ok(output.stdout);
  }

  private mergeBase(
    args: LintChangedCortexDensityArgs,
  ): Result<string, ChangedCortexDensityFailure> {
    const mergeBaseArgs: GitOutputArgs = {
      arguments: ['merge-base', 'HEAD', args.baseSha],
      repoRoot: args.repoRoot,
    };
    const selection7 = this.gitOutput(mergeBaseArgs);
    if (selection7.isErr()) return err(selection7.error);
    const comparisonCommit = selection7.value.trim();
    if (!/^[0-9a-f]{40}$/u.test(comparisonCommit)) {
      return err({
        code: LoomFailureCode.CommandFailed,
        message:
          'Unable to select changed Cortex Markdown: ' +
          `git merge-base returned an invalid commit: ${comparisonCommit}`,
      });
    }
    return ok(comparisonCommit);
  }

  private intersectsAddedLines(args: IntersectsAddedLinesArgs): boolean {
    return args.ranges.some(
      (range) =>
        args.finding.line <= range.end && args.finding.endLine >= range.start,
    );
  }

  private withoutSpan(findingSpan: DensityFindingSpan): DensityFinding {
    const { endLine: _endLine, ...finding } = findingSpan;
    return finding;
  }

  private isPersistentCortexMarkdownPath(relativePath: string): boolean {
    const normalized = relativePath.replaceAll('\\', '/');
    return (
      normalized.startsWith('.cortex/') &&
      !normalized.startsWith('.cortex/.session/') &&
      normalized.endsWith('.md')
    );
  }

  private isRegularFile(
    args: IsRegularFileArgs,
  ): Result<boolean, ChangedCortexDensityFailure> {
    const absolutePath = path.join(args.repoRoot, args.relativePath);
    try {
      return ok(existsSync(absolutePath) && lstatSync(absolutePath).isFile());
    } catch {
      return err({
        code: LoomFailureCode.CommandFailed,
        message: `Could not inspect changed Cortex Markdown: ${args.relativePath}`,
      });
    }
  }
}

export type ChangedCortexDensityReport = {
  readonly checkedPaths: readonly string[];
  readonly findings: readonly DensityFinding[];
  readonly valeAlerts: readonly ValeNativeAlert[];
};

export type LintChangedCortexDensityArgs = {
  readonly baseSha: string;
  readonly repoRoot: string;
};

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

type IntersectsAddedLinesArgs = {
  readonly finding: DensityFindingSpan;
  readonly ranges: readonly ChangedLineRange[];
};

type IsRegularFileArgs = {
  readonly relativePath: string;
  readonly repoRoot: string;
};

export type ChangedCortexDensityFailure =
  | ValeFailure
  | { readonly code: LoomFailureCode.CommandFailed; readonly message: string };
