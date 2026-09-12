#!/usr/bin/env bun

import { err, ok, type Result } from 'neverthrow';

import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { extname } from 'node:path';

const PR_ADDITION_LIMIT = 2_000;
const PR_ADDITION_WARNING = 1_500;

const reportedOnlyFilenames = new Set([
  'Cargo.lock',
  'bun.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);
const generatedPaths = new Set([
  '/nook-app/nook-web/nook-web-app/src/landing/generated-message-keys.ts',
]);
const authoredTextExtensions = new Set([
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

export interface NumstatInput {
  readonly numstat: string;
  readonly deletedPaths?: ReadonlySet<string>;
}
interface ChangeRecord {
  readonly path: string;
  readonly added: number;
  readonly deleted: number;
  readonly renamed?: boolean;
  readonly deletedOnly?: boolean;
}
export class AuthoredChangeSummary {
  authoredLines = 0;
  binaryFiles = 0;
  generatedLines = 0;
  lockfileLines = 0;
  malformedRecords = 0;
  pureRenameFiles = 0;
  snapshotLines = 0;
  unmeasurableAuthoredFiles = 0;
  vendoredLines = 0;

  static fromNumstat(request: NumstatInput): AuthoredChangeSummary {
    const { numstat, deletedPaths = new Set<string>() } = request;
    const summary = new AuthoredChangeSummary();
    const records = numstat.split('\0');
    for (let index = 0; index < records.length;) {
      const record = records[index];
      if (!record) break;
      const firstTab = record.indexOf('\t');
      const secondTab = record.indexOf('\t', firstTab + 1);
      if (firstTab < 0 || secondTab < 0) {
        summary.malformedRecords += 1;
        index += 1;
        continue;
      }
      const addedRaw = record.slice(0, firstTab);
      const deletedRaw = record.slice(firstTab + 1, secondTab);
      const inlinePath = record.slice(secondTab + 1);
      let path = inlinePath;
      let renamed = false;
      index += 1;
      if (!inlinePath) {
        if (!records[index] || !records[index + 1]) {
          summary.malformedRecords += 1;
          break;
        }
        const renamedPath = records[index + 1];
        if (!renamedPath) {
          summary.malformedRecords += 1;
          break;
        }
        path = renamedPath;
        renamed = true;
        index += 2;
      }
      summary.classify({
        path,
        added: /^\d+$/.test(addedRaw) ? Number(addedRaw) : Number.NaN,
        deleted: /^\d+$/.test(deletedRaw) ? Number(deletedRaw) : Number.NaN,
        renamed,
        deletedOnly: deletedPaths.has(path),
      });
    }
    return summary;
  }
  addUntracked(paths: readonly string[]): Result<void, AuthoredBudgetFailure> {
    for (const path of paths) {
      if (!path) continue;
      const admitted = new UntrackedAuthoredFile(path).read();
      if (admitted.isErr()) return err(admitted.error);
      if (admitted.value.kind === UntrackedFileKind.Unmeasurable) {
        this.unmeasurableAuthoredFiles += 1;
        continue;
      }
      const content = admitted.value.content;
      if (content.includes(0)) {
        this.classify({ path, added: Number.NaN, deleted: Number.NaN });
        continue;
      }
      const text = content.toString('utf8');
      this.classify({
        path,
        added: new SourceText(text).lineCount(),
        deleted: 0,
      });
    }
    return ok();
  }
  private classify({
    path,
    added,
    deleted,
    renamed = false,
    deletedOnly = false,
  }: ChangeRecord): void {
    const normalizedPath = `/${path.replaceAll('\\', '/')}`;
    const filename = normalizedPath.slice(normalizedPath.lastIndexOf('/') + 1);
    if (!Number.isInteger(added) || !Number.isInteger(deleted)) {
      if (deletedOnly) {
        this.binaryFiles += 1;
      } else if (authoredTextExtensions.has(extname(filename))) {
        this.unmeasurableAuthoredFiles += 1;
      } else {
        this.binaryFiles += 1;
      }
      return;
    }
    const changedLines = added + deleted;
    if (reportedOnlyFilenames.has(filename)) {
      this.lockfileLines += changedLines;
    } else if (normalizedPath.endsWith('.snap')) {
      this.snapshotLines += changedLines;
    } else if (
      normalizedPath.includes('/generated/') ||
      normalizedPath.includes('/dist/') ||
      generatedPaths.has(normalizedPath)
    ) {
      this.generatedLines += changedLines;
    } else if (normalizedPath.includes('/vendor/')) {
      this.vendoredLines += changedLines;
    } else if (renamed && changedLines === 0) {
      this.pureRenameFiles += 1;
    } else {
      this.authoredLines += added;
    }
  }
}
export class SourceText {
  constructor(private readonly text: string) {}
  lineCount(): number {
    const text = this.text;
    if (text.length === 0) return 0;
    const terminators = [...text.matchAll(/\n/gu)].length;
    return terminators + (text.endsWith('\n') ? 0 : 1);
  }
}
export enum AuthoredBudgetFailureKind {
  Git = 'git',
  Filesystem = 'filesystem',
  MergeBase = 'merge-base',
  Unmeasurable = 'unmeasurable',
  Limit = 'limit',
}
export interface AuthoredBudgetFailure {
  readonly kind: AuthoredBudgetFailureKind;
  readonly message: string;
}
export enum AuthoredBudgetMode {
  NearLimit = 'near-limit',
  AdditionsOnly = 'additions-only',
}
export type AuthoredBudgetAdmission =
  | { readonly mode: AuthoredBudgetMode.NearLimit; readonly message: string }
  | { readonly mode: AuthoredBudgetMode.AdditionsOnly };
enum UntrackedFileKind {
  Read = 'read',
  Unmeasurable = 'unmeasurable',
}
type UntrackedFileAdmission =
  | { kind: UntrackedFileKind.Read; content: Buffer }
  | { kind: UntrackedFileKind.Unmeasurable };
class UntrackedAuthoredFile {
  constructor(private readonly path: string) {}
  read(): Result<UntrackedFileAdmission, AuthoredBudgetFailure> {
    try {
      const status = lstatSync(this.path);
      if (!status.isFile() && !status.isSymbolicLink())
        return ok({ kind: UntrackedFileKind.Unmeasurable });
      const content = status.isSymbolicLink()
        ? Buffer.from(readlinkSync(this.path, 'utf8'))
        : readFileSync(this.path);
      return ok({ kind: UntrackedFileKind.Read, content });
    } catch {
      return err({
        kind: AuthoredBudgetFailureKind.Filesystem,
        message: 'Unable to measure untracked authored file',
      });
    }
  }
}
export class AuthoredAdditionBudget {
  constructor(private readonly authoredLines: number) {}
  evaluate(): Result<AuthoredBudgetAdmission, AuthoredBudgetFailure> {
    if (this.authoredLines > PR_ADDITION_LIMIT)
      return err({
        kind: AuthoredBudgetFailureKind.Limit,
        message: `authored additions exceed the 2,000-line limit: ${this.authoredLines}`,
      });
    if (this.authoredLines >= PR_ADDITION_WARNING)
      return ok({
        mode: AuthoredBudgetMode.NearLimit,
        message: `warning: authored additions are near the 2,000-line limit: ${this.authoredLines}`,
      });
    return ok({ mode: AuthoredBudgetMode.AdditionsOnly });
  }
}
class AuthoredBudgetWorkspace {
  private runGit(
    args: readonly string[],
  ): Result<string, AuthoredBudgetFailure> {
    try {
      return ok(
        execFileSync('git', args, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      );
    } catch {
      return err({
        kind: AuthoredBudgetFailureKind.Git,
        message: 'Unable to read Git authored-change inventory',
      });
    }
  }
  main(): Result<void, AuthoredBudgetFailure> {
    const merged = this.runGit(['merge-base', 'HEAD', 'origin/main']);
    if (merged.isErr()) return err(merged.error);
    const mergeBase = merged.value.trim();
    if (!/^[0-9a-f]{40}$/.test(mergeBase))
      return err({
        kind: AuthoredBudgetFailureKind.MergeBase,
        message: 'PR merge base is unavailable',
      });
    const numstat = this.runGit([
      'diff',
      '--no-ext-diff',
      '--numstat',
      '-z',
      '--find-renames',
      '-l0',
      mergeBase,
    ]);
    if (numstat.isErr()) return err(numstat.error);
    const deleted = this.runGit([
      'diff',
      '--no-ext-diff',
      '--diff-filter=D',
      '--name-only',
      '-z',
      mergeBase,
    ]);
    if (deleted.isErr()) return err(deleted.error);
    const deletedPaths = new Set(deleted.value.split('\0').filter(Boolean));
    const summary = AuthoredChangeSummary.fromNumstat({
      numstat: numstat.value,
      deletedPaths,
    });
    const untracked = this.runGit([
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
    ]);
    if (untracked.isErr()) return err(untracked.error);
    const measured = summary.addUntracked(untracked.value.split('\0'));
    if (measured.isErr()) return err(measured.error);
    if (summary.malformedRecords > 0 || summary.unmeasurableAuthoredFiles > 0)
      return err({
        kind: AuthoredBudgetFailureKind.Unmeasurable,
        message: `authored additions are not completely measurable: ${JSON.stringify(summary)}`,
      });
    console.log(`Authored PR additions: ${summary.authoredLines} lines`);
    console.log(`Reported-only diff: ${JSON.stringify(summary)}`);
    const result = new AuthoredAdditionBudget(summary.authoredLines).evaluate();
    if (result.isErr()) return err(result.error);
    if (result.value.mode === AuthoredBudgetMode.NearLimit)
      console.warn(result.value.message);
    console.log('PR authored-addition budget passed');
    return ok();
  }
}
if (import.meta.main) {
  const outcome = new AuthoredBudgetWorkspace().main();
  if (outcome.isErr()) {
    console.error(outcome.error.message);
    process.exitCode = 1;
  }
}
