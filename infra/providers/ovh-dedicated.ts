import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

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
if (!homeDirectory) throw new Error("HOME must be set for the private credential store");
const defaultInventory = resolve(
  repositoryRoot,
  "infra/providers/ovh-dedicated-servers.yaml",
);
const defaultCredentialFile = resolve(
  homeDirectory,
  ".nook/ovh-api.json",
);
const hostIdentityRoot = resolve(
  homeDirectory,
  ".nook/infra/ovh-host-identities",
);
const recoveryMarkerRoot = resolve(
  homeDirectory,
  ".nook/infra/ovh-recovery",
);

function requireString(input: { label: string; value: string }): string {
  if (input.value.trim().length === 0) {
    throw new Error(`${input.label} must not be empty`);
  }
  return input.value.trim();
}

function expandHome(input: string): string {
  if (input === "~") return homeDirectory;
  if (input.startsWith("~/")) {
    return resolve(homeDirectory, input.slice(2));
  }
  return resolve(input);
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path)
    .then(() => true)
    .catch(() => false);
}

function recoveryMarkerPath(hostname: string): string {
  return resolve(recoveryMarkerRoot, `${hostname}.json`);
}

export function recoveryMarkerMatches(input: {
  definition: DedicatedServerDefinition;
  hostname: string;
  marker: OvhRecoveryMarker;
}): boolean {
  return (
    input.marker.version === 1 &&
    input.marker.hostname === input.hostname &&
    input.marker.serviceName === input.definition.serviceName &&
    input.marker.operatingSystem === input.definition.operatingSystem
  );
}

async function loadRecoveryMarker(input: {
  definition: DedicatedServerDefinition;
  hostname: string;
}): Promise<RecoveryMarkerState> {
  const path = recoveryMarkerPath(input.hostname);
  if (!(await pathExists(path))) {
    return { status: RecoveryMarkerStatus.Absent };
  }
  const marker = JSON.parse(await readFile(path, "utf8")) as OvhRecoveryMarker;
  if (!recoveryMarkerMatches({ ...input, marker })) {
    throw new Error(`recovery marker for ${input.hostname} does not match inventory`);
  }
  return { marker, status: RecoveryMarkerStatus.Pending };
}

async function persistRecoveryMarker(input: {
  definition: DedicatedServerDefinition;
  hostname: string;
}): Promise<void> {
  await mkdir(recoveryMarkerRoot, { mode: 0o700, recursive: true });
  await chmod(recoveryMarkerRoot, 0o700);
  const path = recoveryMarkerPath(input.hostname);
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

async function clearRecoveryMarker(input: {
  definition: DedicatedServerDefinition;
  hostname: string;
}): Promise<void> {
  const state = await loadRecoveryMarker(input);
  if (state.status === RecoveryMarkerStatus.Absent) return;
  await rm(recoveryMarkerPath(input.hostname));
}

async function runCommand(command: string[]): Promise<string> {
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

async function loadHostIdentity(input: HostIdentityInput): Promise<HostIdentity> {
  const directory = resolve(hostIdentityRoot, input.hostname);
  const privateKeyPath = resolve(directory, "ssh_host_ed25519_key");
  const publicKeyPath = `${privateKeyPath}.pub`;
  await mkdir(directory, { mode: 0o700, recursive: true });
  await chmod(hostIdentityRoot, 0o700);
  await chmod(directory, 0o700);
  if (!(await pathExists(privateKeyPath))) {
    if (!input.allowCreate) {
      throw new Error(
        `missing trusted SSH host identity for ${input.hostname}; restore it or explicitly reinstall the server`,
      );
    }
    await runCommand([
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
    ]);
  }
  if (!(await pathExists(publicKeyPath))) {
    const publicKey = await runCommand(["ssh-keygen", "-y", "-f", privateKeyPath]);
    await writeFile(publicKeyPath, `${publicKey}\n`, { mode: 0o600 });
  }
  await chmod(privateKeyPath, 0o600);
  await chmod(publicKeyPath, 0o600);
  const derivedPublicKey = await runCommand([
    "ssh-keygen",
    "-y",
    "-f",
    privateKeyPath,
  ]);
  const derivedKeyMaterial = derivedPublicKey.split(/\s+/).slice(0, 2).join(" ");
  const storedPublicKey = (await readFile(publicKeyPath, "utf8")).trim();
  const storedKeyMaterial = storedPublicKey.split(/\s+/).slice(0, 2).join(" ");
  if (derivedKeyMaterial !== storedKeyMaterial) {
    throw new Error(`stored SSH host keypair for ${input.hostname} does not match`);
  }
  const fingerprintOutput = await runCommand([
    "ssh-keygen",
    "-l",
    "-f",
    publicKeyPath,
    "-E",
    "sha256",
  ]);
  const fingerprint = fingerprintOutput.split(/\s+/)[1] ?? "";
  if (!fingerprint.startsWith("SHA256:")) {
    throw new Error("generated SSH host identity has no SHA256 fingerprint");
  }
  return {
    fingerprint,
    privateKey: await readFile(privateKeyPath, "utf8"),
    publicKey: `${storedPublicKey}\n`,
  };
}

function hostIdentityInstallScript(identity: HostIdentity): string {
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

export function createOvhSignature(input: SignatureInput): string {
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

export function requiresReinstall(input: {
  allowReinstall: boolean;
  currentOperatingSystem: string;
  desiredOperatingSystem: string;
}): boolean {
  if (input.allowReinstall) return true;
  if (input.currentOperatingSystem === input.desiredOperatingSystem) return false;
  if (input.currentOperatingSystem === "none_64") return true;
  throw new Error(
    `refusing to replace ${input.currentOperatingSystem}; declare disaster recovery explicitly`,
  );
}

export function isTerminalTaskFailure(status: OvhTaskStatus): boolean {
  return [
    OvhTaskStatus.Cancelled,
    OvhTaskStatus.CustomerError,
    OvhTaskStatus.OvhError,
  ].includes(status);
}

function parseArguments(argv: string[]): CliArguments {
  const [actionRaw = "", ...rest] = argv;
  const action = Object.values(CliAction).find((value) => value === actionRaw);
  if (!action) {
    throw new Error("unsupported OVH dedicated action");
  }
  const values = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index] ?? "";
    const value = rest[index + 1] ?? "";
    if (!flag.startsWith("--") || value.length === 0) {
      throw new Error(`invalid argument near ${flag}`);
    }
    values.set(flag.slice(2), value);
  }
  const node = requireString({ label: "node", value: values.get("node") ?? "" });
  const fieldRaw = values.get("field") ?? DedicatedServerField.Hostname;
  const field = Object.values(DedicatedServerField).find(
    (value) => value === fieldRaw,
  );
  if (!field) throw new Error(`unsupported field ${fieldRaw}`);
  return {
    action,
    allowReinstall: values.get("allow-reinstall") === "true",
    field,
    inventoryFile: expandHome(values.get("inventory") ?? defaultInventory),
    node,
  };
}

async function loadInventory(path: string): Promise<DedicatedServerInventory> {
  const parsed = Bun.YAML.parse(await readFile(path, "utf8")) as DedicatedServerInventory;
  if (!parsed.servers || typeof parsed.servers !== "object") {
    throw new Error("OVH server inventory has no servers mapping");
  }
  return parsed;
}

async function parseCredentials(path: string): Promise<OvhCredentials> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as OvhCredentials;
  const requiredCredentials: Array<[string, string]> = [
    ["applicationKey", parsed.applicationKey],
    ["applicationSecret", parsed.applicationSecret],
    ["consumerKey", parsed.consumerKey],
    ["endpoint", parsed.endpoint],
  ];
  for (const [label, value] of requiredCredentials) {
    requireString({ label: `OVH ${label}`, value });
  }
  return parsed;
}

async function loadCredentials(input: {
  definition: DedicatedServerDefinition;
}): Promise<OvhCredentials> {
  const source = expandHome(
    process.env.OVH_CREDENTIAL_FILE ?? defaultCredentialFile,
  );
  const target = defaultCredentialFile;
  await mkdir(dirname(target), { mode: 0o700, recursive: true });
  await chmod(dirname(target), 0o700);
  if (source === target) {
    await chmod(target, 0o600);
    return parseCredentials(target);
  }
  const candidate = await parseCredentials(source);
  const validationRequest: ApiRequest = {
    method: HttpMethod.Get,
    path: "/auth/currentCredential",
  };
  await ovhApi<boolean>({ credentials: candidate, request: validationRequest });
  await getServer({ credentials: candidate, definition: input.definition });
  const next = `${target}.next`;
  await writeFile(next, await readFile(source), { mode: 0o600 });
  await chmod(next, 0o600);
  await rename(next, target);
  await chmod(target, 0o600);
  return candidate;
}

function apiRoot(credentials: OvhCredentials): string {
  const roots: Record<string, string> = {
    "https://api.us.ovhcloud.com": "https://api.us.ovhcloud.com/1.0",
    "https://api.us.ovhcloud.com/1.0": "https://api.us.ovhcloud.com/1.0",
    "ovh-us": "https://api.us.ovhcloud.com/1.0",
  };
  const root = roots[credentials.endpoint];
  if (!root) throw new Error("OVH credential endpoint is not an approved US API endpoint");
  return root.endsWith("/1.0") ? root : `${root}/1.0`;
}

async function ovhApi<T>(input: {
  credentials: OvhCredentials;
  request: ApiRequest;
}): Promise<T> {
  const root = apiRoot(input.credentials);
  const body = input.request.body ?? "";
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
    "X-Ovh-Signature": createOvhSignature(signatureInput),
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

function validateServer(input: {
  definition: DedicatedServerDefinition;
  server: OvhServer;
}): void {
  const expected = input.definition;
  const actual = input.server;
  if (
    actual.name !== expected.serviceName ||
    actual.ip !== expected.publicAddress ||
    actual.commercialRange !== expected.expectedCommercialRange ||
    actual.datacenter !== expected.expectedDatacenter ||
    actual.state !== OvhServerState.Ready
  ) {
    throw new Error("OVH server does not match the declared identity and ready-state contract");
  }
}

async function getServer(input: {
  credentials: OvhCredentials;
  definition: DedicatedServerDefinition;
}): Promise<OvhServer> {
  const request: ApiRequest = {
    method: HttpMethod.Get,
    path: `/dedicated/server/${encodeURIComponent(input.definition.serviceName)}`,
  };
  const server = await ovhApi<OvhServer>({
    credentials: input.credentials,
    request,
  });
  validateServer({ definition: input.definition, server });
  return server;
}

async function requireCompatibleTemplate(input: {
  credentials: OvhCredentials;
  definition: DedicatedServerDefinition;
}): Promise<void> {
  const request: ApiRequest = {
    method: HttpMethod.Get,
    path: `/dedicated/server/${encodeURIComponent(input.definition.serviceName)}/install/compatibleTemplates`,
  };
  const templates = await ovhApi<CompatibleTemplates>({
    credentials: input.credentials,
    request,
  });
  if (!templates.ovh.includes(input.definition.operatingSystem)) {
    throw new Error("declared operating system is not compatible with this server");
  }
}

async function prepareReinstall(input: ProvisionContext): Promise<PreparedReinstall> {
  await requireCompatibleTemplate({
    credentials: input.credentials,
    definition: input.definition,
  });
  const publicKey = await readFile(
    expandHome(input.definition.sshPublicKeyFile),
    "utf8",
  );
  if (!/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(input.hostname)) {
    throw new Error("hostname is not a valid lowercase host label");
  }
  if (!/^ssh-(?:ed25519|rsa) [A-Za-z0-9+/=]+(?: .*)?$/.test(publicKey.trim())) {
    throw new Error("SSH public key must be an OpenSSH ed25519 or RSA key");
  }
  return {
    hostIdentity: await loadHostIdentity({
      allowCreate: true,
      hostname: input.hostname,
    }),
    publicKey: publicKey.trim(),
  };
}

async function waitForTask(input: {
  credentials: OvhCredentials;
  definition: DedicatedServerDefinition;
  taskId: number;
}): Promise<void> {
  const deadline = Date.now() + 45 * 60 * 1000;
  while (Date.now() < deadline) {
    const request: ApiRequest = {
      method: HttpMethod.Get,
      path: `/dedicated/server/${encodeURIComponent(input.definition.serviceName)}/task/${input.taskId}`,
    };
    const task = await ovhApi<OvhTask>({ credentials: input.credentials, request });
    if (task.status === OvhTaskStatus.Done) return;
    if (isTerminalTaskFailure(task.status)) {
      throw new Error(`OVH reinstall task ended in ${task.status}`);
    }
    process.stderr.write(`OVH reinstall ${task.status}\n`);
    await Bun.sleep(15_000);
  }
  throw new Error("OVH reinstall task exceeded 45 minutes");
}

async function provision(input: ProvisionContext): Promise<ProvisionResult> {
  const current = await getServer({
    credentials: input.credentials,
    definition: input.definition,
  });
  const recoveryMarker = await loadRecoveryMarker({
    definition: input.definition,
    hostname: input.hostname,
  });
  if (recoveryMarker.status === RecoveryMarkerStatus.Pending) {
    return ProvisionResult.Reinstalled;
  }
  const reinstallInput = {
    allowReinstall: input.allowReinstall,
    currentOperatingSystem: current.os,
    desiredOperatingSystem: input.definition.operatingSystem,
  };
  if (!requiresReinstall(reinstallInput)) return ProvisionResult.Unchanged;
  const prepared = await prepareReinstall(input);
  const payload: ReinstallRequest = {
    customizations: {
      hostname: input.hostname,
      postInstallationScript: hostIdentityInstallScript(prepared.hostIdentity),
      sshKey: prepared.publicKey,
    },
    operatingSystem: input.definition.operatingSystem,
  };
  const request: ApiRequest = {
    body: JSON.stringify(payload),
    method: HttpMethod.Post,
    path: `/dedicated/server/${encodeURIComponent(input.definition.serviceName)}/reinstall`,
  };
  const preSubmission = await getServer({
    credentials: input.credentials,
    definition: input.definition,
  });
  const preSubmissionInput = {
    allowReinstall: input.allowReinstall,
    currentOperatingSystem: preSubmission.os,
    desiredOperatingSystem: input.definition.operatingSystem,
  };
  if (!requiresReinstall(preSubmissionInput)) return ProvisionResult.Unchanged;
  await persistRecoveryMarker({
    definition: input.definition,
    hostname: input.hostname,
  });
  const task = await ovhApi<OvhTask>({ credentials: input.credentials, request });
  await waitForTask({
    credentials: input.credentials,
    definition: input.definition,
    taskId: task.taskId,
  });
  const installed = await getServer({
    credentials: input.credentials,
    definition: input.definition,
  });
  if (installed.os !== input.definition.operatingSystem) {
    throw new Error("OVH task completed without the declared operating system");
  }
  return ProvisionResult.Reinstalled;
}

async function main(): Promise<void> {
  const args = parseArguments(Bun.argv.slice(2));
  const inventory = await loadInventory(args.inventoryFile);
  const definition = inventory.servers[args.node];
  if (!definition) throw new Error(`unknown declared OVH server ${args.node}`);
  if (args.action === CliAction.Field) {
    process.stdout.write(
      `${args.field === DedicatedServerField.Hostname ? args.node : definition[args.field]}\n`,
    );
    return;
  }
  if (args.action === CliAction.HostFingerprint) {
    const hostIdentity = await loadHostIdentity({
      allowCreate: false,
      hostname: args.node,
    });
    process.stdout.write(`${hostIdentity.fingerprint}\n`);
    return;
  }
  if (args.action === CliAction.RecoveryComplete) {
    await clearRecoveryMarker({ definition, hostname: args.node });
    return;
  }
  const credentials = await loadCredentials({ definition });
  if (args.action === CliAction.Inspect) {
    const server = await getServer({ credentials, definition });
    process.stdout.write(
      `${server.name}\t${server.ip}\t${server.commercialRange}\t${server.datacenter}\t${server.os}\t${server.state}\n`,
    );
    return;
  }
  if (args.action === CliAction.ReinstallRequired) {
    const recoveryMarker = await loadRecoveryMarker({
      definition,
      hostname: args.node,
    });
    const server = await getServer({ credentials, definition });
    const required =
      recoveryMarker.status === RecoveryMarkerStatus.Pending
        ? true
        : requiresReinstall({
          allowReinstall: args.allowReinstall,
          currentOperatingSystem: server.os,
          desiredOperatingSystem: definition.operatingSystem,
        });
    if (required) {
      await prepareReinstall({
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
  process.stdout.write(`${await provision(context)}\n`);
}

if (import.meta.main) {
  await main();
}
