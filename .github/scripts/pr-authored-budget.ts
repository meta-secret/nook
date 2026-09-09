#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { extname } from "node:path";

const PR_ADDITION_LIMIT = 2_000;
const PR_ADDITION_WARNING = 1_500;

const reportedOnlyFilenames = new Set([
  "Cargo.lock",
  "bun.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);
const generatedPaths = new Set([
  "/nook-app/nook-web/nook-web-app/src/landing/generated-message-keys.ts",
]);
const authoredTextExtensions = new Set([
  ".bash",
  ".cjs",
  ".css",
  ".graphql",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".proto",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".svelte",
  ".toml",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
  ".zsh",
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
    const records = numstat.split("\0");
    for (let index = 0; index < records.length;) {
      const record = records[index];
      if (!record) break;
      const firstTab = record.indexOf("\t");
      const secondTab = record.indexOf("\t", firstTab + 1);
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
        path = records[index + 1];
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
  addUntracked(paths: readonly string[]): void {
    for (const path of paths) {
      if (!path) continue;
      const status = lstatSync(path);
      if (!status.isFile() && !status.isSymbolicLink()) {
        this.unmeasurableAuthoredFiles += 1;
        continue;
      }
      const content = status.isSymbolicLink()
        ? Buffer.from(readlinkSync(path, "utf8"))
        : readFileSync(path);
      if (content.includes(0)) {
        this.classify({ path, added: Number.NaN, deleted: Number.NaN });
        continue;
      }
      const text = content.toString("utf8");
      this.classify({ path, added: SourceText.lineCount(text), deleted: 0 });
    }
  }
  private classify({
    path,
    added,
    deleted,
    renamed = false,
    deletedOnly = false,
  }: ChangeRecord): void {
    const normalizedPath = `/${path.replaceAll("\\", "/")}`;
    const filename = normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1);
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
    } else if (normalizedPath.endsWith(".snap")) {
      this.snapshotLines += changedLines;
    } else if (
      normalizedPath.includes("/generated/") ||
      normalizedPath.includes("/dist/") ||
      generatedPaths.has(normalizedPath)
    ) {
      this.generatedLines += changedLines;
    } else if (normalizedPath.includes("/vendor/")) {
      this.vendoredLines += changedLines;
    } else if (renamed && changedLines === 0) {
      this.pureRenameFiles += 1;
    } else {
      this.authoredLines += added;
    }
  }
}
export class SourceText {
  static lineCount(text: string): number {
    if (text.length === 0) return 0;
    const terminators = [...text.matchAll(/\n/gu)].length;
    return terminators + (text.endsWith("\n") ? 0 : 1);
  }
}
export class AuthoredAdditionBudget {
  constructor(private readonly authoredLines: number) {}
  evaluate() {
    const authoredLines = this.authoredLines;
    if (authoredLines > PR_ADDITION_LIMIT) {
      return {
        ok: false,
        message: `authored additions exceed the 2,000-line limit: ${authoredLines}`,
      };
    }
    if (authoredLines >= PR_ADDITION_WARNING) {
      return {
        ok: true,
        mode: "near-limit",
        message: `warning: authored additions are near the 2,000-line limit: ${authoredLines}`,
      };
    }
    return { ok: true, mode: "additions-only" };
  }
}
class AuthoredBudgetWorkspace {
  private runGit(args: readonly string[]): string {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  }
  main(): void {
    const mergeBase = this.runGit(["merge-base", "HEAD", "origin/main"]);
    if (!/^[0-9a-f]{40}$/.test(mergeBase)) {
      throw new Error("PR merge base is unavailable");
    }
    const numstat = execFileSync("git", [
      "diff",
      "--no-ext-diff",
      "--numstat",
      "-z",
      "--find-renames",
      "-l0",
      mergeBase,
    ]).toString("utf8");
    const deletedPaths = new Set(
      execFileSync("git", [
        "diff",
        "--no-ext-diff",
        "--diff-filter=D",
        "--name-only",
        "-z",
        mergeBase,
      ])
        .toString("utf8")
        .split("\0")
        .filter(Boolean),
    );
    const summary = AuthoredChangeSummary.fromNumstat({
      numstat: numstat,
      deletedPaths: deletedPaths,
    });
    const untracked = execFileSync("git", [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
    ])
      .toString("utf8")
      .split("\0");
    summary.addUntracked(untracked);
    if (summary.malformedRecords > 0 || summary.unmeasurableAuthoredFiles > 0) {
      throw new Error(
        `authored additions are not completely measurable: ${JSON.stringify(summary)}`,
      );
    }
    console.log(`Authored PR additions: ${summary.authoredLines} lines`);
    console.log(`Reported-only diff: ${JSON.stringify(summary)}`);
    const result = new AuthoredAdditionBudget(
      { authoredLines: summary.authoredLines }.authoredLines,
    ).evaluate();
    if (!result.ok) throw new Error(result.message);
    if (result.mode === "near-limit") console.warn(result.message);
    console.log("PR authored-addition budget passed");
  }
}

if (import.meta.main) {
  try {
    new AuthoredBudgetWorkspace().main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
