export type CiAgentConfig = {
  repoRoot: string;
  cursorApiKey: string;
  ghToken: string;
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

  const ghToken = requireEnv("GH_TOKEN");
  const githubRepository = requireEnv("GITHUB_REPOSITORY");
  const githubRunId = requireEnv("GITHUB_RUN_ID");
  const fixBranch = process.env.FIX_BRANCH?.trim() || `fix/ci-${githubRunId}`;

  return {
    repoRoot: process.env.REPO_ROOT?.trim() || "/workspace",
    cursorApiKey,
    ghToken,
    githubRepository,
    githubRunId,
    fixBranch,
    promptFile: ".github/prompts/ci-fix-agent.md",
    modelId: process.env.CURSOR_AGENT_MODEL?.trim() || "composer-2.5",
  };
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
