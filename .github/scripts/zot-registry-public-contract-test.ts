import { resolve } from "node:path";
import { err, ok, type Result } from "neverthrow";
import {
  OperationalContractSource,
  OperationalContractFailureKind,
  type OperationalContractFailure,
} from "./operational-contract";

class RegistryContractSource {
  constructor(private readonly request: string) {}
  async execute(): Promise<Result<string, OperationalContractFailure>> {
    const relative = this.request;

    return new OperationalContractSource(resolve(root, relative)).read();
  }
}

class RequiredRegistryFragment {
  constructor(
    private readonly request: {
      source: string;
      fragment: string;
      message: string;
    },
  ) {}
  execute(): Result<void, OperationalContractFailure> {
    const input = this.request;

    if (!input.source.includes(input.fragment)) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: input.message,
      });
    }
    return ok();
  }
}

class ForbiddenRegistryFragment {
  constructor(
    private readonly request: {
      source: string;
      fragment: string;
      message: string;
    },
  ) {}
  execute(): Result<void, OperationalContractFailure> {
    const input = this.request;

    if (input.source.includes(input.fragment)) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: input.message,
      });
    }
    return ok();
  }
}

class RegistryFragmentCount {
  constructor(
    private readonly request: {
      source: string;
      fragment: string;
      expected: number;
      message: string;
    },
  ) {}
  execute(): Result<void, OperationalContractFailure> {
    const input = this.request;

    const actual = input.source.split(input.fragment).length - 1;
    if (actual !== input.expected) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: `${input.message}: expected ${input.expected}, found ${actual}`,
      });
    }
    return ok();
  }
}

class RegistryFragmentOrder {
  constructor(
    private readonly request: {
      source: string;
      first: string;
      second: string;
      message: string;
    },
  ) {}
  execute(): Result<void, OperationalContractFailure> {
    const input = this.request;

    const first = input.source.indexOf(input.first);
    const second = input.source.indexOf(input.second);
    if (first < 0 || second < 0 || first >= second) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: input.message,
      });
    }
    return ok();
  }
}

interface ControllerQuarantineRequest {
  readonly taints: ArcTaint[];
  readonly owner: string;
}

class ControllerQuarantine {
  constructor(private readonly request: ControllerQuarantineRequest) {}
  execute(): QuarantineDisposition {
    const { taints, owner } = this.request;

    if (
      owner !== "" &&
      owner !== "registry-controller-owned-v1" &&
      owner !== "registry-controller-borrowed-v1"
    ) {
      return QuarantineDisposition.Reject;
    }
    const matching = taints.filter(
      (taint) => taint.key === "nook.nokey.sh/arc-build",
    );
    if (matching.length === 0) {
      return owner === "registry-controller-borrowed-v1"
        ? QuarantineDisposition.Reject
        : QuarantineDisposition.Owned;
    }
    if (
      matching.length === 1 &&
      matching[0]?.value === "preparing" &&
      matching[0]?.effect === "NoSchedule"
    ) {
      return owner === "registry-controller-owned-v1"
        ? QuarantineDisposition.Owned
        : QuarantineDisposition.Borrowed;
    }
    return QuarantineDisposition.Reject;
  }
}

enum QuarantineRelease {
  RemoveOwnedTaint,
  PreserveBorrowedTaint,
}

class ControllerQuarantineRelease {
  constructor(private readonly request: QuarantineDisposition) {}
  execute(): Result<QuarantineRelease, OperationalContractFailure> {
    const disposition = this.request;

    if (disposition === QuarantineDisposition.Reject) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "rejected quarantine has no release authority",
      });
    }
    return ok(
      disposition === QuarantineDisposition.Owned
        ? QuarantineRelease.RemoveOwnedTaint
        : QuarantineRelease.PreserveBorrowedTaint,
    );
  }
}

interface WorkerInvocationTransitionRequest {
  readonly previous: string;
  readonly current: string;
}

class WorkerInvocationTransition {
  constructor(private readonly request: WorkerInvocationTransitionRequest) {}
  execute(): boolean {
    const { previous, current } = this.request;

    return previous !== current;
  }
}

interface ResourceVersionGuardRequest {
  readonly expected: string;
  readonly observed: string;
}

class ResourceVersionGuard {
  constructor(private readonly request: ResourceVersionGuardRequest) {}
  execute(): boolean {
    const { expected, observed } = this.request;

    return expected === observed;
  }
}

type ArcTaint = { key: string; value: string; effect: string };
enum QuarantineDisposition {
  Owned = "owned",
  Borrowed = "borrowed",
  Reject = "reject",
}

const root = resolve(import.meta.dir, "../..");

class PublicRegistryContract {
  async execute(): Promise<Result<void, OperationalContractFailure>> {
    const registryTaskResult = await new RegistryContractSource(
      "infra/tasks/registry.yml",
    ).execute();
    if (registryTaskResult.isErr()) return err(registryTaskResult.error);
    const registryTask = registryTaskResult.value;
    const k0sTaskResult = await new RegistryContractSource(
      "infra/tasks/k0s.yml",
    ).execute();
    if (k0sTaskResult.isErr()) return err(k0sTaskResult.error);
    const k0sTask = k0sTaskResult.value;
    const workerTaskResult = await new RegistryContractSource(
      "infra/tasks/k0s-workers.yml",
    ).execute();
    if (workerTaskResult.isErr()) return err(workerTaskResult.error);
    const workerTask = workerTaskResult.value;
    const workerRestoreTaskResult = await new RegistryContractSource(
      "infra/tasks/k0s-worker-restore.yml",
    ).execute();
    if (workerRestoreTaskResult.isErr())
      return err(workerRestoreTaskResult.error);
    const workerRestoreTask = workerRestoreTaskResult.value;
    const workerTaskFamily = [workerTask, workerRestoreTask].join("\n");
    const workerMeshResult = await new RegistryContractSource(
      "infra/k0s/scripts/k0s-worker-mesh-reconcile",
    ).execute();
    if (workerMeshResult.isErr()) return err(workerMeshResult.error);
    const workerMesh = workerMeshResult.value;
    const completeDeployResult = await new RegistryContractSource(
      "infra/tasks/host-services.yml",
    ).execute();
    if (completeDeployResult.isErr()) return err(completeDeployResult.error);
    const completeDeploy = completeDeployResult.value;
    const controllerAuthReconcile = registryTask.slice(
      registryTask.indexOf("  registry:containerd-auth:reconcile:"),
      registryTask.indexOf("  registry:credential:sync:"),
    );
    if (!controllerAuthReconcile) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "controller registry-auth reconciliation task is missing",
      });
    }
    const zotResult = await new RegistryContractSource(
      "infra/k0s/manifests/registry/zot.yaml",
    ).execute();
    if (zotResult.isErr()) return err(zotResult.error);
    const zot = zotResult.value;
    const traefikResult = await new RegistryContractSource(
      "infra/traefik-dynamic.yaml",
    ).execute();
    if (traefikResult.isErr()) return err(traefikResult.error);
    const traefik = traefikResult.value;
    const composeResult = await new RegistryContractSource(
      "infra/compose.yaml",
    ).execute();
    if (composeResult.isErr()) return err(composeResult.error);
    const compose = composeResult.value;
    const hostsResult = await new RegistryContractSource(
      "infra/k0s/config/registry-hosts.toml",
    ).execute();
    if (hostsResult.isErr()) return err(hostsResult.error);
    const hosts = hostsResult.value;
    const criRegistryResult = await new RegistryContractSource(
      "infra/k0s/config/cri-registry.toml",
    ).execute();
    if (criRegistryResult.isErr()) return err(criRegistryResult.error);
    const criRegistry = criRegistryResult.value;
    const hiveResult = await new RegistryContractSource(
      "infra/tasks/hive.yml",
    ).execute();
    if (hiveResult.isErr()) return err(hiveResult.error);
    const hive = hiveResult.value;
    const sccacheResult = await new RegistryContractSource(
      "infra/tasks/sccache.yml",
    ).execute();
    if (sccacheResult.isErr()) return err(sccacheResult.error);
    const sccache = sccacheResult.value;
    const sccacheBucketEnsure = sccache.slice(
      sccache.indexOf("  sccache:bucket:ensure:"),
      sccache.indexOf("  sccache:check:"),
    );

    for (const fragment of [
      "registry.dev.nokey.sh",
      "nook-zot-htpasswd",
      "nook-zot-registry-loopback.service",
      "disable --now",
      "Host must not listen on :5000",
      "gh secret set NOOK_REGISTRY_PASSWORD",
      "remote_mirror_read",
      "/v2/moby/buildkit/manifests/buildx-stable-1",
      "kubectl.*port-forward.*nook-zot",
    ]) {
      const assertion = {
        source: registryTask,
        fragment,
        message: `missing registry contract: ${fragment}`,
      };
      const admission1 = new RequiredRegistryFragment(assertion).execute();
      if (admission1.isErr()) return err(admission1.error);
    }
    for (const fragment of [
      "grep -Eq \"^${username}\"':[$]2[ay][$]'",
      "grep -Eq \"^${remote_username}\"':[$]2[ay][$]'",
    ]) {
      const admission2 = new RequiredRegistryFragment({
        source: registryTask,
        fragment,
        message: `registry bcrypt guard must use literal-dollar classes: ${fragment}`,
      }).execute();
      if (admission2.isErr()) return err(admission2.error);
    }
    const admission3 = new ForbiddenRegistryFragment({
      source: registryTask,
      fragment: "':\\$2[ay]\\$'",
      message:
        "registry bcrypt guard must not rely on Task-sensitive dollar escapes",
    }).execute();
    if (admission3.isErr()) return err(admission3.error);
    const admission4 = new ForbiddenRegistryFragment({
      source: controllerAuthReconcile,
      fragment: "metadata.labels.nook\\.nokey\\.sh/arc-build}')\" != true",
      message:
        "controller auth cleanup must support an ARC-qualified controller",
    }).execute();
    if (admission4.isErr()) return err(admission4.error);
    const admission5 = new ForbiddenRegistryFragment({
      source: controllerAuthReconcile,
      fragment: "--overwrite",
      message: "controller quarantine must not overwrite concurrent ownership",
    }).execute();
    if (admission5.isErr()) return err(admission5.error);
    for (const fragment of [
      "quarantine_taint_owned=false",
      "registry-controller-owned-v1",
      "registry-controller-borrowed-v1",
      "Controller has a foreign containerd auth quarantine owner",
      "Controller has ambiguous ARC quarantine state",
      '{op: "test", path: "/metadata/resourceVersion", value: $resource_version}',
      '--type=json --patch "$quarantine_patch"',
      "Controller quarantine changed during atomic acquisition",
      '--type=json --patch "$release_patch"',
      "Controller quarantine changed during atomic release",
    ]) {
      const admission6 = new RequiredRegistryFragment({
        source: controllerAuthReconcile,
        fragment,
        message: `controller quarantine ownership is missing: ${fragment}`,
      }).execute();
      if (admission6.isErr()) return err(admission6.error);
    }
    for (const fragment of ["kubectl annotate", "kubectl taint"]) {
      const admission7 = new ForbiddenRegistryFragment({
        source: controllerAuthReconcile,
        fragment,
        message: `controller quarantine must use atomic Node patches, not ${fragment}`,
      }).execute();
      if (admission7.isErr()) return err(admission7.error);
    }
    const admission8 = new RegistryFragmentOrder({
      source: controllerAuthReconcile,
      first: '--type=json --patch "$quarantine_patch"',
      second: "actions.github.com/scale-set-name",
      message:
        "controller quarantine must block scheduling before the ARC drain",
    }).execute();
    if (admission8.isErr()) return err(admission8.error);
    const admission9 = new RegistryFragmentOrder({
      source: controllerAuthReconcile,
      first: "actions.github.com/scale-set-name",
      second: "sudo -n systemctl restart k0scontroller.service",
      message: "controller ARC drain must finish before restart",
    }).execute();
    if (admission9.isErr()) return err(admission9.error);
    const admission10 = new RegistryFragmentOrder({
      source: controllerAuthReconcile,
      first: 'sudo -n install -m 0600 "$marker_next" "$marker"',
      second: 'if test "$restart_required" = true; then',
      message:
        "owned controller quarantine must remain until cleanup is proven",
    }).execute();
    if (admission10.isErr()) return err(admission10.error);
    const admission11 = new RegistryFragmentCount({
      source: controllerAuthReconcile,
      fragment: "sudo -n systemctl restart k0scontroller.service",
      expected: 1,
      message: "controller auth cleanup must restart exactly once",
    }).execute();
    if (admission11.isErr()) return err(admission11.error);
    const admission12 = new RegistryFragmentCount({
      source: controllerAuthReconcile,
      fragment:
        '{op: "test", path: "/metadata/resourceVersion", value: $resource_version}',
      expected: 4,
      message:
        "every controller quarantine mutation must guard resourceVersion",
    }).execute();
    if (admission12.isErr()) return err(admission12.error);
    const admission13 = new RegistryFragmentCount({
      source: workerMesh,
      fragment: "sudo -n systemctl restart k0sworker.service",
      expected: 1,
      message: "worker auth cleanup must restart exactly once",
    }).execute();
    if (admission13.isErr()) return err(admission13.error);

    const controllerQuarantineFixtures = [
      {
        name: "ARC-qualified controller without a taint",
        arcBuildQualified: true,
        taints: [] as ArcTaint[],
        owner: "",
        expected: QuarantineDisposition.Owned,
      },
      {
        name: "interrupted owned quarantine before taint",
        arcBuildQualified: true,
        taints: [] as ArcTaint[],
        owner: "registry-controller-owned-v1",
        expected: QuarantineDisposition.Owned,
      },
      {
        name: "pre-existing exact quarantine",
        arcBuildQualified: true,
        taints: [
          {
            key: "nook.nokey.sh/arc-build",
            value: "preparing",
            effect: "NoSchedule",
          },
        ],
        owner: "",
        expected: QuarantineDisposition.Borrowed,
      },
      {
        name: "interrupted owned exact quarantine",
        arcBuildQualified: true,
        taints: [
          {
            key: "nook.nokey.sh/arc-build",
            value: "preparing",
            effect: "NoSchedule",
          },
        ],
        owner: "registry-controller-owned-v1",
        expected: QuarantineDisposition.Owned,
      },
      {
        name: "borrowed quarantine lost its taint",
        arcBuildQualified: true,
        taints: [] as ArcTaint[],
        owner: "registry-controller-borrowed-v1",
        expected: QuarantineDisposition.Reject,
      },
      {
        name: "conflicting quarantine",
        arcBuildQualified: true,
        taints: [
          {
            key: "nook.nokey.sh/arc-build",
            value: "other",
            effect: "NoSchedule",
          },
        ],
        owner: "",
        expected: QuarantineDisposition.Reject,
      },
      {
        name: "foreign quarantine owner",
        arcBuildQualified: true,
        taints: [] as ArcTaint[],
        owner: "foreign",
        expected: QuarantineDisposition.Reject,
      },
    ] as const;
    for (const fixture of controllerQuarantineFixtures) {
      if (!fixture.arcBuildQualified) {
        return err({
          kind: OperationalContractFailureKind.Requirement,
          message: `${fixture.name} must exercise an ARC-qualified controller`,
        });
      }
      if (
        new ControllerQuarantine({
          taints: [...fixture.taints],
          owner: fixture.owner,
        }).execute() !== fixture.expected
      ) {
        return err({
          kind: OperationalContractFailureKind.Requirement,
          message: `controller quarantine fixture failed: ${fixture.name}`,
        });
      }
    }

    for (const fixture of [
      {
        name: "owned release removes its taint",
        disposition: QuarantineDisposition.Owned,
        release: QuarantineRelease.RemoveOwnedTaint,
      },
      {
        name: "borrowed release preserves the pre-existing taint",
        disposition: QuarantineDisposition.Borrowed,
        release: QuarantineRelease.PreserveBorrowedTaint,
      },
    ] as const) {
      const release = new ControllerQuarantineRelease(
        fixture.disposition,
      ).execute();
      if (release.isErr()) return err(release.error);
      if (release.value !== fixture.release) {
        return err({
          kind: OperationalContractFailureKind.Requirement,
          message: `controller release fixture failed: ${fixture.name}`,
        });
      }
    }
    const previousWorkerInvocation = "0123456789abcdef0123456789abcdef";

    if (
      !new WorkerInvocationTransition({
        previous: previousWorkerInvocation,
        current: "11111111111111111111111111111111",
      }).execute()
    ) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "changed worker InvocationID fixture was rejected",
      });
    }
    if (
      new WorkerInvocationTransition({
        previous: previousWorkerInvocation,
        current: previousWorkerInvocation,
      }).execute()
    ) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "unchanged worker InvocationID fixture was accepted",
      });
    }

    for (const fixture of [
      {
        name: "acquisition resourceVersion conflict",
        expected: "41",
        observed: "42",
        accepted: false,
      },
      {
        name: "release resourceVersion race",
        expected: "51",
        observed: "52",
        accepted: false,
      },
      {
        name: "unchanged resourceVersion",
        expected: "61",
        observed: "61",
        accepted: true,
      },
    ] as const) {
      if (
        new ResourceVersionGuard({
          expected: fixture.expected,
          observed: fixture.observed,
        }).execute() !== fixture.accepted
      ) {
        return err({
          kind: OperationalContractFailureKind.Requirement,
          message: `resourceVersion fixture failed: ${fixture.name}`,
        });
      }
    }
    for (const fragment of [
      "kubectl port-forward --",
      "port-forward --address",
    ]) {
      const assertion = {
        source: registryTask,
        fragment,
        message: `prohibited registry path: ${fragment}`,
      };
      const admission14 = new ForbiddenRegistryFragment(assertion).execute();
      if (admission14.isErr()) return err(admission14.error);
    }
    for (const fragment of [
      "clusterIP: 10.96.90.10",
      '"htpasswd"',
      "nook-zot-htpasswd",
      '"urls": ["https://index.docker.io"]',
      '"onDemand": true',
      '"preserveDigest": true',
      '"anonymousPolicy": ["read"]',
      '"actions": ["read"]',
      '"nook-hive": {',
      '"users": ["__NOOK_REGISTRY_USERNAME__"]',
      "kind: Service",
      'requests:\n              cpu: "2"\n              memory: 4Gi',
      'limits:\n              cpu: "8"\n              memory: 12Gi',
    ]) {
      const assertion = {
        source: zot,
        fragment,
        message: `missing Zot contract: ${fragment}`,
      };
      const admission15 = new RequiredRegistryFragment(assertion).execute();
      if (admission15.isErr()) return err(admission15.error);
    }
    if (!/cidr:\s*10\.0\.0\.0\/8/.test(zot)) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "Zot ingress must retain the private-network CIDR",
      });
    }
    for (const fragment of [
      "Host(`registry.dev.nokey.sh`)",
      "Host(`sccache.dev.nokey.sh`)",
      "http://10.96.90.10:5000",
      "http://127.0.0.1:8333",
    ]) {
      const assertion = {
        source: traefik,
        fragment,
        message: `missing Traefik contract: ${fragment}`,
      };
      const admission16 = new RequiredRegistryFragment(assertion).execute();
      if (admission16.isErr()) return err(admission16.error);
    }
    for (const fragment of ["127.0.0.1:6379", "HostSNI("]) {
      const assertion = {
        source: traefik,
        fragment,
        message: `prohibited Traefik contract: ${fragment}`,
      };
      const admission17 = new ForbiddenRegistryFragment(assertion).execute();
      if (admission17.isErr()) return err(admission17.error);
    }
    for (const fragment of [
      "network_mode: host",
      "seaweedfs",
      "chrislusf/seaweedfs",
      "-s3.port=8333",
      "--entryPoints.websecure.transport.respondingTimeouts.readTimeout=15m",
    ]) {
      const assertion = {
        source: compose,
        fragment,
        message: `missing Compose contract: ${fragment}`,
      };
      const admission18 = new RequiredRegistryFragment(assertion).execute();
      if (admission18.isErr()) return err(admission18.error);
    }
    for (const fragment of ["\n  redis:", "443:443", "5000:5000", "6380"]) {
      const assertion = {
        source: compose,
        fragment,
        message: `prohibited Compose contract: ${fragment}`,
      };
      const admission19 = new ForbiddenRegistryFragment(assertion).execute();
      if (admission19.isErr()) return err(admission19.error);
    }
    const hostsAssertion = {
      source: hosts,
      fragment: 'server = "https://registry.dev.nokey.sh"',
      message: "containerd must use the authenticated public registry endpoint",
    };
    const admission20 = new RequiredRegistryFragment(hostsAssertion).execute();
    if (admission20.isErr()) return err(admission20.error);
    const admission21 = new RequiredRegistryFragment({
      source: criRegistry,
      fragment: 'config_path = "/etc/k0s/containerd.d/certs.d"',
      message: "containerd must load registry hosts through config_path",
    }).execute();
    if (admission21.isErr()) return err(admission21.error);
    for (const source of [
      registryTask,
      k0sTask,
      workerTaskFamily,
      workerMesh,
    ]) {
      const admission22 = new ForbiddenRegistryFragment({
        source,
        fragment: "registry.configs",
        message:
          "deprecated containerd registry.configs authentication is prohibited",
      }).execute();
      if (admission22.isErr()) return err(admission22.error);
      const admission23 = new RequiredRegistryFragment({
        source,
        fragment: "sudo -n rm -f /etc/k0s/containerd.d/registry-auth.toml",
        message:
          "every k0s convergence path must remove deprecated containerd authentication",
      }).execute();
      if (admission23.isErr()) return err(admission23.error);
    }
    for (const fragment of [
      "registry:containerd-auth:reconcile:",
      "/var/lib/k0s/nook-containerd-auth-clean-invocation",
      "--property=InvocationID --value",
      "actions.github.com/scale-set-name",
      "nook.nokey.sh/arc-build",
      "restart_required=true",
      "sudo -n systemctl restart k0scontroller.service",
      "k0s controller did not start a clean containerd invocation",
      "kubectl get --raw=/readyz",
      'kubectl wait "node/$controller_node" --for=condition=Ready --timeout=5m',
      'sudo -n test ! -e "$auth_file"',
      "- task: registry:containerd-auth:reconcile",
    ]) {
      const admission24 = new RequiredRegistryFragment({
        source: registryTask,
        fragment,
        message: `controller registry-auth reconciliation is missing: ${fragment}`,
      }).execute();
      if (admission24.isErr()) return err(admission24.error);
    }
    for (const source of [k0sTask, workerTaskFamily, workerMesh]) {
      const admission25 = new RequiredRegistryFragment({
        source,
        fragment: "/var/lib/k0s/nook-containerd-auth-clean-invocation",
        message: "k0s convergence must record the clean containerd invocation",
      }).execute();
      if (admission25.isErr()) return err(admission25.error);
      const admission26 = new RequiredRegistryFragment({
        source,
        fragment: "--property=InvocationID --value",
        message: "k0s convergence must bind cleanup to a systemd invocation",
      }).execute();
      if (admission26.isErr()) return err(admission26.error);
    }
    for (const fragment of [
      "inspect_worker_containerd_auth",
      "wait_for_arc_runners",
      "actions.github.com/scale-set-name",
      "sudo -n systemctl restart k0sworker.service",
      "sport = :10250",
      "k0s worker did not start a clean containerd invocation",
      'wait_for_node_ready "$node_name"',
      "Worker containerd auth state changed during reconciliation",
    ]) {
      const admission27 = new RequiredRegistryFragment({
        source: workerMesh,
        fragment,
        message: `fleet worker registry-auth reconciliation is missing: ${fragment}`,
      }).execute();
      if (admission27.isErr()) return err(admission27.error);
    }
    const completeInstall = completeDeploy.indexOf("      - task: k0s:install");
    const completeWorkers = completeDeploy.indexOf(
      "      - task: k0s:worker-mesh:reconcile",
    );
    const completeRegistry = completeDeploy.indexOf(
      "      - task: registry:deploy",
    );
    if (
      completeInstall < 0 ||
      completeWorkers <= completeInstall ||
      completeRegistry <= completeWorkers
    ) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message:
          "complete deploy must reconcile controller, then worker, then registry auth",
      });
    }
    for (const source of [hosts, hive]) {
      const assertion = {
        source,
        fragment: "127.0.0.1:5000",
        message: "loopback registry references are prohibited",
      };
      const admission28 = new ForbiddenRegistryFragment(assertion).execute();
      if (admission28.isErr()) return err(admission28.error);
    }
    const hiveAssertion = {
      source: hive,
      fragment: "registry.dev.nokey.sh/nook-hive",
      message: "Hive must publish through the public Zot endpoint",
    };
    const admission29 = new RequiredRegistryFragment(hiveAssertion).execute();
    if (admission29.isErr()) return err(admission29.error);
    const admission30 = new RequiredRegistryFragment({
      source: sccacheBucketEnsure,
      fragment: "docker.io/amazon/aws-cli:2.27.50@sha256:",
      message: "clean-host sccache bootstrap must not depend on Zot",
    }).execute();
    if (admission30.isErr()) return err(admission30.error);
    const admission31 = new ForbiddenRegistryFragment({
      source: sccacheBucketEnsure,
      fragment: "registry.dev.nokey.sh/amazon/aws-cli",
      message: "sccache bootstrap cannot use Zot before k0s deploys it",
    }).execute();
    if (admission31.isErr()) return err(admission31.error);

    console.log("Public Zot registry contract: ok");

    return ok();
  }
}
const outcome = await new PublicRegistryContract().execute();
if (outcome.isErr()) {
  console.error(outcome.error.message);
  process.exitCode = 1;
}
