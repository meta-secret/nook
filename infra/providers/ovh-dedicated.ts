import {createHash} from "node:crypto";
import {chmod,mkdir,readFile,rename,rm,stat,writeFile} from "node:fs/promises";
import {dirname,resolve} from "node:path";

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
    const marker = JSON.parse(
      await readFile(path, "utf8"),
    ) as OvhRecoveryMarker;
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

export class OvhDedicatedCreateOvhSignature {
  constructor(private readonly request: SignatureInput) {}
  execute(): string {
    const input = this.request;

    const material = [
      input.applicationSecret,
      input.consumerKey,
      input.method,
      input.url,
      input.body,
      input.timestamp,
    ].join("+");
    return `$1$${createHash("sha1").update(material).digest("hex")}`;
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

    const parsed = Bun.YAML.parse(
      await readFile(path, "utf8"),
    ) as DedicatedServerInventory;
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

    const parsed = JSON.parse(await readFile(path, "utf8")) as OvhCredentials;
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
    await new OvhDedicatedOvhApi<boolean>({
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

class OvhDedicatedApiRoot {
  constructor(private readonly request: OvhCredentials) {}
  execute(): string {
    const credentials = this.request;

    const roots: Record<string, string> = {
      "https://api.us.ovhcloud.com": "https://api.us.ovhcloud.com/1.0",
      "https://api.us.ovhcloud.com/1.0": "https://api.us.ovhcloud.com/1.0",
      "ovh-us": "https://api.us.ovhcloud.com/1.0",
    };
    const root = roots[credentials.endpoint];
    if (!root)
      throw new Error(
        "OVH credential endpoint is not an approved US API endpoint",
      );
    return root.endsWith("/1.0") ? root : `${root}/1.0`;
  }
}

class OvhDedicatedOvhApi<T> {
  constructor(
    private readonly request: {
      credentials: OvhCredentials;
      request: ApiRequest;
    },
  ) {}
  async execute(): Promise<T> {
    const input = this.request;

    const root = new OvhDedicatedApiRoot(input.credentials).execute();
    const { body = "" } = input.request;
    const url = `${root}${input.request.path}`;
    const timeResponse = await fetch(`${root}/auth/time`);
    if (!timeResponse.ok) throw new Error("OVH time endpoint failed");
    const timestamp = Number(await timeResponse.text());
    const signatureInput: SignatureInput = {
      applicationSecret: input.credentials.applicationSecret,
      body,
      consumerKey: input.credentials.consumerKey,
      method: input.request.method,
      timestamp,
      url,
    };
    const headers = new Headers({
      "Content-Type": "application/json",
      "X-Ovh-Application": input.credentials.applicationKey,
      "X-Ovh-Consumer": input.credentials.consumerKey,
      "X-Ovh-Signature": new OvhDedicatedCreateOvhSignature(
        signatureInput,
      ).execute(),
      "X-Ovh-Timestamp": String(timestamp),
    });
    const options: RequestInit = {
      headers,
      method: input.request.method,
    };
    if (input.request.method === HttpMethod.Post) options.body = body;
    const response = await fetch(url, options);
    const responseBody = await response.text();
    if (!response.ok) {
      throw new Error(
        `OVH API ${input.request.method} ${input.request.path} failed: HTTP_${response.status}`,
      );
    }
    return JSON.parse(responseBody) as T;
  }
}

class OvhDedicatedValidateServer {
  constructor(
    private readonly request: {
      definition: DedicatedServerDefinition;
      server: OvhServer;
    },
  ) {}
  execute(): void {
    const input = this.request;

    const expected = input.definition;
    const actual = input.server;
    if (
      actual.name !== expected.serviceName ||
      actual.ip !== expected.publicAddress ||
      actual.commercialRange !== expected.expectedCommercialRange ||
      actual.datacenter !== expected.expectedDatacenter ||
      actual.state !== OvhServerState.Ready
    ) {
      throw new Error(
        "OVH server does not match the declared identity and ready-state contract",
      );
    }
  }
}

class OvhDedicatedGetServer {
  constructor(
    private readonly request: {
      credentials: OvhCredentials;
      definition: DedicatedServerDefinition;
    },
  ) {}
  async execute(): Promise<OvhServer> {
    const input = this.request;

    const request: ApiRequest = {
      method: HttpMethod.Get,
      path: `/dedicated/server/${encodeURIComponent(input.definition.serviceName)}`,
    };
    const server = await new OvhDedicatedOvhApi<OvhServer>({
      credentials: input.credentials,
      request,
    }).execute();
    new OvhDedicatedValidateServer({
      definition: input.definition,
      server,
    }).execute();
    return server;
  }
}

class OvhDedicatedRequireCompatibleTemplate {
  constructor(
    private readonly request: {
      credentials: OvhCredentials;
      definition: DedicatedServerDefinition;
    },
  ) {}
  async execute(): Promise<void> {
    const input = this.request;

    const request: ApiRequest = {
      method: HttpMethod.Get,
      path: `/dedicated/server/${encodeURIComponent(input.definition.serviceName)}/install/compatibleTemplates`,
    };
    const templates = await new OvhDedicatedOvhApi<CompatibleTemplates>({
      credentials: input.credentials,
      request,
    }).execute();
    if (!templates.ovh.includes(input.definition.operatingSystem)) {
      throw new Error(
        "declared operating system is not compatible with this server",
      );
    }
  }
}

class OvhDedicatedPrepareReinstall {
  constructor(private readonly request: ProvisionContext) {}
  async execute(): Promise<PreparedReinstall> {
    const input = this.request;

    await new OvhDedicatedRequireCompatibleTemplate({
      credentials: input.credentials,
      definition: input.definition,
    }).execute();
    const publicKey = await readFile(
      new OvhDedicatedExpandHome(input.definition.sshPublicKeyFile).execute(),
      "utf8",
    );
    if (!/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(input.hostname)) {
      throw new Error("hostname is not a valid lowercase host label");
    }
    if (
      !/^ssh-(?:ed25519|rsa) [A-Za-z0-9+/=]+(?: .*)?$/.test(publicKey.trim())
    ) {
      throw new Error("SSH public key must be an OpenSSH ed25519 or RSA key");
    }
    return {
      hostIdentity: await new OvhDedicatedLoadHostIdentity({
        allowCreate: true,
        hostname: input.hostname,
      }).execute(),
      publicKey: publicKey.trim(),
    };
  }
}

class OvhDedicatedWaitForTask {
  constructor(
    private readonly request: {
      credentials: OvhCredentials;
      definition: DedicatedServerDefinition;
      taskId: number;
    },
  ) {}
  async execute(): Promise<void> {
    const input = this.request;

    const deadline = Date.now() + 45 * 60 * 1000;
    while (Date.now() < deadline) {
      const request: ApiRequest = {
        method: HttpMethod.Get,
        path: `/dedicated/server/${encodeURIComponent(input.definition.serviceName)}/task/${input.taskId}`,
      };
      const task = await new OvhDedicatedOvhApi<OvhTask>({
        credentials: input.credentials,
        request,
      }).execute();
      if (task.status === OvhTaskStatus.Done) return;
      if (new OvhDedicatedIsTerminalTaskFailure(task.status).execute()) {
        throw new Error(`OVH reinstall task ended in ${task.status}`);
      }
      process.stderr.write(`OVH reinstall ${task.status}\n`);
      await Bun.sleep(15_000);
    }
    throw new Error("OVH reinstall task exceeded 45 minutes");
  }
}

class OvhDedicatedProvision {
  constructor(private readonly request: ProvisionContext) {}
  async execute(): Promise<ProvisionResult> {
    const input = this.request;

    const current = await new OvhDedicatedGetServer({
      credentials: input.credentials,
      definition: input.definition,
    }).execute();
    const recoveryMarker = await new OvhDedicatedLoadRecoveryMarker({
      definition: input.definition,
      hostname: input.hostname,
    }).execute();
    if (recoveryMarker.status === RecoveryMarkerStatus.Pending) {
      return ProvisionResult.Reinstalled;
    }
    const reinstallInput = {
      allowReinstall: input.allowReinstall,
      currentOperatingSystem: current.os,
      desiredOperatingSystem: input.definition.operatingSystem,
    };
    if (!new OvhDedicatedRequiresReinstall(reinstallInput).execute())
      return ProvisionResult.Unchanged;
    const prepared = await new OvhDedicatedPrepareReinstall(input).execute();
    const payload: ReinstallRequest = {
      customizations: {
        hostname: input.hostname,
        postInstallationScript: new OvhDedicatedHostIdentityInstallScript(
          prepared.hostIdentity,
        ).execute(),
        sshKey: prepared.publicKey,
      },
      operatingSystem: input.definition.operatingSystem,
    };
    const request: ApiRequest = {
      body: JSON.stringify(payload),
      method: HttpMethod.Post,
      path: `/dedicated/server/${encodeURIComponent(input.definition.serviceName)}/reinstall`,
    };
    const preSubmission = await new OvhDedicatedGetServer({
      credentials: input.credentials,
      definition: input.definition,
    }).execute();
    const preSubmissionInput = {
      allowReinstall: input.allowReinstall,
      currentOperatingSystem: preSubmission.os,
      desiredOperatingSystem: input.definition.operatingSystem,
    };
    if (!new OvhDedicatedRequiresReinstall(preSubmissionInput).execute())
      return ProvisionResult.Unchanged;
    await new OvhDedicatedPersistRecoveryMarker({
      definition: input.definition,
      hostname: input.hostname,
    }).execute();
    const task = await new OvhDedicatedOvhApi<OvhTask>({
      credentials: input.credentials,
      request,
    }).execute();
    await new OvhDedicatedWaitForTask({
      credentials: input.credentials,
      definition: input.definition,
      taskId: task.taskId,
    }).execute();
    const installed = await new OvhDedicatedGetServer({
      credentials: input.credentials,
      definition: input.definition,
    }).execute();
    if (installed.os !== input.definition.operatingSystem) {
      throw new Error(
        "OVH task completed without the declared operating system",
      );
    }
    return ProvisionResult.Reinstalled;
  }
}

interface OvhCredentials {
  applicationKey: string;
  applicationSecret: string;
  consumerKey: string;
  endpoint: string;
}

interface OvhServer {
  commercialRange: string;
  datacenter: string;
  ip: string;
  name: string;
  os: string;
  state: string;
}

enum ArcTier {
  Overflow = "overflow",
  Primary = "primary",
  Secondary = "secondary",
}

enum EndpointMode {
  Direct = "direct",
  Roaming = "roaming",
}

enum CliAction {
  Field = "field",
  HostFingerprint = "host-fingerprint",
  Inspect = "inspect",
  Provision = "provision",
  RecoveryComplete = "recovery-complete",
  ReinstallRequired = "reinstall-required",
}

enum HttpMethod {
  Get = "GET",
  Post = "POST",
}

enum ProvisionResult {
  Reinstalled = "reinstalled",
  Unchanged = "unchanged",
}

enum RecoveryMarkerStatus {
  Absent = "absent",
  Pending = "pending",
}

enum OvhServerState {
  Ready = "ok",
}

export enum OvhTaskStatus {
  Cancelled = "cancelled",
  CustomerError = "customerError",
  Doing = "doing",
  Done = "done",
  Init = "init",
  OvhError = "ovhError",
  Todo = "todo",
}

enum DedicatedServerField {
  ArcTier = "arcTier",
  EndpointMode = "endpointMode",
  ExpectedCommercialRange = "expectedCommercialRange",
  ExpectedDatacenter = "expectedDatacenter",
  Hostname = "hostname",
  MeshAddress = "meshAddress",
  OperatingSystem = "operatingSystem",
  PublicAddress = "publicAddress",
  ServiceName = "serviceName",
  SshPublicKeyFile = "sshPublicKeyFile",
  SshUser = "sshUser",
}

interface OvhTask {
  status: OvhTaskStatus;
  taskId: number;
}

interface CompatibleTemplates {
  ovh: string[];
}

interface DedicatedServerDefinition {
  arcTier: ArcTier;
  endpointMode: EndpointMode;
  expectedCommercialRange: string;
  expectedDatacenter: string;
  meshAddress: string;
  operatingSystem: string;
  publicAddress: string;
  serviceName: string;
  sshPublicKeyFile: string;
  sshUser: string;
}

interface DedicatedServerInventory {
  servers: Record<string, DedicatedServerDefinition>;
}

interface CliArguments {
  action: CliAction;
  allowReinstall: boolean;
  field: DedicatedServerField;
  inventoryFile: string;
  node: string;
}

interface ApiRequest {
  body?: string;
  method: HttpMethod;
  path: string;
}

interface SignatureInput {
  applicationSecret: string;
  body: string;
  consumerKey: string;
  method: string;
  timestamp: number;
  url: string;
}

interface ReinstallRequest {
  customizations: {
    hostname: string;
    postInstallationScript: string;
    sshKey: string;
  };
  operatingSystem: string;
}

interface ProvisionContext {
  allowReinstall: boolean;
  credentials: OvhCredentials;
  definition: DedicatedServerDefinition;
  hostname: string;
}

interface HostIdentity {
  fingerprint: string;
  privateKey: string;
  publicKey: string;
}

interface HostIdentityInput {
  allowCreate: boolean;
  hostname: string;
}

interface PreparedReinstall {
  hostIdentity: HostIdentity;
  publicKey: string;
}

export interface OvhRecoveryMarker {
  hostname: string;
  operatingSystem: string;
  serviceName: string;
  version: 1;
}

interface AbsentRecoveryMarker {
  status: RecoveryMarkerStatus.Absent;
}

interface PendingRecoveryMarker {
  marker: OvhRecoveryMarker;
  status: RecoveryMarkerStatus.Pending;
}

type RecoveryMarkerState = AbsentRecoveryMarker | PendingRecoveryMarker;

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
      await new OvhDedicatedPrepareReinstall({
        allowReinstall: args.allowReinstall,
        credentials,
        definition,
        hostname: args.node,
      }).execute();
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
