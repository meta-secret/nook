import { err, ok, type Result } from "neverthrow";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export class HostCommand {
  constructor(private readonly request: CommandRequest) {}
  run(): Result<CommandOutcome, CacheFailure> {
    const request = this.request;

    const executable = request.command[0];
    if (!executable)
      return err({
        kind: CacheFailureKind.Command,
        message: `${request.label} has no executable`,
      });
    const { environment = process.env } = request;
    let result;
    try {
      result = spawnSync(executable, request.command.slice(1), {
        cwd: request.cwd,
        env: environment,
        input: request.input,
        encoding: "utf8",
      });
    } catch {
      return err({
        kind: CacheFailureKind.Command,
        message: `${request.label} could not start`,
      });
    }
    const {
      status,
      stdout = "",
      stderr: rawStderr = result.error?.message,
    } = result;
    const [stderr = ""] = [rawStderr];
    const outcome: CommandOutcome = {
      exitCode: typeof status === "number" ? status : 1,
      stdout: typeof stdout === "string" ? stdout : "",
      stderr: typeof stderr === "string" ? stderr : "",
    };
    if (request.output === CommandOutputPolicy.Streamed) {
      if (outcome.stdout.length > 0) process.stdout.write(outcome.stdout);
      if (outcome.stderr.length > 0) process.stderr.write(outcome.stderr);
    }
    if (
      outcome.exitCode !== 0 &&
      request.failurePolicy !== CommandFailurePolicy.ObserveExit
    ) {
      return err({
        kind: CacheFailureKind.Command,
        message: `${request.label} failed with exit ${outcome.exitCode}`,
      });
    }
    return ok(outcome);
  }
}

export class KubectlCommand {
  constructor(private readonly request: KubectlRequest) {}
  run(): Result<CommandOutcome, CacheFailure> {
    const request = this.request;

    const commandRequest: CommandRequest = {
      label: request.label,
      command: ["kubectl", ...request.command],
      cwd: REPOSITORY_ROOT,
      environment: { ...process.env, KUBECONFIG: request.kubeconfigPath },
      ...("input" in request ? { input: request.input } : {}),
      ...("failurePolicy" in request
        ? { failurePolicy: request.failurePolicy }
        : {}),
      ...("output" in request ? { output: request.output } : {}),
    };
    return new HostCommand(commandRequest).run();
  }
}

export class KubernetesManifestApplication {
  constructor(
    private readonly request: {
      readonly kubeconfigPath: string;
      readonly label: string;
      readonly yaml: string;
    },
  ) {}
  apply(): Result<void, CacheFailure> {
    const request = this.request;

    return new KubectlCommand({
      kubeconfigPath: request.kubeconfigPath,
      label: request.label,
      command: ["apply", "-f", "-"],
      input: request.yaml,
      output: CommandOutputPolicy.Streamed,
    })
      .run()
      .map(() => {});
  }
}

export class RequiredOutputText {
  constructor(private readonly request: AssertionRequest) {}
  assertPresent(): Result<void, CacheFailure> {
    const request = this.request;

    if (!request.content.includes(request.expected)) {
      return err({
        kind: CacheFailureKind.Expectation,
        message: `${request.label}: missing ${JSON.stringify(request.expected)}`,
      });
    }
    return ok();
  }
}

export class ForbiddenOutputText {
  constructor(private readonly request: AssertionRequest) {}
  assertAbsent(): Result<void, CacheFailure> {
    const request = this.request;

    if (request.content.includes(request.expected)) {
      return err({
        kind: CacheFailureKind.Expectation,
        message: `${request.label}: found forbidden ${JSON.stringify(request.expected)}`,
      });
    }
    return ok();
  }
}

export const CLUSTER_NAME = "nook-cache-proof";
export const K3D_VERSION = "v5.9.0";
export const K3D_BINARY = process.env.NOOK_K3D_BIN?.trim() || "k3d";
export const K3S_IMAGE =
  "rancher/k3s:v1.36.2-k3s1@sha256:6a47cea22c4b834d4ba72c89d291696b79ebe406251f90b446e4dff03513dd87";
export const BUILDKIT_IMAGE =
  "docker.io/moby/buildkit:v0.32.2-rootless@sha256:60d1f642e29dc938bd6c109ba5500849fccf41921927c5339788b8227f57feb9";
export const REGISTRY_HOST = "nook-zot.hive-data.svc.cluster.local:5000";
export const BUILDKIT_ADDRESS =
  "tcp://nook-buildkit.arc-runners.svc.cluster.local:1234";
export const ADMIN_USERNAME = "sim-admin";
export const REMOTE_USERNAME = "sim-remote";
export const ADMIN_SECRET = "nook-cache-proof-admin-dockerconfig";
export const REMOTE_SECRET = "nook-cache-proof-remote-dockerconfig";
export const SIMULATION_DIRECTORY = import.meta.dir;
export const REPOSITORY_ROOT = resolve(SIMULATION_DIRECTORY, "../../..");

export interface CommandRequest {
  readonly label: string;
  readonly command: readonly string[];
  readonly cwd?: string;
  readonly input?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly failurePolicy?: CommandFailurePolicy;
  readonly output?: CommandOutputPolicy;
}

export interface CommandOutcome {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface KubectlRequest {
  readonly kubeconfigPath: string;
  readonly label: string;
  readonly command: readonly string[];
  readonly input?: string;
  readonly failurePolicy?: CommandFailurePolicy;
  readonly output?: CommandOutputPolicy;
}

interface AssertionRequest {
  readonly content: string;
  readonly expected: string;
  readonly label: string;
}

export enum CacheFailureKind {
  Command = "command",
  Filesystem = "filesystem",
  Expectation = "expectation",
  Identity = "identity",
  Timeout = "timeout",
  Cleanup = "cleanup",
}
export interface CacheFailure {
  readonly kind: CacheFailureKind;
  readonly message: string;
}

export enum CommandFailurePolicy {
  RequireSuccess = "require-success",
  ObserveExit = "observe-exit",
}
export enum CommandOutputPolicy {
  Captured = "captured",
  Streamed = "streamed",
}
