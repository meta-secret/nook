import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function gh(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("gh", args, {
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

export async function configureGit(repoRoot: string): Promise<void> {
  console.log("==> Configuring gh and git (GH_TOKEN from environment)");
  await execFileAsync("git", ["config", "--global", "--add", "safe.directory", repoRoot]);
  await execFileAsync("git", [
    "config",
    "--global",
    "credential.helper",
    "!gh auth git-credential",
  ]);
  await execFileAsync("git", [
    "config",
    "--global",
    "user.email",
    "41898282+github-actions[bot]@users.noreply.github.com",
  ]);
  await execFileAsync("git", ["config", "--global", "user.name", "github-actions[bot]"]);
}

export async function findOpenPr(fixBranch: string): Promise<string | null> {
  try {
    const out = await gh([
      "pr",
      "list",
      "--head",
      fixBranch,
      "--state",
      "open",
      "--json",
      "number",
      "-q",
      ".[0].number",
    ]);
    return out || null;
  } catch {
    return null;
  }
}

export async function waitForChecks(prNum: string): Promise<void> {
  console.log(`==> Waiting for PR #${prNum} checks`);
  await gh(["pr", "checks", prNum, "--watch", "--fail-fast"]);
}

export async function squashMerge(prNum: string): Promise<void> {
  console.log(`==> Squash merging PR #${prNum}`);
  await gh(["pr", "merge", prNum, "--squash", "--delete-branch"]);
}
