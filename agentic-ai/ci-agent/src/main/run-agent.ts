import { err, ok, ResultAsync, type Result } from "neverthrow";
import { CiCleanupOutcome, CiFailureKind, type CiFailure } from "./failure.js";
import { Agent } from "@cursor/sdk";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ElapsedDuration,
  AgentWaitEnvironment,
  AgentWait,
} from "./agent-wait.js";
import type { CiAgentConfig } from "./config.js";
import { CiInteractionLogger } from "./log.js";
import { Logger } from "./logger.js";

export interface ConfiguredAgentRuntimeRunFixAgentRequest {
  readonly prompt: string;
  readonly isolation?: AgentIsolation;
}

type CursorAgent = Awaited<ReturnType<typeof Agent.create>>;
type SandboxedAgent = {
  agent: CursorAgent;
  cleanup: () => Promise<Result<void, CiFailure>>;
};
export class ConfiguredAgentRuntime {
  constructor(private readonly value: CiAgentConfig) {}
  async createSandboxedAgent(): Promise<Result<SandboxedAgent, CiFailure>> {
    const config = this.value;
    const policy = await ResultAsync.fromPromise(
      access(join(config.repoRoot, ".cursor", "sandbox.json")),
      (cause): CiFailure => ({
        kind: CiFailureKind.Filesystem,
        message: "Unable to inspect implementation sandbox policy",
        ...(cause instanceof Error &&
        "code" in cause &&
        typeof cause.code === "string"
          ? { code: cause.code }
          : {}),
      }),
    );
    if (policy.isOk())
      return err({
        kind: CiFailureKind.CredentialBoundary,
        message: "Implementation source must not provide Cursor sandbox policy",
      });
    if (
      policy.error.kind === CiFailureKind.Combined ||
      policy.error.code !== "ENOENT"
    )
      return err(policy.error);
    const home = await ResultAsync.fromPromise(
      mkdtemp(join(tmpdir(), "nook-agent-home-")),
      (): CiFailure => ({
        kind: CiFailureKind.Filesystem,
        message: "Unable to create isolated agent home",
      }),
    );
    if (home.isErr()) return err(home.error);
    const prepared = await this.prepareSandbox(home.value);
    if (prepared.isErr())
      return new CiCleanupOutcome(await this.removeSandbox(home.value)).finish(
        err(prepared.error),
      );
    new AgentRuntimeSanitizeAgentEnvironment(process.env).execute();
    process.env.HOME = home.value;
    const agent = await ResultAsync.fromPromise(
      Agent.create({
        apiKey: config.cursorApiKey,
        model: { id: config.modelId },
        disallowedTools: ["task", "mcp"],
        local: {
          cwd: config.repoRoot,
          settingSources: [],
          sandboxOptions: { enabled: true },
        },
      }),
      (): CiFailure => ({
        kind: CiFailureKind.Agent,
        message: "Unable to create isolated Cursor agent",
      }),
    );
    if (agent.isErr())
      return new CiCleanupOutcome(await this.removeSandbox(home.value)).finish(
        err(agent.error),
      );
    return ok({
      agent: agent.value,
      cleanup: () => this.removeSandbox(home.value),
    });
  }
  private async prepareSandbox(home: string): Promise<Result<void, CiFailure>> {
    const cursorHome = join(home, ".cursor");
    const directory = await ResultAsync.fromPromise(
      mkdir(cursorHome),
      (): CiFailure => ({
        kind: CiFailureKind.Filesystem,
        message: "Unable to create trusted Cursor policy directory",
      }),
    );
    if (directory.isErr()) return err(directory.error);
    return ResultAsync.fromPromise(
      writeFile(
        join(cursorHome, "sandbox.json"),
        JSON.stringify({
          type: "workspace_readwrite",
          readBoundary: "workspace",
          networkPolicy: { version: 1, default: "deny" },
          networkPolicyStrict: true,
        }),
        { mode: 0o600 },
      ),
      (): CiFailure => ({
        kind: CiFailureKind.Filesystem,
        message: "Unable to write trusted Cursor sandbox policy",
      }),
    );
  }
  private async removeSandbox(home: string): Promise<Result<void, CiFailure>> {
    return ResultAsync.fromPromise(
      rm(home, { recursive: true, force: true }),
      (): CiFailure => ({
        kind: CiFailureKind.Cleanup,
        message: "Unable to remove isolated Cursor home",
      }),
    );
  }
  createLegacyAgent() {
    const config = this.value;
    return ResultAsync.fromPromise(
      Agent.create({
        apiKey: config.cursorApiKey,
        model: { id: config.modelId },
        local: {
          cwd: config.repoRoot,
          settingSources: [],
          sandboxOptions: { enabled: false },
        },
      }),
      (): CiFailure => ({
        kind: CiFailureKind.Agent,
        message: "Unable to create Cursor agent",
      }),
    );
  }
  async runFixAgent({
    prompt,
    isolation = AgentIsolation.Legacy,
  }: ConfiguredAgentRuntimeRunFixAgentRequest): Promise<
    Result<void, CiFailure>
  > {
    const config = this.value;
    const waitOptions = new AgentWaitEnvironment(
      process.env,
    ).loadAgentWaitOptions();
    log.info(
      `Running Cursor SDK agent (run ${config.githubRunId}, branch ${config.fixBranch}, timeout ${new ElapsedDuration(waitOptions.timeoutMs).format()})`,
    );
    if (isolation === AgentIsolation.Strict) {
      const hostEnvironment = { ...process.env };
      const created = await this.createSandboxedAgent();
      let outcome: Result<void, CiFailure>;
      if (created.isErr()) outcome = err(created.error);
      else {
        const completed = await new AgentRuntimeRunCreatedAgent({
          agent: created.value.agent,
          prompt,
          waitOptions,
        }).execute();
        outcome = new CiCleanupOutcome(await created.value.cleanup()).finish(
          completed,
        );
      }
      new AgentRuntimeRestoreHostEnvironment({
        snapshot: hostEnvironment,
        environment: process.env,
      }).execute();
      return outcome;
    }
    const agent = await this.createLegacyAgent();
    if (agent.isErr()) return err(agent.error);
    return new AgentRuntimeRunCreatedAgent({
      agent: agent.value,
      prompt,
      waitOptions,
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
  async execute(): Promise<Result<void, CiFailure>> {
    const outcome = await this.run();
    const disposed = await ResultAsync.fromPromise(
      this.request.agent[Symbol.asyncDispose](),
      (): CiFailure => ({
        kind: CiFailureKind.Cleanup,
        message: "Unable to dispose Cursor agent",
      }),
    );
    if (disposed.isOk()) log.info("Agent disposed");
    return new CiCleanupOutcome(disposed).finish(outcome);
  }
  private async run(): Promise<Result<void, CiFailure>> {
    const { agent, prompt, waitOptions } = this.request;
    let interactionLogger = new CiInteractionLogger();
    const sent = await ResultAsync.fromPromise(
      agent.send(prompt, {
        onDelta: ({ update }) => {
          interactionLogger = interactionLogger.log(update);
        },
      }),
      (): CiFailure => ({
        kind: CiFailureKind.Agent,
        message: "Cursor agent startup failed",
      }),
    );
    if (sent.isErr()) return err(sent.error);
    const run = sent.value;
    log.info(`Agent run started (id ${run.id})`);
    const outcome = await new AgentWait({
      label: "Agent",
      wait: async () =>
        ResultAsync.fromPromise(run.wait(), (): CiFailure => ({
          kind: CiFailureKind.Agent,
          message: "Cursor agent wait failed",
        })),
      options: waitOptions,
    }).complete();
    if (outcome.isErr()) return err(outcome.error);
    const result = outcome.value;
    if (result.status === "error")
      return err({
        kind: CiFailureKind.Agent,
        message: `Cursor agent run failed (run id ${result.id})`,
      });
    if (result.status === "cancelled")
      return err({
        kind: CiFailureKind.Cancelled,
        message: `Cursor agent run cancelled (run id ${result.id})`,
      });
    log.info(`Agent finished (${result.status})`);
    interactionLogger = interactionLogger.finish();
    return ok();
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
