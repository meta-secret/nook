import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type { Octokit } from "@octokit/rest";

import { createLogger } from "./logger.js";

const log = createLogger("git");
const execFileAsync = promisify(execFile);

const ACTIONS_BOT = {
  email: "41898282+github-actions[bot]@users.noreply.github.com",
  name: "github-actions[bot]",
} as const;

const REPORTED_ONLY_FILENAMES = new Set([
  "Cargo.lock",
  "bun.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const REPOSITORY_GENERATED_PATHS = new Set([
  "/nook-app/nook-web/nook-web-app/src/landing/generated-message-keys.ts",
]);

const AGENT_RUNTIME_ARTIFACTS = [
  ".nook-workbench-plan.md",
  ".nook-workbench-worklog.md",
];
const AGENT_RUNTIME_EXCLUSIONS = AGENT_RUNTIME_ARTIFACTS.map(
  (path) => `:(exclude)${path}`,
);

const TRUSTED_GIT_OPTIONS = [
  "-c",
  "commit.gpgSign=false",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.hooksPath=/dev/null",
] as const;

export function trustedGitArgs(
  repoRoot: string,
  args: readonly string[],
): string[] {
  return ["-C", repoRoot, ...TRUSTED_GIT_OPTIONS, ...args];
}

function trustedGit(repoRoot: string, args: readonly string[]) {
  return execFileAsync("git", trustedGitArgs(repoRoot, args));
}

export async function excludeAgentRuntimeArtifacts(
  repoRoot: string,
): Promise<void> {
  await trustedGit(repoRoot, [
    "reset",
    "--quiet",
    "HEAD",
    "--",
    ...AGENT_RUNTIME_ARTIFACTS,
  ]);
}

const AUTHORED_TEXT_EXTENSIONS = new Set([
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

export type AuthoredBudgetArgs = {
  repoRoot: string;
  baseRef: string;
  maximumLines: number;
};

export class AuthoredChangeBudgetExceededError extends Error {}

enum NumstatRecordParseKind {
  End = "end",
  Malformed = "malformed",
  Valid = "valid",
}

type NumstatRecordParseResult =
  | { kind: NumstatRecordParseKind.End }
  | { kind: NumstatRecordParseKind.Malformed; nextIndex: number }
  | {
      kind: NumstatRecordParseKind.Valid;
      nextIndex: number;
      added: string;
      deleted: string;
      destinationPath: string;
      renamed: boolean;
    };

type ParseNumstatRecordArgs = {
  records: string[];
  index: number;
};

function parseNumstatRecord(
  args: ParseNumstatRecordArgs,
): NumstatRecordParseResult {
  const record = args.records.at(args.index);
  if (typeof record !== "string" || record.length === 0) {
    return { kind: NumstatRecordParseKind.End };
  }
  const firstTab = record.indexOf("\t");
  const secondTab = record.indexOf("\t", firstTab + 1);
  if (firstTab < 0 || secondTab < 0) {
    return {
      kind: NumstatRecordParseKind.Malformed,
      nextIndex: args.index + 1,
    };
  }
  const added = record.slice(0, firstTab);
  const deleted = record.slice(firstTab + 1, secondTab);
  const inlinePath = record.slice(secondTab + 1);
  if (inlinePath.length > 0) {
    return {
      kind: NumstatRecordParseKind.Valid,
      nextIndex: args.index + 1,
      added,
      deleted,
      destinationPath: inlinePath,
      renamed: false,
    };
  }
  const sourcePath = args.records.at(args.index + 1);
  const destinationPath = args.records.at(args.index + 2);
  if (
    typeof sourcePath !== "string" ||
    sourcePath.length === 0 ||
    typeof destinationPath !== "string" ||
    destinationPath.length === 0
  ) {
    return {
      kind: NumstatRecordParseKind.Malformed,
      nextIndex: args.records.length,
    };
  }
  return {
    kind: NumstatRecordParseKind.Valid,
    nextIndex: args.index + 3,
    added,
    deleted,
    destinationPath,
    renamed: true,
  };
}

export type ReportedOnlyNumstat = {
  binaryFiles: number;
  generatedLines: number;
  lockfileLines: number;
  malformedRecords: number;
  pureRenameFiles: number;
  snapshotLines: number;
  unmeasurableAuthoredFiles: number;
  vendoredLines: number;
};

export type AuthoredNumstatSummary = {
  authoredLines: number;
  reportedOnly: ReportedOnlyNumstat;
};

function emptyReportedOnlyNumstat(): ReportedOnlyNumstat {
  return {
    binaryFiles: 0,
    generatedLines: 0,
    lockfileLines: 0,
    malformedRecords: 0,
    pureRenameFiles: 0,
    snapshotLines: 0,
    unmeasurableAuthoredFiles: 0,
    vendoredLines: 0,
  };
}

export function summarizeAuthoredNumstat(
  numstat: string,
  deletedPaths: ReadonlySet<string> = new Set(),
): AuthoredNumstatSummary {
  let authoredLines = 0;
  const reportedOnly = emptyReportedOnlyNumstat();
  const records = numstat.split("\0");
  let index = 0;
  while (index < records.length) {
    const parseArgs: ParseNumstatRecordArgs = { records, index };
    const parsed = parseNumstatRecord(parseArgs);
    if (parsed.kind === NumstatRecordParseKind.End) break;
    index = parsed.nextIndex;
    if (parsed.kind === NumstatRecordParseKind.Malformed) {
      reportedOnly.malformedRecords += 1;
      continue;
    }
    const normalizedPath = `/${parsed.destinationPath.replaceAll("\\", "/")}`;
    const filename = normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1);
    if (!/^\d+$/.test(parsed.added) || !/^\d+$/.test(parsed.deleted)) {
      if (deletedPaths.has(parsed.destinationPath)) {
        reportedOnly.binaryFiles += 1;
        continue;
      }
      const extensionStart = filename.lastIndexOf(".");
      const extension =
        extensionStart >= 0 ? filename.slice(extensionStart) : "";
      if (AUTHORED_TEXT_EXTENSIONS.has(extension)) {
        reportedOnly.unmeasurableAuthoredFiles += 1;
      } else {
        reportedOnly.binaryFiles += 1;
      }
      continue;
    }
    const addedLines = Number(parsed.added);
    const changedLines = addedLines + Number(parsed.deleted);
    if (REPORTED_ONLY_FILENAMES.has(filename)) {
      reportedOnly.lockfileLines += changedLines;
    } else if (normalizedPath.endsWith(".snap")) {
      reportedOnly.snapshotLines += changedLines;
    } else if (
      normalizedPath.includes("/generated/") ||
      REPOSITORY_GENERATED_PATHS.has(normalizedPath)
    ) {
      reportedOnly.generatedLines += changedLines;
    } else if (normalizedPath.includes("/vendor/")) {
      reportedOnly.vendoredLines += changedLines;
    } else if (normalizedPath.includes("/dist/")) {
      reportedOnly.generatedLines += changedLines;
    } else if (parsed.renamed && changedLines === 0) {
      reportedOnly.pureRenameFiles += 1;
    } else {
      authoredLines += addedLines;
    }
  }
  return { authoredLines, reportedOnly };
}

export function countAuthoredNumstat(numstat: string): number {
  return summarizeAuthoredNumstat(numstat).authoredLines;
}

export async function assertAuthoredChangeBudget(
  args: AuthoredBudgetArgs,
): Promise<void> {
  await excludeAgentRuntimeArtifacts(args.repoRoot);
  await trustedGit(args.repoRoot, [
    "add",
    "-A",
    "--",
    ".",
    ...AGENT_RUNTIME_EXCLUSIONS,
  ]);
  const { stdout } = await trustedGit(args.repoRoot, [
    "diff",
    "--cached",
    "--no-ext-diff",
    "--numstat",
    "-z",
    "--find-renames",
    "-l0",
    args.baseRef,
  ]);
  const deletedDiff = await trustedGit(args.repoRoot, [
    "diff",
    "--cached",
    "--no-ext-diff",
    "--diff-filter=D",
    "--name-only",
    "-z",
    args.baseRef,
  ]);
  const deletedPaths = new Set(deletedDiff.stdout.split("\0").filter(Boolean));
  const summary = summarizeAuthoredNumstat(stdout, deletedPaths);
  log.info(
    `Implemented diff contains ${summary.authoredLines} authored additions against ${args.baseRef}`,
  );
  log.info(`Reported-only diff rows: ${JSON.stringify(summary.reportedOnly)}`);
  if (summary.reportedOnly.unmeasurableAuthoredFiles > 0) {
    throw new Error(
      `Implemented diff contains ${summary.reportedOnly.unmeasurableAuthoredFiles} authored source file(s) whose line counts are hidden by binary attributes`,
    );
  }
  if (summary.authoredLines > args.maximumLines) {
    throw new AuthoredChangeBudgetExceededError(
      `Implemented diff exceeds the ${args.maximumLines} authored-addition budget: ${summary.authoredLines}`,
    );
  }
}

async function markSafeDirectory(repoRoot: string): Promise<void> {
  // Must run before any other git command: bind-mounted Actions checkouts are
  // owned by the runner user while the agent container often runs as root.
  try {
    await execFileAsync("git", [
      "config",
      "--global",
      "--add",
      "safe.directory",
      repoRoot,
    ]);
  } catch {
    // may already be present
  }
  try {
    await execFileAsync("git", [
      "config",
      "--global",
      "--add",
      "safe.directory",
      "*",
    ]);
  } catch {
    // optional wildcard
  }
}

async function assertGitRepo(repoRoot: string): Promise<void> {
  try {
    await access(join(repoRoot, ".git"));
  } catch {
    throw new Error(
      `REPO_ROOT is not a git working tree (missing .git): ${repoRoot}. ` +
        `If running in Docker, bind-mount the Actions checkout (and RUNNER_TEMP if .git is a gitfile).`,
    );
  }

  try {
    await trustedGit(repoRoot, ["rev-parse", "--git-dir"]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`git rev-parse failed in ${repoRoot}: ${message}`);
  }
}

export async function configureGitForCi(
  repoRoot: string,
  octokit?: Octokit,
): Promise<void> {
  await markSafeDirectory(repoRoot);
  await assertGitRepo(repoRoot);

  let userEmail: string = ACTIONS_BOT.email;
  let userName: string = ACTIONS_BOT.name;

  if (octokit) {
    try {
      const { data } = await octokit.rest.users.getAuthenticated();
      userName = data.name?.trim() || data.login;
      userEmail =
        data.email?.trim() ||
        `${data.id}+${data.login}@users.noreply.github.com`;
    } catch {
      // Fall back to github-actions[bot] when the token cannot resolve a user.
    }
  }

  const globalConfig: Array<[string, string]> = [
    ["user.email", userEmail],
    ["user.name", userName],
    ["core.untrackedCache", "true"],
  ];

  for (const [key, value] of globalConfig) {
    await execFileAsync("git", ["config", "--global", key, value]);
  }

  log.info(
    `Configured git identity as ${userName} <${userEmail}> in ${repoRoot}`,
  );
}

export async function hasWorkingTreeChanges(
  repoRoot: string,
): Promise<boolean> {
  await excludeAgentRuntimeArtifacts(repoRoot);
  const { stdout } = await trustedGit(repoRoot, [
    "status",
    "--porcelain",
    "--",
    ".",
    ...AGENT_RUNTIME_EXCLUSIONS,
  ]);
  return stdout.trim().length > 0;
}

async function pushAuthenticatedBranch(repoRoot: string): Promise<void> {
  const token = process.env.NOOK_GITHUB_PAT?.trim();
  const authEnv = token
    ? {
        ...process.env,
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
        GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
      }
    : process.env;
  await execFileAsync("git", ["-C", repoRoot, "push", "-u", "origin", "HEAD"], {
    env: authEnv,
  });
}

export async function pushFixBranch(
  repoRoot: string,
  fixBranch: string,
  runId: string,
): Promise<void> {
  log.info(`Pushing fix branch ${fixBranch}`);
  await trustedGit(repoRoot, ["checkout", "-B", fixBranch]);
  await excludeAgentRuntimeArtifacts(repoRoot);
  await trustedGit(repoRoot, [
    "add",
    "-A",
    "--",
    ".",
    ...AGENT_RUNTIME_EXCLUSIONS,
  ]);

  const staged = await hasStagedChanges(repoRoot);
  if (!staged) {
    throw new Error("No staged changes to commit after git add -A");
  }

  const commitMessage =
    process.env.AGENT_COMMIT_MESSAGE?.trim() ||
    `Fix main CI failure (run ${runId}).`;

  await trustedGit(repoRoot, ["commit", "-m", commitMessage]);
  await trustedGit(repoRoot, ["config", "core.hooksPath", "/dev/null"]);
  await pushAuthenticatedBranch(repoRoot);
  log.info(`Pushed ${fixBranch}`);
}

export async function revParse(repoRoot: string, ref: string): Promise<string> {
  const { stdout } = await trustedGit(repoRoot, ["rev-parse", ref]);
  return stdout.trim();
}

async function hasStagedChanges(repoRoot: string): Promise<boolean> {
  try {
    await trustedGit(repoRoot, [
      "diff",
      "--cached",
      "--quiet",
      "--no-ext-diff",
    ]);
    return false;
  } catch (err: unknown) {
    if (isExecExitCode(err, 1)) {
      return true;
    }
    throw err;
  }
}

function isExecExitCode(err: unknown, code: number): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code: number }).code === code
  );
}
