import { Agent, CursorAgentError } from "@cursor/sdk";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  formatDuration,
  loadAgentWaitOptions,
  waitWithHeartbeat,
} from "./agent-wait.js";
import type { CiAgentConfig } from "./config.js";
import { finishInteractionLog, logInteractionUpdate } from "./log.js";
import { createLogger } from "./logger.js";

const log = createLogger("run-agent");

export enum AgentIsolation {
  Legacy = "legacy",
  Strict = "strict",
}

const AGENT_ENV_ALLOWLIST = new Set([
  "CI",
  "FORCE_COLOR",
  "HOME",
  "LANG",
  "LC_ALL",
  "NO_COLOR",
  "PATH",
  "SHELL",
  "TERM",
  "TMPDIR",
  "WASM_BUILD_MODE",
]);

export function sanitizeAgentEnvironment(environment: NodeJS.ProcessEnv): void {
  for (const name of Object.keys(environment)) {
    if (!AGENT_ENV_ALLOWLIST.has(name)) delete environment[name];
  }
}

export function restoreHostEnvironment(
  snapshot: NodeJS.ProcessEnv,
  environment: NodeJS.ProcessEnv,
): void {
  for (const name of Object.keys(environment)) delete environment[name];
  Object.assign(environment, snapshot);
}

async function createSandboxedAgent(config: CiAgentConfig) {
  try {
    await access(join(config.repoRoot, ".cursor", "sandbox.json"));
    throw new Error(
      "Implementation source must not provide Cursor sandbox policy",
    );
  } catch (error: unknown) {
    if (error instanceof Error && !error.message.includes("ENOENT"))
      throw error;
  }
  const sandboxHome = await mkdtemp(join(tmpdir(), "nook-agent-home-"));
  const cursorHome = join(sandboxHome, ".cursor");
  await mkdir(cursorHome);
  await writeFile(
    join(cursorHome, "sandbox.json"),
    JSON.stringify({
      type: "workspace_readwrite",
      readBoundary: "workspace",
      networkPolicy: { version: 1, default: "deny" },
      networkPolicyStrict: true,
    }),
    { mode: 0o600 },
  );
  sanitizeAgentEnvironment(process.env);
  process.env.HOME = sandboxHome;
  try {
    const agent = await Agent.create({
      apiKey: config.cursorApiKey,
      model: { id: config.modelId },
      disallowedTools: ["task", "mcp"],
      local: {
        cwd: config.repoRoot,
        settingSources: [],
        sandboxOptions: { enabled: true },
      },
    });
    return {
      agent,
      cleanup: () => rm(sandboxHome, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(sandboxHome, { recursive: true, force: true });
    throw error;
  }
}

async function createLegacyAgent(config: CiAgentConfig) {
  return Agent.create({
    apiKey: config.cursorApiKey,
    model: { id: config.modelId },
    local: {
      cwd: config.repoRoot,
      settingSources: [],
      sandboxOptions: { enabled: false },
    },
  });
}

async function runCreatedAgent(
  agent: Awaited<ReturnType<typeof Agent.create>>,
  prompt: string,
  waitOptions: ReturnType<typeof loadAgentWaitOptions>,
): Promise<void> {
  try {
    let run;
    try {
      run = await agent.send(prompt, {
        onDelta: ({ update }) => {
          logInteractionUpdate(update);
        },
      });
      log.info(`Agent run started (id ${run.id})`);
    } catch (err) {
      if (err instanceof CursorAgentError) {
        throw new Error(`Cursor agent startup failed: ${err.message}`);
      }
      throw err;
    }

    const result = await waitWithHeartbeat(
      "Agent",
      () => run.wait(),
      waitOptions,
    );
    if (result.status === "error") {
      const detail = result.error?.message?.trim();
      throw new Error(
        `Cursor agent run failed (run id ${result.id})${detail ? `: ${detail}` : ""}`,
      );
    }
    if (result.status === "cancelled") {
      throw new Error(`Cursor agent run cancelled (run id ${result.id})`);
    }

    log.info(`Agent finished (${result.status})`);
    finishInteractionLog();
  } finally {
    try {
      await agent[Symbol.asyncDispose]();
      log.info("Agent disposed");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.info(`Agent dispose warning: ${message}`);
    }
  }
}

export async function runFixAgent(
  config: CiAgentConfig,
  prompt: string,
  isolation: AgentIsolation = AgentIsolation.Legacy,
): Promise<void> {
  const waitOptions = loadAgentWaitOptions();
  log.info(
    `Running Cursor SDK agent (run ${config.githubRunId}, branch ${config.fixBranch}, timeout ${formatDuration(waitOptions.timeoutMs)})`,
  );

  // Prefer explicit asyncDispose over fire-and-forget close() so local executor
  // resources are released before git push / PR polling / process.exit.
  // The API key is passed directly to the SDK control plane. Remove every
  // repository/control-plane credential from the process environment before
  // the local agent can spawn a shell; local child processes inherit env.
  // Cursor SDK 1.0.28 consumes the trusted per-user policy while
  // sandboxOptions makes unsupported hosts fail closed.
  if (isolation === AgentIsolation.Strict) {
    const hostEnvironment = { ...process.env };
    try {
      const created = await createSandboxedAgent(config);
      try {
        await runCreatedAgent(created.agent, prompt, waitOptions);
      } finally {
        await created.cleanup();
      }
    } finally {
      restoreHostEnvironment(hostEnvironment, process.env);
    }
    return;
  }
  await runCreatedAgent(await createLegacyAgent(config), prompt, waitOptions);
}
