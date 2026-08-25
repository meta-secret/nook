import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

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
  readonly allowFailure?: boolean;
  readonly streamOutput?: boolean;
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
  readonly allowFailure?: boolean;
  readonly streamOutput?: boolean;
}

interface AssertionRequest {
  readonly content: string;
  readonly expected: string;
  readonly label: string;
}

export function runCommand(request: CommandRequest): CommandOutcome {
  const executable = request.command[0];
  if (!executable) throw new Error(`${request.label} has no executable`);
  const result = spawnSync(executable, request.command.slice(1), {
    cwd: request.cwd,
    env: request.environment ?? process.env,
    input: request.input,
    encoding: "utf8",
  });
  const outcome: CommandOutcome = {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
  if (request.streamOutput) {
    if (outcome.stdout.length > 0) process.stdout.write(outcome.stdout);
    if (outcome.stderr.length > 0) process.stderr.write(outcome.stderr);
  }
  if (outcome.exitCode !== 0 && !request.allowFailure) {
    throw new Error(
      `${request.label} failed with exit ${outcome.exitCode}\n${outcome.stdout}${outcome.stderr}`,
    );
  }
  return outcome;
}

export function runKubectl(request: KubectlRequest): CommandOutcome {
  return runCommand({
    label: request.label,
    command: ["kubectl", ...request.command],
    cwd: REPOSITORY_ROOT,
    input: request.input,
    environment: { ...process.env, KUBECONFIG: request.kubeconfigPath },
    allowFailure: request.allowFailure,
    streamOutput: request.streamOutput,
  });
}

export function applyYaml(request: {
  readonly kubeconfigPath: string;
  readonly label: string;
  readonly yaml: string;
}): void {
  runKubectl({
    kubeconfigPath: request.kubeconfigPath,
    label: request.label,
    command: ["apply", "-f", "-"],
    input: request.yaml,
    streamOutput: true,
  });
}

export function assertContains(request: AssertionRequest): void {
  if (!request.content.includes(request.expected)) {
    throw new Error(`${request.label}: missing ${JSON.stringify(request.expected)}`);
  }
}

export function assertExcludes(request: AssertionRequest): void {
  if (request.content.includes(request.expected)) {
    throw new Error(
      `${request.label}: found forbidden ${JSON.stringify(request.expected)}`,
    );
  }
}
