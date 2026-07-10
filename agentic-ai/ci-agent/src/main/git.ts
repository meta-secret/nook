import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { Octokit } from "@octokit/rest";

import { createLogger } from "./logger.js";

const log = createLogger("git");
const execFileAsync = promisify(execFile);

const ACTIONS_BOT = {
  email: "41898282+github-actions[bot]@users.noreply.github.com",
  name: "github-actions[bot]",
} as const;

export async function configureGitForCi(
  repoRoot: string,
  octokit?: Octokit,
): Promise<void> {
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

  const localConfig: Array<[string, string]> = [
    ["user.email", userEmail],
    ["user.name", userName],
    ["core.untrackedCache", "true"],
  ];

  for (const [key, value] of localConfig) {
    await execFileAsync("git", ["config", "--local", key, value], { cwd: repoRoot });
  }

  try {
    await execFileAsync("git", ["config", "--global", "--add", "safe.directory", repoRoot], {
      cwd: repoRoot,
    });
  } catch {
    // safe.directory may already be set by actions/checkout.
  }
}

export async function hasWorkingTreeChanges(repoRoot: string): Promise<boolean> {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: repoRoot });
  return stdout.trim().length > 0;
}

export async function pushFixBranch(
  repoRoot: string,
  fixBranch: string,
  runId: string,
): Promise<void> {
  log.info(`Pushing fix branch ${fixBranch}`);
  await execFileAsync("git", ["checkout", "-B", fixBranch], { cwd: repoRoot });
  await execFileAsync("git", ["add", "-A"], { cwd: repoRoot });

  const staged = await hasStagedChanges(repoRoot);
  if (!staged) {
    throw new Error("No staged changes to commit after git add -A");
  }

  await execFileAsync(
    "git",
    ["commit", "-m", `Fix main CI failure (run ${runId}).`],
    { cwd: repoRoot },
  );
  await execFileAsync("git", ["push", "-u", "origin", "HEAD"], { cwd: repoRoot });
  log.info(`Pushed ${fixBranch}`);
}

export async function pushIssueBranch(
  repoRoot: string,
  branch: string,
  issueNumber: number,
  issueTitle: string,
): Promise<void> {
  log.info(`Pushing issue branch ${branch}`);
  await execFileAsync("git", ["checkout", "-B", branch], { cwd: repoRoot });
  await execFileAsync("git", ["add", "-A"], { cwd: repoRoot });

  const staged = await hasStagedChanges(repoRoot);
  if (!staged) {
    throw new Error("No staged changes to commit after git add -A");
  }

  const subject = sanitizeCommitSubject(`Implement #${issueNumber}: ${issueTitle}`);
  await execFileAsync("git", ["commit", "-m", subject], { cwd: repoRoot });
  await execFileAsync("git", ["push", "-u", "origin", "HEAD"], { cwd: repoRoot });
  log.info(`Pushed ${branch}`);
}

/** Keep commit subjects single-line and within a reasonable length. */
export function sanitizeCommitSubject(raw: string): string {
  const oneLine = raw.replace(/\s+/g, " ").trim();
  if (oneLine.length <= 72) {
    return oneLine;
  }
  return `${oneLine.slice(0, 69).trimEnd()}...`;
}

async function hasStagedChanges(repoRoot: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["diff", "--cached", "--quiet"], { cwd: repoRoot });
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
