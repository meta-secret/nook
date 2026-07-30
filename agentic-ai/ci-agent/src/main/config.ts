export type CiAgentConfig = {
  repoRoot: string;
  cursorApiKey: string;
  githubRepository: string;
  githubRunId: string;
  fixBranch: string;
  fixLabel: string;
  promptFile: string;
  modelId: string;
};

export enum CiAgentConfigLoadKind {
  MissingApiKey = "missing-api-key",
  Ready = "ready",
}

export type CiAgentConfigLoad =
  | { kind: CiAgentConfigLoadKind.MissingApiKey }
  | { kind: CiAgentConfigLoadKind.Ready; config: CiAgentConfig };

export function loadConfig(): CiAgentConfigLoad {
  const cursorApiKey = process.env.CURSOR_API_KEY?.trim() ?? "";
  if (!cursorApiKey) {
    return { kind: CiAgentConfigLoadKind.MissingApiKey };
  }

  const githubRunId = process.env.GITHUB_RUN_ID?.trim() ?? "";
  const fixBranch =
    process.env.AGENT_BRANCH?.trim() ||
    process.env.FIX_BRANCH?.trim() ||
    (githubRunId ? `fix/ci-${githubRunId}` : "");

  return {
    kind: CiAgentConfigLoadKind.Ready,
    config: {
      repoRoot: process.env.REPO_ROOT?.trim() || process.cwd(),
      cursorApiKey,
      githubRepository: process.env.GITHUB_REPOSITORY?.trim() ?? "",
      githubRunId,
      fixBranch,
      fixLabel: process.env.CI_FIX_LABEL?.trim() || "main CI",
      promptFile:
        process.env.CI_AGENT_PROMPT_FILE?.trim() ||
        ".github/prompts/ci-fix-agent.md",
      modelId: process.env.CURSOR_AGENT_MODEL?.trim() || "composer-2.5",
    },
  };
}
