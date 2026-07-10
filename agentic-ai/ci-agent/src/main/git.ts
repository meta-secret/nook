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
  await assertGitRepo(repoRoot);

  let userEmail: string = ACTIONS_BOT.email;
  let userName: string = ACTIONS_BOT.name;

  if (octokit) {
    try {
      const { data } = await octokit.rest.users.getAuthenticated();
      userName = data.name?.trim() || data.login;
      userEmail =
        data.email?.trim() || `${data.id}+${data.login}@users.noreply.github.com`;
    } catch {
      // Fall back to github-actions[bot] when the token cannot resolve a user.
    }
  }

  // Global identity works even when --local is awkward across container UIDs;
  // still require a real checkout for commit/push.
  const globalConfig: Array<[string, string]> = [
    ["user.email", userEmail],
    ["user.name", userName],
    ["core.untrackedCache", "true"],
  ];

  for (const [key, value] of globalConfig) {
    await execFileAsync("git", ["config", "--global", key, value], { cwd: repoRoot });
  }

  try {
    await execFileAsync(
      "git",
      ["config", "--global", "--add", "safe.directory", repoRoot],
      { cwd: repoRoot },
    );
  } catch {
    // safe.directory may already be set by actions/checkout.
  }

  try {
    await execFileAsync("git", ["config", "--global", "--add", "safe.directory", "*"], {
      cwd: repoRoot,
    });
  } catch {
    // optional wildcard for nested gitdirs
  }

  log.info(`Configured git identity as ${userName} <${userEmail}> in ${repoRoot}`);
}

export async function hasWorkingTreeChanges(repoRoot: string): Promise<boolean> {
  const { stdout } = await execFileAsync("git", ["-C", repoRoot, "status", "--porcelain"]);
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
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: number }).code === code
  );
}
