import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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

  index(fragment: string): number {
    const position = this.input.source.indexOf(fragment);
    if (position < 0)
      throw new Error(
        `${this.input.label} is missing required contract: ${fragment}`,
      );
    return position;
  }
}

function contract(input: ContractSource): TextContract {
  return new TextContract(input);
}

const namespaces = contract({
  label: "ARC namespaces",
  source: await read("infra/k0s/manifests/namespaces.yaml"),
});
const runners = contract({
  label: "ARC runner scale set",
  source: await read("infra/k0s/manifests/arc/runner-scale-set-values.yaml"),
});
const controller = contract({
  label: "ARC controller",
  source: await read("infra/k0s/manifests/arc/controller-values.yaml"),
});
const network = contract({
  label: "ARC network policy",
  source: await read("infra/k0s/manifests/arc/network-policy.yaml"),
});
const kataValues = contract({
  label: "Kata values",
  source: await read("infra/k0s/manifests/kata/values.yaml"),
});
const tasks = contract({
  label: "ARC tasks",
  source: await read("infra/tasks/arc.yml"),
});
const workerTasks = contract({
  label: "k0s worker tasks",
  source: await read("infra/tasks/k0s-workers.yml"),
});
const remoteWorkflow = contract({
  label: "remote workflow",
  source: await read(".github/workflows/remote.yml"),
});
const hiveNeo4jWait = contract({
  label: "Hive Neo4j readiness",
  source: await read(".github/scripts/wait-hive-neo4j.sh"),
});
const dockerSetup = contract({
  label: "Docker setup action",
  source: await read(".github/actions/nook-docker-setup/action.yml"),
});
const remoteBatch = contract({
  label: "remote task batch",
  source: await read(".github/scripts/remote-task-batch.sh"),
});
const runtimeSmoke = contract({
  label: "ARC runtime smoke",
  source: await read(".github/scripts/arc-runtime-smoke.sh"),
});
const registryTasks = contract({
  label: "registry tasks",
  source: await read("infra/tasks/registry.yml"),
});
const platformTasks = contract({
  label: "platform tasks",
  source: await read("nook-app/nook-platform/Taskfile.yml"),
});
const buildkitEntrypoint = contract({
  label: "ARC BuildKit entrypoint",
  source: await read("infra/k0s/images/arc-buildkit/entrypoint"),
});
const buildkitPrepare = contract({
  label: "ARC BuildKit preparation",
  source: await read("infra/k0s/images/arc-buildkit/prepare-state"),
});
const buildkitCloner = contract({
  label: "ARC BuildKit cloner",
  source: await read("infra/k0s/scripts/arc-buildkit-cloner"),
});
const hiveWorkflow = contract({
  label: "Hive workflow",
  source: await read(".github/workflows/hive.yml"),
});
const mainWorkflow = contract({
  label: "Main workflow",
  source: await read(".github/workflows/main.yml"),
});
const hiveTasks = contract({
  label: "Hive tasks",
  source: await read("agentic-ai/minds/hive/Taskfile.yml"),
});

namespaces.requireAll([
  "name: arc-systems",
  "name: arc-runners",
  "nook.nokey.sh/role: arc-runners",
]);
runners.requireAll([
  "runnerScaleSetName: nook-k0s",
  "minRunners: 0",
  "maxRunners: 10",
  "requests:\n            cpu: 500m\n            memory: 3Gi",
  "requests:\n            cpu: 250m\n            memory: 1Gi\n            ephemeral-storage: 1Gi",
  "requests:\n            cpu: 250m\n            memory: 1Gi",
  'limits:\n            cpu: "2"\n            memory: 2Gi',
  "runAsNonRoot: true",
  "runtimeClassName: kata-qemu-runtime-rs",
  'nodeSelector:\n      nook.nokey.sh/arc-build: "true"',
  "--oci-worker-snapshotter",
  "- overlayfs",
  "localhost/nook-arc-buildkit:0.32.2-ext4-reflink-v1",
  "imagePullPolicy: Never",
  'limits:\n            cpu: "6"\n            memory: 8Gi',
  '- "24000"',
  'value: "34359738368"',
  "path: /var/lib/nook-arc-buildkit/pool/requests",
  "path: /var/lib/nook-arc-buildkit/pool/jobs",
  "subPathExpr: $(POD_UID)",
  "name: prepare-buildkit-state",
  "name: buildkit",
  "restartPolicy: Always",
  "privileged: true",
  "NOOK_BUILDKIT_ADDR",
  "tcp://127.0.0.1:1234",
  "name: container-runtime",
  "name: prepare-container-runtime-state",
  "quay.io/podman/stable:v5.8.4@sha256:8923deffca4caa8338b5dd4f553a86736f2aab424a4743827fccce632fecd750",
  "tcp://127.0.0.1:2375",
  "truncate -s 24G",
  "mkfs.ext4 -F -m 0",
  "mount -t ext4 -o noatime",
  "/dev/loop1",
  "--storage-driver overlay",
  "mountPath: /var/lib/nook-container-runtime-backing",
  "- /usr/bin/podman\n              - --url\n              - tcp://127.0.0.1:2375\n              - info",
  "NOOK_CONTAINER_RUNTIME",
  "sizeLimit: 24Gi",
  "mountPath: /home/runner/_work",
  "automountServiceAccountToken: false",
  "ghcr.io/actions/actions-runner:2.336.0@sha256:",
  "docker:29.1.3-cli@sha256:",
  "githubConfigSecret",
  "actions-runner:2.336.0@sha256:0cfdcc701ce933c6d243c6b0b2da767366dc9f2e99961d4c3754b0b78084cdda",
]);
const hostPathCount = runners.count.bind(runners);
hostPathCount({ fragment: "hostPath:", expected: 2 });
for (const prohibited of [
  "docker:dind",
  "dockerd",
  "docker.sock",
  "containerd.sock",
  "sysbox",
  "containermode:",
  "/dev/fuse",
]) {
  runners.forbid(prohibited);
}
kataValues.require("qemu-runtime-rs:\n    enabled: true");
kataValues.requireAll([
  "key: nook.nokey.sh/arc-build",
  "value: preparing",
]);
controller.requireAll([
  "updateStrategy: eventual",
  "nodeSelector:\n  nook.nokey.sh/node-role: control-storage",
]);
network.require("policyTypes:\n    - Ingress");
workerTasks.requireAll([
  "10.202.0.1",
  "10.202.0.2",
  "wg-quick@wg-nook.service",
  "hive.nook.sh/storage=local",
  "nook.nokey.sh/arc-build=preparing:NoSchedule",
  "k0s token create --role worker --expiry 15m",
  "sudo -n rm -f /etc/k0s/worker-token",
  "runtimeClassName: kata-qemu-runtime-rs",
  "task: arc:deploy",
]);

const renderedDirectory = mkdtempSync(join(tmpdir(), "nook-arc-hive-values-"));
try {
  const renderedPath = join(renderedDirectory, "values.yaml");
  const renderInput = {
    cmd: [
      resolve(root, "infra/k0s/scripts/arc-hive-values.rb"),
      resolve(root, "infra/k0s/manifests/arc/runner-scale-set-values.yaml"),
      renderedPath,
    ],
    stdout: "pipe" as const,
    stderr: "pipe" as const,
  };
  const rendered = Bun.spawnSync(renderInput);
  if (rendered.exitCode !== 0) {
    throw new Error(
      `Hive ARC values failed to render: ${rendered.stderr.toString()}`,
    );
  }
  interface HiveValues {
    runnerScaleSetName: string;
    minRunners: number;
    maxRunners: number;
    template: {
      spec: {
        runtimeClassName: string;
        nodeSelector: Record<string, string>;
        initContainers: Array<{
          name: string;
          image: string;
          restartPolicy?: string;
        }>;
        containers: Array<{
          name: string;
          env?: Array<{ name: string; value?: string }>;
        }>;
        volumes: Array<{ hostPath?: { path: string } }>;
      };
    };
  }
  const hiveValues = Bun.YAML.parse(
    await Bun.file(renderedPath).text(),
  ) as HiveValues;
  if (hiveValues.runnerScaleSetName !== "nook-k0s-hive")
    throw new Error("Hive must use its ARC scale set");
  if (hiveValues.minRunners !== 0 || hiveValues.maxRunners !== 10) {
    throw new Error("Hive ARC must scale from zero through ten fresh runners");
  }
  const hivePod = hiveValues.template.spec;
  if (hivePod.runtimeClassName !== "kata-qemu-runtime-rs")
    throw new Error("Hive ARC must use Kata QEMU");
  if (hivePod.nodeSelector["nook.nokey.sh/arc-build"] !== "true") {
    throw new Error("Hive ARC must run only on qualified build nodes");
  }
  const sidecars = new Map(
    hivePod.initContainers.map((item) => [item.name, item]),
  );
  if (sidecars.has("container-runtime")) {
    throw new Error("Hive ARC must not carry the general Podman runtime");
  }
  const hiveRunner = hivePod.containers.find((item) => item.name === "runner");
  if (
    hiveRunner?.env?.some((item) =>
      ["DOCKER_HOST", "NOOK_CONTAINER_RUNTIME"].includes(item.name),
    )
  ) {
    throw new Error("Hive ARC runner must not target the general Podman API");
  }
  for (const name of ["neo4j", "hive-test-runtime"]) {
    const sidecar = sidecars.get(name);
    if (sidecar?.restartPolicy !== "Always")
      throw new Error(`Hive ARC ${name} must be a native sidecar`);
  }
  if (
    !sidecars.get("neo4j")?.image.includes("neo4j:2026.06.0-community@sha256:")
  ) {
    throw new Error("Hive ARC Neo4j must be versioned and digest-pinned");
  }
  if (hivePod.volumes.filter((volume) => "hostPath" in volume).length !== 2) {
    throw new Error("Hive ARC must inherit only the two approved hostPaths");
  }
} finally {
  rmSync(renderedDirectory, { recursive: true, force: true });
}

tasks.requireAll([
  "ARC_HIVE_RUNNER_LABEL: nook-k0s-hive",
  "ARC_CHART_VERSION: 0.14.2",
  "helm upgrade --install",
  "ARC scale sets are dispatch-ready",
  "helm upgrade --install nook-k0s-hive",
  "unexpected ARC hostPath volumes",
  'ruby - "$runner_render" "$hive_render"',
  '"buildkit-requests" => ["prepare-buildkit-state"]',
  '"buildkit-jobs" => ["buildkit"]',
  'install -d -m 0700 "$pool_root"',
  "pool_size=768G",
  'btrfs quota enable "$pool_mount"',
  'btrfs filesystem resize max "$pool_mount"',
  'chmod 0600 "$pool_image"',
  'if ! sudo -n test -f "$pool_image"; then',
  'if ! sudo -n test -f "$seed_file"; then',
  'sudo -n mountpoint -q "$pool_mount"',
  '*" -id $sandbox_id "*',
  "stat -c '%F:%u:%g:%h:%s' -- \"$job_file\"",
  'test "$generation_size" -gt 128',
  "'^[0-9]+:[0-9]+:[0-9]+:[0-9]+$'",
  "actions/runs/$run_id/force-cancel",
  "runner_uid",
  "A session for this runner already exists.",
  "kubectl delete ephemeralrunner --namespace arc-runners",
  "sudo -n k0s kubeconfig admin",
  'tr -d "\\r\\n"',
  "Existing ARC repository credential retained; set ARC_GITHUB_TOKEN_FILE to rotate it",
  "ARC repository credential is not installed; set ARC_GITHUB_TOKEN_FILE to bootstrap it",
  'test -s "$token_file"',
  "gh workflow run remote.yml",
  "bash <<'BASH'\n        set -euo pipefail\n        smoke_task=",
  '--raw-field "tasks=$smoke_task"',
  "for _ in $(seq 1 500)",
  "did not complete within 25 minutes",
  "Successful smoke run did not report",
  'dispatch_nonce="$(openssl rand -hex 16)"',
  '--raw-field "dispatch_nonce=$dispatch_nonce"',
  "--json databaseId,displayTitle,headSha",
  ".displayTitle == $title and .headSha == $sha",
  "btrfs-progs e2fsprogs ruby util-linux",
  "mkfs.btrfs -q -f -L nook-arc-buildkit",
  'sudo -n mv "$pool_image_next" "$pool_image"',
  "Promoted successful ARC smoke state to the reusable seed",
  'mktemp "${TMPDIR:-/tmp}/nook-arc-smoke-{{.ARC_SMOKE_RUNNER_LABEL}}.XXXXXX"',
  'test "$state_lines" -ne 3',
  "*containerd-shim-kata-v2*",
  "/var/lib/k0s/kubelet/pods/$pod_uid",
  "runner_state_retained=1",
  "nook-arc-hive-test-runtime",
  "gh variable set NOOK_HIVE_RUNS_ON",
  "route_variable=NOOK_HIVE_RUNS_ON",
  "refusing stale promotion",
]);
tasks.forbidAll([
  "import yaml",
  "e2fsck",
  "gh auth token",
  "task remote TASK_NAME=preflight",
  "docker-in-docker",
]);
const stateCount = {
  fragment: 'state_file="{{.ARC_SMOKE_STATE_FILE}}"',
  expected: 2,
};
tasks.count(stateCount);

remoteWorkflow.requireAll([
  "(inputs.tasks || inputs.task) == 'preflight'",
  "(inputs.tasks || inputs.task) == 'arc:runtime'",
  "runs-on: ubuntu-latest",
  "run-name: Remote / ${{ inputs.tasks || inputs.task }} / ${{ inputs.dispatch_nonce || 'manual' }}",
  "vars.NOOK_HIVE_RUNS_ON || 'ubuntu-latest'",
  "HIVE_NEO4J_TEST_URI:",
  "--publish 127.0.0.1:7474:7474",
  "nook-hive-linux-amd64-v1:buildcache",
]);
mainWorkflow.forbid("runs-on: ubuntu-latest");
const mainCount = {
  fragment: "runs-on: ${{ vars.NOOK_RUNS_ON || 'ubuntu-latest' }}",
  expected: 8,
};
mainWorkflow.count(mainCount);
remoteBatch.require(
  'rust:ci) run_with_timeout "$timeout_minutes" env CI_ARTIFACT_DIR="$artifact_root/rust-ci" task ci:pr:rust',
);
remoteBatch.require("arc:runtime must be dispatched as a single ARC task.");
remoteBatch.require(
  'arc:runtime) run_with_timeout "$timeout_minutes" bash .github/scripts/arc-runtime-smoke.sh',
);
registryTasks.forbid('kubectl create namespace "$namespace" --dry-run=client');
dockerSetup.requireAll([
  "driver remote",
  "startsWith(runner.name, 'nook-k0s-')",
  "Verify ARC container runtime",
  "tcp://127.0.0.1:2375",
  "docker info >/dev/null",
]);
dockerSetup.forbid("docker-in-docker");
runtimeSmoke.requireAll([
  "NOOK_CONTAINER_RUNTIME",
  "tcp://127.0.0.1:2375",
  "docker buildx build --load",
  "docker info --format '{{.Driver}}'",
  'docker run --rm \\',
  '--volume "$shared_dir:/nook-output"',
  "ARC BuildKit-to-Podman runtime smoke passed",
]);
buildkitPrepare.require("printf '%s\\n' \"$pod_uid\"");
buildkitEntrypoint.require("NOOK_BUILDKIT_STATE_IMAGE_BYTES:-34359738368");
buildkitCloner.requireAll([
  'btrfs qgroup limit -e "$job_exclusive_limit" "$job_dir"',
  'if ! container_list="$(',
  "cp --reflink=always --sparse=auto",
  'test ! -e "$pod_root/$pod_uid" || continue',
  "SECONDS - last_prune >= 30",
  'retain_marker="$runtime_dir/$pod_uid.retain"',
  "retain_expiry > now && retain_expiry <= now + 1800",
  "k0s ctr --namespace k8s.io tasks list -q",
  "record_active_sandboxes",
  'test "$existing_sandbox_id" = "$sandbox_id" && return 0',
  "SECONDS - last_sandbox_refresh >= 1",
  'if ! record_sandbox_id "$pod_uid"; then',
  'if request_expired "$pod_uid" "$request"; then',
  'find "$request" -mmin +5',
  'test ! -e "$pod_root/$pod_uid" || return 1',
  'if ! container_list="$(\n    k0s ctr --namespace k8s.io containers list -q',
  'test ! -e "$request_dir/$pod_uid.request" || continue',
  "*containerd-shim-kata-v2*) continue 2",
  '*containerd-shim-kata-v2*" -id $sandbox_id "*',
  'labels.\\"io.kubernetes.pod.uid\\"==$pod_uid',
  ".seed-generation",
]);
buildkitCloner.forbid('retain_marker="$job_dir/.retain"');
if (
  buildkitCloner.index('if ! record_sandbox_id "$pod_uid"; then') >
  buildkitCloner.index('btrfs subvolume create "$job_dir"')
) {
  throw new Error(
    "sandbox identity must be recorded before job subvolume creation",
  );
}
platformTasks.require("--no-cache");
hiveWorkflow.requireAll([
  "runs-on: nook-k0s-hive",
  "vars.NOOK_HIVE_RUNS_ON == 'nook-k0s-hive'",
  "verify-hosted:",
  "Connect hosted BuildKit cache",
  "github.event.pull_request.head.repo.full_name != github.repository",
  "github.event.pull_request.user.login == 'dependabot[bot]'",
  "github.event.pull_request.user.login != 'dependabot[bot]'",
]);
hiveWorkflow.count({
  fragment: "github.event.pull_request.user.login != 'dependabot[bot]'",
  expected: 2,
});
hiveWorkflow.count({
  fragment: "github.event.pull_request.user.login == 'dependabot[bot]'",
  expected: 1,
});
const publishCount = { fragment: "Publish verified Hive cache", expected: 2 };
hiveWorkflow.count(publishCount);
const bunSetupCount = { fragment: "uses: oven-sh/setup-bun@v2", expected: 3 };
hiveWorkflow.count(bunSetupCount);
hiveNeo4jWait.require("http://127.0.0.1:7474/db/neo4j/tx/commit");
hiveTasks.require('"$HIVE_TASK_DIR/run-arc-tests.sh"');
runners.forbid("docker-in-docker");

enum RunnerPlacement {
  ArcGeneralMain = "arc-general-main",
  ArcGeneralPr = "arc-general-pr",
  ArcGeneralRemote = "arc-general-remote",
  ArcGeneralRustReusable = "arc-general-rust-reusable",
  ArcHive = "arc-hive",
  HostedAi = "hosted-ai",
  HostedControl = "hosted-control",
  HostedDeployment = "hosted-deployment",
  HostedRuntime = "hosted-runtime",
  HostedScheduled = "hosted-scheduled",
  HostedUntrusted = "hosted-untrusted",
  LegacyCleanup = "legacy-cleanup",
  Reusable = "reusable",
}

interface WorkflowJob {
  "runs-on"?: string;
  uses?: string;
}

interface WorkflowEventTrigger {
  branches?: string[];
  paths?: string[];
}

interface WorkflowManifest {
  on: Record<string, WorkflowEventTrigger>;
  jobs: Record<string, WorkflowJob>;
}

interface WorkflowPlacementContract {
  workflow: string;
  jobs: Record<string, RunnerPlacement>;
}

const hostedRunnerPlacements = new Set<RunnerPlacement>([
  RunnerPlacement.HostedAi,
  RunnerPlacement.HostedControl,
  RunnerPlacement.HostedDeployment,
  RunnerPlacement.HostedRuntime,
  RunnerPlacement.HostedScheduled,
  RunnerPlacement.HostedUntrusted,
]);

const runnerPlacementReasons: Record<RunnerPlacement, string> = {
  [RunnerPlacement.ArcGeneralMain]: "trusted Main job with a disposable general Kata guest",
  [RunnerPlacement.ArcGeneralPr]: "trusted same-repository PR native job with hosted fork fallback",
  [RunnerPlacement.ArcGeneralRemote]: "explicitly allowlisted focused task with hosted fallback",
  [RunnerPlacement.ArcGeneralRustReusable]: "trusted push or same-repository PR Rust job with hosted fallback",
  [RunnerPlacement.ArcHive]: "trusted Hive job with isolated native service sidecars",
  [RunnerPlacement.HostedAi]: "AI credentials and agent execution stay outside the private cluster",
  [RunnerPlacement.HostedControl]: "small orchestration work avoids consuming scarce ARC build capacity",
  [RunnerPlacement.HostedDeployment]: "release or deployment credentials stay outside the private cluster",
  [RunnerPlacement.HostedRuntime]: "non-Main browser, WASM, coverage, or arbitrary-ref runtime",
  [RunnerPlacement.HostedScheduled]: "scheduled maintenance avoids consuming ARC build capacity",
  [RunnerPlacement.HostedUntrusted]: "fork or Dependabot code must not enter the private cluster",
  [RunnerPlacement.LegacyCleanup]: "maintenance only for the separately registered persistent Docker pool",
  [RunnerPlacement.Reusable]: "caller-owned placement for a reusable workflow",
};

const workflowPlacementContracts: WorkflowPlacementContract[] = [
  { workflow: "agent-implement.yml", jobs: { "agent-implement": RunnerPlacement.HostedAi } },
  { workflow: "ci-agent-smoke.yml", jobs: { smoke: RunnerPlacement.HostedAi } },
  { workflow: "e2e-pr.yml", jobs: { e2e: RunnerPlacement.HostedRuntime } },
  {
    workflow: "hive.yml",
    jobs: {
      console: RunnerPlacement.HostedControl,
      verify: RunnerPlacement.ArcHive,
      "verify-hosted": RunnerPlacement.HostedRuntime,
      "verify-fork": RunnerPlacement.HostedUntrusted,
    },
  },
  {
    workflow: "linear-ui-demo.yml",
    jobs: {
      publish: RunnerPlacement.HostedDeployment,
      close: RunnerPlacement.HostedDeployment,
    },
  },
  { workflow: "main-build-stats.yml", jobs: { record: RunnerPlacement.HostedControl } },
  { workflow: "main-failure-handoff.yml", jobs: { record: RunnerPlacement.HostedControl } },
  {
    workflow: "main.yml",
    jobs: {
      "product-paths": RunnerPlacement.ArcGeneralMain,
      "rust-ecosystem": RunnerPlacement.Reusable,
      rust: RunnerPlacement.ArcGeneralMain,
      wasm: RunnerPlacement.ArcGeneralMain,
      web: RunnerPlacement.ArcGeneralMain,
      "web-e2e": RunnerPlacement.ArcGeneralMain,
      "extension-e2e": RunnerPlacement.ArcGeneralMain,
      "ui-demos": RunnerPlacement.ArcGeneralMain,
      deploy: RunnerPlacement.ArcGeneralMain,
    },
  },
  { workflow: "pr-coverage.yml", jobs: { coverage: RunnerPlacement.HostedRuntime } },
  { workflow: "pr-validation-handoff.yml", jobs: { promote: RunnerPlacement.HostedControl } },
  {
    workflow: "pr.yml",
    jobs: {
      "validation-request": RunnerPlacement.HostedControl,
      "rust-ecosystem": RunnerPlacement.Reusable,
      rust: RunnerPlacement.ArcGeneralPr,
      wasm: RunnerPlacement.HostedRuntime,
      "wasm-node-test": RunnerPlacement.HostedRuntime,
      verify: RunnerPlacement.HostedRuntime,
      "ui-demo": RunnerPlacement.HostedRuntime,
      preview: RunnerPlacement.HostedDeployment,
      coverage: RunnerPlacement.Reusable,
      "full-e2e": RunnerPlacement.HostedRuntime,
      "full-extension-e2e": RunnerPlacement.HostedRuntime,
    },
  },
  { workflow: "release.yml", jobs: { deploy: RunnerPlacement.HostedDeployment } },
  {
    workflow: "remote.yml",
    jobs: {
      batch: RunnerPlacement.ArcGeneralRemote,
      "rust-cache-promote": RunnerPlacement.HostedControl,
    },
  },
  { workflow: "repository-policy.yml", jobs: { verify: RunnerPlacement.HostedUntrusted } },
  { workflow: "runner-cleanup.yml", jobs: { "docker-prune": RunnerPlacement.LegacyCleanup } },
  {
    workflow: "rust-dependency-updates.yml",
    jobs: {
      audit: RunnerPlacement.HostedScheduled,
      update: RunnerPlacement.HostedAi,
    },
  },
  {
    workflow: "rust-ecosystem-checks.yml",
    jobs: {
      "dependency-policy": RunnerPlacement.ArcGeneralRustReusable,
      "deterministic-tests": RunnerPlacement.ArcGeneralRustReusable,
      "fuzz-smoke": RunnerPlacement.ArcGeneralRustReusable,
      kani: RunnerPlacement.ArcGeneralRustReusable,
      dylint: RunnerPlacement.ArcGeneralRustReusable,
    },
  },
  {
    workflow: "rust-ecosystem.yml",
    jobs: {
      "validation-request": RunnerPlacement.HostedControl,
      ecosystem: RunnerPlacement.Reusable,
    },
  },
  {
    workflow: "web-research.yml",
    jobs: { deploy: RunnerPlacement.HostedDeployment },
  },
];

function expectedRunner(placement: RunnerPlacement): string {
  if (hostedRunnerPlacements.has(placement)) return "ubuntu-latest";
  if (placement === RunnerPlacement.LegacyCleanup) return "nook";
  if (placement === RunnerPlacement.ArcHive) return "nook-k0s-hive";
  if (placement === RunnerPlacement.ArcGeneralMain) {
    return "${{ vars.NOOK_RUNS_ON || 'ubuntu-latest' }}";
  }
  if (placement === RunnerPlacement.ArcGeneralPr) {
    return "${{ github.event.pull_request.head.repo.full_name == github.repository && github.event.pull_request.user.login != 'dependabot[bot]' && (vars.NOOK_RUNS_ON || 'ubuntu-latest') || 'ubuntu-latest' }}";
  }
  if (placement === RunnerPlacement.ArcGeneralRemote) {
    return "${{ (inputs.tasks || inputs.task) == 'hive:verify' && (vars.NOOK_HIVE_RUNS_ON || 'ubuntu-latest') || (((inputs.tasks || inputs.task) == 'preflight' || (inputs.tasks || inputs.task) == 'rust:ci' || (inputs.tasks || inputs.task) == 'arc:runtime') && (vars.NOOK_RUNS_ON || 'ubuntu-latest') || 'ubuntu-latest') }}";
  }
  if (placement === RunnerPlacement.ArcGeneralRustReusable) {
    return "${{ (github.event_name == 'push' || (github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository && github.event.pull_request.user.login != 'dependabot[bot]')) && (vars.NOOK_RUNS_ON || 'ubuntu-latest') || 'ubuntu-latest' }}";
  }
  throw new Error(`Runner placement ${placement} does not own runs-on`);
}

async function validateWorkflowPlacement(
  input: WorkflowPlacementContract,
): Promise<void> {
  const relativePath = `.github/workflows/${input.workflow}`;
  const manifest = Bun.YAML.parse(await read(relativePath)) as WorkflowManifest;
  const actualJobs = Object.keys(manifest.jobs).sort();
  const classifiedJobs = Object.keys(input.jobs).sort();
  if (actualJobs.join("\n") !== classifiedJobs.join("\n")) {
    throw new Error(
      `${input.workflow} job inventory changed; actual=${actualJobs.join(",")} classified=${classifiedJobs.join(",")}`,
    );
  }

  if (Object.values(input.jobs).includes(RunnerPlacement.ArcGeneralMain)) {
    const eventNames = Object.keys(manifest.on).sort();
    const pushTrigger = manifest.on.push;
    const pushBranches = pushTrigger?.branches ?? [];
    const pushFields = pushTrigger ? Object.keys(pushTrigger) : [];
    const unsupportedPushFields = pushFields.filter(
      (field) => field !== "branches" && field !== "paths",
    );
    if (
      eventNames.join("\n") !== "push" ||
      pushBranches.join("\n") !== "main" ||
      unsupportedPushFields.length > 0
    ) {
      throw new Error(
        `${input.workflow} ARC Main jobs require an exclusive push trigger on the main branch`,
      );
    }
  }

  for (const jobName of actualJobs) {
    const job = manifest.jobs[jobName];
    const placement = input.jobs[jobName];
    if (!job || !placement) throw new Error(`${input.workflow}/${jobName} is unclassified`);
    if (placement === RunnerPlacement.Reusable) {
      if (!job.uses?.startsWith("./.github/workflows/")) {
        throw new Error(`${input.workflow}/${jobName} must call a local reusable workflow`);
      }
      continue;
    }
    const expected = expectedRunner(placement);
    if (job["runs-on"] !== expected) {
      throw new Error(
        `${input.workflow}/${jobName} must use ${expected}: ${runnerPlacementReasons[placement]}`,
      );
    }
  }
}

for (const placementContract of workflowPlacementContracts) {
  await validateWorkflowPlacement(placementContract);
}

const workflowDirectory = resolve(root, ".github/workflows");
const workflowFiles = [
  ...new Bun.Glob("*.{yml,yaml}").scanSync(workflowDirectory),
].sort();
const classifiedWorkflowFiles = workflowPlacementContracts
  .map((item) => item.workflow)
  .sort();
if (workflowFiles.join("\n") !== classifiedWorkflowFiles.join("\n")) {
  throw new Error(
    `Workflow inventory changed; actual=${workflowFiles.join(",")} classified=${classifiedWorkflowFiles.join(",")}`,
  );
}

console.log("ARC manifest contract passed");
