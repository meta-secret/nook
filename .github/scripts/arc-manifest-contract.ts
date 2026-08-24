import { resolve } from "node:path";

import { assertHiveRenderContract } from "./arc-hive-render-contract";

const root = resolve(import.meta.dir, "../..");

async function read(relative: string): Promise<string> {
  return Bun.file(resolve(root, relative)).text();
}

interface ContractSource {
  label: string;
  source: string;
}

class TextContract {
  constructor(private readonly input: ContractSource) {}

  require(fragment: string): void {
    if (!this.input.source.includes(fragment)) {
      throw new Error(
        `${this.input.label} is missing required contract: ${fragment}`,
      );
    }
  }

  requireAll(fragments: string[]): void {
    for (const fragment of fragments) this.require(fragment);
  }

  forbid(fragment: string): void {
    if (this.input.source.includes(fragment)) {
      throw new Error(
        `${this.input.label} contains prohibited contract: ${fragment}`,
      );
    }
  }

  forbidAll(fragments: string[]): void {
    for (const fragment of fragments) this.forbid(fragment);
  }

  count(input: { fragment: string; expected: number }): void {
    const actual = this.input.source.split(input.fragment).length - 1;
    if (actual !== input.expected) {
      throw new Error(
        `${this.input.label} expected ${input.expected} copies of ${input.fragment}, found ${actual}`,
      );
    }
  }
}

interface ResourceEnvelope {
  requests?: { cpu?: string; memory?: string };
  limits?: { cpu?: string; memory?: string };
}

interface ArcContainer {
  name: string;
  env?: Array<{ name: string; value?: string }>;
  resources?: ResourceEnvelope;
}

interface ArcVolume {
  name: string;
  hostPath?: { path: string };
}

interface ArcValues {
  runnerScaleSetName: string;
  minRunners: number;
  maxRunners: number;
  template: {
    spec: {
      runtimeClassName?: string;
      automountServiceAccountToken: boolean;
      initContainers: ArcContainer[];
      containers: ArcContainer[];
      volumes: ArcVolume[];
    };
  };
}

const runnersSource = await read(
  "infra/k0s/manifests/arc/runner-scale-set-values.yaml",
);
const runners = new TextContract({
  label: "ARC runner scale set",
  source: runnersSource,
});
const buildkit = new TextContract({
  label: "ARC persistent BuildKit",
  source: await read("infra/k0s/manifests/arc/buildkit.yaml"),
});
const network = new TextContract({
  label: "ARC network policy",
  source: await read("infra/k0s/manifests/arc/network-policy.yaml"),
});
const tasks = new TextContract({
  label: "ARC operations",
  source: await read("infra/tasks/arc.yml"),
});
const dockerSetup = new TextContract({
  label: "Docker setup action",
  source: await read(".github/actions/nook-docker-setup/action.yml"),
});
const runtimeSmoke = new TextContract({
  label: "ARC BuildKit smoke",
  source: await read(".github/scripts/arc-runtime-smoke.sh"),
});
const mainWorkflow = new TextContract({
  label: "Main workflow",
  source: await read(".github/workflows/main.yml"),
});
const remoteWorkflow = new TextContract({
  label: "Remote workflow",
  source: await read(".github/workflows/remote.yml"),
});
const workerTasks = new TextContract({
  label: "k0s worker tasks",
  source: await read("infra/tasks/k0s-workers.yml"),
});

const values = Bun.YAML.parse(runnersSource) as ArcValues;
if (
  values.runnerScaleSetName !== "nook-k0s" ||
  values.minRunners !== 0 ||
  values.maxRunners !== 25
) {
  throw new Error("general ARC must scale from zero through 25 runners");
}
const pod = values.template.spec;
if (pod.runtimeClassName !== undefined) {
  throw new Error("general ARC must use the default Kubernetes runtime");
}
if (pod.automountServiceAccountToken !== false) {
  throw new Error("ARC runners must not receive Kubernetes credentials");
}
if (pod.volumes.some((volume) => volume.hostPath !== undefined)) {
  throw new Error("ARC runners must not mount host paths");
}
if (
  pod.initContainers.length !== 1 ||
  pod.initContainers[0]?.name !== "install-docker-client"
) {
  throw new Error("ARC must carry only the daemon-free Docker client init");
}
const runner = pod.containers.find((container) => container.name === "runner");
const runnerEnvironment = new Map(
  runner?.env?.map((item) => [item.name, item.value]) ?? [],
);
if (
  runnerEnvironment.get("NOOK_BUILDKIT_ADDR") !==
  "tcp://nook-buildkit.arc-runners.svc.cluster.local:1234"
) {
  throw new Error("ARC runner must use its node-local BuildKit service");
}
if (
  runner?.resources?.limits?.cpu !== "4" ||
  runner.resources.limits.memory !== "6Gi"
) {
  throw new Error("ARC runner must retain its 4 CPU and 6 GiB envelope");
}

runners.requireAll([
  "maxSkew: 5",
  "whenUnsatisfiable: DoNotSchedule",
  "values: [primary]",
  "values: [secondary]",
  "values: [overflow]",
  "ghcr.io/actions/actions-runner:2.336.0@sha256:",
  "registry.dev.nokey.sh/library/docker:29.1.3-cli@sha256:",
]);
runners.forbidAll([
  "runtimeClassName:",
  "privileged: true",
  "podman",
  "docker:dind",
  "dockerd",
  "docker.sock",
  "containerd.sock",
  "DOCKER_HOST",
  "hostPath:",
]);

buildkit.requireAll([
  "name: nook-buildkit-local-retain",
  "volumeBindingMode: WaitForFirstConsumer",
  "internalTrafficPolicy: Local",
  "kind: StatefulSet",
  "replicas: 3",
  "requiredDuringSchedulingIgnoredDuringExecution:",
  "nook.nokey.sh/arc-build: \"true\"",
  "v0.32.2-rootless@sha256:60d1f642e29dc938bd6c109ba5500849fccf41921927c5339788b8227f57feb9",
  "--oci-worker-no-process-sandbox",
  "--oci-worker-gc-keepstorage",
  'cpu: "4"',
  "memory: 8Gi",
  "memory: 48Gi",
  "storage: 64Gi",
  "type: Unconfined",
  'mirrors = ["registry.dev.nokey.sh"]',
]);
buildkit.count({ fragment: "kind: PersistentVolume\n", expected: 3 });
buildkit.count({
  fragment: "local:\n    path: /var/lib/nook-arc-buildkit/state",
  expected: 3,
});
buildkit.forbidAll([
  "runtimeClassName:",
  "privileged: true",
  "docker.sock",
  "containerd.sock",
]);

network.requireAll([
  "name: arc-runner-default-deny-ingress",
  "name: arc-runner-to-buildkit",
  'values: ["arc-runner", "arc-hive-runner", "arc-buildkit-benchmark"]',
  "port: 1234",
]);
dockerSetup.requireAll([
  "driver remote",
  "node-local BuildKit shard",
  "tcp://nook-buildkit.arc-runners.svc.cluster.local:1234",
]);
dockerSetup.forbidAll([
  "Verify ARC container runtime",
  "tcp://127.0.0.1:2375",
  "docker info >/dev/null",
  "docker-in-docker",
]);
runtimeSmoke.requireAll([
  "NOOK_ARC_RUNNER",
  'type=local,dest=$shared_dir',
  "ARC node-local rootless BuildKit smoke passed",
]);
runtimeSmoke.forbidAll(["--load", "docker run", "docker info", "podman"]);

tasks.requireAll([
  "arc:buildkit:storage:prepare:",
  "install -d -o 1000 -g 1000 -m 0700",
  "infra/k0s/manifests/arc/buildkit.yaml",
  "rollout status statefulset/nook-buildkit",
  "one persistent rootless BuildKit shard per build node",
  "for scale_set in nook-k0s nook-k0s-hive",
  "helm uninstall nook-k0s-cache",
]);
mainWorkflow.forbid("NOOK_CACHE_RUNS_ON");
remoteWorkflow.forbidAll(["NOOK_CACHE_RUNS_ON", "nook-k0s-cache"]);
remoteWorkflow.require(
  "inputs.dispatch_nonce || 'default'",
  "remote dispatches must permit explicitly distinct concurrent cache proofs",
);
workerTasks.requireAll([
  "10.202.0.1",
  "10.202.0.2",
  "INFRA_WORKER_MESH_ADDRESS",
  "nook.nokey.sh/arc-build=preparing:NoSchedule",
]);

await assertHiveRenderContract({ root });
