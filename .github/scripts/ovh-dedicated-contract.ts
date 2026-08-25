import { resolve } from "node:path";

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

async function read(relative: string): Promise<string> {
  return Bun.file(resolve(root, relative)).text();
}

function requireFragment(input: ContractInput): void {
  if (!input.source.includes(input.fragment)) {
    throw new Error(`${input.label} is missing ${input.fragment}`);
  }
}

function forbidFragment(input: ContractInput): void {
  if (input.source.includes(input.fragment)) {
    throw new Error(`${input.label} contains prohibited ${input.fragment}`);
  }
}

const provider = await read("infra/providers/ovh-dedicated.ts");
const tasks = await read("infra/tasks/providers.yml");
const inventorySource = await read(
  "infra/providers/ovh-dedicated-servers.yaml",
);
const inventory = Bun.YAML.parse(inventorySource) as ServerInventory;

for (const fragment of [
  ".nook/ovh-api.json",
  "await chmod(dirname(target), 0o700)",
  "await chmod(target, 0o600)",
  "requiredCredentials",
  "/auth/currentCredential",
  "await rename(next, target)",
  ".nook/infra/ovh-host-identities",
  "postInstallationScript",
  "missing trusted SSH host identity",
  "preSubmission",
  "approved US API endpoint",
  'currentOperatingSystem === "none_64"',
  "allowReinstall",
  "/reinstall",
  "waitForTask",
  "requireCompatibleTemplate",
  "validateServer",
]) {
  requireFragment({ fragment, label: "OVH provider", source: provider });
}

for (const fragment of [
  "configDriveUserData",
  "applicationSecret}",
  "consumerKey}",
]) {
  forbidFragment({ fragment, label: "OVH provider", source: provider });
}

for (const fragment of [
  "ovh:server:deploy:",
  "reinstall-required",
  "kubectl cordon",
  "actions.github.com/scale-set-name",
  "kubectl drain",
  "ssh-keyscan -t ed25519 -T 3 -H",
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
  requireFragment({ fragment, label: "OVH Taskfile", source: tasks });
}

for (const fragment of ["cloud-init", "PasswordAuthentication yes"]) {
  forbidFragment({ fragment, label: "OVH Taskfile", source: tasks });
}

const expectedServers = ["nook-rise-s-1", "nook-rise-s-2"];
if (Object.keys(inventory.servers).sort().join("\n") !== expectedServers.join("\n")) {
  throw new Error("OVH inventory must declare both Rise-S workers exactly once");
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
    throw new Error(`OVH inventory entry ${hostname} violates the worker contract`);
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
  forbidFragment({ fragment, label: "OVH inventory", source: inventorySource });
}

console.log("OVH dedicated provisioning contract: ok");
