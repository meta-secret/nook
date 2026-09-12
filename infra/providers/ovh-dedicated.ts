import { resolve } from "node:path";
import { err, ok, type Result } from "neverthrow";
import { OvhFailure, OvhFailureKind } from "./ovh-dedicated-failure";
import { OvhDedicatedGetServer } from "./ovh-dedicated-api";
import { OvhCredentialStore, OvhHostIdentityStore, OvhInventoryFile, OvhPrivatePaths, OvhRecoveryMarkerStore } from "./ovh-dedicated-local";
import { OvhDedicatedProvision, OvhReinstallIntent, OvhReinstallPreparation, ReinstallDecision } from "./ovh-dedicated-reinstall";
import { CliAction, DedicatedServerField, HostIdentityCreation, RecoveryMarkerStatus,
  ReinstallAuthorization, type CliArguments, type ProvisionContext } from "./ovh-dedicated-contracts";
export { OvhDedicatedCreateOvhSignature } from "./ovh-dedicated-api";
export { OvhTaskStatus, OvhTaskOutcome, ReinstallAuthorization, type OvhRecoveryMarker } from "./ovh-dedicated-contracts";
export { OvhReinstallIntent, ReinstallDecision } from "./ovh-dedicated-reinstall";

class OvhDedicatedArguments {
  constructor(private readonly paths: OvhPrivatePaths) {}
  parse(argv: string[]): Result<CliArguments, OvhFailure> {
    const [actionRaw = "", ...rest] = argv;
    const action = Object.values(CliAction).find(
      (value) => String(value) === actionRaw,
    );
    if (!action) return err(new OvhFailure(OvhFailureKind.Arguments, "unsupported OVH dedicated action"));
    const values = new Map<string, string>();
    for (let index = 0; index < rest.length; index += 2) {
      const [flag = "", value = ""] = rest.slice(index, index + 2);
      if (!flag.startsWith("--") || value.length === 0)
        return err(new OvhFailure(OvhFailureKind.Arguments, `invalid argument near ${flag}`));
      values.set(flag.slice(2), value);
    }
    const [nodeValue = ""] = [values.get("node")];
    const [fieldRaw = DedicatedServerField.Hostname] = [values.get("field")];
    const [inventoryFile = resolve(import.meta.dir, "ovh-dedicated-servers.yaml")] = [values.get("inventory")];
    const node = nodeValue.trim();
    if (!node) return err(new OvhFailure(OvhFailureKind.Arguments, "node must not be empty"));
    const field = Object.values(DedicatedServerField).find(
      (value) => String(value) === fieldRaw,
    );
    if (!field) return err(new OvhFailure(OvhFailureKind.Arguments, `unsupported field ${fieldRaw}`));
    return ok({ action, allowReinstall: values.get("allow-reinstall") === "true" ? ReinstallAuthorization.Replace : ReinstallAuthorization.Preserve,
      field, inventoryFile: this.paths.expand(inventoryFile), node });
  }
}

class OvhDedicatedCommand {
  constructor(private readonly paths: OvhPrivatePaths) {}
  async execute(argv: string[]): Promise<Result<void, OvhFailure>> {
    const parsed = new OvhDedicatedArguments(this.paths).parse(argv);
    if (parsed.isErr()) return err(parsed.error);
    const args = parsed.value;
    const inventory = await new OvhInventoryFile(args.inventoryFile).load();
    if (inventory.isErr()) return err(inventory.error);
    const definition = inventory.value.servers[args.node];
    if (!definition) return err(new OvhFailure(OvhFailureKind.Arguments, `unknown declared OVH server ${args.node}`));
    if (args.action === CliAction.Field) {
      process.stdout.write(`${args.field === DedicatedServerField.Hostname ? args.node : definition[args.field]}\n`);
      return ok();
    }
    if (args.action === CliAction.HostFingerprint) {
      const identity = await new OvhHostIdentityStore(this.paths).load({ allowCreate: HostIdentityCreation.Existing, hostname: args.node });
      if (identity.isErr()) return err(identity.error);
      process.stdout.write(`${identity.value.fingerprint}\n`);
      return ok();
    }
    const markers = new OvhRecoveryMarkerStore(this.paths);
    if (args.action === CliAction.RecoveryComplete) return markers.clear({ definition, hostname: args.node });
    const credentials = await new OvhCredentialStore(this.paths).load(definition);
    if (credentials.isErr()) return err(credentials.error);
    if (args.action === CliAction.Inspect) {
      const admitted = await new OvhDedicatedGetServer({ credentials: credentials.value, definition }).execute();
      if (admitted.isErr()) return err(admitted.error);
      const server = admitted.value;
      const observed = server.toJSON();
      process.stdout.write(`${observed.name}\t${observed.ip}\t${observed.commercialRange}\t${observed.datacenter}\t${observed.os}\t${observed.state}\n`);
      return ok();
    }
    const context: ProvisionContext = { allowReinstall: args.allowReinstall,
      credentials: credentials.value, definition, hostname: args.node };
    if (args.action === CliAction.ReinstallRequired) {
      const marker = await markers.load(context);
      if (marker.isErr()) return err(marker.error);
      const server = await new OvhDedicatedGetServer(context).execute();
      if (server.isErr()) return err(server.error);
      const decision = marker.value.status === RecoveryMarkerStatus.Pending ? ok<ReinstallDecision, OvhFailure>(ReinstallDecision.Required)
        : new OvhReinstallIntent({ allowReinstall: args.allowReinstall,
          currentOperatingSystem: server.value.os, desiredOperatingSystem: definition.operatingSystem }).decision();
      if (decision.isErr()) return err(decision.error);
      if (decision.value === ReinstallDecision.Required) {
        const prepared = await new OvhReinstallPreparation(this.paths).prepare(context);
        if (prepared.isErr()) return err(prepared.error);
      }
      process.stdout.write(`${decision.value === ReinstallDecision.Required}\n`);
      return ok();
    }
    const provisioned = await new OvhDedicatedProvision(this.paths).execute(context);
    if (provisioned.isErr()) return err(provisioned.error);
    process.stdout.write(`${provisioned.value}\n`);
    return ok();
  }
}
if (import.meta.main) {
  const home = process.env.HOME;
  const outcome = home ? await new OvhDedicatedCommand(new OvhPrivatePaths(home)).execute(Bun.argv.slice(2))
    : err<void, OvhFailure>(new OvhFailure(OvhFailureKind.Arguments, "HOME must be set for the private credential store"));
  if (outcome.isErr()) { console.error(outcome.error.message); process.exitCode = 1; }
}
