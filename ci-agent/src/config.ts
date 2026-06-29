export type CiAgentConfig = {
  repoRoot: string;
  cursorApiKey: string;
  githubRepository: string;
  githubRunId: string;
  fixBranch: string;
  promptFile: string;
  modelId: string;
};

export function loadConfig(): CiAgentConfig | null {
  const cursorApiKey = process.env.CURSOR_API_KEY?.trim() ?? "";
  if (!cursorApiKey) {
    return null;
  }

  const githubRunId = process.env.GITHUB_RUN_ID?.trim() ?? "";
  const fixBranch =
    process.env.FIX_BRANCH?.trim() || (githubRunId ? `fix/ci-${githubRunId}` : "");

  return {
    repoRoot: process.env.REPO_ROOT?.trim() || process.cwd(),
    cursorApiKey,
    githubRepository: process.env.GITHUB_REPOSITORY?.trim() ?? "",
    githubRunId,
    fixBranch,
    promptFile: ".github/prompts/ci-fix-agent.md",
    modelId: process.env.CURSOR_AGENT_MODEL?.trim() || "composer-2.5",
  };
}
