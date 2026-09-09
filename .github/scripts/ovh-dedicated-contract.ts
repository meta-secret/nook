import { resolve } from "node:path";

class OvhDedicatedContractRead {
  constructor(private readonly request: string) {}
  async execute(): Promise<string> {
    const relative = this.request;

    return Bun.file(resolve(root, relative)).text();
  }
}

class OvhDedicatedContractRequireFragment {
  constructor(private readonly request: ContractInput) {}
  execute(): void {
    const input = this.request;

    if (!input.source.includes(input.fragment)) {
      throw new Error(`${input.label} is missing ${input.fragment}`);
    }
  }
}

class OvhDedicatedContractForbidFragment {
  constructor(private readonly request: ContractInput) {}
  execute(): void {
    const input = this.request;

    if (input.source.includes(input.fragment)) {
      throw new Error(`${input.label} contains prohibited ${input.fragment}`);
    }
  }
}

const root = resolve(import.meta.dir, "../..");

interface ContractInput {
  fragment: string;
  label: string;
  source: string;
}

interface ServerDefinition {
  arcTier: string;
  endpointMode: string;
  expectedCommercialRange: string;
  expectedDatacenter: string;
  meshAddress: string;
  operatingSystem: string;
  publicAddress: string;
  serviceName: string;
  sshPublicKeyFile: string;
  sshUser: string;
}

interface ServerInventory {
  servers: Record<string, ServerDefinition>;
}

const provider = await new OvhDedicatedContractRead(
  "infra/providers/ovh-dedicated.ts",
).execute();
const tasks = await new OvhDedicatedContractRead(
  "infra/tasks/providers.yml",
).execute();
const inventorySource = await new OvhDedicatedContractRead(
  "infra/providers/ovh-dedicated-servers.yaml",
).execute();
const inventory = Bun.YAML.parse(inventorySource) as ServerInventory;

for (const fragment of [
  ".nook/ovh-api.json",
  "await chmod(dirname(target), 0o700)",
  "await chmod(target, 0o600)",
  "requiredCredentials",
  "/auth/currentCredential",
  "getServer({ credentials: candidate",
  "await rename(next, target)",
  ".nook/infra/ovh-host-identities",
  ".nook/infra/ovh-recovery",
  "postInstallationScript",
  "missing trusted SSH host identity",
  "stored SSH host keypair",
  "prepareReinstall",
  "persistRecoveryMarker",
  "RecoveryComplete",
  "clearRecoveryMarker",
  "preSubmission",
  "approved US API endpoint",
  'currentOperatingSystem === "none_64"',
  "allowReinstall",
  "/reinstall",
  "waitForTask",
  "requireCompatibleTemplate",
  "validateServer",
]) {
  new OvhDedicatedContractRequireFragment({
    fragment,
    label: "OVH provider",
    source: provider,
  }).execute();
}

for (const fragment of [
  "configDriveUserData",
  "applicationSecret}",
  "consumerKey}",
]) {
  new OvhDedicatedContractForbidFragment({
    fragment,
    label: "OVH provider",
    source: provider,
  }).execute();
}

for (const fragment of [
  "ovh:server:deploy:",
  "reinstall-required",
  "recovery-complete",
  "--ignore-not-found",
  "kubectl cordon",
  "actions.github.com/scale-set-name",
  "kubectl drain",
  "ssh-keyscan -t ed25519 -T 3 -H",
  ".known_hosts.lock",
  "known_hosts.next.XXXXXX",
  "expected_fingerprint",
  "CONTROLLER_RECOVERY",
  "/etc/sudoers.d/90-nook-infra",
  "/etc/ssh/sshd_config.d/00-nook-infra.conf",
  "sshd -T | grep -Fx 'passwordauthentication no'",
  "findmnt -n -o SOURCE /",
  "active raid1",
  "/sys/block/md3/md/degraded",
  "k0s:worker:deploy",
  "INFRA_WORKER_MESH_ADDRESS",
  "INFRA_WORKER_ARC_TIER",
]) {
  new OvhDedicatedContractRequireFragment({
    fragment,
    label: "OVH Taskfile",
    source: tasks,
  }).execute();
}

for (const fragment of [
  "cloud-init",
  "PasswordAuthentication yes",
  'if ! sudo -n k0s kubectl get node "$node"',
  '"$known_hosts.merged"',
]) {
  new OvhDedicatedContractForbidFragment({
    fragment,
    label: "OVH Taskfile",
    source: tasks,
  }).execute();
}

const expectedServers = ["nook-rise-s-1", "nook-rise-s-2"];
if (
  Object.keys(inventory.servers).sort().join("\n") !==
  expectedServers.join("\n")
) {
  throw new Error(
    "OVH inventory must declare both Rise-S workers exactly once",
  );
}
const meshAddresses = new Set<string>();
for (const [hostname, server] of Object.entries(inventory.servers)) {
  if (
    server.operatingSystem !== "debian13_64" ||
    server.expectedCommercialRange !== "RISE-S | AMD Ryzen 7 9700X" ||
    server.sshUser !== "debian" ||
    server.endpointMode !== "direct" ||
    server.arcTier !== "primary" ||
    !/^10\.202\.0\.[2-9][0-9]?$/.test(server.meshAddress) ||
    !/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(hostname)
  ) {
    throw new Error(
      `OVH inventory entry ${hostname} violates the worker contract`,
    );
  }
  if (meshAddresses.has(server.meshAddress)) {
    throw new Error("OVH inventory reuses a private mesh address");
  }
  meshAddresses.add(server.meshAddress);
}

for (const fragment of [
  "applicationKey",
  "applicationSecret",
  "consumerKey",
  "password",
  "token",
]) {
  new OvhDedicatedContractForbidFragment({
    fragment,
    label: "OVH inventory",
    source: inventorySource,
  }).execute();
}

console.log("OVH dedicated provisioning contract: ok");
