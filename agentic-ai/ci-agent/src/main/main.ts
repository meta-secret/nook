import { err, ok, type Result } from "neverthrow";
import { CiFailureKind, type CiFailure } from "./failure.js";
import { CiWorkingDirectory } from "./process.js";
import { CiAgentExit } from "./exit.js";
import { CiFixCommand } from "./fix.js";
import { CiImplementationCommand } from "./implement.js";
import { CiAgentConfigLoadKind, CiAgentEnvironment } from "./config.js";
import { AgentPrompt } from "./prompt.js";
import { AgentIsolation, ConfiguredAgentRuntime } from "./run-agent.js";
import { AuditRequirement, PullRequestAuditRunPrAudit } from "./pr-audit.js";
import { ReviewCommandEnvironment } from "./pr-review.js";

enum AgentCommandMode {
  OptionalLegacy,
  RequiredPlanning,
}
class CiAgentCommand {
  constructor(private readonly argv: readonly string[]) {}
  async runAgentCommand(
    mode: AgentCommandMode,
  ): Promise<Result<void, CiFailure>> {
    const loaded = new CiAgentEnvironment(process.env).loadConfig();
    if (loaded.kind === CiAgentConfigLoadKind.MissingApiKey) {
      if (mode === AgentCommandMode.RequiredPlanning)
        return err({
          kind: CiFailureKind.Configuration,
          message: "CURSOR_API_KEY is required for the isolated planning agent",
        });
      console.log("::warning::CURSOR_API_KEY is not set — skipping agent run.");
      return ok();
    }
    const config = loaded.config;
    const entered = new CiWorkingDirectory(config.repoRoot).enter();
    if (entered.isErr()) return err(entered.error);
    const prompt = await new AgentPrompt(config).load();
    if (prompt.isErr()) return err(prompt.error);
    return new ConfiguredAgentRuntime(config).runFixAgent({
      prompt: prompt.value,
      isolation:
        mode === AgentCommandMode.RequiredPlanning
          ? AgentIsolation.Strict
          : AgentIsolation.Legacy,
    });
  }
  async main(): Promise<Result<void, CiFailure>> {
    const command = this.argv[2] || "fix";
    switch (command) {
      case "agent":
        return this.runAgentCommand(AgentCommandMode.OptionalLegacy);
      case "plan":
        return this.runAgentCommand(AgentCommandMode.RequiredPlanning);
      case "fix":
        return (await new CiFixCommand(process.env).runCiFix()).map(
          () => {},
        );
      case "implement":
        return new CiImplementationCommand(process.env).runCiImplement();
      case "deliver":
        return new CiImplementationCommand(process.env).runCiDeliver();
      case "edit":
        return new CiImplementationCommand(process.env).runCiEditOnly();
      case "pr-preflight":
        return new PullRequestAuditRunPrAudit(
          AuditRequirement.Snapshot,
        ).execute();
      case "pr-ready":
        return new PullRequestAuditRunPrAudit(AuditRequirement.Ready).execute();
      case "pr-review":
        return new ReviewCommandEnvironment(process.env).runPrReviewRequest();
      case "pr-review-stabilize":
        return new ReviewCommandEnvironment(
          process.env,
        ).runPrReviewStabilization();
      default:
        return err({
          kind: CiFailureKind.Configuration,
          message: `Unknown command: ${command} (expected agent, fix, implement, plan, edit, deliver, pr-preflight, pr-ready, pr-review, or pr-review-stabilize)`,
        });
    }
  }
}
const outcome = await new CiAgentCommand(process.argv).main();
if (outcome.isErr()) {
  console.error(`::error::${outcome.error.message}`);
  new CiAgentExit(1).finish();
}
new CiAgentExit(0).finish();
