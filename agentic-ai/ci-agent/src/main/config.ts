export class CiAgentEnvironment {
  constructor(private readonly environment: NodeJS.ProcessEnv) {}
  loadConfig(): CiAgentConfigLoad {
    const [cursorApiKey = ""] = [this.environment.CURSOR_API_KEY?.trim()];
    if (!cursorApiKey) {
      return { kind: CiAgentConfigLoadKind.MissingApiKey };
    }

    const [githubRunId = ""] = [this.environment.GITHUB_RUN_ID?.trim()];
    const repoRoot = this.environment.REPO_ROOT?.trim() || process.cwd();
    const fixBranch =
      this.environment.AGENT_BRANCH?.trim() ||
      this.environment.FIX_BRANCH?.trim() ||
      (githubRunId ? `fix/ci-${githubRunId}` : "");

    const [defaulted1 = ""] = [this.environment.GITHUB_REPOSITORY?.trim()];
    return {
      kind: CiAgentConfigLoadKind.Ready,
      config: {
        repoRoot,
        toolingRoot: this.environment.CI_AGENT_TOOLING_ROOT?.trim() || repoRoot,
        cursorApiKey,
        githubRepository: defaulted1,
        githubRunId,
        fixBranch,
        fixLabel: this.environment.CI_FIX_LABEL?.trim() || "main CI",
        promptFile:
          this.environment.CI_AGENT_PROMPT_FILE?.trim() ||
          ".github/prompts/ci-fix-agent.md",
        modelId: this.environment.CURSOR_AGENT_MODEL?.trim() || "composer-2.5",
      },
    };
  }
}
export type CiAgentConfig = {
  repoRoot: string;
  toolingRoot: string;
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
