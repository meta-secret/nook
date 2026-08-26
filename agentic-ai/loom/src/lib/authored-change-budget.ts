import { readFileSync } from 'node:fs';
import path from 'node:path';

import { runCommand } from './run.ts';

import type { RunCommandArgs } from './run.ts';

const REPORTED_ONLY_FILENAMES = new Set([
  'Cargo.lock',
  'bun.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

const REPOSITORY_GENERATED_PATHS = new Set([
  '/nook-app/nook-web/nook-web-app/src/landing/generated-message-keys.ts',
]);

const AUTHORED_TEXT_EXTENSIONS = new Set([
  '.bash',
  '.cjs',
  '.css',
  '.graphql',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.proto',
  '.rb',
  '.rs',
  '.scss',
  '.sh',
  '.sql',
  '.svelte',
  '.toml',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
  '.zsh',
]);

export type AuthoredChangeBudgetRequest = {
  readonly baseRef: string;
  readonly repoRoot: string;
};

export type AuthoredChangeBudget = {
  readonly authoredLines: number;
  readonly unmeasurableAuthoredFiles: number;
  readonly untrackedAuthoredFiles: number;
};

enum NumstatRecordKind {
  End = 'end',
  Malformed = 'malformed',
  Valid = 'valid',
}

type NumstatRecord =
  | { readonly kind: NumstatRecordKind.End }
  | { readonly kind: NumstatRecordKind.Malformed; readonly nextIndex: number }
  | {
      readonly added: string;
      readonly deleted: string;
      readonly destinationPath: string;
      readonly kind: NumstatRecordKind.Valid;
      readonly nextIndex: number;
    };

type ParseNumstatRecordRequest = {
  readonly index: number;
  readonly records: readonly string[];
};

export function measureAuthoredChangeBudget(
  request: AuthoredChangeBudgetRequest,
): AuthoredChangeBudget {
  const diffRequest: RunCommandArgs = {
    command: 'git',
    args: ['diff', '--numstat', '-z', '--find-renames', '-l0', request.baseRef],
    cwd: request.repoRoot,
  };
  const diff = runCommand(diffRequest);
  if (diff.exitCode !== 0) {
    throw new Error(
      `git diff against ${request.baseRef} failed: ${diff.stderr || diff.stdout}`,
    );
  }
  const tracked = summarizeAuthoredNumstat(diff.stdout);
  const untrackedRequest: RunCommandArgs = {
    command: 'git',
    args: ['ls-files', '--others', '--exclude-standard', '-z'],
    cwd: request.repoRoot,
  };
  const untracked = runCommand(untrackedRequest);
  if (untracked.exitCode !== 0) {
    throw new Error(
      `git ls-files failed: ${untracked.stderr || untracked.stdout}`,
    );
  }
  let untrackedLines = 0;
  let untrackedAuthoredFiles = 0;
  let unmeasurableAuthoredFiles = tracked.unmeasurableAuthoredFiles;
  for (const relativePath of untracked.stdout.split('\0')) {
    if (relativePath.length === 0 || isReportedOnlyPath(relativePath)) continue;
    const contents = readFileSync(path.join(request.repoRoot, relativePath));
    if (contents.includes(0)) {
      if (AUTHORED_TEXT_EXTENSIONS.has(path.extname(relativePath))) {
        unmeasurableAuthoredFiles += 1;
      }
      continue;
    }
    untrackedAuthoredFiles += 1;
    untrackedLines += countTextLines(contents.toString('utf8'));
  }
  return {
    authoredLines: tracked.authoredLines + untrackedLines,
    unmeasurableAuthoredFiles,
    untrackedAuthoredFiles,
  };
}

export function summarizeAuthoredNumstat(
  numstat: string,
): AuthoredChangeBudget {
  let authoredLines = 0;
  let unmeasurableAuthoredFiles = 0;
  const records = numstat.split('\0');
  let index = 0;
  while (index < records.length) {
    const parseRequest: ParseNumstatRecordRequest = { index, records };
    const parsed = parseNumstatRecord(parseRequest);
    if (parsed.kind === NumstatRecordKind.End) break;
    index = parsed.nextIndex;
    if (parsed.kind === NumstatRecordKind.Malformed) continue;
    if (!/^\d+$/.test(parsed.added) || !/^\d+$/.test(parsed.deleted)) {
      if (!isReportedOnlyPath(parsed.destinationPath)) {
        unmeasurableAuthoredFiles += 1;
      }
      continue;
    }
    if (isReportedOnlyPath(parsed.destinationPath)) continue;
    authoredLines += Number(parsed.added) + Number(parsed.deleted);
  }
  return {
    authoredLines,
    unmeasurableAuthoredFiles,
    untrackedAuthoredFiles: 0,
  };
}

export function countTextLines(contents: string): number {
  if (contents.length === 0) return 0;
  const lineCount = contents.split('\n').length;
  return contents.endsWith('\n') ? lineCount - 1 : lineCount;
}

function parseNumstatRecord(request: ParseNumstatRecordRequest): NumstatRecord {
  const record = request.records.at(request.index);
  if (typeof record !== 'string' || record.length === 0) {
    return { kind: NumstatRecordKind.End };
  }
  const firstTab = record.indexOf('\t');
  const secondTab = record.indexOf('\t', firstTab + 1);
  if (firstTab < 0 || secondTab < 0) {
    return {
      kind: NumstatRecordKind.Malformed,
      nextIndex: request.index + 1,
    };
  }
  const added = record.slice(0, firstTab);
  const deleted = record.slice(firstTab + 1, secondTab);
  const inlinePath = record.slice(secondTab + 1);
  if (inlinePath.length > 0) {
    return {
      added,
      deleted,
      destinationPath: inlinePath,
      kind: NumstatRecordKind.Valid,
      nextIndex: request.index + 1,
    };
  }
  const destinationPath = request.records.at(request.index + 2);
  if (typeof destinationPath !== 'string' || destinationPath.length === 0) {
    return {
      kind: NumstatRecordKind.Malformed,
      nextIndex: request.records.length,
    };
  }
  return {
    added,
    deleted,
    destinationPath,
    kind: NumstatRecordKind.Valid,
    nextIndex: request.index + 3,
  };
}

function isReportedOnlyPath(candidate: string): boolean {
  const normalized = `/${candidate.replaceAll('\\', '/')}`;
  const filename = normalized.slice(normalized.lastIndexOf('/') + 1);
  return (
    REPORTED_ONLY_FILENAMES.has(filename) ||
    normalized.endsWith('.snap') ||
    normalized.includes('/generated/') ||
    REPOSITORY_GENERATED_PATHS.has(normalized) ||
    normalized.includes('/vendor/') ||
    normalized.includes('/dist/')
  );
}
