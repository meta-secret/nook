import { resolve } from "node:path";

import { assertHiveRenderContract } from "./arc-hive-render-contract";

const root = resolve(import.meta.dir, "../..");

async function read(relative: string): Promise<string> {
  return Bun.file(resolve(root, relative)).text();
}

type ContractSource = { label: string; source: string };

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
const cacheRunners = contract({
  label: "ARC cache-primary runner scale set",
  source: await read(
    "infra/k0s/manifests/arc/runner-cache-primary-values.yaml",
  ),
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
const kataTasks = contract({
  label: "Kata tasks",
  source: await read("infra/tasks/kata.yml"),
});
const tasks = contract({
  label: "ARC tasks",
  source: [
    await read("infra/tasks/arc.yml"),
    await read("infra/tasks/arc-smoke.yml"),
  ].join("\n"),
});
const workerTasks = contract({
  label: "k0s worker tasks",
  source: await read("infra/tasks/k0s-workers.yml"),
});
const workerMesh = contract({
  label: "k0s worker mesh reconciler",
  source: await read("infra/k0s/scripts/k0s-worker-mesh-reconcile"),
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
  label: "registry tasks and manifests",
  source: `${await read("infra/tasks/registry.yml")}\n${await read("infra/k0s/manifests/registry/zot.yaml")}`,
});
const platformTasks = contract({
  label: "platform tasks",
  source: await read("nook-app/nook-platform/Taskfile.yml"),
});
const ciTasks = contract({
  label: "CI cache publication tasks",
  source: await read("nook-app/ci/Taskfile.yml"),
});
const buildkitEntrypoint = contract({
  label: "ARC BuildKit entrypoint",
  source: await read("infra/k0s/images/arc-buildkit/entrypoint"),
});
const buildkitDockerfile = contract({
  label: "ARC BuildKit image",
  source: await read("infra/k0s/images/arc-buildkit/Dockerfile"),
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
  "maxRunners: 25",
  'requests:\n            cpu: "1"\n            memory: 4Gi',
  "requests:\n            cpu: 250m\n            memory: 512Mi\n            ephemeral-storage: 1Gi",
  "requests:\n            cpu: 500m\n            memory: 1Gi",
  'limits:\n            cpu: "2"\n            memory: 2Gi',
  "runAsNonRoot: true",
  "listenerTemplate:\n  spec:\n    nodeSelector:\n      nook.nokey.sh/node-role: control-storage\n    tolerations:",
  "runtimeClassName: kata-qemu-runtime-rs",
  'nodeSelector:\n      nook.nokey.sh/arc-build: "true"',
  "preferredDuringSchedulingIgnoredDuringExecution:",
  "weight: 100",
  "values: [primary]",
  "weight: 50",
  "values: [secondary]",
  "weight: 1",
  "values: [overflow]",
  "maxSkew: 5",
  "whenUnsatisfiable: DoNotSchedule",
  "nodeAffinityPolicy: Honor",
  "nodeTaintsPolicy: Honor",
  "nook.nokey.sh/arc-spread-group: general",
  "--oci-worker-snapshotter",
  "- overlayfs",
  "localhost/nook-arc-buildkit:0.32.2-ext4-reflink-v1",
  "imagePullPolicy: Never",
  'limits:\n            cpu: "4"\n            memory: 10Gi',
  'limits:\n            cpu: "4"\n            memory: 2Gi',
  '- "36000"',
  'value: "51539607552"',
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
  "registry.dev.nokey.sh/library/docker:29.1.3-cli@sha256:",
  "githubConfigSecret",
  "actions-runner:2.336.0@sha256:0cfdcc701ce933c6d243c6b0b2da767366dc9f2e99961d4c3754b0b78084cdda",
]);
interface ResourceEnvelope {
  limits?: { cpu?: string; memory?: string };
}

interface ArcContainer {
  name: string;
  resources?: ResourceEnvelope;
}

interface ArcValues {
  listenerTemplate: { spec: { containers: ArcContainer[] } };
  template: {
    spec: { initContainers: ArcContainer[]; containers: ArcContainer[] };
  };
}

const generalValues = Bun.YAML.parse(
  await read("infra/k0s/manifests/arc/runner-scale-set-values.yaml"),
) as ArcValues;
const generalSidecars = new Map(
  generalValues.template.spec.initContainers.map((item) => [item.name, item]),
);
const generalContainers = new Map(
  generalValues.template.spec.containers.map((item) => [item.name, item]),
);
const requiredLimit = (input: {
  containers: Map<string, ArcContainer>;
  name: string;
  cpu: string;
  memory: string;
}): void => {
  const resources = input.containers.get(input.name)?.resources;
  if (
    resources?.limits?.cpu !== input.cpu ||
    resources.limits.memory !== input.memory
  ) {
    throw new Error(
      `ARC ${input.name} must retain ${input.cpu} CPU and ${input.memory}`,
    );
  }
};
requiredLimit({
  containers: generalSidecars,
  name: "buildkit",
  cpu: "4",
  memory: "10Gi",
});
requiredLimit({
  containers: generalSidecars,
  name: "container-runtime",
  cpu: "4",
  memory: "2Gi",
});
requiredLimit({
  containers: generalContainers,
  name: "runner",
  cpu: "2",
  memory: "2Gi",
});
requiredLimit({
  containers: new Map(
    generalValues.listenerTemplate.spec.containers.map((item) => [
      item.name,
      item,
    ]),
  ),
  name: "listener",
  cpu: "1",
  memory: "512Mi",
});
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
kataValues.requireAll(["key: nook.nokey.sh/arc-build", "value: preparing"]);
kataTasks.requireAll([
  "kubectl patch runtimeclass kata-qemu-runtime-rs --type=merge",
  '\"cpu\":\"250m\",\"memory\":\"1792Mi\"',
  "-o jsonpath='{.overhead.podFixed.memory}')\" = 1792Mi",
]);
controller.requireAll([
  "updateStrategy: eventual",
  "nodeSelector:\n  nook.nokey.sh/node-role: control-storage",
  "tolerations:\n  - key: nook.nokey.sh/arc-build",
  "value: preparing",
  "effect: NoSchedule",
  'limits:\n    cpu: "2"\n    memory: 1Gi',
]);
network.require("policyTypes:\n    - Ingress");
workerTasks.requireAll([
  "10.202.0.1",
  "INFRA_WORKER_MESH_ADDRESS",
  "legacy-%03d.conf",
  "persisted_matches",
  "refusing colliding partial legacy inventory",
  "assert_mesh_address_available",
  'persisted_public_key="$(sudo -n sed -n',
  'test "$persisted_public_key" != "$worker_public_key"',
  'test "$assigned_nodes" != "$worker_node_name"',
  "nook-k0s-mesh-endpoints",
  "wg-quick@wg-nook.service",
  "hive.nook.sh/storage=local",
  "nook.nokey.sh/arc-build=preparing:NoSchedule",
  "k0s token create --role worker --expiry 15m",
  "sudo -n rm -f /etc/k0s/worker-token",
  "runtimeClassName: kata-qemu-runtime-rs",
  "task: arc:deploy",
]);

await assertHiveRenderContract({ root });

tasks.requireAll([
  "ARC_HIVE_RUNNER_LABEL: nook-k0s-hive",
  "ARC_CHART_VERSION: 0.14.2",
  "helm upgrade --install",
  "ARC scale sets are dispatch-ready",
  "helm upgrade --install nook-k0s-hive",
  "unexpected ARC hostPath volumes",
  'ruby - "$runner_render" "$hive_render"',
  '"buildkit-requests" => ["prepare-buildkit-state", "request-buildkit-promotion"]',
  '"buildkit-jobs" => ["buildkit"]',
  'install -d -m 0700 "$pool_root"',
  'install -d -m 0700 "$pool_mount/requests"',
  'chmod 0700 "$pool_mount/requests"',
  "pool_size=768G",
  'btrfs quota enable "$pool_mount"',
  'btrfs filesystem resize max "$pool_mount"',
  'chmod 0600 "$pool_image"',
  'if ! sudo -n test -f "$pool_image"; then',
  'if ! sudo -n test -f "$seed_file"; then',
  'sudo -n mountpoint -q "$pool_mount"',
  '*" -id $sandbox_id "*',
  "stat -c '%F:%u:%g:%h:%s' -- \"$job_file\"",
  "actions/runs/$run_id/force-cancel",
  "runner_uid",
  "A session for this runner already exists.",
  "kubectl delete ephemeralrunner --namespace arc-runners",
  "sudo -n k0s kubeconfig admin",
  'tr -d "\\r\\n"',
  "ARC credential persisted under ~/.nook and synchronized to the encrypted k0s Secret",
  "ARC repository credential is not installed; set ARC_GITHUB_TOKEN_FILE to bootstrap it",
  'test -s "$token_file"',
  "gh workflow run remote.yml",
  "smoke_task='{{.ARC_SMOKE_TASK}}'",
  '--raw-field "tasks=$smoke_task"',
  "for _ in $(seq 1 500)",
  "did not complete within 25 minutes",
  "Successful smoke run did not report",
  'dispatch_nonce="$(openssl rand -hex 16)"',
  '--raw-field "dispatch_nonce=$dispatch_nonce"',
  "--json databaseId,displayTitle,headSha",
  ".displayTitle == $title and .headSha == $sha",
  "btrfs-progs curl e2fsprogs jq ruby util-linux",
  "mkfs.btrfs -q -f -L nook-arc-buildkit",
  'sudo -n mv "$pool_image_next" "$pool_image"',
  "Validated and discarded successful ARC smoke state",
  'btrfs subvolume delete "$request_lane"',
  'btrfs subvolume delete "$job_dir"',
  '"$intent_dir/$pod_uid.intent" "$intent_dir/$pod_uid.intent.next"',
  'mktemp "${TMPDIR:-/tmp}/nook-arc-smoke-{{.ARC_SMOKE_RUNNER_LABEL}}.XXXXXX"',
  'test "$state_lines" -ne 4',
  "*containerd-shim-kata-v2*",
  "/var/lib/k0s/kubelet/pods/$pod_uid",
  "runner_state_retained=1",
  'completed_sandbox="$(find_sandbox "$runner_uid")"',
  'test "$completed_sandbox_id" != "$runner_sandbox_id"',
  "cleanup_smoke()",
  "trap cleanup_smoke EXIT",
  "trap 'exit 130' INT",
  "trap 'exit 143' TERM",
  'test ! -f "$state_file"',
  "rm -f -- '/var/lib/nook-arc-buildkit/pool/runtime/$runner_uid.retain'",
  "nook-arc-hive-test-runtime",
  "gh variable set NOOK_HIVE_RUNS_ON",
  "gh variable set NOOK_CACHE_RUNS_ON",
  "route_variable=NOOK_HIVE_RUNS_ON",
  "route_variable=NOOK_CACHE_RUNS_ON",
  "ARC_SMOKE_RUNNER_LABEL: nook-k0s-cache",
  '--raw-field "runner_label=$smoke_runner_label"',
]);
runtimeSmoke.forbid(
  "Successful ARC smoke lost its current Kata sandbox before teardown tracking",
);
tasks.forbidAll([
  "import yaml",
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
  "vars.NOOK_CACHE_RUNS_ON || 'ubuntu-latest'",
  "REQUESTED_RUNNER_LABEL:",
  "nook-k0s-cache|nook-k0s-hive",
  "nook-k0s-cache:arc:runtime",
  "nook-k0s-hive:hive:verify",
  "HIVE_NEO4J_TEST_URI:",
  "--publish 127.0.0.1:7474:7474",
  "nook-hive-linux-amd64-v2:buildcache",
  "isolated-cache-write: ${{ (inputs.tasks || inputs.task) == 'hive:verify' && 'false' || 'true' }}",
]);
mainWorkflow.forbid("runs-on: ubuntu-latest");
const mainCount = {
  fragment: "runs-on: ${{ vars.NOOK_RUNS_ON || 'ubuntu-latest' }}",
  expected: 4,
};
mainWorkflow.count(mainCount);
mainWorkflow.count({
  fragment: "runs-on: ${{ vars.NOOK_CACHE_RUNS_ON || 'ubuntu-latest' }}",
  expected: 4,
});
mainWorkflow.count({ fragment: "if: success()", expected: 4 });
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
dockerSetup.requireAll([
  "ARC skips general exact-SHA registry export; Main and sccache remain reusable",
  'else\n            cache_write_enabled=1',
]);
dockerSetup.forbid("ARC publishes a minimal exact-SHA handoff");
dockerSetup.forbid("docker-in-docker");
runtimeSmoke.requireAll([
  "NOOK_CONTAINER_RUNTIME",
  "tcp://127.0.0.1:2375",
  "docker buildx build --load",
  "docker info --format '{{.Driver}}'",
  "docker run --rm \\",
  '--volume "$shared_dir:/nook-output"',
  "ARC BuildKit-to-Podman runtime smoke passed",
]);
buildkitPrepare.requireAll([
  "printf '%s\\n' \"$pod_uid\"",
  'create_file="$request_dir/.create-$pod_uid"',
  'create_temp="$request_dir/.creating-$pod_uid.tmp"',
  "trap 'rm -f -- \"$create_temp\"' EXIT",
  'while ! test -d "$request_lane"; do',
]);
buildkitPrepare.forbid('create_temp="$create_file.tmp"');
buildkitPrepare.forbid('mkdir -p "$request_lane"');
buildkitEntrypoint.require("NOOK_BUILDKIT_STATE_IMAGE_BYTES:-51539607552");
buildkitEntrypoint.require('"$actual_size" -lt "$expected_bytes"');
buildkitDockerfile.require("jq=1.8.1-r0");
buildkitCloner.requireAll([
  'btrfs qgroup limit -e "$job_exclusive_limit" "$job_dir"',
  'request_exclusive_limit="${NOOK_ARC_BUILDKIT_REQUEST_EXCLUSIVE_LIMIT:-1M}"',
  'btrfs subvolume create "$request_lane"',
  'btrfs qgroup limit -e "$request_exclusive_limit" "$request_lane"',
  "prepare_request_lanes",
  'if ! container_list="$(',
  "cp --reflink=always --sparse=auto",
  'test ! -e "$pod_root/$pod_uid" || continue',
  "prune_interval=30",
  'retain_marker="$runtime_dir/$pod_uid.retain"',
  "retain_expiry > now && retain_expiry <= now + 1800",
  "k0s ctr --namespace k8s.io tasks list -q",
  "record_active_sandboxes",
  'record_sandbox_id "$pod_uid"',
  'test "$existing_sandbox_id" = "$sandbox_id" && return 0',
  "SECONDS - last_sandbox_refresh >= 1",
  'if ! record_sandbox_id "$pod_uid"; then',
  'if request_expired "$pod_uid" "$request"; then',
  'find "$request" -mmin +5',
  "prune_orphan_request_lanes",
  'sandbox_marker="$runtime_dir/$pod_uid.sandbox"',
  'test ! -e "$jobs_dir/$pod_uid" || continue',
  'find "$request_lane" -mmin +5',
  'test ! -e "$pod_root/$pod_uid" || return 1',
  'if ! container_list="$(\n    k0s ctr --namespace k8s.io containers list -q',
  'test ! -e "$request_dir/$pod_uid/request" || continue',
  "*containerd-shim-kata-v2*) continue 2",
  '*containerd-shim-kata-v2*" -id $sandbox_id "*',
  'labels.\\"io.kubernetes.pod.uid\\"==$pod_uid',
  ".seed-generation",
  '"regular file:0:0:1"',
  "promotion_barrier_pending && return 0",
  "promotion_intents_pending",
  'intent_dir="$runtime_dir/intents"',
  'intent="$intent_dir/$pod_uid.intent"',
  'for candidate in "$request_dir"/*/candidate; do',
  'for request in "$request_dir"/*/request; do',
  'request_lane_valid "$request_lane"',
  "pod_name_for_uid() {",
  '.Labels["io.kubernetes.pod.name"] // empty',
  "pod_is_cache_primary_runner",
  'test "$trusted_pod_name" != "$pod_name"',
  'accepted_next="$intent_dir/$pod_uid.accepted.next"',
  'mv -T "$accepted_next" "$request_lane/accepted"',
  'ln "$intent_next" "$intent_dir/$pod_uid.intent"',
  'find "$intent" -mmin +1',
  'remove_untrusted_path "$request"',
  'seed_next="$pool_dir/seed/buildkit.ext4.next.$pod_uid"',
  'if test "$current_generation" != "$expected_generation"; then',
  'if ! cp --reflink=always --sparse=auto "$job_file" "$seed_next"; then',
  'success) promote_job_dir "$job_dir" || continue ;;',
  'remove_untrusted_path "$request_dir/$pod_uid/accepted"',
  "verify_promotion_candidates",
  'github_token_file="${NOOK_ARC_GITHUB_TOKEN_FILE:-/etc/nook/arc-cache-verifier-token}"',
  "curl --config - --fail --silent --show-error",
  "--connect-timeout 5 --max-time 10",
  "--retry 1 --retry-all-errors --retry-delay 1",
  'candidate_value="$(tr -d \'\\r\\n\' < "$candidate_claim")"',
  'any(.jobs[]?; .runner_name == $runner and .status == "in_progress" and .conclusion == null)',
  'conclusion="$(promotion_job_conclusion "$pod_uid" || true)"',
  "promotion_barrier_pending && prune_interval=5",
  "if (( SECONDS - last_prune >= prune_interval )); then",
  "prune_orphan_request_lanes\n    prune_stale_jobs",
]);
buildkitCloner.forbid('accepted_next="$request_lane/accepted.next"');
buildkitCloner.forbid('mv "$intent_next" "$intent_dir/$pod_uid.intent"');
buildkitCloner.forbid(".promote");
buildkitCloner.forbid('retain_marker="$job_dir/.retain"');
buildkitCloner.forbid('promote_job_dir "$job_dir" || true');
buildkitPrepare.require("deadline=$(($(date +%s) + 240))");
if (
  buildkitCloner.index('if ! record_sandbox_id "$pod_uid"; then') >
  buildkitCloner.index('btrfs subvolume create "$job_dir"')
) {
  throw new Error(
    "sandbox identity must be recorded before job subvolume creation",
  );
}
if (
  buildkitCloner.index('ln "$intent_next" "$intent_dir/$pod_uid.intent"') >
  buildkitCloner.index('mv -T "$accepted_next" "$request_lane/accepted"')
) {
  throw new Error("ARC promotion intent must persist before acceptance");
}
platformTasks.require("--no-cache");
hiveWorkflow.requireAll([
  "isolated-cache-write: ${{ github.event_name == 'pull_request' && 'true' || 'false' }}",
  "runs-on: nook-k0s-hive",
  "vars.NOOK_HIVE_RUNS_ON == 'nook-k0s-hive'",
  "verify-hosted:",
  "Connect hosted BuildKit cache",
  "github.event.pull_request.head.repo.full_name != github.repository",
  "github.event.pull_request.user.login == 'dependabot[bot]'",
  "github.event.pull_request.user.login != 'dependabot[bot]'",
  "task hive:cache:publish",
]);
ciTasks.requireAll([
  "ci:main:wasm-node-test:",
  "GHA_CACHE_WRITE_ENABLED= task ci:wasm:node-test",
  "GHA_CACHE_WRITE_ENABLED=1 task ci:wasm:node-test",
  "ci:arc:promote-buildkit-cache:",
  'if test "${NOOK_ARC_RUNNER:-}" = "1" &&',
  'test "${GITHUB_REF:-}" = "refs/heads/main" &&',
  "task: _ci:main:publish-cache",
  "CACHE_PUBLISH_TASK",
  "task: '{{.CACHE_PUBLISH_TASK}}'",
  'test "${GITHUB_EVENT_NAME:-}" = "push"',
  'signal_dir="${NOOK_ARC_CACHE_PROMOTION_DIR:?missing ARC cache promotion directory}"',
  "umask 027",
  'mv "$signal_dir/request.next" "$signal_dir/request"',
  "deadline=$(($(date +%s) + 70))",
  'test -f "$signal_dir/accepted" && exit 0',
]);
runtimeSmoke.forbid("task ci:arc:promote-buildkit-cache");
runners.requireAll([
  "fsGroup: 1001",
  "fsGroupChangePolicy: OnRootMismatch",
  "name: request-buildkit-promotion",
  "name: cache-promotion-signal",
  "NOOK_ARC_CACHE_PROMOTION_DIR",
  'candidate_file="$request_dir/candidate"',
  'host_accepted_file="$request_dir/accepted"',
  "subPathExpr: $(POD_UID)",
  '"regular file:1001:1001:640:1"',
  'mv "$candidate_next" "$candidate_file"',
  'while ! test -f "$host_accepted_file"; do',
  '"regular file:0:0:600:1"',
  "deadline=$(($(date +%s) + 60))",
  'printf \'%s\\n\' "$POD_UID" > "$accepted_file.next"',
  "while true; do sleep 1; done",
]);
runners.forbid("- name: GITHUB_TOKEN");
runners.forbid("https://api.github.com");
runners.forbid("minDomains:");
cacheRunners.requireAll([
  "runnerScaleSetName: nook-k0s-cache",
  "maxRunners: 2",
  'nook.nokey.sh/arc-cache-primary: "true"',
  "nook.nokey.sh/arc-spread-group: cache",
]);
cacheRunners.forbid("minDomains:");
tasks.requireAll([
  'credential_store="$credential_dir/arc-controller-token"',
  "ARC credential persisted under ~/.nook",
  'credential_store="$credential_dir/arc-cache-verifier-token"',
  "ARC_CACHE_VERIFIER_TOKEN_FILE",
  "/etc/nook/arc-cache-verifier-token",
  "actions/runs?per_page=1",
  "ReadOnlyPaths=-/etc/nook/arc-cache-verifier-token",
  "nook.nokey.sh/arc-cache-primary=true",
  "arc:build-host:resolve:",
  "arc:cache-primary:preserve:",
  "arc:cache-primary:ensure:",
  "arc:controller-build:prepare:",
  "arc:build-hosts:activate:",
  "nook.nokey.sh/node-role=control-storage",
  "nook.nokey.sh/arc-build=preparing:NoSchedule",
  "nook.nokey.sh/arc-tier=overflow",
  "nook.nokey.sh/arc-tier=primary --overwrite",
  "nook.nokey.sh/arc-build=preparing:NoSchedule- >/dev/null 2>&1 || true",
  "arc-cache-primary-ssh-target",
  "arc-build-ssh-targets",
  "ARC cache-primary node $node is unreachable",
  "Deferred offline non-primary ARC node",
  "nook.nokey.sh/arc-cache-verifier-owner=true",
  "may still hold the cache verifier credential",
  'mktemp "$target_file.next.XXXXXX"',
  'mktemp "$inventory_file.next.XXXXXX"',
  "synchronized only to the cache-primary node",
  "sudo -n rm -f /etc/nook/arc-cache-verifier-token",
  "Imported the pinned ARC BuildKit wrapper into every build node",
  '"nook.nokey.sh/ssh-target=$controller_ssh_user@$internal_ip"',
  "nook.nokey.sh/infra-remote-dir",
  "build_remote_dir",
  'printf "%s\\n" "$HOME/.local/share/nook-infra"',
]);
buildkitCloner.forbid('test -s "$github_token_file"\n\nvalid_uid');
tasks.require("ssh -n -o BatchMode=yes -o StrictHostKeyChecking=accept-new");
tasks.forbid(`ssh -n -o BatchMode=yes "$controller_target" 'bash -s'`);
tasks.forbid("$credential_temp.normalized");
tasks.forbid('primary_node="$(jq -r');
workerTasks.requireAll([
  "nook.nokey.sh/arc-cache-primary=true",
  '"nook.nokey.sh/ssh-target=$worker_ssh_user@$worker_mesh_address"',
  '"nook.nokey.sh/infra-remote-dir=$remote_dir"',
  "INFRA_WORKER_ENDPOINT_MODE",
  "INFRA_WORKER_ARC_TIER",
  'test "$worker_endpoint_mode" = roaming',
  "PersistentKeepalive = 25",
  "nook k0s mesh wireguard roaming",
  "wg syncconf wg-nook",
  'ip route replace "$worker_pod_cidr" dev wg-nook',
  'if test "$worker_endpoint_mode" = direct; then\n          configure_worker_firewall',
  "debian:13|ubuntu:26.04",
  '--kubelet-extra-args="--node-ip=$worker_mesh_address',
  '--arg address "$worker_mesh_address"',
  '--arg name "$worker_node_name" --arg address "$worker_mesh_address"',
  "Kubernetes node $worker_node_name belongs to another InternalIP",
  'WireGuard key already belongs to $(basename "$persisted_peer" .conf)',
  'live_fragment="$(mktemp)"',
  'delete rule inet bynull_filter " chain " handle " $NF',
  'sudo -n nft --file "$live_fragment"',
  'comment "nook k0s worker wireguard"',
  '/comment "nook k0s worker /',
  'grep -Ev \'^[[:space:]]*flush ruleset[[:space:]]*$\' "$config" > "$bootstrap"',
  '--labels="nook.nokey.sh/arc-build=true,nook.nokey.sh/node-role=compute,nook.nokey.sh/arc-tier=$worker_arc_tier"',
]);
workerTasks.forbid("sudo -n nft --file /etc/nftables.conf");
workerTasks.forbid("systemctl restart wg-quick@wg-nook.service");
workerTasks.forbid(
  '--labels="nook.nokey.sh/arc-build=true,nook.nokey.sh/arc-cache-primary=true,nook.nokey.sh/node-role=compute"',
);
workerMesh.requireAll([
  'if ! sudo -n test -s "$peer_inventory"; then',
  'if ! sudo -n test -s "$endpoint_inventory"; then',
]);
workerMesh.forbid('test "$inventory_count" != 0');
workerMesh.forbid('$0 ~ "ip saddr " controller_ip');
mainWorkflow.requireAll(["needs: [web]", "task ci:main:wasm-node-test"]);
mainWorkflow.forbid(
  '# The exporter commits only after the Node-test Docker stage succeeds.\n          GHA_CACHE_WRITE_ENABLED: "1"',
);
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
registryTasks.require('"readTimeout": "15m",\n        "writeTimeout": "15m"');
tasks.require('if test "$expanded_seed" != true; then');
tasks.require('seed_lock="$pool_mount/.seed.lock"');
tasks.require('sudo -n chown "$(id -u):$(id -g)" "$seed_lock"');
tasks.require('e2fsck -f -p "$loop_device"');
tasks.require("- task: arc:buildkit:image:sync\n      - task: arc:cache:pool:sync");
enum RunnerPlacement {
  ArcCacheMain = "arc-cache-main",
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

type WorkflowJob = { "runs-on"?: string; uses?: string };
type WorkflowEventTrigger = { branches?: string[]; paths?: string[] };

interface WorkflowManifest {
  on: Record<string, WorkflowEventTrigger>;
  jobs: Record<string, WorkflowJob>;
}

type Placement = { workflow: string; jobs: Record<string, RunnerPlacement> };

const hostedRunnerPlacements = new Set<RunnerPlacement>([
  RunnerPlacement.HostedAi,
  RunnerPlacement.HostedControl,
  RunnerPlacement.HostedDeployment,
  RunnerPlacement.HostedRuntime,
  RunnerPlacement.HostedScheduled,
  RunnerPlacement.HostedUntrusted,
]);

const workflowPlacementContracts: Placement[] = [
  {
    workflow: "agent-implement.yml",
    jobs: { "agent-implement": RunnerPlacement.HostedAi },
  },
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
  {
    workflow: "main-build-stats.yml",
    jobs: { record: RunnerPlacement.HostedControl },
  },
  {
    workflow: "main-failure-handoff.yml",
    jobs: { record: RunnerPlacement.HostedControl },
  },
  {
    workflow: "main.yml",
    jobs: {
      "product-paths": RunnerPlacement.ArcGeneralMain,
      "rust-ecosystem": RunnerPlacement.Reusable,
      rust: RunnerPlacement.ArcCacheMain,
      wasm: RunnerPlacement.ArcCacheMain,
      web: RunnerPlacement.ArcCacheMain,
      "web-e2e": RunnerPlacement.ArcGeneralMain,
      "extension-e2e": RunnerPlacement.ArcGeneralMain,
      "ui-demos": RunnerPlacement.ArcCacheMain,
      deploy: RunnerPlacement.ArcGeneralMain,
    },
  },
  {
    workflow: "pr-coverage.yml",
    jobs: { coverage: RunnerPlacement.HostedRuntime },
  },
  {
    workflow: "pr-validation-handoff.yml",
    jobs: { promote: RunnerPlacement.HostedControl },
  },
  {
    workflow: "pr.yml",
    jobs: {
      "validation-request": RunnerPlacement.HostedControl,
      "rust-ecosystem": RunnerPlacement.Reusable,
      rust: RunnerPlacement.ArcGeneralPr,
      wasm: RunnerPlacement.ArcGeneralPr,
      "wasm-node-test": RunnerPlacement.ArcGeneralPr,
      verify: RunnerPlacement.HostedRuntime,
      "ui-demo": RunnerPlacement.HostedRuntime,
      preview: RunnerPlacement.HostedDeployment,
      coverage: RunnerPlacement.Reusable,
      "full-e2e": RunnerPlacement.HostedRuntime,
      "full-extension-e2e": RunnerPlacement.HostedRuntime,
    },
  },
  {
    workflow: "release.yml",
    jobs: { deploy: RunnerPlacement.HostedDeployment },
  },
  {
    workflow: "remote.yml",
    jobs: {
      batch: RunnerPlacement.ArcGeneralRemote,
      "rust-cache-promote": RunnerPlacement.HostedControl,
    },
  },
  {
    workflow: "repository-policy.yml",
    jobs: { verify: RunnerPlacement.HostedUntrusted },
  },
  {
    workflow: "runner-cleanup.yml",
    jobs: { "docker-prune": RunnerPlacement.LegacyCleanup },
  },
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
  if (placement === RunnerPlacement.ArcCacheMain) {
    return "${{ vars.NOOK_CACHE_RUNS_ON || 'ubuntu-latest' }}";
  }
  if (placement === RunnerPlacement.ArcGeneralMain) {
    return "${{ vars.NOOK_RUNS_ON || 'ubuntu-latest' }}";
  }
  if (placement === RunnerPlacement.ArcGeneralPr) {
    return "${{ github.event.pull_request.head.repo.full_name == github.repository && github.event.pull_request.user.login != 'dependabot[bot]' && (vars.NOOK_RUNS_ON || 'ubuntu-latest') || 'ubuntu-latest' }}";
  }
  if (placement === RunnerPlacement.ArcGeneralRemote) {
    return "${{ inputs.runner_label == 'nook-k0s-cache' && (vars.NOOK_CACHE_RUNS_ON || 'ubuntu-latest') || inputs.runner_label == 'nook-k0s-hive' && (vars.NOOK_HIVE_RUNS_ON || 'ubuntu-latest') || inputs.runner_label == 'nook-k0s' && (vars.NOOK_RUNS_ON || 'ubuntu-latest') || ((inputs.tasks || inputs.task) == 'hive:verify' && (vars.NOOK_HIVE_RUNS_ON || 'ubuntu-latest') || (((inputs.tasks || inputs.task) == 'preflight' || (inputs.tasks || inputs.task) == 'rust:ci' || (inputs.tasks || inputs.task) == 'arc:runtime') && (vars.NOOK_RUNS_ON || 'ubuntu-latest') || 'ubuntu-latest')) }}";
  }
  if (placement === RunnerPlacement.ArcGeneralRustReusable) {
    return "${{ (github.event_name == 'push' || (github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository && github.event.pull_request.user.login != 'dependabot[bot]')) && (vars.NOOK_RUNS_ON || 'ubuntu-latest') || 'ubuntu-latest' }}";
  }
  throw new Error(`Runner placement ${placement} does not own runs-on`);
}

async function validateWorkflowPlacement(input: Placement): Promise<void> {
  const relativePath = `.github/workflows/${input.workflow}`;
  const manifest = Bun.YAML.parse(await read(relativePath)) as WorkflowManifest;
  const actualJobs = Object.keys(manifest.jobs).sort();
  const classifiedJobs = Object.keys(input.jobs).sort();
  if (actualJobs.join("\n") !== classifiedJobs.join("\n")) {
    throw new Error(
      `${input.workflow} job inventory changed; actual=${actualJobs.join(",")} classified=${classifiedJobs.join(",")}`,
    );
  }

  if (
    Object.values(input.jobs).includes(RunnerPlacement.ArcGeneralMain) ||
    Object.values(input.jobs).includes(RunnerPlacement.ArcCacheMain)
  ) {
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
    if (!job || !placement)
      throw new Error(`${input.workflow}/${jobName} is unclassified`);
    if (placement === RunnerPlacement.Reusable) {
      if (!job.uses?.startsWith("./.github/workflows/")) {
        throw new Error(
          `${input.workflow}/${jobName} must call a local reusable workflow`,
        );
      }
      continue;
    }
    const expected = expectedRunner(placement);
    if (job["runs-on"] !== expected) {
      throw new Error(
        `${input.workflow}/${jobName} must use ${expected} for ${placement}`,
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
