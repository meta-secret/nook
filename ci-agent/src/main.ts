import { chdir } from "node:process";

import { loadConfig } from "./config.js";
import {
  configureGit,
  findOpenPr,
  squashMerge,
  waitForChecks,
} from "./github.js";
import { loadPrompt } from "./prompt.js";
import { runFixAgent } from "./run-agent.js";

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.log("::warning::CURSOR_API_KEY is not set — skipping AI CI fix job.");
    console.log(
      "Add repository secret CURSOR_API_KEY (Cursor Dashboard → Integrations → User API Keys).",
    );
    return;
  }

  process.env.GH_TOKEN = config.ghToken;
  process.env.FIX_BRANCH = config.fixBranch;
  process.env.GITHUB_RUN_ID = config.githubRunId;
  process.env.GITHUB_REPOSITORY = config.githubRepository;

  chdir(config.repoRoot);
  await configureGit(config.repoRoot);

  let prNum = await findOpenPr(config.fixBranch);
  if (prNum) {
    console.log(
      `==> Open PR already exists for ${config.fixBranch} (#${prNum}) — waiting for checks`,
    );
  } else {
    const prompt = await loadPrompt(config);
    await runFixAgent(config, prompt);

    prNum = await findOpenPr(config.fixBranch);
    if (!prNum) {
      console.error(`::error::Cursor Agent did not open a PR for branch ${config.fixBranch}.`);
      process.exit(1);
    }
    console.log(`==> Agent opened PR #${prNum}`);
  }

  await waitForChecks(prNum);
  await squashMerge(prNum);
  console.log(
    `==> Done — merged PR #${prNum} (fix for main run ${config.githubRunId})`,
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`::error::${message}`);
  process.exit(1);
});
