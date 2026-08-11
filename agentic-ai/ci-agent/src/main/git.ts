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

const REPORTED_ONLY_PATH_PARTS = ["/dist/", "/generated/", "/vendor/"];
const REPORTED_ONLY_FILENAMES = new Set([
  "Cargo.lock",
  "bun.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

export type AuthoredBudgetArgs = {
  repoRoot: string;
  baseRef: string;
  maximumLines: number;
};

function renameDestinationPath(rawPath: string): string {
  const compactRename = rawPath.replace(/\{[^{}]* => ([^{}]*)\}/g, "$1");
  const fullRenameSeparator = compactRename.lastIndexOf(" => ");
  return fullRenameSeparator === -1
    ? compactRename
    : compactRename.slice(fullRenameSeparator + " => ".length);
}

export function countAuthoredNumstat(numstat: string): number {
  let total = 0;
  for (const line of numstat.split("\n")) {
    const [added, deleted, rawPath = ""] = line.split("\t");
    const destinationPath = renameDestinationPath(rawPath);
    const normalizedPath = `/${destinationPath.replaceAll("\\", "/")}`;
    const filename = normalizedPath.split("/").at(-1) || "";
    const reportedOnly =
      REPORTED_ONLY_FILENAMES.has(filename) ||
      normalizedPath.endsWith(".snap") ||
      REPORTED_ONLY_PATH_PARTS.some((part) => normalizedPath.includes(part));
    if (reportedOnly || !/^\d+$/.test(added) || !/^\d+$/.test(deleted)) {
      continue;
    }
    total += Number(added) + Number(deleted);
  }
  return total;
}

export async function assertAuthoredChangeBudget(
  args: AuthoredBudgetArgs,
): Promise<void> {
  await execFileAsync("git", ["-C", args.repoRoot, "add", "-A"]);
  const { stdout } = await execFileAsync("git", [
    "-C",
    args.repoRoot,
    "diff",
    "--cached",
    "--numstat",
    "--find-renames",
    args.baseRef,
  ]);
  const authoredLines = countAuthoredNumstat(stdout);
  log.info(
    `Implemented diff contains ${authoredLines} authored changed lines against ${args.baseRef}`,
  );
  if (authoredLines > args.maximumLines) {
    throw new Error(
      `Implemented diff exceeds the ${args.maximumLines} authored changed-line budget: ${authoredLines}`,
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
    await execFileAsync("git", ["-C", repoRoot, "rev-parse", "--git-dir"]);
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
  const { stdout } = await execFileAsync("git", [
    "-C",
    repoRoot,
    "status",
    "--porcelain",
  ]);
  return stdout.trim().length > 0;
}

export async function pushFixBranch(
  repoRoot: string,
  fixBranch: string,
  runId: string,
): Promise<void> {
  log.info(`Pushing fix branch ${fixBranch}`);
  await execFileAsync("git", ["-C", repoRoot, "checkout", "-B", fixBranch]);
  await execFileAsync("git", ["-C", repoRoot, "add", "-A"]);

  const staged = await hasStagedChanges(repoRoot);
  if (!staged) {
    throw new Error("No staged changes to commit after git add -A");
  }

  const commitMessage =
    process.env.AGENT_COMMIT_MESSAGE?.trim() ||
    `Fix main CI failure (run ${runId}).`;

  await execFileAsync("git", ["-C", repoRoot, "commit", "-m", commitMessage]);
  await execFileAsync("git", ["-C", repoRoot, "push", "-u", "origin", "HEAD"]);
  log.info(`Pushed ${fixBranch}`);
}

async function hasStagedChanges(repoRoot: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["-C", repoRoot, "diff", "--cached", "--quiet"]);
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
