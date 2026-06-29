import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function configureGitForCi(repoRoot: string): Promise<void> {
  const localConfig: Array<[string, string]> = [
    ["user.email", "41898282+github-actions[bot]@users.noreply.github.com"],
    ["user.name", "github-actions[bot]"],
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
  console.log(`==> Pushing fix branch ${fixBranch}`);
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
  console.log(`==> Pushed ${fixBranch}`);
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
