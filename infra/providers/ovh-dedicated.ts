import {
  OvhDedicatedOvhApi,
  OvhDedicatedGetServer,
  OvhDedicatedRequireCompatibleTemplate,
} from "./ovh-dedicated-api";
export { OvhDedicatedCreateOvhSignature } from "./ovh-dedicated-api";
import {
  type OvhCredentials,
  ArcTier,
  EndpointMode,
  CliAction,
  HttpMethod,
  ProvisionResult,
  RecoveryMarkerStatus,
  OvhTaskStatus,
  DedicatedServerField,
  type DedicatedServerDefinition,
  type DedicatedServerInventory,
  type CliArguments,
  type ApiRequest,
  type ReinstallRequest,
  type ProvisionContext,
  type HostIdentity,
  type HostIdentityInput,
  type OvhRecoveryMarker,
  type AbsentRecoveryMarker,
  type PendingRecoveryMarker,
  type RecoveryMarkerState,
} from "./ovh-dedicated-contracts";
export {
  OvhTaskStatus,
  type OvhRecoveryMarker,
} from "./ovh-dedicated-contracts";
import { OvhDocument } from "./ovh-dedicated-document";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

class OvhDedicatedRequireString {
  constructor(private readonly request: { label: string; value: string }) {}
  execute(): string {
    const input = this.request;

    if (input.value.trim().length === 0) {
      throw new Error(`${input.label} must not be empty`);
    }
    return input.value.trim();
  }
}

class OvhDedicatedExpandHome {
  constructor(private readonly request: string) {}
  execute(): string {
    const input = this.request;

    if (input === "~") return homeDirectory;
    if (input.startsWith("~/")) {
      return resolve(homeDirectory, input.slice(2));
    }
    return resolve(input);
  }
}

class OvhDedicatedPathExists {
  constructor(private readonly request: string) {}
  async execute(): Promise<boolean> {
    const path = this.request;

    return stat(path)
      .then(() => true)
      .catch(() => false);
  }
}

class OvhDedicatedRecoveryMarkerPath {
  constructor(private readonly request: string) {}
  execute(): string {
    const hostname = this.request;

    return resolve(recoveryMarkerRoot, `${hostname}.json`);
  }
}

export class OvhDedicatedRecoveryMarkerMatches {
  constructor(
    private readonly request: {
      definition: DedicatedServerDefinition;
      hostname: string;
      marker: OvhRecoveryMarker;
    },
  ) {}
  execute(): boolean {
    const input = this.request;

    return (
      input.marker.version === 1 &&
      input.marker.hostname === input.hostname &&
      input.marker.serviceName === input.definition.serviceName &&
      input.marker.operatingSystem === input.definition.operatingSystem
    );
  }
}

class OvhDedicatedLoadRecoveryMarker {
  constructor(
    private readonly request: {
      definition: DedicatedServerDefinition;
      hostname: string;
    },
  ) {}
  async execute(): Promise<RecoveryMarkerState> {
    const input = this.request;

    const path = new OvhDedicatedRecoveryMarkerPath(input.hostname).execute();
    if (!(await new OvhDedicatedPathExists(path).execute())) {
      return { status: RecoveryMarkerStatus.Absent };
    }
    const marker = OvhDocument.recoveryMarker(await readFile(path, "utf8"));
    if (
      !new OvhDedicatedRecoveryMarkerMatches({ ...input, marker }).execute()
    ) {
      throw new Error(
        `recovery marker for ${input.hostname} does not match inventory`,
      );
    }
    return { marker, status: RecoveryMarkerStatus.Pending };
  }
}

class OvhDedicatedPersistRecoveryMarker {
  constructor(
    private readonly request: {
      definition: DedicatedServerDefinition;
      hostname: string;
    },
  ) {}
  async execute(): Promise<void> {
    const input = this.request;

    await mkdir(recoveryMarkerRoot, { mode: 0o700, recursive: true });
    await chmod(recoveryMarkerRoot, 0o700);
    const path = new OvhDedicatedRecoveryMarkerPath(input.hostname).execute();
    const next = `${path}.next`;
    const marker: OvhRecoveryMarker = {
      hostname: input.hostname,
      operatingSystem: input.definition.operatingSystem,
      serviceName: input.definition.serviceName,
      version: 1,
    };
    await writeFile(next, `${JSON.stringify(marker)}\n`, { mode: 0o600 });
    await chmod(next, 0o600);
    await rename(next, path);
    await chmod(path, 0o600);
  }
}

class OvhDedicatedClearRecoveryMarker {
  constructor(
    private readonly request: {
      definition: DedicatedServerDefinition;
      hostname: string;
    },
  ) {}
  async execute(): Promise<void> {
    const input = this.request;

    const state = await new OvhDedicatedLoadRecoveryMarker(input).execute();
    if (state.status === RecoveryMarkerStatus.Absent) return;
    await rm(new OvhDedicatedRecoveryMarkerPath(input.hostname).execute());
  }
}

class OvhDedicatedRunCommand {
  constructor(private readonly request: string[]) {}
  async execute(): Promise<string> {
    const command = this.request;

    const process = Bun.spawn(command, {
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stdout] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
    ]);
    if (exitCode !== 0) throw new Error(`${command[0]} failed`);
    return stdout.trim();
  }
}

class OvhDedicatedLoadHostIdentity {
  constructor(private readonly request: HostIdentityInput) {}
  async execute(): Promise<HostIdentity> {
    const input = this.request;

    const directory = resolve(hostIdentityRoot, input.hostname);
    const privateKeyPath = resolve(directory, "ssh_host_ed25519_key");
    const publicKeyPath = `${privateKeyPath}.pub`;
    await mkdir(directory, { mode: 0o700, recursive: true });
    await chmod(hostIdentityRoot, 0o700);
    await chmod(directory, 0o700);
    if (!(await new OvhDedicatedPathExists(privateKeyPath).execute())) {
      if (!input.allowCreate) {
        throw new Error(
          `missing trusted SSH host identity for ${input.hostname}; restore it or explicitly reinstall the server`,
        );
      }
      await new OvhDedicatedRunCommand([
        "ssh-keygen",
        "-q",
        "-t",
        "ed25519",
        "-N",
        "",
        "-C",
        `nook-host:${input.hostname}`,
        "-f",
        privateKeyPath,
      ]).execute();
    }
    if (!(await new OvhDedicatedPathExists(publicKeyPath).execute())) {
      const publicKey = await new OvhDedicatedRunCommand([
        "ssh-keygen",
        "-y",
        "-f",
        privateKeyPath,
      ]).execute();
      await writeFile(publicKeyPath, `${publicKey}\n`, { mode: 0o600 });
    }
    await chmod(privateKeyPath, 0o600);
    await chmod(publicKeyPath, 0o600);
    const derivedPublicKey = await new OvhDedicatedRunCommand([
      "ssh-keygen",
      "-y",
      "-f",
      privateKeyPath,
    ]).execute();
    const derivedKeyMaterial = derivedPublicKey
      .split(/\s+/)
      .slice(0, 2)
      .join(" ");
    const storedPublicKey = (await readFile(publicKeyPath, "utf8")).trim();
    const storedKeyMaterial = storedPublicKey
      .split(/\s+/)
      .slice(0, 2)
      .join(" ");
    if (derivedKeyMaterial !== storedKeyMaterial) {
      throw new Error(
        `stored SSH host keypair for ${input.hostname} does not match`,
      );
    }
    const fingerprintOutput = await new OvhDedicatedRunCommand([
      "ssh-keygen",
      "-l",
      "-f",
      publicKeyPath,
      "-E",
      "sha256",
    ]).execute();
    const [, fingerprint = ""] = fingerprintOutput.split(/\s+/);
    if (!fingerprint.startsWith("SHA256:")) {
      throw new Error("generated SSH host identity has no SHA256 fingerprint");
    }
    return {
      fingerprint,
      privateKey: await readFile(privateKeyPath, "utf8"),
      publicKey: `${storedPublicKey}\n`,
    };
  }
}

class OvhDedicatedHostIdentityInstallScript {
  constructor(private readonly request: HostIdentity) {}
  execute(): string {
    const identity = this.request;

    const script = `#!/bin/sh
set -eu
install -d -m 0755 /etc/ssh
cat > /etc/ssh/ssh_host_ed25519_key <<'NOOK_PRIVATE_KEY'
${identity.privateKey.trim()}
NOOK_PRIVATE_KEY
cat > /etc/ssh/ssh_host_ed25519_key.pub <<'NOOK_PUBLIC_KEY'
${identity.publicKey.trim()}
NOOK_PUBLIC_KEY
chmod 0600 /etc/ssh/ssh_host_ed25519_key
chmod 0644 /etc/ssh/ssh_host_ed25519_key.pub
systemctl restart ssh.service
`;
    return Buffer.from(script).toString("base64");
  }
}

export class OvhDedicatedRequiresReinstall {
  constructor(
    private readonly request: {
      allowReinstall: boolean;
      currentOperatingSystem: string;
      desiredOperatingSystem: string;
    },
  ) {}
  execute(): boolean {
    const input = this.request;

    if (input.allowReinstall) return true;
    if (input.currentOperatingSystem === input.desiredOperatingSystem)
      return false;
    if (input.currentOperatingSystem === "none_64") return true;
    throw new Error(
      `refusing to replace ${input.currentOperatingSystem}; declare disaster recovery explicitly`,
    );
  }
}

export class OvhDedicatedIsTerminalTaskFailure {
  constructor(private readonly request: OvhTaskStatus) {}
  execute(): boolean {
    const status = this.request;

    return [
      OvhTaskStatus.Cancelled,
      OvhTaskStatus.CustomerError,
      OvhTaskStatus.OvhError,
    ].includes(status);
  }
}

class OvhDedicatedParseArguments {
  constructor(private readonly request: string[]) {}
  execute(): CliArguments {
    const argv = this.request;

    const [actionRaw = "", ...rest] = argv;
    const action = Object.values(CliAction).find(
      (value) => value === actionRaw,
    );
    if (!action) {
      throw new Error("unsupported OVH dedicated action");
    }
    const values = new Map<string, string>();
    for (let index = 0; index < rest.length; index += 2) {
      const [flag = "", value = ""] = rest.slice(index, index + 2);
      if (!flag.startsWith("--") || value.length === 0) {
        throw new Error(`invalid argument near ${flag}`);
      }
      values.set(flag.slice(2), value);
    }
    const [nodeValue = ""] = [values.get("node")];
    const [fieldRaw = DedicatedServerField.Hostname] = [values.get("field")];
    const [inventoryFile = defaultInventory] = [values.get("inventory")];
    const node = new OvhDedicatedRequireString({
      label: "node",
      value: nodeValue,
    }).execute();
    const field = Object.values(DedicatedServerField).find(
      (value) => value === fieldRaw,
    );
    if (!field) throw new Error(`unsupported field ${fieldRaw}`);
    return {
      action,
      allowReinstall: values.get("allow-reinstall") === "true",
      field,
      inventoryFile: new OvhDedicatedExpandHome(inventoryFile).execute(),
      node,
    };
  }
}

class OvhDedicatedLoadInventory {
  constructor(private readonly request: string) {}
  async execute(): Promise<DedicatedServerInventory> {
    const path = this.request;

    const parsed = OvhDocument.inventory(
      Bun.YAML.parse(await readFile(path, "utf8")),
    );
    if (!parsed.servers || typeof parsed.servers !== "object") {
      throw new Error("OVH server inventory has no servers mapping");
    }
    return parsed;
  }
}

class OvhDedicatedParseCredentials {
  constructor(private readonly request: string) {}
  async execute(): Promise<OvhCredentials> {
    const path = this.request;

    const parsed = OvhDocument.credentials(await readFile(path, "utf8"));
    const requiredCredentials: Array<[string, string]> = [
      ["applicationKey", parsed.applicationKey],
      ["applicationSecret", parsed.applicationSecret],
      ["consumerKey", parsed.consumerKey],
      ["endpoint", parsed.endpoint],
    ];
    for (const [label, value] of requiredCredentials) {
      new OvhDedicatedRequireString({ label: `OVH ${label}`, value }).execute();
    }
    return parsed;
  }
}

class OvhDedicatedLoadCredentials {
  constructor(
    private readonly request: {
      definition: DedicatedServerDefinition;
    },
  ) {}
  async execute(): Promise<OvhCredentials> {
    const input = this.request;

    const { OVH_CREDENTIAL_FILE: credentialFile = defaultCredentialFile } =
      process.env;
    const source = new OvhDedicatedExpandHome(credentialFile).execute();
    const target = defaultCredentialFile;
    await mkdir(dirname(target), { mode: 0o700, recursive: true });
    await chmod(dirname(target), 0o700);
    if (source === target) {
      await chmod(target, 0o600);
      return new OvhDedicatedParseCredentials(target).execute();
    }
    const candidate = await new OvhDedicatedParseCredentials(source).execute();
    const validationRequest: ApiRequest = {
      method: HttpMethod.Get,
      path: "/auth/currentCredential",
    };
    await new OvhDedicatedOvhApi({
      decode: OvhDocument.credentialValidation,
      credentials: candidate,
      request: validationRequest,
    }).execute();
    await new OvhDedicatedGetServer({
      credentials: candidate,
      definition: input.definition,
    }).execute();
    const next = `${target}.next`;
    await writeFile(next, await readFile(source), { mode: 0o600 });
    await chmod(next, 0o600);
    await rename(next, target);
    await chmod(target, 0o600);
    return candidate;
  }
}

enum ReinstallPreparationState {
  Ready = "ready",
  Consumed = "consumed",
}
interface ReadyReinstall {
  kind: ReinstallPreparationState.Ready;
  context: ProvisionContext;
  hostIdentity: HostIdentity;
  publicKey: string;
}
type ReinstallPreparation =
  ReadyReinstall | { kind: ReinstallPreparationState.Consumed };
enum ReinstallDispatchKind {
  Unchanged = "unchanged",
  Submitted = "submitted",
}
interface DispatchedReinstall {
  kind: ReinstallDispatchKind.Submitted;
  context: ProvisionContext;
  taskId: number;
}
type ReinstallDispatch =
  DispatchedReinstall | { kind: ReinstallDispatchKind.Unchanged };
type ReinstallSubmission =
  | { kind: ReinstallDispatchKind.Submitted; task: SubmittedOvhReinstall }
  | { kind: ReinstallDispatchKind.Unchanged };

/** Admission owns validated local inputs; dispatch still rechecks current server state. */
class PreparedOvhReinstall {
  #state: ReinstallPreparation;
  private constructor(input: ReadyReinstall) {
    this.#state = input;
  }
  static async prepare(input: ProvisionContext): Promise<PreparedOvhReinstall> {
    const context = {
      ...input,
      credentials: { ...input.credentials },
      definition: { ...input.definition },
    };
    await new OvhDedicatedRequireCompatibleTemplate(context).execute();
    const publicKey = await readFile(
      new OvhDedicatedExpandHome(context.definition.sshPublicKeyFile).execute(),
      "utf8",
    );
    if (!/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(context.hostname)) {
      throw new Error("hostname is not a valid lowercase host label");
    }
    if (
      !/^ssh-(?:ed25519|rsa) [A-Za-z0-9+/=]+(?: .*)?$/.test(publicKey.trim())
    ) {
      throw new Error("SSH public key must be an OpenSSH ed25519 or RSA key");
    }
    const hostIdentity = await new OvhDedicatedLoadHostIdentity({
      allowCreate: true,
      hostname: context.hostname,
    }).execute();
    return new PreparedOvhReinstall({
      kind: ReinstallPreparationState.Ready,
      context,
      hostIdentity,
      publicKey: publicKey.trim(),
    });
  }
  async dispatch(): Promise<ReinstallDispatch> {
    if (this.#state.kind === ReinstallPreparationState.Consumed)
      throw new Error("OVH reinstall preparation has already been consumed");
    const { context, hostIdentity, publicKey } = this.#state;
    this.#state = { kind: ReinstallPreparationState.Consumed };
    const payload: ReinstallRequest = {
      customizations: {
        hostname: context.hostname,
        postInstallationScript: new OvhDedicatedHostIdentityInstallScript(
          hostIdentity,
        ).execute(),
        sshKey: publicKey,
      },
      operatingSystem: context.definition.operatingSystem,
    };
    const request: ApiRequest = {
      body: JSON.stringify(payload),
      method: HttpMethod.Post,
      path:
        "/dedicated/server/" +
        encodeURIComponent(context.definition.serviceName) +
        "/reinstall",
    };
    const current = await new OvhDedicatedGetServer(context).execute();
    if (
      !new OvhDedicatedRequiresReinstall({
        allowReinstall: context.allowReinstall,
        currentOperatingSystem: current.os,
        desiredOperatingSystem: context.definition.operatingSystem,
      }).execute()
    ) {
      return { kind: ReinstallDispatchKind.Unchanged };
    }
    await new OvhDedicatedPersistRecoveryMarker(context).execute();
    const task = await new OvhDedicatedOvhApi({
      decode: OvhDocument.task,
      credentials: context.credentials,
      request,
    }).execute();
    return {
      kind: ReinstallDispatchKind.Submitted,
      context,
      taskId: task.taskId,
    };
  }
}

enum SubmittedReinstallState {
  Awaiting = "awaiting",
  Consumed = "consumed",
}
type SubmittedReinstall =
  | {
      kind: SubmittedReinstallState.Awaiting;
      context: ProvisionContext;
      taskId: number;
    }
  | { kind: SubmittedReinstallState.Consumed };
class SubmittedOvhReinstall {
  #state: SubmittedReinstall;
  private constructor(dispatched: DispatchedReinstall) {
    this.#state = {
      kind: SubmittedReinstallState.Awaiting,
      context: dispatched.context,
      taskId: dispatched.taskId,
    };
  }
  static async submit(
    prepared: PreparedOvhReinstall,
  ): Promise<ReinstallSubmission> {
    const dispatched = await prepared.dispatch();
    if (dispatched.kind === ReinstallDispatchKind.Unchanged) return dispatched;
    return {
      kind: ReinstallDispatchKind.Submitted,
      task: new SubmittedOvhReinstall(dispatched),
    };
  }
  async complete(): Promise<ProvisionResult> {
    if (this.#state.kind === SubmittedReinstallState.Consumed)
      throw new Error("OVH reinstall task has already been consumed");
    const { context, taskId } = this.#state;
    this.#state = { kind: SubmittedReinstallState.Consumed };
    const deadline = Date.now() + 45 * 60 * 1000;
    for (;;) {
      if (Date.now() >= deadline)
        throw new Error("OVH reinstall task exceeded 45 minutes");
      const request: ApiRequest = {
        method: HttpMethod.Get,
        path:
          "/dedicated/server/" +
          encodeURIComponent(context.definition.serviceName) +
          "/task/" +
          taskId,
      };
      const task = await new OvhDedicatedOvhApi({
        decode: OvhDocument.task,
        credentials: context.credentials,
        request,
      }).execute();
      if (task.status === OvhTaskStatus.Done) break;
      if (new OvhDedicatedIsTerminalTaskFailure(task.status).execute())
        throw new Error("OVH reinstall task ended in " + task.status);
      process.stderr.write("OVH reinstall " + task.status + "\n");
      await Bun.sleep(15_000);
    }
    const installed = await new OvhDedicatedGetServer(context).execute();
    if (installed.os !== context.definition.operatingSystem)
      throw new Error(
        "OVH task completed without the declared operating system",
      );
    return ProvisionResult.Reinstalled;
  }
}

class OvhDedicatedProvision {
  constructor(private readonly request: ProvisionContext) {}
  async execute(): Promise<ProvisionResult> {
    const input = this.request;
    const current = await new OvhDedicatedGetServer(input).execute();
    const recoveryMarker = await new OvhDedicatedLoadRecoveryMarker(
      input,
    ).execute();
    if (recoveryMarker.status === RecoveryMarkerStatus.Pending)
      return ProvisionResult.Reinstalled;
    if (
      !new OvhDedicatedRequiresReinstall({
        allowReinstall: input.allowReinstall,
        currentOperatingSystem: current.os,
        desiredOperatingSystem: input.definition.operatingSystem,
      }).execute()
    )
      return ProvisionResult.Unchanged;
    const submission = await SubmittedOvhReinstall.submit(
      await PreparedOvhReinstall.prepare(input),
    );
    if (submission.kind === ReinstallDispatchKind.Unchanged)
      return ProvisionResult.Unchanged;
    return submission.task.complete();
  }
}

const repositoryRoot = resolve(import.meta.dir, "../..");
const homeDirectory = process.env.HOME;
if (!homeDirectory)
  throw new Error("HOME must be set for the private credential store");
const defaultInventory = resolve(
  repositoryRoot,
  "infra/providers/ovh-dedicated-servers.yaml",
);
const defaultCredentialFile = resolve(homeDirectory, ".nook/ovh-api.json");
const hostIdentityRoot = resolve(
  homeDirectory,
  ".nook/infra/ovh-host-identities",
);
const recoveryMarkerRoot = resolve(homeDirectory, ".nook/infra/ovh-recovery");

async function main(): Promise<void> {
  const args = new OvhDedicatedParseArguments(Bun.argv.slice(2)).execute();
  const inventory = await new OvhDedicatedLoadInventory(
    args.inventoryFile,
  ).execute();
  const definition = inventory.servers[args.node];
  if (!definition) throw new Error(`unknown declared OVH server ${args.node}`);
  if (args.action === CliAction.Field) {
    process.stdout.write(
      `${args.field === DedicatedServerField.Hostname ? args.node : definition[args.field]}\n`,
    );
    return;
  }
  if (args.action === CliAction.HostFingerprint) {
    const hostIdentity = await new OvhDedicatedLoadHostIdentity({
      allowCreate: false,
      hostname: args.node,
    }).execute();
    process.stdout.write(`${hostIdentity.fingerprint}\n`);
    return;
  }
  if (args.action === CliAction.RecoveryComplete) {
    await new OvhDedicatedClearRecoveryMarker({
      definition,
      hostname: args.node,
    }).execute();
    return;
  }
  const credentials = await new OvhDedicatedLoadCredentials({
    definition,
  }).execute();
  if (args.action === CliAction.Inspect) {
    const server = await new OvhDedicatedGetServer({
      credentials,
      definition,
    }).execute();
    process.stdout.write(
      `${server.name}\t${server.ip}\t${server.commercialRange}\t${server.datacenter}\t${server.os}\t${server.state}\n`,
    );
    return;
  }
  if (args.action === CliAction.ReinstallRequired) {
    const recoveryMarker = await new OvhDedicatedLoadRecoveryMarker({
      definition,
      hostname: args.node,
    }).execute();
    const server = await new OvhDedicatedGetServer({
      credentials,
      definition,
    }).execute();
    const required =
      recoveryMarker.status === RecoveryMarkerStatus.Pending
        ? true
        : new OvhDedicatedRequiresReinstall({
            allowReinstall: args.allowReinstall,
            currentOperatingSystem: server.os,
            desiredOperatingSystem: definition.operatingSystem,
          }).execute();
    if (required) {
      await PreparedOvhReinstall.prepare({
        allowReinstall: args.allowReinstall,
        credentials,
        definition,
        hostname: args.node,
      });
    }
    process.stdout.write(`${required}\n`);
    return;
  }
  const context: ProvisionContext = {
    allowReinstall: args.allowReinstall,
    credentials,
    definition,
    hostname: args.node,
  };
  process.stdout.write(
    `${await new OvhDedicatedProvision(context).execute()}\n`,
  );
}

if (import.meta.main) {
  await main();
}
