import { resolve } from "node:path";
import { readdir } from "node:fs/promises";

import { assertHiveRenderContract } from "./arc-hive-render-contract";
import { assertArcWorkerRestoreContract } from "./arc-worker-restore-contract";
import { assertDockerfileFrontendContract } from "./dockerfile-frontend-contract";
import { TextContract } from "./text-contract";

const root = resolve(import.meta.dir, "../..");

async function read(relative: string): Promise<string> {
  return Bun.file(resolve(root, relative)).text();
}

interface ResourceEnvelope {
  requests?: {
    cpu?: string;
    memory?: string;
    "ephemeral-storage"?: string;
  };
  limits?: {
    cpu?: string;
    memory?: string;
    "ephemeral-storage"?: string;
  };
}

type ArcEnvironmentVariable =
  | { name: string; value: string }
  | {
      name: string;
      valueFrom: { fieldRef: { fieldPath: string } };
    };

interface ArcContainer {
  name: string;
  env?: ArcEnvironmentVariable[];
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

interface ArcContainerHook {
  data: { "content.yaml": string };
}

interface ArcContainerPodTemplate {
  spec: { initContainers: ArcContainer[]; containers: ArcContainer[] };
}

class ArcPlacementScenario {
  constructor(
    readonly primaryOne: number,
    readonly primaryTwo: number,
    readonly secondary: number,
    readonly overflow: number,
  ) {}

  tierPreferenceScore(): number {
    return (
      (this.primaryOne + this.primaryTwo) * 100 +
      this.secondary * 50 +
      this.overflow
    );
  }

  primarySkew(): number {
    return Math.abs(this.primaryOne - this.primaryTwo);
  }
}

class ArcActivationScenario {
  constructor(
    readonly queuedRunners: number,
    readonly firstEligiblePrimaryNodes: number,
    readonly firstEligibleWeakerNodes: number,
  ) {}

  preservesPrimaryFirstEligibility(): boolean {
    return (
      this.queuedRunners > 0 &&
      this.firstEligiblePrimaryNodes === 2 &&
      this.firstEligibleWeakerNodes === 0
    );
  }
}

function assertCpuUnconstrained(container: ArcContainer, label: string): void {
  const resources = container.resources;
  if (!resources) {
    return;
  }
  const { limits = {}, requests = {} } = resources;
  if (
    Object.keys(requests).includes("cpu") ||
    Object.keys(limits).includes("cpu")
  ) {
    throw new Error(`${label} must not declare CPU requests or limits`);
  }
}

function assertNoResourceEnvelope(container: ArcContainer, label: string): void {
  if ("resources" in container) {
    throw new Error(`${label} must not declare resource requests or limits`);
  }
}

interface WorkflowJob {
  if?: string;
  "runs-on"?: string;
  steps?: Array<{ run?: string; uses?: string }>;
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
const containerRunnersSource = await read(
  "infra/k0s/manifests/arc/container-runner-scale-set-values.yaml",
);
const containerRunners = new TextContract({
  label: "ARC Kubernetes container scale set",
  source: containerRunnersSource,
});
const containerHookSource = await read(
  "infra/k0s/manifests/arc/container-hook.yaml",
);
const containerHook = new TextContract({
  label: "ARC Kubernetes container hook",
  source: containerHookSource,
});
const containerJobNodesSource = await read(
  "infra/k0s/config/arc-container-job-nodes",
);
const containerJobNodes = new TextContract({
  label: "ARC container-job node inventory",
  source: containerJobNodesSource,
});
const buildkitSource = await read("infra/k0s/manifests/arc/buildkit.yaml");
const buildkit = new TextContract({
  label: "ARC persistent BuildKit",
  source: buildkitSource,
});
const buildkitContainerStart = buildkitSource.indexOf("        - name: buildkitd");
const buildkitContainerEnd = buildkitSource.indexOf(
  "          volumeMounts:",
  buildkitContainerStart,
);
if (buildkitContainerStart < 0 || buildkitContainerEnd < 0) {
  throw new Error("ARC persistent BuildKit container envelope is missing");
}
const buildkitContainer = new TextContract({
  label: "ARC persistent BuildKit container",
  source: buildkitSource.slice(buildkitContainerStart, buildkitContainerEnd),
});
const network = new TextContract({
  label: "ARC network policy",
  source: await read("infra/k0s/manifests/arc/network-policy.yaml"),
});
const arcTasksSource = await read("infra/tasks/arc.yml");
const tasks = new TextContract({
  label: "ARC operations",
  source: arcTasksSource,
});
const registryTransport = new TextContract({
  label: "ARC standalone registry transport configuration",
  source: arcTasksSource.slice(
    arcTasksSource.indexOf("  arc:network:configure:"),
    arcTasksSource.indexOf("  arc:buildkit:storage:prepare:"),
  ),
});
registryTransport.requireAll([
  "for node in ovh-us bynull-servo; do",
  "ovh-us:debian@10.202.0.1|bynull-servo:bynull@10.202.0.3)",
  'test "$(hostname -s)" = "$expected_node"',
  "sudo -n modprobe tcp_bbr",
  "/etc/modules-load.d/nook-tcp-congestion-control.conf",
  "/etc/sysctl.d/99-nook-tcp-congestion-control.conf",
  '.Labels["io.kubernetes.pod.namespace"] == "arc-runners"',
  '.Labels["io.kubernetes.container.name"] == "buildkitd"',
  'test("^nook-buildkit-[0-9]+$")',
  'if test "${#buildkit_pids[@]}" != 1; then',
  "Expected exactly one running home BuildKit container",
  'sudo -n nsenter -t "${buildkit_pids[0]}" -n sysctl -w',
  'test "$(sudo -n nsenter -t "${buildkit_pids[0]}" -n',
  "unshare --net cat /proc/sys/net/ipv4/tcp_congestion_control",
]);
registryTransport.requireBefore({
  first: 'if test "${#buildkit_pids[@]}" != 1; then',
  second: 'sudo -n nsenter -t "${buildkit_pids[0]}" -n sysctl -w',
});
registryTransport.forbidAll(["nook-buildkit-0", "rollout restart", "uncordon"]);
tasks.forbid("- task: arc:network:configure");
new TextContract({
  label: "ARC TCP boot module",
  source: await read("infra/k0s/config/nook-tcp-congestion-control.conf"),
}).require("tcp_bbr\n");
new TextContract({
  label: "ARC TCP congestion policy",
  source: await read("infra/k0s/config/99-nook-tcp-congestion-control.conf"),
}).require("net.ipv4.tcp_congestion_control = bbr\n");
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
const prWorkflowSource = await read(".github/workflows/pr.yml");
const prWorkflow = new TextContract({
  label: "PR workflow",
  source: prWorkflowSource,
});
const authSensitiveJobStart = prWorkflowSource.indexOf(
  "  auth-sensitive-extension-e2e:",
);
const authSensitiveJobEnd = prWorkflowSource.indexOf(
  "  preview:",
  authSensitiveJobStart,
);
if (authSensitiveJobStart < 0 || authSensitiveJobEnd < 0) {
  throw new Error("PR authentication-sensitive extension e2e job is missing");
}
const authSensitiveJob = new TextContract({
  label: "PR authentication-sensitive extension e2e job",
  source: prWorkflowSource.slice(authSensitiveJobStart, authSensitiveJobEnd),
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
const extensionTasks = new TextContract({
  label: "extension browser tasks",
  source: await read("nook-app/nook-web/nook-web-extension/Taskfile.yml"),
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
for (const container of [...pod.initContainers, ...pod.containers]) {
  assertCpuUnconstrained(container, `general ARC ${container.name}`);
}
const dockerClientInit = pod.initContainers[0];
if (
  dockerClientInit?.resources?.requests?.memory !== "32Mi" ||
  dockerClientInit.resources.limits?.memory !== "256Mi"
) {
  throw new Error("general ARC Docker client init must retain its memory envelope");
}
const runner = pod.containers.find((container) => container.name === "runner");
if (!runner) {
  throw new Error("general ARC must retain its runner container");
}
const { env: runnerVariables = [] } = runner;
const runnerEnvironment = new Map(
  runnerVariables.flatMap((item) =>
    "value" in item ? [[item.name, item.value]] : [],
  ),
);
if (
  runnerEnvironment.get("NOOK_BUILDKIT_ADDR") !==
  "tcp://nook-buildkit.arc-runners.svc.cluster.local:1234"
) {
  throw new Error("ARC runner must use its node-local BuildKit service");
}
const kubernetesNodeEnvironment = runner.env?.find(
  (item) => item.name === "KUBERNETES_NODE_NAME",
);
if (
  !kubernetesNodeEnvironment ||
  !("valueFrom" in kubernetesNodeEnvironment) ||
  kubernetesNodeEnvironment.valueFrom.fieldRef.fieldPath !== "spec.nodeName"
) {
  throw new Error(
    "ARC runner must expose its Kubernetes worker through the Downward API",
  );
}
assertNoResourceEnvelope(runner, "general ARC runner");

const containerValues = Bun.YAML.parse(containerRunnersSource) as ArcValues;
const containerRunner = containerValues.template.spec.containers.find(
  (container) => container.name === "runner",
);
if (!containerRunner) {
  throw new Error("container ARC must retain its runner coordinator");
}
assertCpuUnconstrained(containerRunner, "container ARC runner coordinator");
assertNoResourceEnvelope(containerRunner, "container ARC runner coordinator");

const containerHookManifest = Bun.YAML.parse(
  containerHookSource,
) as ArcContainerHook;
const containerPodTemplate = Bun.YAML.parse(
  containerHookManifest.data["content.yaml"],
) as ArcContainerPodTemplate;
for (const container of [
  ...containerPodTemplate.spec.initContainers,
  ...containerPodTemplate.spec.containers,
]) {
  assertCpuUnconstrained(container, `ARC job Pod ${container.name}`);
}
const jobContainer = containerPodTemplate.spec.containers.find(
  (container) => container.name === "$job",
);
if (!jobContainer) {
  throw new Error("ARC container hook must retain its job container");
}
assertNoResourceEnvelope(jobContainer, "ARC job container");

runners.requireAll([
  "maxSkew: 2",
  "whenUnsatisfiable: ScheduleAnyway",
  "weight: 100",
  "weight: 50",
  "weight: 1",
  "values: [primary]",
  "values: [secondary]",
  "values: [overflow]",
  "ghcr.io/actions/actions-runner:2.336.0@sha256:",
  "registry.dev.nokey.sh/library/docker:29.1.3-cli@sha256:",
]);
runners.forbid("maxSkew: 5");
runners.forbid("whenUnsatisfiable: DoNotSchedule");
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
  "nook.nokey.sh/arc-container-job: \"true\"",
  "values: [primary]",
  "values: [secondary]",
  "values: [overflow]",
  "maxSkew: 2",
  "whenUnsatisfiable: ScheduleAnyway",
  "weight: 100",
  "weight: 50",
  "weight: 1",
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
  "maxSkew: 5",
  "whenUnsatisfiable: DoNotSchedule",
  "privileged: true",
  "docker.sock",
  "containerd.sock",
  "hostPath:",
]);
containerJobNodes.requireAll(["nook-rise-s-1", "nook-rise-s-2", "ovh-us"]);
containerJobNodes.forbid("bynull-servo");
if (containerJobNodesSource !== "nook-rise-s-1\nnook-rise-s-2\novh-us\n") {
  throw new Error(
    "ARC container-job node inventory must contain exactly the declared eligible nodes",
  );
}

// These scenarios compare the declared preferences; Kubernetes still combines
// them with its other scheduler scores and live node state.
const fiveJobPreference = new ArcPlacementScenario(2, 2, 1, 0);
const fiveJobPrimaryPile = new ArcPlacementScenario(4, 0, 1, 0);
if (
  fiveJobPreference.primarySkew() >= fiveJobPrimaryPile.primarySkew() ||
  fiveJobPreference.secondary >= fiveJobPreference.primaryOne ||
  fiveJobPreference.overflow >= fiveJobPreference.secondary
) {
  throw new Error(
    "ARC five-job intent must balance primary nodes while limiting weaker tiers",
  );
}

const primaryDominantBurst = new ArcPlacementScenario(9, 9, 5, 1);
const forcedEqualBurst = new ArcPlacementScenario(6, 6, 6, 6);
if (
  primaryDominantBurst.tierPreferenceScore() <=
    forcedEqualBurst.tierPreferenceScore() ||
  primaryDominantBurst.secondary >= primaryDominantBurst.primaryOne ||
  primaryDominantBurst.overflow >= primaryDominantBurst.secondary
) {
  throw new Error(
    "ARC 24-runner intent must prefer primary capacity over equal cross-tier load",
  );
}

for (const queuedRunners of [22, 24]) {
  const activation = new ArcActivationScenario(queuedRunners, 2, 0);
  if (!activation.preservesPrimaryFirstEligibility()) {
    throw new Error(
      `ARC ${queuedRunners}-runner activation must expose both primaries before weaker tiers`,
    );
  }
}

buildkit.requireAll([
  "name: nook-buildkit-local-retain",
  "volumeBindingMode: WaitForFirstConsumer",
  "internalTrafficPolicy: Local",
  "kind: StatefulSet",
  "replicas: 4",
  "requiredDuringSchedulingIgnoredDuringExecution:",
  "nook.nokey.sh/arc-build: \"true\"",
  "v0.32.2-rootless@sha256:60d1f642e29dc938bd6c109ba5500849fccf41921927c5339788b8227f57feb9",
  "--oci-worker-no-process-sandbox",
  'cpu: "4"',
  "memory: 8Gi",
  "storage: 128Gi",
  "type: Unconfined",
  "[worker.oci]",
  "gc = true",
  'reservedSpace = "8GB"',
  'maxUsedSpace = "112GB"',
  'minFreeSpace = "16GB"',
  'mirrors = ["registry.dev.nokey.sh"]',
]);
buildkit.forbidAll(["--oci-worker-gc", "--oci-worker-gc-keepstorage"]);
buildkit.count({ fragment: "storage: 128Gi", expected: 5 });
buildkit.count({ fragment: "kind: PersistentVolume\n", expected: 4 });
buildkit.count({
  fragment: "local:\n    path: /var/lib/nook-arc-buildkit/state",
  expected: 4,
});
buildkitContainer.requireAll([
  "resources:",
  "requests:",
  'cpu: "4"',
  "memory: 8Gi",
]);
buildkitContainer.forbid("limits:");
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
  "arc:container-hosts:reconcile:",
  "arc:buildkit:storage:prepare:",
  "install -d -o 1000 -g 1000 -m 0700",
  "infra/k0s/manifests/arc/buildkit.yaml",
  "rollout status statefulset/nook-buildkit",
  "one persistent rootless BuildKit shard per build node",
  "for scale_set in nook-k0s nook-k0s-hive",
  "helm uninstall nook-k0s-cache",
  "arc-build-nodes",
  "arc-container-job-nodes",
  "nook.nokey.sh/arc-container-job=true",
  "ARC container-job labels do not match the declared eligibility inventory",
  "expected_build_nodes",
  "usable_bytes=$((available_bytes + state_bytes + legacy_bytes))",
  'state_bytes="${state_bytes:-0}"',
  'test "$filesystem_bytes" -ge 137438953472',
  'if test "$usable_bytes" -lt 137438953472',
  'test "$((available_bytes + state_bytes))" -ge 137438953472',
  "- task: arc:auth:sync",
  "nook.nokey.sh/buildkit-config-sha256",
  "current_buildkit_storage",
  "--cascade=orphan --wait=true",
  "disable --now nook-arc-buildkit-cloner.service",
  '"$legacy_image_next"',
  "/etc/sysctl.d/91-nook-buildkit-keyring.conf",
  'keyring_maxkeys=20000',
  'keyring_maxbytes=2000000',
  'inotify_max_user_instances=8000',
  'inotify_max_user_watches=10485760',
  '"fs.inotify.max_user_instances=$inotify_max_user_instances"',
  '"fs.inotify.max_user_watches=$inotify_max_user_watches"',
  'sysctl -p "$keyring_config"',
  'cat /proc/sys/kernel/keys/maxkeys',
  'cat /proc/sys/kernel/keys/maxbytes',
  'cat /proc/sys/fs/inotify/max_user_instances',
  'cat /proc/sys/fs/inotify/max_user_watches',
  'nook.nokey.sh/arc-build=preparing:NoSchedule --overwrite',
  "ARC build node $node is quarantined for convergence",
  'quarantine_failed=0',
  'test "$quarantine_failed" = 0',
  "for tier in primary secondary overflow",
  "primary) expected_tier_count=2",
  'secondary|overflow) expected_tier_count=1',
  'kubectl taint node "${tier_nodes[@]}"',
  "ARC build tier $tier is active",
  "- task: arc:build-hosts:quarantine\n      - task: arc:container-hosts:reconcile\n      - task: arc:buildkit:storage:prepare",
  "container-runner-scale-set-values.yaml",
  "container-hook.yaml",
  "for scale_set in nook-k0s nook-k0s-hive nook-k0s-container",
]);
mainWorkflow.forbid("NOOK_CACHE_RUNS_ON");
mainWorkflow.forbid("    runs-on: ubuntu-latest");
mainWorkflow.requireAll([
  '- "!.vale.ini"',
  '- "!.vale/**"',
  "wasm-cache-publish:",
  "name: WASM cache publication",
  "needs: [wasm]",
  "cache_publication_outcome: ${{ steps.publish_wasm_cache.outcome }}",
  "continue-on-error: true",
  "CACHE_PUBLICATION_OUTCOME: ${{ needs.wasm.outputs.cache_publication_outcome }}",
  "WASM cache publication failed in the verified producer",
  "wasm-cache-proof:",
  "name: Portable WASM cache publication proof",
  "needs: [wasm-cache-publish]",
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
  "name: Verify web build",
  "needs: [web, web-e2e, wasm-cache-proof]",
  "task _ci:main:web:e2e-only",
  "task _extension:test:e2e",
  "task _web:test:ui-demo",
]);
mainWorkflow.forbid("Build sealed web image for development deploy");
prWorkflow.requireAll([
  "- .vale.ini",
  "- .vale/**",
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
  "auth-sensitive-e2e-required: ${{ steps.auth-sensitive-e2e-contract.outputs.required }}",
  "name: Detect authentication-sensitive browser changes",
  "steps.auth-sensitive-e2e-contract.outputs.required == 'true' &&\n          github.event.pull_request.head.repo.full_name == github.repository &&\n          github.event.pull_request.user.login != 'dependabot[bot]'",
  "nook-app/nook-web/nook-web-shared/src/extension/password-form*",
  "nook-app/nook-web/nook-web-extension/src/content/autofill.ts",
  "nook-app/nook-web/nook-web-extension/src/content/autofill/*",
  "nook-app/nook-web/nook-web-extension/e2e/mock-auth-provider-scenarios.ts",
  "nook-app/nook-web/nook-web-extension/e2e/mock-auth/src/pages/DetectionHiddenHeaderLogin.svelte",
  "nook-app/nook-web/nook-web-extension/e2e/mock-auth-pilot-coverage.spec.ts",
  "auth-sensitive-extension-e2e:",
  "name: Authentication-sensitive extension e2e",
  "needs: [validation-request, verify, wasm-node-test]",
  "E2E_SPEC: e2e/mock-auth-pilot-coverage.spec.ts",
  "AUTH_SENSITIVE_E2E_RESULT: ${{ needs.auth-sensitive-extension-e2e.result }}",
  "needs: [validation-request, rust, wasm, verify, wasm-node-test, ui-demo, auth-sensitive-extension-e2e]",
  "Authentication-sensitive extension e2e finished with $AUTH_SENSITIVE_E2E_RESULT",
  "task _extension:test:e2e:file",
]);
authSensitiveJob.requireAll([
  "needs.verify.outputs.auth-sensitive-e2e-required == 'true'",
  "github.event.pull_request.head.repo.full_name == github.repository",
  "github.event.pull_request.user.login != 'dependabot[bot]'",
  "runs-on: nook-k0s-container",
  "image: registry.dev.nokey.sh/nook/remote-buildcache/nook-pr-e2e:run-${{ github.run_id }}-${{ github.run_attempt }}",
  "run: task _extension:test:e2e:file",
  "E2E_SPEC: e2e/mock-auth-pilot-coverage.spec.ts",
]);
extensionTasks.requireAll([
  "_extension:test:e2e:file:",
  'test -n "${E2E_SPEC:-}"',
  'bash scripts/test-e2e.sh "$E2E_SPEC"',
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
  "- .vale.ini",
  "- .vale/**",
  ".vale.ini | .vale/*",
  "uses: vale-cli/vale-action@518a9136acc6e6668ce7c00d367051e0941e87ff",
  "version: 3.19.0",
  "files: '[]'",
  "sync: false",
  'find "$RUNNER_TOOL_CACHE/vale/3.19.0"',
  'vale_dir="$(dirname "$vale_bin")"',
  'PATH="$vale_dir:$PATH"',
  '"$(vale --version)"',
  '"vale version 3.19.0"',
]);
repositoryPolicyWorkflow.forbid('"$("$vale_bin" --version)"');
repositoryPolicyWorkflow.requireBefore({
  first: "name: Activate Vale 3.19.0",
  second: "run: task loom:cortex-audit",
});
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
  'nook-rust-wasm-deps-input-v3:fingerprint-${deps_fingerprint}',
  "nook-rust-wasm-source-v3:buildcache,ignore-error=true",
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
  "name: Report Kubernetes worker node",
  ': "${KUBERNETES_NODE_NAME:?KUBERNETES_NODE_NAME is required}"',
  "printf '::notice title=Kubernetes worker::%s\\n' \"$KUBERNETES_NODE_NAME\"",
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
  "uses: vale-cli/vale-action@518a9136acc6e6668ce7c00d367051e0941e87ff",
  "version: 3.19.0",
  "files: '[]'",
  "sync: false",
  'find "$RUNNER_TOOL_CACHE/vale/3.19.0"',
  'vale_dir="$(dirname "$vale_bin")"',
  'PATH="$vale_dir:$PATH"',
  '"$(vale --version)"',
  '"vale version 3.19.0"',
]);
remoteWorkflow.forbid('"$("$vale_bin" --version)"');
remoteWorkflow.requireBefore({
  first: "name: Report Kubernetes worker node",
  second: "uses: actions/checkout@v7",
});
remoteWorkflow.requireBefore({
  first: "name: Activate Vale 3.19.0",
  second: "name: Run task batch",
});
remoteWorkflow.require(
  "inputs.dispatch_nonce || 'default'",
  "remote dispatches must permit explicitly distinct concurrent cache proofs",
);
await assertArcWorkerRestoreContract({ root });
await assertDockerfileFrontendContract({ root });
await assertHiveRenderContract({ root });

const hostedUntrustedBoundary = new Set([
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
  const { jobs = {} } = workflow;
  for (const [jobName, job] of Object.entries(jobs)) {
    if (job.uses) continue;
    const placement = job["runs-on"];
    if (!placement) {
      throw new Error(`${workflowFile}#${jobName} has no runner placement`);
    }
    const identity = `${workflowFile}#${jobName}`;
    if (placement === "ubuntu-latest") {
      if (!hostedUntrustedBoundary.has(identity)) {
        throw new Error(`${identity} routes trusted work to GitHub cloud`);
      }
      observedHostedExceptions.add(identity);
      const { if: condition = "" } = job;
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

for (const exception of hostedUntrustedBoundary) {
  if (!observedHostedExceptions.has(exception)) {
    throw new Error(`stale hosted runner exception: ${exception}`);
  }
}
