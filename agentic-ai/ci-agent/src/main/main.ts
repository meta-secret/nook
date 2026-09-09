import { chdir } from "node:process";
class CiAgentCommand {
  constructor(private readonly arguments: readonly string[]) {}
  async runAgentCommand(): Promise<void> {
    const loadedConfig = new CiAgentEnvironment(process.env).loadConfig();
    if (loadedConfig.kind === CiAgentConfigLoadKind.MissingApiKey) {
      console.log("::warning::CURSOR_API_KEY is not set — skipping agent run.");
      return;
    }
    const config = loadedConfig.config;

    chdir(config.repoRoot);
    const prompt = await new AgentPrompt(config).load();
    await new ConfiguredAgentRuntime(config).runFixAgent({ prompt: prompt });
  }

  async runPlanningAgentCommand(): Promise<void> {
    const loadedConfig = new CiAgentEnvironment(process.env).loadConfig();
    if (loadedConfig.kind === CiAgentConfigLoadKind.MissingApiKey) {
      throw new Error(
        "CURSOR_API_KEY is required for the isolated planning agent",
      );
    }
    const config = loadedConfig.config;

    chdir(config.repoRoot);
    const prompt = await new AgentPrompt(config).load();
    await new ConfiguredAgentRuntime(config).runFixAgent({
      prompt: prompt,
      isolation: AgentIsolation.Strict,
    });
  }

  async main(): Promise<void> {
    const [command = "fix"] = [this.arguments[2]];

    switch (command) {
      case "agent":
        await this.runAgentCommand();
        break;
      case "fix":
        await new CiFixCommand(process.env).runCiFix();
        break;
      case "implement":
        await new CiImplementationCommand(process.env).runCiImplement();
        break;
      case "plan":
        await this.runPlanningAgentCommand();
        break;
      case "deliver":
        await new CiImplementationCommand(process.env).runCiDeliver();
        break;
      case "edit":
        await new CiImplementationCommand(process.env).runCiEditOnly();
        break;
      case "pr-preflight":
        await new PullRequestAuditRunPrAudit(false).execute();
        break;
      case "pr-ready":
        await new PullRequestAuditRunPrAudit(true).execute();
        break;
      case "pr-review":
        await new ReviewCommandEnvironment(process.env).runPrReviewRequest();
        break;
      case "pr-review-stabilize":
        await new ReviewCommandEnvironment(
          process.env,
        ).runPrReviewStabilization();
        break;
      default:
        throw new Error(
          `Unknown command: ${command} (expected agent, fix, implement, plan, edit, deliver, pr-preflight, pr-ready, pr-review, or pr-review-stabilize)`,
        );
    }
  }
}

import { CiAgentExit } from "./exit.js";
import { CiFixCommand } from "./fix.js";
import { CiImplementationCommand } from "./implement.js";
import { CiAgentConfigLoadKind, CiAgentEnvironment } from "./config.js";
import { AgentPrompt } from "./prompt.js";
import { AgentIsolation, ConfiguredAgentRuntime } from "./run-agent.js";
import { PullRequestAuditRunPrAudit } from "./pr-audit.js";
import { ReviewCommandEnvironment } from "./pr-review.js";

new CiAgentCommand(process.argv)
  .main()
  .then(() => {
    new CiAgentExit(0).finish();
  })
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`::error::${message}`);
    new CiAgentExit(1).finish();
  });
