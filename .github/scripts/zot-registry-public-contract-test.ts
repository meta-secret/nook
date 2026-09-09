import { resolve } from "node:path";

class ZotRegistryPublicContractTestRead {
  constructor(private readonly request: string) {}
  async execute(): Promise<string> {
    const relative = this.request;

    return Bun.file(resolve(root, relative)).text();
  }
}

class ZotRegistryPublicContractTestRequireFragment {
  constructor(
    private readonly request: {
      source: string;
      fragment: string;
      message: string;
    },
  ) {}
  execute(): void {
    const input = this.request;

    if (!input.source.includes(input.fragment)) {
      throw new Error(input.message);
    }
  }
}

class ZotRegistryPublicContractTestForbidFragment {
  constructor(
    private readonly request: {
      source: string;
      fragment: string;
      message: string;
    },
  ) {}
  execute(): void {
    const input = this.request;

    if (input.source.includes(input.fragment)) {
      throw new Error(input.message);
    }
  }
}

class ZotRegistryPublicContractTestCountFragment {
  constructor(
    private readonly request: {
      source: string;
      fragment: string;
      expected: number;
      message: string;
    },
  ) {}
  execute(): void {
    const input = this.request;

    const actual = input.source.split(input.fragment).length - 1;
    if (actual !== input.expected) {
      throw new Error(
        `${input.message}: expected ${input.expected}, found ${actual}`,
      );
    }
  }
}

class ZotRegistryPublicContractTestRequireBefore {
  constructor(
    private readonly request: {
      source: string;
      first: string;
      second: string;
      message: string;
    },
  ) {}
  execute(): void {
    const input = this.request;

    const first = input.source.indexOf(input.first);
    const second = input.source.indexOf(input.second);
    if (first < 0 || second < 0 || first >= second) {
      throw new Error(input.message);
    }
  }
}

interface ZotRegistryPublicContractTestQuarantineDispositionRequest {
  readonly taints: ArcTaint[];
  readonly owner: string;
}

class ZotRegistryPublicContractTestQuarantineDisposition {
  constructor(
    private readonly request: ZotRegistryPublicContractTestQuarantineDispositionRequest,
  ) {}
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

class ZotRegistryPublicContractTestReleaseRemovesTaint {
  constructor(private readonly request: QuarantineDisposition) {}
  execute(): boolean {
    const disposition = this.request;

    if (disposition === QuarantineDisposition.Reject) {
      throw new Error("rejected quarantine has no release authority");
    }
    return disposition === QuarantineDisposition.Owned;
  }
}

interface ZotRegistryPublicContractTestDidInvocationChangeRequest {
  readonly previous: string;
  readonly current: string;
}

class ZotRegistryPublicContractTestDidInvocationChange {
  constructor(
    private readonly request: ZotRegistryPublicContractTestDidInvocationChangeRequest,
  ) {}
  execute(): boolean {
    const { previous, current } = this.request;

    return previous !== current;
  }
}

interface ZotRegistryPublicContractTestResourceVersionGuardMatchesRequest {
  readonly expected: string;
  readonly observed: string;
}

class ZotRegistryPublicContractTestResourceVersionGuardMatches {
  constructor(
    private readonly request: ZotRegistryPublicContractTestResourceVersionGuardMatchesRequest,
  ) {}
  execute(): boolean {
    const { expected, observed } = this.request;

    return expected === observed;
  }
}

const root = resolve(import.meta.dir, "../..");

const registryTask = await new ZotRegistryPublicContractTestRead(
  "infra/tasks/registry.yml",
).execute();
const k0sTask = await new ZotRegistryPublicContractTestRead(
  "infra/tasks/k0s.yml",
).execute();
const workerTask = await new ZotRegistryPublicContractTestRead(
  "infra/tasks/k0s-workers.yml",
).execute();
const workerRestoreTask = await new ZotRegistryPublicContractTestRead(
  "infra/tasks/k0s-worker-restore.yml",
).execute();
const workerTaskFamily = [workerTask, workerRestoreTask].join("\n");
const workerMesh = await new ZotRegistryPublicContractTestRead(
  "infra/k0s/scripts/k0s-worker-mesh-reconcile",
).execute();
const completeDeploy = await new ZotRegistryPublicContractTestRead(
  "infra/tasks/host-services.yml",
).execute();
const controllerAuthReconcile = registryTask.slice(
  registryTask.indexOf("  registry:containerd-auth:reconcile:"),
  registryTask.indexOf("  registry:credential:sync:"),
);
if (!controllerAuthReconcile) {
  throw new Error("controller registry-auth reconciliation task is missing");
}
const zot = await new ZotRegistryPublicContractTestRead(
  "infra/k0s/manifests/registry/zot.yaml",
).execute();
const traefik = await new ZotRegistryPublicContractTestRead(
  "infra/traefik-dynamic.yaml",
).execute();
const compose = await new ZotRegistryPublicContractTestRead(
  "infra/compose.yaml",
).execute();
const hosts = await new ZotRegistryPublicContractTestRead(
  "infra/k0s/config/registry-hosts.toml",
).execute();
const criRegistry = await new ZotRegistryPublicContractTestRead(
  "infra/k0s/config/cri-registry.toml",
).execute();
const hive = await new ZotRegistryPublicContractTestRead(
  "infra/tasks/hive.yml",
).execute();
const sccache = await new ZotRegistryPublicContractTestRead(
  "infra/tasks/sccache.yml",
).execute();
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
  new ZotRegistryPublicContractTestRequireFragment(assertion).execute();
}
for (const fragment of [
  "grep -Eq \"^${username}\"':[$]2[ay][$]'",
  "grep -Eq \"^${remote_username}\"':[$]2[ay][$]'",
]) {
  new ZotRegistryPublicContractTestRequireFragment({
    source: registryTask,
    fragment,
    message: `registry bcrypt guard must use literal-dollar classes: ${fragment}`,
  }).execute();
}
new ZotRegistryPublicContractTestForbidFragment({
  source: registryTask,
  fragment: "':\\$2[ay]\\$'",
  message:
    "registry bcrypt guard must not rely on Task-sensitive dollar escapes",
}).execute();
new ZotRegistryPublicContractTestForbidFragment({
  source: controllerAuthReconcile,
  fragment: "metadata.labels.nook\\.nokey\\.sh/arc-build}')\" != true",
  message: "controller auth cleanup must support an ARC-qualified controller",
}).execute();
new ZotRegistryPublicContractTestForbidFragment({
  source: controllerAuthReconcile,
  fragment: "--overwrite",
  message: "controller quarantine must not overwrite concurrent ownership",
}).execute();
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
  new ZotRegistryPublicContractTestRequireFragment({
    source: controllerAuthReconcile,
    fragment,
    message: `controller quarantine ownership is missing: ${fragment}`,
  }).execute();
}
for (const fragment of ["kubectl annotate", "kubectl taint"]) {
  new ZotRegistryPublicContractTestForbidFragment({
    source: controllerAuthReconcile,
    fragment,
    message: `controller quarantine must use atomic Node patches, not ${fragment}`,
  }).execute();
}
new ZotRegistryPublicContractTestRequireBefore({
  source: controllerAuthReconcile,
  first: '--type=json --patch "$quarantine_patch"',
  second: "actions.github.com/scale-set-name",
  message: "controller quarantine must block scheduling before the ARC drain",
}).execute();
new ZotRegistryPublicContractTestRequireBefore({
  source: controllerAuthReconcile,
  first: "actions.github.com/scale-set-name",
  second: "sudo -n systemctl restart k0scontroller.service",
  message: "controller ARC drain must finish before restart",
}).execute();
new ZotRegistryPublicContractTestRequireBefore({
  source: controllerAuthReconcile,
  first: 'sudo -n install -m 0600 "$marker_next" "$marker"',
  second: 'if test "$restart_required" = true; then',
  message: "owned controller quarantine must remain until cleanup is proven",
}).execute();
new ZotRegistryPublicContractTestCountFragment({
  source: controllerAuthReconcile,
  fragment: "sudo -n systemctl restart k0scontroller.service",
  expected: 1,
  message: "controller auth cleanup must restart exactly once",
}).execute();
new ZotRegistryPublicContractTestCountFragment({
  source: controllerAuthReconcile,
  fragment:
    '{op: "test", path: "/metadata/resourceVersion", value: $resource_version}',
  expected: 4,
  message: "every controller quarantine mutation must guard resourceVersion",
}).execute();
new ZotRegistryPublicContractTestCountFragment({
  source: workerMesh,
  fragment: "sudo -n systemctl restart k0sworker.service",
  expected: 1,
  message: "worker auth cleanup must restart exactly once",
}).execute();

type ArcTaint = { key: string; value: string; effect: string };
enum QuarantineDisposition {
  Owned = "owned",
  Borrowed = "borrowed",
  Reject = "reject",
}

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
    throw new Error(
      `${fixture.name} must exercise an ARC-qualified controller`,
    );
  }
  if (
    new ZotRegistryPublicContractTestQuarantineDisposition({
      taints: [...fixture.taints],
      owner: fixture.owner,
    }).execute() !== fixture.expected
  ) {
    throw new Error(`controller quarantine fixture failed: ${fixture.name}`);
  }
}

for (const fixture of [
  {
    name: "owned release removes its taint",
    disposition: QuarantineDisposition.Owned,
    removesTaint: true,
  },
  {
    name: "borrowed release preserves the pre-existing taint",
    disposition: QuarantineDisposition.Borrowed,
    removesTaint: false,
  },
] as const) {
  if (
    new ZotRegistryPublicContractTestReleaseRemovesTaint(
      fixture.disposition,
    ).execute() !== fixture.removesTaint
  ) {
    throw new Error(`controller release fixture failed: ${fixture.name}`);
  }
}
const previousWorkerInvocation = "0123456789abcdef0123456789abcdef";

if (
  !new ZotRegistryPublicContractTestDidInvocationChange({
    previous: previousWorkerInvocation,
    current: "11111111111111111111111111111111",
  }).execute()
) {
  throw new Error("changed worker InvocationID fixture was rejected");
}
if (
  new ZotRegistryPublicContractTestDidInvocationChange({
    previous: previousWorkerInvocation,
    current: previousWorkerInvocation,
  }).execute()
) {
  throw new Error("unchanged worker InvocationID fixture was accepted");
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
    new ZotRegistryPublicContractTestResourceVersionGuardMatches({
      expected: fixture.expected,
      observed: fixture.observed,
    }).execute() !== fixture.accepted
  ) {
    throw new Error(`resourceVersion fixture failed: ${fixture.name}`);
  }
}
for (const fragment of ["kubectl port-forward --", "port-forward --address"]) {
  const assertion = {
    source: registryTask,
    fragment,
    message: `prohibited registry path: ${fragment}`,
  };
  new ZotRegistryPublicContractTestForbidFragment(assertion).execute();
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
  new ZotRegistryPublicContractTestRequireFragment(assertion).execute();
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
  new ZotRegistryPublicContractTestRequireFragment(assertion).execute();
}
for (const fragment of ["127.0.0.1:6379", "HostSNI("]) {
  const assertion = {
    source: traefik,
    fragment,
    message: `prohibited Traefik contract: ${fragment}`,
  };
  new ZotRegistryPublicContractTestForbidFragment(assertion).execute();
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
  new ZotRegistryPublicContractTestRequireFragment(assertion).execute();
}
for (const fragment of ["\n  redis:", "443:443", "5000:5000", "6380"]) {
  const assertion = {
    source: compose,
    fragment,
    message: `prohibited Compose contract: ${fragment}`,
  };
  new ZotRegistryPublicContractTestForbidFragment(assertion).execute();
}
const hostsAssertion = {
  source: hosts,
  fragment: 'server = "https://registry.dev.nokey.sh"',
  message: "containerd must use the authenticated public registry endpoint",
};
new ZotRegistryPublicContractTestRequireFragment(hostsAssertion).execute();
new ZotRegistryPublicContractTestRequireFragment({
  source: criRegistry,
  fragment: 'config_path = "/etc/k0s/containerd.d/certs.d"',
  message: "containerd must load registry hosts through config_path",
}).execute();
for (const source of [registryTask, k0sTask, workerTaskFamily, workerMesh]) {
  new ZotRegistryPublicContractTestForbidFragment({
    source,
    fragment: "registry.configs",
    message:
      "deprecated containerd registry.configs authentication is prohibited",
  }).execute();
  new ZotRegistryPublicContractTestRequireFragment({
    source,
    fragment: "sudo -n rm -f /etc/k0s/containerd.d/registry-auth.toml",
    message:
      "every k0s convergence path must remove deprecated containerd authentication",
  }).execute();
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
  new ZotRegistryPublicContractTestRequireFragment({
    source: registryTask,
    fragment,
    message: `controller registry-auth reconciliation is missing: ${fragment}`,
  }).execute();
}
for (const source of [k0sTask, workerTaskFamily, workerMesh]) {
  new ZotRegistryPublicContractTestRequireFragment({
    source,
    fragment: "/var/lib/k0s/nook-containerd-auth-clean-invocation",
    message: "k0s convergence must record the clean containerd invocation",
  }).execute();
  new ZotRegistryPublicContractTestRequireFragment({
    source,
    fragment: "--property=InvocationID --value",
    message: "k0s convergence must bind cleanup to a systemd invocation",
  }).execute();
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
  new ZotRegistryPublicContractTestRequireFragment({
    source: workerMesh,
    fragment,
    message: `fleet worker registry-auth reconciliation is missing: ${fragment}`,
  }).execute();
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
  new ZotRegistryPublicContractTestForbidFragment(assertion).execute();
}
const hiveAssertion = {
  source: hive,
  fragment: "registry.dev.nokey.sh/nook-hive",
  message: "Hive must publish through the public Zot endpoint",
};
new ZotRegistryPublicContractTestRequireFragment(hiveAssertion).execute();
new ZotRegistryPublicContractTestRequireFragment({
  source: sccacheBucketEnsure,
  fragment: "docker.io/amazon/aws-cli:2.27.50@sha256:",
  message: "clean-host sccache bootstrap must not depend on Zot",
}).execute();
new ZotRegistryPublicContractTestForbidFragment({
  source: sccacheBucketEnsure,
  fragment: "registry.dev.nokey.sh/amazon/aws-cli",
  message: "sccache bootstrap cannot use Zot before k0s deploys it",
}).execute();

console.log("Public Zot registry contract: ok");
