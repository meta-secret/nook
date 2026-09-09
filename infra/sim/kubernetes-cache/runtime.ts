import { CommandOutputPolicy } from "./contracts";
import { accessSync, constants, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { err, ok, type Result } from "neverthrow";
import {
  CLUSTER_NAME,
  K3D_BINARY,
  K3S_IMAGE,
  CacheFailureKind,
  type CacheFailure,
  type CommandRequest,
  HostCommand,
} from "./contracts";

export class RuntimeRequireCommand {
  constructor(private readonly command: string) {}
  execute(): Result<void, CacheFailure> {
    const { PATH: executablePath = "" } = process.env;
    const candidates = this.command.includes("/")
      ? [this.command]
      : executablePath
          .split(delimiter)
          .filter((directory) => directory.length > 0)
          .map((directory) => join(directory, this.command));
    for (const candidate of candidates) {
      try {
        accessSync(candidate, constants.X_OK);
        return ok();
      } catch {
        /* A missing PATH entry is not itself a failed command admission. */
      }
    }
    return err({
      kind: CacheFailureKind.Command,
      message: `${this.command} is required`,
    });
  }
}
export class RuntimeWriteKubeconfig {
  constructor(private readonly path: string) {}
  execute(): Result<void, CacheFailure> {
    const outcome = new HostCommand({
      label: "read isolated k3d kubeconfig",
      command: [K3D_BINARY, "kubeconfig", "get", CLUSTER_NAME],
    }).run();
    if (outcome.isErr()) return err(outcome.error);
    try {
      writeFileSync(this.path, outcome.value.stdout, { mode: 0o600 });
      return ok();
    } catch {
      return err({
        kind: CacheFailureKind.Filesystem,
        message: "Unable to write isolated kubeconfig",
      });
    }
  }
}
export enum ClusterOwnership {
  Unowned = "unowned",
  Created = "created",
}
export enum ClusterPresence {
  Absent = "absent",
  Present = "present",
}
export type TemporaryWorkspace =
  | { kind: TemporaryWorkspaceKind.Absent }
  | { kind: TemporaryWorkspaceKind.Created; path: string };
export enum TemporaryWorkspaceKind {
  Absent = "absent",
  Created = "created",
}
export interface CleanupRequest {
  readonly workspace: TemporaryWorkspace;
  readonly cluster: ClusterOwnership;
}
export class RuntimeCleanup {
  constructor(private readonly request: CleanupRequest) {}
  execute(): Result<void, readonly CacheFailure[]> {
    const failures: CacheFailure[] = [];
    if (this.request.cluster === ClusterOwnership.Created) {
      const removed = new HostCommand({
        label: "delete exact k3d proof cluster",
        command: [K3D_BINARY, "cluster", "delete", CLUSTER_NAME],
        output: CommandOutputPolicy.Streamed,
      }).run();
      if (removed.isErr()) failures.push(removed.error);
    }
    if (this.request.workspace.kind === TemporaryWorkspaceKind.Created) {
      try {
        rmSync(this.request.workspace.path, { recursive: true, force: true });
      } catch {
        failures.push({
          kind: CacheFailureKind.Filesystem,
          message: "Unable to remove cache proof workspace",
        });
      }
    }
    if (this.request.cluster === ClusterOwnership.Created) {
      const present = new SimulationCluster().clusterExists();
      if (present.isErr()) failures.push(present.error);
      else if (present.value === ClusterPresence.Present)
        failures.push({
          kind: CacheFailureKind.Cleanup,
          message: `cluster ${CLUSTER_NAME} still exists`,
        });
    }
    return failures.length > 0 ? err(failures) : ok();
  }
}
export class SimulationCluster {
  constructor(private readonly name: string = CLUSTER_NAME) {}
  clusterExists(): Result<ClusterPresence, CacheFailure> {
    return new HostCommand({
      label: "list k3d clusters",
      command: [K3D_BINARY, "cluster", "list", "--no-headers"],
    })
      .run()
      .map((outcome) =>
        outcome.stdout
          .split("\n")
          .map((line) => {
            const [name = ""] = line.trim().split(/\s+/);
            return name;
          })
          .includes(this.name)
          ? ClusterPresence.Present
          : ClusterPresence.Absent,
      );
  }
  createCluster(): Result<void, CacheFailure> {
    return new HostCommand({
      label: "create pinned k3d cluster",
      command: [
        K3D_BINARY,
        "cluster",
        "create",
        this.name,
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
      output: CommandOutputPolicy.Streamed,
    })
      .run()
      .map(() => {});
  }
  prepareLocalStorage(): Result<void, CacheFailure> {
    const requests: readonly CommandRequest[] = [
      {
        label: "prepare Zot local storage",
        command: [
          "docker",
          "exec",
          `k3d-${this.name}-server-0`,
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
          `k3d-${this.name}-agent-${index}`,
          "sh",
          "-euc",
          "mkdir -p /var/lib/nook-arc-buildkit/state && chown 1000:1000 /var/lib/nook-arc-buildkit/state",
        ],
      })),
    ];
    for (const request of requests) {
      const outcome = new HostCommand(request).run();
      if (outcome.isErr()) return err(outcome.error);
    }
    return ok();
  }
}
