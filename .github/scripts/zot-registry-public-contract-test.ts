import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");

async function read(relative: string): Promise<string> {
  return Bun.file(resolve(root, relative)).text();
}

function requireFragment(input: {
  source: string;
  fragment: string;
  message: string;
}): void {
  if (!input.source.includes(input.fragment)) {
    throw new Error(input.message);
  }
}

function forbidFragment(input: {
  source: string;
  fragment: string;
  message: string;
}): void {
  if (input.source.includes(input.fragment)) {
    throw new Error(input.message);
  }
}

function countFragment(input: {
  source: string;
  fragment: string;
  expected: number;
  message: string;
}): void {
  const actual = input.source.split(input.fragment).length - 1;
  if (actual !== input.expected) {
    throw new Error(
      `${input.message}: expected ${input.expected}, found ${actual}`,
    );
  }
}

function requireBefore(input: {
  source: string;
  first: string;
  second: string;
  message: string;
}): void {
  const first = input.source.indexOf(input.first);
  const second = input.source.indexOf(input.second);
  if (first < 0 || second < 0 || first >= second) {
    throw new Error(input.message);
  }
}

const registryTask = await read("infra/tasks/registry.yml");
const k0sTask = await read("infra/tasks/k0s.yml");
const workerTask = await read("infra/tasks/k0s-workers.yml");
const workerMesh = await read("infra/k0s/scripts/k0s-worker-mesh-reconcile");
const completeDeploy = await read("infra/tasks/host-services.yml");
const controllerAuthReconcile = registryTask.slice(
  registryTask.indexOf("  registry:containerd-auth:reconcile:"),
  registryTask.indexOf("  registry:credential:sync:"),
);
if (!controllerAuthReconcile) {
  throw new Error("controller registry-auth reconciliation task is missing");
}
const zot = await read("infra/k0s/manifests/registry/zot.yaml");
const traefik = await read("infra/traefik-dynamic.yaml");
const compose = await read("infra/compose.yaml");
const hosts = await read("infra/k0s/config/registry-hosts.toml");
const criRegistry = await read("infra/k0s/config/cri-registry.toml");
const hive = await read("infra/tasks/hive.yml");
const sccache = await read("infra/tasks/sccache.yml");
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
  requireFragment(assertion);
}
forbidFragment({
  source: controllerAuthReconcile,
  fragment: "metadata.labels.nook\\.nokey\\.sh/arc-build}')\" != true",
  message: "controller auth cleanup must support an ARC-qualified controller",
});
forbidFragment({
  source: controllerAuthReconcile,
  fragment: "--overwrite",
  message: "controller quarantine must not overwrite concurrent ownership",
});
for (const fragment of [
  "quarantine_owned=false",
  "nook.nokey.sh/containerd-auth-quarantine=registry-controller-v1",
  "Controller has a foreign containerd auth quarantine owner",
  "nook.nokey.sh/arc-build=preparing:NoSchedule",
  "Controller has ambiguous ARC quarantine state",
  'if test "$quarantine_owned" = true; then',
  "nook.nokey.sh/arc-build:NoSchedule-",
  "nook.nokey.sh/containerd-auth-quarantine-",
]) {
  requireFragment({
    source: controllerAuthReconcile,
    fragment,
    message: `controller quarantine ownership is missing: ${fragment}`,
  });
}
requireBefore({
  source: controllerAuthReconcile,
  first: "nook.nokey.sh/arc-build=preparing:NoSchedule",
  second: "actions.github.com/scale-set-name",
  message: "controller quarantine must block scheduling before the ARC drain",
});
requireBefore({
  source: controllerAuthReconcile,
  first: "actions.github.com/scale-set-name",
  second: "sudo -n systemctl restart k0scontroller.service",
  message: "controller ARC drain must finish before restart",
});
requireBefore({
  source: controllerAuthReconcile,
  first: 'sudo -n install -m 0600 "$marker_next" "$marker"',
  second: 'if test "$quarantine_owned" = true; then',
  message: "owned controller quarantine must remain until cleanup is proven",
});
countFragment({
  source: controllerAuthReconcile,
  fragment: "sudo -n systemctl restart k0scontroller.service",
  expected: 1,
  message: "controller auth cleanup must restart exactly once",
});
countFragment({
  source: workerMesh,
  fragment: "sudo -n systemctl restart k0sworker.service",
  expected: 1,
  message: "worker auth cleanup must restart exactly once",
});

type ArcTaint = { key: string; value: string; effect: string };
function quarantineDisposition(
  taints: ArcTaint[],
  owner: string,
): "owned" | "preserved" | "reject" {
  if (owner !== "" && owner !== "registry-controller-v1") return "reject";
  const matching = taints.filter(
    (taint) => taint.key === "nook.nokey.sh/arc-build",
  );
  if (matching.length === 0) return "owned";
  if (
    matching.length === 1 &&
    matching[0]?.value === "preparing" &&
    matching[0]?.effect === "NoSchedule"
  ) {
    return owner === "registry-controller-v1" ? "owned" : "preserved";
  }
  return "reject";
}
const controllerQuarantineFixtures = [
  {
    name: "ARC-qualified controller without a taint",
    arcBuildQualified: true,
    taints: [] as ArcTaint[],
    owner: "",
    expected: "owned",
  },
  {
    name: "interrupted owned quarantine before taint",
    arcBuildQualified: true,
    taints: [] as ArcTaint[],
    owner: "registry-controller-v1",
    expected: "owned",
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
    expected: "preserved",
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
    owner: "registry-controller-v1",
    expected: "owned",
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
    expected: "reject",
  },
  {
    name: "foreign quarantine owner",
    arcBuildQualified: true,
    taints: [] as ArcTaint[],
    owner: "foreign",
    expected: "reject",
  },
] as const;
for (const fixture of controllerQuarantineFixtures) {
  if (!fixture.arcBuildQualified) {
    throw new Error(
      `${fixture.name} must exercise an ARC-qualified controller`,
    );
  }
  if (
    quarantineDisposition([...fixture.taints], fixture.owner) !==
    fixture.expected
  ) {
    throw new Error(`controller quarantine fixture failed: ${fixture.name}`);
  }
}
const previousWorkerInvocation = "0123456789abcdef0123456789abcdef";
function didInvocationChange(previous: string, current: string): boolean {
  return previous !== current;
}
if (
  !didInvocationChange(
    previousWorkerInvocation,
    "11111111111111111111111111111111",
  )
) {
  throw new Error("changed worker InvocationID fixture was rejected");
}
if (didInvocationChange(previousWorkerInvocation, previousWorkerInvocation)) {
  throw new Error("unchanged worker InvocationID fixture was accepted");
}
for (const fragment of ["kubectl port-forward --", "port-forward --address"]) {
  const assertion = {
    source: registryTask,
    fragment,
    message: `prohibited registry path: ${fragment}`,
  };
  forbidFragment(assertion);
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
  requireFragment(assertion);
}
if (!/cidr:\s*10\.0\.0\.0\/8/.test(zot)) {
  throw new Error("Zot ingress must retain the private-network CIDR");
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
  requireFragment(assertion);
}
for (const fragment of ["127.0.0.1:6379", "HostSNI("]) {
  const assertion = {
    source: traefik,
    fragment,
    message: `prohibited Traefik contract: ${fragment}`,
  };
  forbidFragment(assertion);
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
  requireFragment(assertion);
}
for (const fragment of ["\n  redis:", "443:443", "5000:5000", "6380"]) {
  const assertion = {
    source: compose,
    fragment,
    message: `prohibited Compose contract: ${fragment}`,
  };
  forbidFragment(assertion);
}
const hostsAssertion = {
  source: hosts,
  fragment: 'server = "https://registry.dev.nokey.sh"',
  message: "containerd must use the authenticated public registry endpoint",
};
requireFragment(hostsAssertion);
requireFragment({
  source: criRegistry,
  fragment: 'config_path = "/etc/k0s/containerd.d/certs.d"',
  message: "containerd must load registry hosts through config_path",
});
for (const source of [registryTask, k0sTask, workerTask, workerMesh]) {
  forbidFragment({
    source,
    fragment: "registry.configs",
    message:
      "deprecated containerd registry.configs authentication is prohibited",
  });
  requireFragment({
    source,
    fragment: "sudo -n rm -f /etc/k0s/containerd.d/registry-auth.toml",
    message:
      "every k0s convergence path must remove deprecated containerd authentication",
  });
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
  requireFragment({
    source: registryTask,
    fragment,
    message: `controller registry-auth reconciliation is missing: ${fragment}`,
  });
}
for (const source of [k0sTask, workerTask, workerMesh]) {
  requireFragment({
    source,
    fragment: "/var/lib/k0s/nook-containerd-auth-clean-invocation",
    message: "k0s convergence must record the clean containerd invocation",
  });
  requireFragment({
    source,
    fragment: "--property=InvocationID --value",
    message: "k0s convergence must bind cleanup to a systemd invocation",
  });
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
  requireFragment({
    source: workerMesh,
    fragment,
    message: `fleet worker registry-auth reconciliation is missing: ${fragment}`,
  });
}
const completeInstall = completeDeploy.indexOf("      - task: k0s:install");
const completeWorkers = completeDeploy.indexOf(
  "      - task: k0s:worker-mesh:reconcile",
);
const completeRegistry = completeDeploy.indexOf("      - task: registry:deploy");
if (
  completeInstall < 0 ||
  completeWorkers <= completeInstall ||
  completeRegistry <= completeWorkers
) {
  throw new Error(
    "complete deploy must reconcile controller, then worker, then registry auth",
  );
}
for (const source of [hosts, hive]) {
  const assertion = {
    source,
    fragment: "127.0.0.1:5000",
    message: "loopback registry references are prohibited",
  };
  forbidFragment(assertion);
}
const hiveAssertion = {
  source: hive,
  fragment: "registry.dev.nokey.sh/nook-hive",
  message: "Hive must publish through the public Zot endpoint",
};
requireFragment(hiveAssertion);
requireFragment({
  source: sccacheBucketEnsure,
  fragment: "docker.io/amazon/aws-cli:2.27.50@sha256:",
  message: "clean-host sccache bootstrap must not depend on Zot",
});
forbidFragment({
  source: sccacheBucketEnsure,
  fragment: "registry.dev.nokey.sh/amazon/aws-cli",
  message: "sccache bootstrap cannot use Zot before k0s deploys it",
});

console.log("Public Zot registry contract: ok");
