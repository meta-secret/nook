import { err, ok, ResultAsync, type Result } from "neverthrow";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CiCleanupOutcome, CiFailureKind, type CiFailure } from "./failure.js";
import { CiWorkingDirectory } from "./process.js";
import { AgentFile } from "./agent-files.js";
import { AgentRuntimeRestoreHostEnvironment } from "./run-agent.js";
export class DependencyFixCreateValidationEnvironment {
  constructor(private readonly request: NodeJS.ProcessEnv) {}
  execute(): NodeJS.ProcessEnv {
    const hostEnvironment = this.request;

    return Object.fromEntries(
      Object.entries(hostEnvironment).filter(
        ([name, value]) =>
          VALIDATION_ENV_ALLOWLIST.has(name) && typeof value === "string",
      ),
    );
  }
}

export interface DependencyFixWithValidationEnvironmentRequest<T> {
  readonly environment: NodeJS.ProcessEnv;
  readonly operation: (
    sanitized: NodeJS.ProcessEnv,
  ) => Promise<Result<T, CiFailure>>;
}

export class DependencyFixWithValidationEnvironment<T> {
  constructor(
    private readonly request: DependencyFixWithValidationEnvironmentRequest<T>,
  ) {}
  async execute(): Promise<Result<T, CiFailure>> {
    const { environment, operation } = this.request;
    const hostEnvironment = { ...environment };
    const root = await ResultAsync.fromPromise(
      mkdtemp(join(tmpdir(), "nook-validation-")),
      (): CiFailure => ({
        kind: CiFailureKind.Filesystem,
        message: "Unable to create credential-isolated validation directory",
      }),
    );
    if (root.isErr()) return err(root.error);
    const prepared = await this.prepare(root.value, hostEnvironment);
    let outcome: Result<T, CiFailure>;
    if (prepared.isErr()) outcome = err(prepared.error);
    else {
      new AgentRuntimeRestoreHostEnvironment({
        snapshot: prepared.value,
        environment,
      }).execute();
      const operated = await ResultAsync.fromPromise(
        operation(environment),
        (): CiFailure => ({
          kind: CiFailureKind.Dependency,
          message: "Isolated dependency validation rejected",
        }),
      );
      outcome = operated.isErr() ? err(operated.error) : operated.value;
    }
    new AgentRuntimeRestoreHostEnvironment({
      snapshot: hostEnvironment,
      environment,
    }).execute();
    const cleanup = await ResultAsync.fromPromise(
      rm(root.value, { recursive: true, force: true }),
      (): CiFailure => ({
        kind: CiFailureKind.Cleanup,
        message: "Unable to remove credential-isolated validation directory",
      }),
    );
    return new CiCleanupOutcome(cleanup).finish(outcome);
  }
  private async prepare(
    isolatedRoot: string,
    hostEnvironment: NodeJS.ProcessEnv,
  ): Promise<Result<NodeJS.ProcessEnv, CiFailure>> {
    const base = new DependencyFixCreateValidationEnvironment(
      hostEnvironment,
    ).execute();
    let dockerHost = "";
    for (const dir of (base.PATH || "").split(":")) {
      const inspected = await new AgentFile(join(dir, "docker")).metadata();
      if (inspected.isOk()) {
        dockerHost = join(dir, "docker");
        break;
      }
    }
    if (!dockerHost)
      return err({
        kind: CiFailureKind.Configuration,
        message: "docker not found on sanitized PATH",
      });
    const bin = join(isolatedRoot, "bin"),
      home = join(isolatedRoot, "home"),
      docker = join(bin, "docker");
    const directories = await ResultAsync.fromPromise(
      Promise.all([mkdir(bin), mkdir(home)]),
      (): CiFailure => ({
        kind: CiFailureKind.Filesystem,
        message: "Unable to prepare isolated validation directories",
      }),
    );
    if (directories.isErr()) return err(directories.error);
    const script = await ResultAsync.fromPromise(
      writeFile(docker, NETWORKLESS_DOCKER, { mode: 0o700 }),
      (): CiFailure => ({
        kind: CiFailureKind.Filesystem,
        message: "Unable to write networkless Docker adapter",
      }),
    );
    if (script.isErr()) return err(script.error);
    const builder = base.NOOK_PR_BUILDX_BUILDER;
    const hostHome = hostEnvironment.HOME;
    if (builder) {
      if (!/^[a-zA-Z0-9_.-]+$/u.test(builder) || !hostHome)
        return err({
          kind: CiFailureKind.Configuration,
          message: "Invalid trusted Buildx instance metadata",
        });
      const source = join(hostHome, ".docker", "buildx", "instances", builder);
      const metadata = await new AgentFile(source).metadata();
      if (metadata.isErr()) return err(metadata.error);
      if (!metadata.value.isFile())
        return err({
          kind: CiFailureKind.CredentialBoundary,
          message: "Trusted Buildx instance metadata is not a regular file",
        });
      const instances = join(home, ".docker", "buildx", "instances");
      const directory = await ResultAsync.fromPromise(
        mkdir(instances, { recursive: true }),
        (): CiFailure => ({
          kind: CiFailureKind.Filesystem,
          message: "Unable to prepare isolated Buildx metadata directory",
        }),
      );
      if (directory.isErr()) return err(directory.error);
      const copied = await ResultAsync.fromPromise(
        copyFile(source, join(instances, builder)),
        (): CiFailure => ({
          kind: CiFailureKind.Filesystem,
          message: "Unable to copy trusted Buildx metadata",
        }),
      );
      if (copied.isErr()) return err(copied.error);
    }
    return ok({
      ...base,
      DOCKER: docker,
      HOME: home,
      NOOK_VALIDATION_DOCKER: dockerHost,
      PATH: `${bin}:${base.PATH || ""}`,
      SCCACHE_OPTIONAL: "1",
      ...(builder ? { BUILDX_BUILDER: builder } : {}),
    });
  }
}

const VALIDATION_ENV_ALLOWLIST = new Set([
  "BUILDKIT_PROGRESS",
  "BUILDX_BUILDER",
  "CI",
  "DOCKER_BUILDKIT",
  "DOCKER_HOST",
  "FORCE_COLOR",
  "GITHUB_ACTIONS",
  "LANG",
  "LC_ALL",
  "NO_COLOR",
  "NOOK_ARC_HIVE",
  "NOOK_BUILDKIT_REMOTE",
  "NOOK_PR_BUILDX_BUILDER",
  "PATH",
  "RUNNER_TOOL_CACHE",
  "SHELL",
  "TERM",
  "TMPDIR",
]);

const NETWORKLESS_DOCKER = `#!/bin/sh
set -eu
real=\${NOOK_VALIDATION_DOCKER:?}
deny_net() { for a; do case "$a" in --network|--network=*|--net|--net=*) echo "Blocked Docker network override: $a" >&2; exit 97;; esac; done; }
case "\${1:-}" in
  build) shift; deny_net "$@"; exec "$real" build --network none "$@" ;;
  buildx)
    sub=\${2:-}; shift 2
    case "$sub" in
      bake) deny_net "$@"; exec "$real" buildx bake --set '*.network=none' "$@" ;;
      build) deny_net "$@"; exec "$real" buildx build --network none "$@" ;;
      create)
        [ "$*" = "--name \${NOOK_PR_BUILDX_BUILDER:-} --driver docker-container --bootstrap" ] || exit 97
        exec "$real" buildx create "$@" ;;
      inspect|use|version) exec "$real" buildx "$sub" "$@" ;;
      rm)
        [ "$*" = "--force \${NOOK_PR_BUILDX_BUILDER:-}" ] || exit 97
        exec "$real" buildx rm "$@" ;;
      *) echo "Blocked Docker buildx operation during isolated validation: $sub" >&2; exit 97 ;;
    esac ;;
  run) shift; deny_net "$@"; exec "$real" run --network none "$@" ;;
  container|cp|create|image|images|inspect|ps|rm|version) exec "$real" "$@" ;;
  *) echo "Blocked Docker operation during isolated validation: \${1:-<empty>}" >&2; exit 97 ;;
esac
`;

type ValidationCommand = {
  args: readonly string[];
  environment: Readonly<Record<string, string>>;
};

export const RUST_DEPENDENCY_UPDATE_VALIDATION_COMMANDS: readonly ValidationCommand[] =
  [
    {
      args: ["docker:ecosystem:fuzz", "FUZZ_SECONDS=20"],
      environment: {},
    },
    { args: ["hive:verify"], environment: {} },
  ];

export type ValidationRunner = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => Promise<Result<void, CiFailure>>;

enum IsolatedValidation {
  Hive,
  Fuzz,
}
class IsolatedValidationProcess {
  constructor(private readonly scenario: IsolatedValidation) {}
  execute(): Promise<Result<void, CiFailure>> {
    return new Promise((resolveRun) => {
      try {
        const child =
          this.scenario === IsolatedValidation.Fuzz
            ? spawn("task", ["docker:ecosystem:fuzz", "FUZZ_SECONDS=20"], {
                stdio: "inherit",
              })
            : spawn("task", ["hive:verify"], { stdio: "inherit" });
        child.once("error", () =>
          resolveRun(
            err({
              kind: CiFailureKind.Dependency,
              message: "Unable to start isolated validation command",
            }),
          ),
        );
        child.once("close", (code, signal) =>
          resolveRun(
            code === 0 && !signal
              ? ok()
              : err({
                  kind: CiFailureKind.Dependency,
                  message: "Isolated validation command failed",
                }),
          ),
        );
      } catch {
        resolveRun(
          err({
            kind: CiFailureKind.Dependency,
            message: "Unable to start isolated validation command",
          }),
        );
      }
    });
  }
}
export const runValidationCommand: ValidationRunner = async (
  command,
  args,
  options,
) => {
  if (command !== "task")
    return err({
      kind: CiFailureKind.Configuration,
      message: "Isolated validation may only invoke task",
    });
  let scenario: IsolatedValidation;
  if (args[0] === "hive:verify" && args.length === 1)
    scenario = IsolatedValidation.Hive;
  else if (
    args[0] === "docker:ecosystem:fuzz" &&
    args[1] === "FUZZ_SECONDS=20" &&
    args.length === 2
  )
    scenario = IsolatedValidation.Fuzz;
  else
    return err({
      kind: CiFailureKind.Configuration,
      message: "Isolated validation command is not allowlisted",
    });
  const cwd = process.cwd(),
    hostEnvironment = { ...process.env };
  const entered = new CiWorkingDirectory(options.cwd).enter();
  if (entered.isErr()) return err(entered.error);
  new AgentRuntimeRestoreHostEnvironment({
    snapshot: options.env,
    environment: process.env,
  }).execute();
  const outcome = await new IsolatedValidationProcess(scenario).execute();
  new AgentRuntimeRestoreHostEnvironment({
    snapshot: hostEnvironment,
    environment: process.env,
  }).execute();
  return new CiCleanupOutcome(new CiWorkingDirectory(cwd).enter()).finish(
    outcome,
  );
};
