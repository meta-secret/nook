import { resolve } from "node:path";
import { readdir } from "node:fs/promises";

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

interface WorkflowJob {
  if?: string;
  "runs-on"?: string;
  uses?: string;
}

interface WorkflowManifest {
  jobs?: Record<string, WorkflowJob>;
}

const runnersSource = await read(
  "infra/k0s/manifests/arc/runner-scale-set-values.yaml",
);
const runners = new TextContract({
  label: "ARC runner scale set",
  source: runnersSource,
});
const containerRunners = new TextContract({
  label: "ARC Kubernetes container scale set",
  source: await read(
    "infra/k0s/manifests/arc/container-runner-scale-set-values.yaml",
  ),
});
const containerHook = new TextContract({
  label: "ARC Kubernetes container hook",
  source: await read("infra/k0s/manifests/arc/container-hook.yaml"),
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
const prWorkflow = new TextContract({
  label: "PR workflow",
  source: await read(".github/workflows/pr.yml"),
});
const hiveWorkflow = new TextContract({
  label: "Hive workflow",
  source: await read(".github/workflows/hive.yml"),
});
const repositoryPolicyWorkflow = new TextContract({
  label: "repository policy workflow",
  source: await read(".github/workflows/repository-policy.yml"),
});
const webResearchWorkflow = new TextContract({
  label: "web research workflow",
  source: await read(".github/workflows/web-research.yml"),
});
const nodeSetup = new TextContract({
  label: "ARC shell Node setup",
  source: await read(".github/actions/nook-node-setup/action.yml"),
});
const webTasks = new TextContract({
  label: "web browser tasks",
  source: await read("nook-app/nook-web/Taskfile.yml"),
});
const webDockerTasks = new TextContract({
  label: "web Docker browser tasks",
  source: await read("nook-app/nook-web/docker/Taskfile.yml"),
});
const wasmCacheProofSource = await read(
  ".github/scripts/verify-wasm-gha-cache.sh",
);
const wasmCacheProof = new TextContract({
  label: "portable WASM cache proof",
  source: wasmCacheProofSource,
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
  values.maxRunners !== 35
) {
  throw new Error("general ARC must scale from zero through 35 runners");
}
const pod = values.template.spec;
if ("runtimeClassName" in pod) {
  throw new Error("general ARC must use the default Kubernetes runtime");
}
if (pod.automountServiceAccountToken !== false) {
  throw new Error("ARC runners must not receive Kubernetes credentials");
}
if (pod.volumes.some((volume) => "hostPath" in volume)) {
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
containerRunners.requireAll([
  "runnerScaleSetName: nook-k0s-container",
  "maxRunners: 20",
  "type: kubernetes-novolume",
  "automountServiceAccountToken: true",
  "ACTIONS_RUNNER_REQUIRE_JOB_CONTAINER",
  "ACTIONS_RUNNER_KUBERNETES_NAMESPACE",
  "value: arc-runners",
  "ACTIONS_RUNNER_CONTAINER_HOOK_TEMPLATE",
  "/etc/nook-arc-hook/content.yaml",
  "ghcr.io/actions/actions-runner:2.336.0@sha256:",
]);
containerRunners.forbidAll([
  "privileged: true",
  "docker:dind",
  "dockerd",
  "docker.sock",
  "podman",
  "hostPath:",
]);
containerHook.requireAll([
  "apiVersion: v1",
  "kind: PodTemplate",
  "name: nook-arc-container-hook",
  "automountServiceAccountToken: false",
  'name: "$job"',
  "nook.nokey.sh/arc-build: \"true\"",
  "values: [primary]",
  "values: [secondary]",
  "values: [overflow]",
  'cpu: "4"',
  "memory: 6Gi",
  "ephemeral-storage: 32Gi",
  'drop: ["ALL"]',
  "fsGroup: 1000",
  "fsGroupChangePolicy: OnRootMismatch",
  "name: fs-init",
  "ghcr.io/actions/actions-runner:2.336.0@sha256:",
  "mountPath: /mnt/externals",
  "mountPath: /mnt/work",
  "mountPath: /mnt/github",
  "chmod -R g+rwX /mnt/work/nook",
]);
containerHook.forbidAll([
  "privileged: true",
  "docker.sock",
  "containerd.sock",
  "hostPath:",
]);

buildkit.requireAll([
  "name: nook-buildkit-local-retain",
  "volumeBindingMode: WaitForFirstConsumer",
  "internalTrafficPolicy: Local",
  "kind: StatefulSet",
  "replicas: 4",
  "requiredDuringSchedulingIgnoredDuringExecution:",
  "nook.nokey.sh/arc-build: \"true\"",
  "v0.32.2-rootless@sha256:60d1f642e29dc938bd6c109ba5500849fccf41921927c5339788b8227f57feb9",
  "--oci-worker-gc-keepstorage",
  "--oci-worker-no-process-sandbox",
  'cpu: "4"',
  "memory: 8Gi",
  "memory: 48Gi",
  "storage: 64Gi",
  "type: Unconfined",
  'mirrors = ["registry.dev.nokey.sh"]',
]);
buildkit.count({ fragment: "kind: PersistentVolume\n", expected: 4 });
buildkit.count({
  fragment: "local:\n    path: /var/lib/nook-arc-buildkit/state",
  expected: 4,
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
dockerSetup.requireAll([
  "name: Login to Nook OCI registry",
  "name: Preload hosted BuildKit from Zot",
  'docker pull "${{ inputs.registry-host }}/moby/buildkit:buildx-stable-1"',
  "driver-opts: image=${{ inputs.registry-host }}/moby/buildkit:buildx-stable-1",
]);
runtimeSmoke.requireAll([
  "NOOK_ARC_RUNNER",
  'type=local,dest=$shared_dir',
  "ARC node-local rootless BuildKit smoke passed",
]);
runtimeSmoke.forbidAll(["--load", "docker run", "docker info", "podman"]);

tasks.requireAll([
  "arc:build-hosts:quarantine:",
  "arc:buildkit:storage:prepare:",
  "install -d -o 1000 -g 1000 -m 0700",
  "infra/k0s/manifests/arc/buildkit.yaml",
  "rollout status statefulset/nook-buildkit",
  "one persistent rootless BuildKit shard per build node",
  "for scale_set in nook-k0s nook-k0s-hive",
  "helm uninstall nook-k0s-cache",
  "arc-build-nodes",
  "expected_build_nodes",
  "usable_bytes=$((available_bytes + state_bytes + legacy_bytes))",
  'state_bytes="${state_bytes:-0}"',
  'test "$((available_bytes + state_bytes))" -ge 68719476736',
  "- task: arc:auth:sync",
  "nook.nokey.sh/buildkit-config-sha256",
  "disable --now nook-arc-buildkit-cloner.service",
  '"$legacy_image_next"',
  "/etc/sysctl.d/91-nook-buildkit-keyring.conf",
  'keyring_maxkeys=20000',
  'keyring_maxbytes=2000000',
  'sysctl -p "$keyring_config"',
  'cat /proc/sys/kernel/keys/maxkeys',
  'cat /proc/sys/kernel/keys/maxbytes',
  'nook.nokey.sh/arc-build=preparing:NoSchedule --overwrite',
  "ARC build node $node is quarantined for convergence",
  "- task: arc:build-hosts:quarantine\n      - task: arc:buildkit:storage:prepare",
  "container-runner-scale-set-values.yaml",
  "container-hook.yaml",
  "for scale_set in nook-k0s nook-k0s-hive nook-k0s-container",
]);
mainWorkflow.forbid("NOOK_CACHE_RUNS_ON");
mainWorkflow.forbid("    runs-on: ubuntu-latest");
mainWorkflow.requireAll([
  "wasm-cache-proof:",
  "name: Portable WASM cache publication proof",
  "Install Bun for registry cache audit",
  "NOOK_WASM_CACHE_PROMOTION_ENABLED: \"1\"",
  "NOOK_REGISTRY_USERNAME: ${{ secrets.NOOK_REGISTRY_USERNAME }}",
  "bash .github/scripts/verify-wasm-gha-cache.sh",
  "web-e2e:",
  "extension-e2e:",
  "ui-demos:",
  "deploy:",
  "Upload verified development deployment handoff",
  "main-web-deploy-${{ github.run_id }}",
  "runs-on: ${{ vars.NOOK_RUNS_ON || 'nook-k0s' }}",
  "runs-on: nook-k0s-container",
  "Publish exact-source browser job image",
  "task _ci:main:web:e2e-only",
  "task _extension:test:e2e",
  "task _web:test:ui-demo",
]);
mainWorkflow.forbid("Build sealed web image for development deploy");
prWorkflow.requireAll([
  "full-e2e-shard:",
  "name: Full browser e2e shard (${{ matrix.shard }}/2)",
  "fail-fast: false",
  "shard: [1, 2]",
  "NOOK_E2E_SHARD: ${{ matrix.shard }}/2",
  "full-e2e:",
  "name: Full browser e2e (main fix)",
  "needs: [full-e2e-shard, wasm]",
  "SHARD_RESULT: ${{ needs.full-e2e-shard.result }}",
  "Publish exact-source PR browser job image",
  "nook-pr-e2e:run-${{ github.run_id }}-${{ github.run_attempt }}",
  "runs-on: nook-k0s-container",
  "task _ci:main:web:e2e-only",
  "task _extension:test:e2e",
  "task _web:test:ui-demo",
]);
prWorkflow.forbid("    runs-on: ubuntu-latest");
nodeSetup.requireAll([
  "/home/runner/externals/node24/bin/node",
  'echo "$(dirname "$node_bin")" >> "$GITHUB_PATH"',
]);
prWorkflow.require("uses: ./.github/actions/nook-node-setup");
repositoryPolicyWorkflow.requireAll([
  "github.event.pull_request.head.repo.full_name == github.repository",
  "uses: ./.github/actions/nook-docker-setup",
  "run: task preflight:test",
]);
hiveWorkflow.requireAll([
  "Build Hive Control Center browser image",
  "nook-hive-console:run-${{ github.run_id }}-${{ github.run_attempt }}",
  "needs: console-image",
  "runs-on: nook-k0s-container",
  "console-untrusted:",
  "Validate untrusted Hive Control Center source",
  "task hive:console:verify",
  "without private credentials",
]);
hiveWorkflow.forbid("task hive:console:e2e:prepare");
webResearchWorkflow.requireAll([
  "Build research browser image",
  "nook-web-research:run-${{ github.run_id }}-${{ github.run_attempt }}",
  "needs: image",
  "runs-on: nook-k0s-container",
]);
webTasks.requireAll([
  "_web:test:e2e:run-groups:",
  'set -- "--shard=$NOOK_E2E_SHARD"',
  "PLAYWRIGHT_WORKERS=3 bun x playwright test --project=stable",
  "PLAYWRIGHT_WORKERS=2 bun x playwright test --project=unstable",
  "bun x playwright test --config playwright.isolation.config.ts",
]);
webDockerTasks.requireAll([
  "NOOK_E2E_SHARD: '{{.NOOK_E2E_SHARD}}'",
  "-e NOOK_E2E_SHARD",
]);
wasmCacheProof.requireAll([
  "Publish from the already-selected node-local rootless BuildKit shard",
  "repair solve never imports the ref it is replacing",
  'nook-rust-wasm-deps-input-v2:fingerprint-${deps_fingerprint}',
  "nook-rust-wasm-source-v2:buildcache,ignore-error=true",
  "compression=zstd,force-compression=true",
  'builder-wasm-deps-cache-proof.cache-to=type=registry,ref=${cache_ref}',
  "verify-registry-cache-blobs.ts",
]);
wasmCacheProof.forbidAll([
  "--driver docker-container",
  "docker buildx create",
  "docker buildx rm",
]);
const promotionSolve = wasmCacheProofSource.slice(
  wasmCacheProofSource.indexOf('if [ "${NOOK_WASM_CACHE_PROMOTION_ENABLED:-}" = "1" ]'),
  wasmCacheProofSource.indexOf('bun "$repo_root/.github/scripts/verify-registry-cache-blobs.ts"'),
);
if (promotionSolve.includes("cache-from=type=registry,ref=${cache_ref}")) {
  throw new Error("portable WASM cache promotion must not import its destination");
}
remoteWorkflow.forbidAll(["NOOK_CACHE_RUNS_ON", "nook-k0s-cache"]);
remoteWorkflow.requireAll([
  "Remote / browser image",
  "runs-on: nook-k0s-container",
  "Run repository invariant preflight",
  "run: task preflight",
  "task web:e2e:kubernetes-image",
  "Run selected task without a nested container runtime",
  "web:build) task _web:build",
  "task _web:test:e2e",
  "extension:e2e) task _extension:test:e2e",
  "check) task _check",
  "ci:pr) task _ci:pr",
  "ci:pr:e2e) task _ci:main",
  "inputs.tasks != '' && inputs.task != ''",
  "(inputs.tasks == '' || inputs.task == '')",
]);
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

const hostedTrustBoundary = new Set([
  "hive.yml#verify-fork",
  "hive.yml#console-untrusted",
  "web-research.yml#validate-untrusted",
]);
const workflowsDir = resolve(root, ".github/workflows");
const workflowFiles = (await readdir(workflowsDir))
  .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
  .sort();
const observedHostedExceptions = new Set<string>();

for (const workflowFile of workflowFiles) {
  const workflow = Bun.YAML.parse(
    await Bun.file(resolve(workflowsDir, workflowFile)).text(),
  ) as WorkflowManifest;
  for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
    if (job.uses) continue;
    const placement = job["runs-on"];
    if (!placement) {
      throw new Error(`${workflowFile}#${jobName} has no runner placement`);
    }
    const identity = `${workflowFile}#${jobName}`;
    if (placement === "ubuntu-latest") {
      if (!hostedTrustBoundary.has(identity)) {
        throw new Error(`${identity} routes trusted work to GitHub cloud`);
      }
      observedHostedExceptions.add(identity);
      const condition = job.if ?? "";
      if (!condition.includes("head.repo.full_name") || !condition.includes("dependabot[bot]")) {
        throw new Error(`${identity} must be restricted to forks and Dependabot`);
      }
      continue;
    }
    if (placement.includes("ubuntu-latest")) {
      if (!placement.includes("head.repo.full_name")) {
        throw new Error(`${identity} has an unguarded GitHub-hosted fallback`);
      }
      continue;
    }
    if (!placement.includes("nook-k0s") && !placement.includes("NOOK_RUNS_ON")) {
      throw new Error(`${identity} is not routed through an ARC scale set`);
    }
  }
}

for (const exception of hostedTrustBoundary) {
  if (!observedHostedExceptions.has(exception)) {
    throw new Error(`stale hosted runner exception: ${exception}`);
  }
}
