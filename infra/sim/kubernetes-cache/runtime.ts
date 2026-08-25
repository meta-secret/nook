import { accessSync, constants, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import {
  CLUSTER_NAME,
  K3D_BINARY,
  K3S_IMAGE,
  type CommandRequest,
  runCommand,
} from "./contracts";

export interface CleanupRequest {
  readonly temporaryDirectory: string;
  readonly clusterCreated: boolean;
}

export function requireCommand(command: string): void {
  const candidates = command.includes("/")
    ? [command]
    : (process.env.PATH ?? "")
        .split(delimiter)
        .filter((directory) => directory.length > 0)
        .map((directory) => join(directory, command));
  const found = candidates.some((candidate) => {
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
  if (!found) throw new Error(`${command} is required`);
}

export function clusterExists(): boolean {
  const outcome = runCommand({
    label: "list k3d clusters",
    command: [K3D_BINARY, "cluster", "list", "--no-headers"],
    allowFailure: true,
  });
  return outcome.stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0] ?? "")
    .includes(CLUSTER_NAME);
}

export function createCluster(): void {
  runCommand({
    label: "create pinned k3d cluster",
    command: [
      K3D_BINARY,
      "cluster",
      "create",
      CLUSTER_NAME,
      "--image",
      K3S_IMAGE,
      "--servers",
      "1",
      "--agents",
      "3",
      "--no-lb",
      "--kubeconfig-update-default=false",
      "--kubeconfig-switch-context=false",
      "--k3s-node-label",
      "hive.nook.sh/storage=local@server:0",
      "--k3s-node-label",
      "nook.nokey.sh/arc-build=true@agent:0,1,2",
      "--k3s-arg",
      "--service-cidr=10.96.0.0/12@server:0",
      "--k3s-arg",
      "--cluster-dns=10.96.0.10@server:0",
      "--k3s-arg",
      "--disable=traefik@server:0",
      "--k3s-arg",
      "--disable=servicelb@server:0",
      "--k3s-arg",
      "--disable=metrics-server@server:0",
      "--k3s-arg",
      "--disable=local-storage@server:0",
      "--wait",
      "--timeout",
      "180s",
    ],
    streamOutput: true,
  });
}

export function writeKubeconfig(kubeconfigPath: string): void {
  const outcome = runCommand({
    label: "read isolated k3d kubeconfig",
    command: [K3D_BINARY, "kubeconfig", "get", CLUSTER_NAME],
  });
  writeFileSync(kubeconfigPath, outcome.stdout, { mode: 0o600 });
}

export function prepareLocalStorage(): void {
  const requests: readonly CommandRequest[] = [
    {
      label: "prepare Zot local storage",
      command: [
        "docker",
        "exec",
        `k3d-${CLUSTER_NAME}-server-0`,
        "sh",
        "-euc",
        "mkdir -p /var/lib/hive/zot && chown 10001:10001 /var/lib/hive/zot",
      ],
    },
    ...[0, 1, 2].map((index): CommandRequest => ({
      label: `prepare BuildKit local storage on agent ${index}`,
      command: [
        "docker",
        "exec",
        `k3d-${CLUSTER_NAME}-agent-${index}`,
        "sh",
        "-euc",
        "mkdir -p /var/lib/nook-arc-buildkit/state && chown 1000:1000 /var/lib/nook-arc-buildkit/state",
      ],
    })),
  ];
  for (const request of requests) runCommand(request);
}

export function cleanup(request: CleanupRequest): void {
  let cleanupError = "";
  if (request.clusterCreated) {
    const outcome = runCommand({
      label: "delete exact k3d proof cluster",
      command: [K3D_BINARY, "cluster", "delete", CLUSTER_NAME],
      allowFailure: true,
      streamOutput: true,
    });
    if (outcome.exitCode !== 0) cleanupError = outcome.stderr;
  }
  if (request.temporaryDirectory.length > 0) {
    rmSync(request.temporaryDirectory, { recursive: true, force: true });
  }
  if (request.clusterCreated && clusterExists()) {
    cleanupError = `${cleanupError}\ncluster ${CLUSTER_NAME} still exists`;
  }
  if (cleanupError.trim().length > 0) {
    throw new Error(`k3d proof cleanup failed: ${cleanupError.trim()}`);
  }
}
