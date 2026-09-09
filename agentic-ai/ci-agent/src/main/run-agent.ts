import { Agent, CursorAgentError } from "@cursor/sdk";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ElapsedDuration,
  AgentWaitEnvironment,
  AgentWait,
} from "./agent-wait.js";
import type { CiAgentConfig } from "./config.js";
import { defaultInteractionLogger } from "./log.js";
import { Logger } from "./logger.js";

export interface ConfiguredAgentRuntimeRunFixAgentRequest {
  readonly prompt: string;
  readonly isolation?: AgentIsolation;
}

export class ConfiguredAgentRuntime {
  constructor(private readonly value: CiAgentConfig) {}
  async createSandboxedAgent() {
    const config = this.value;

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
    new AgentRuntimeSanitizeAgentEnvironment(process.env).execute();
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

  async createLegacyAgent() {
    const config = this.value;

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

  async runFixAgent(
    request: ConfiguredAgentRuntimeRunFixAgentRequest,
  ): Promise<void> {
    const config = this.value;
    const { prompt, isolation = AgentIsolation.Legacy } = request;

    const waitOptions = new AgentWaitEnvironment(
      process.env,
    ).loadAgentWaitOptions();
    log.info(
      `Running Cursor SDK agent (run ${config.githubRunId}, branch ${config.fixBranch}, timeout ${new ElapsedDuration(waitOptions.timeoutMs).format()})`,
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
        const created = await new ConfiguredAgentRuntime(
          config,
        ).createSandboxedAgent();
        try {
          await new AgentRuntimeRunCreatedAgent({
            agent: created.agent,
            prompt: prompt,
            waitOptions: waitOptions,
          }).execute();
        } finally {
          await created.cleanup();
        }
      } finally {
        new AgentRuntimeRestoreHostEnvironment({
          snapshot: hostEnvironment,
          environment: process.env,
        }).execute();
      }
      return;
    }
    await new AgentRuntimeRunCreatedAgent({
      agent: await new ConfiguredAgentRuntime(config).createLegacyAgent(),
      prompt: prompt,
      waitOptions: waitOptions,
    }).execute();
  }
}

export class AgentRuntimeSanitizeAgentEnvironment {
  constructor(private readonly request: NodeJS.ProcessEnv) {}
  execute(): void {
    const environment = this.request;

    for (const name of Object.keys(environment)) {
      if (!AGENT_ENV_ALLOWLIST.has(name)) delete environment[name];
    }
  }
}

export interface AgentRuntimeRestoreHostEnvironmentRequest {
  readonly snapshot: NodeJS.ProcessEnv;
  readonly environment: NodeJS.ProcessEnv;
}

export class AgentRuntimeRestoreHostEnvironment {
  constructor(
    private readonly request: AgentRuntimeRestoreHostEnvironmentRequest,
  ) {}
  execute(): void {
    const { snapshot, environment } = this.request;

    for (const name of Object.keys(environment)) delete environment[name];
    Object.assign(environment, snapshot);
  }
}

interface AgentRuntimeRunCreatedAgentRequest {
  readonly agent: Awaited<ReturnType<typeof Agent.create>>;
  readonly prompt: string;
  readonly waitOptions: ReturnType<
    AgentWaitEnvironment["loadAgentWaitOptions"]
  >;
}

class AgentRuntimeRunCreatedAgent {
  constructor(private readonly request: AgentRuntimeRunCreatedAgentRequest) {}
  async execute(): Promise<void> {
    const { agent, prompt, waitOptions } = this.request;

    try {
      let run;
      try {
        run = await agent.send(prompt, {
          onDelta: ({ update }) => {
            defaultInteractionLogger.log(update);
          },
        });
        log.info(`Agent run started (id ${run.id})`);
      } catch (err) {
        if (err instanceof CursorAgentError) {
          throw new Error(`Cursor agent startup failed: ${err.message}`);
        }
        throw err;
      }

      const result = await new AgentWait({
        label: "Agent",
        wait: () => run.wait(),
        options: waitOptions,
      }).complete();
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
      defaultInteractionLogger.finish();
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
}

const log = new Logger("run-agent");

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
