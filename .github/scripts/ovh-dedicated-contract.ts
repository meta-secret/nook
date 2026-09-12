import { resolve } from "node:path";
import { err, ok, type Result } from "neverthrow";
import { OvhDocument } from "../../infra/providers/ovh-dedicated-document";
import { ArcTier, EndpointMode, type DedicatedServerInventory } from "../../infra/providers/ovh-dedicated-contracts";

enum OvhContractFailureKind { Source = "source", Schema = "schema", Missing = "missing", Forbidden = "forbidden", Inventory = "inventory" }
interface OvhContractFailure { kind: OvhContractFailureKind; message: string }
class OvhContractSource {
  constructor(private readonly input: { label: string; source: string }) {}
  require(fragments: readonly string[]): Result<void, OvhContractFailure> {
    for (const fragment of fragments) if (!this.input.source.includes(fragment))
      return err({ kind: OvhContractFailureKind.Missing, message: `${this.input.label} is missing ${fragment}` });
    return ok();
  }
  forbid(fragments: readonly string[]): Result<void, OvhContractFailure> {
    for (const fragment of fragments) if (this.input.source.includes(fragment))
      return err({ kind: OvhContractFailureKind.Forbidden, message: `${this.input.label} contains prohibited ${fragment}` });
    return ok();
  }
}
class OvhContractInventory {
  constructor(private readonly inventory: DedicatedServerInventory) {}
  admit(): Result<void, OvhContractFailure> {
    if (Object.keys(this.inventory.servers).sort().join("\n") !== ["nook-rise-s-1", "nook-rise-s-2"].join("\n"))
      return err({ kind: OvhContractFailureKind.Inventory, message: "OVH inventory must declare both Rise-S workers exactly once" });
    const meshAddresses = new Set<string>();
    for (const [hostname, server] of Object.entries(this.inventory.servers)) {
      if (server.operatingSystem !== "debian13_64" || server.expectedCommercialRange !== "RISE-S | AMD Ryzen 7 9700X" ||
        server.sshUser !== "debian" || server.endpointMode !== EndpointMode.Direct || server.arcTier !== ArcTier.Primary ||
        !/^10\.202\.0\.[2-9][0-9]?$/.test(server.meshAddress) || !/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(hostname))
        return err({ kind: OvhContractFailureKind.Inventory, message: `OVH inventory entry ${hostname} violates the worker contract` });
      if (meshAddresses.has(server.meshAddress))
        return err({ kind: OvhContractFailureKind.Inventory, message: "OVH inventory reuses a private mesh address" });
      meshAddresses.add(server.meshAddress);
    }
    return ok();
  }
}
class OvhProvisioningContract {
  constructor(private readonly root: string) {}
  private async read(relative: string): Promise<Result<string, OvhContractFailure>> {
    try { return ok(await Bun.file(resolve(this.root, relative)).text()); }
    catch { return err({ kind: OvhContractFailureKind.Source, message: `Unable to read ${relative}` }); }
  }
  private inventory(source: string): Result<DedicatedServerInventory, OvhContractFailure> {
    let value: unknown;
    try { value = Bun.YAML.parse(source); }
    catch { return err({ kind: OvhContractFailureKind.Schema, message: "OVH inventory is not valid YAML" }); }
    return new OvhDocument(value).inventory().mapErr((failure) => ({ kind: OvhContractFailureKind.Schema, message: failure.message }));
  }
  async execute(): Promise<Result<void, OvhContractFailure>> {
    const parts: string[] = [];
    for (const file of ["ovh-dedicated.ts", "ovh-dedicated-api.ts", "ovh-dedicated-local.ts", "ovh-dedicated-reinstall.ts"] ) {
      const source = await this.read(`infra/providers/${file}`);
      if (source.isErr()) return err(source.error);
      parts.push(source.value);
    }
    const provider = new OvhContractSource({ label: "OVH provider", source: parts.join("\n") });
    const taskSource = await this.read("infra/tasks/providers.yml");
    if (taskSource.isErr()) return err(taskSource.error);
    const tasks = new OvhContractSource({ label: "OVH Taskfile", source: taskSource.value });
    const source = await this.read("infra/providers/ovh-dedicated-servers.yaml");
    if (source.isErr()) return err(source.error);
    const inventory = this.inventory(source.value);
    if (inventory.isErr()) return err(inventory.error);
    const providerRequired = provider.require([
      ".nook/ovh-api.json", "await chmod(dirname(target), 0o700)", "await chmod(target, 0o600)",
      "requiredCredentials", "/auth/currentCredential", "new OvhDedicatedGetServer({ credentials: candidate.value",
      "await rename(next, target)", ".nook/infra/ovh-host-identities", ".nook/infra/ovh-recovery",
      "postInstallationScript", "missing trusted SSH host identity", "stored SSH host keypair",
      "new OvhReinstallPreparation", "await markers.persist(context)", "RecoveryComplete", "markers.clear(",
      "approved US API endpoint", 'currentOperatingSystem === "none_64"', "allowReinstall", "/reinstall",
      "async complete()", "new OvhDedicatedRequireCompatibleTemplate", "server.value.admission(",
    ]);
    if (providerRequired.isErr()) return err(providerRequired.error);
    const providerForbidden = provider.forbid(["configDriveUserData", "applicationSecret}", "consumerKey}"]);
    if (providerForbidden.isErr()) return err(providerForbidden.error);
    const taskRequired = tasks.require([
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
]);
    if (taskRequired.isErr()) return err(taskRequired.error);
    const taskForbidden = tasks.forbid([
  "cloud-init",
  "PasswordAuthentication yes",
  'if ! sudo -n k0s kubectl get node "$node"',
  '"$known_hosts.merged"',
]);
    if (taskForbidden.isErr()) return err(taskForbidden.error);
    const admitted = new OvhContractInventory(inventory.value).admit();
    if (admitted.isErr()) return err(admitted.error);
    return new OvhContractSource({ label: "OVH inventory", source: source.value }).forbid([
  "applicationKey",
  "applicationSecret",
  "consumerKey",
  "password",
  "token",
]);
  }
}
const outcome = await new OvhProvisioningContract(resolve(import.meta.dir, "../..")).execute();
if (outcome.isErr()) { console.error(outcome.error.message); process.exitCode = 1; }
else console.log("OVH dedicated provisioning contract: ok");
