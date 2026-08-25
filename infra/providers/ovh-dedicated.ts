import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
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
  Inspect = "inspect",
  Provision = "provision",
}

enum HttpMethod {
  Get = "GET",
  Post = "POST",
}

enum ProvisionResult {
  Reinstalled = "reinstalled",
  Unchanged = "unchanged",
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
  if (input.currentOperatingSystem === input.desiredOperatingSystem) return false;
  if (input.currentOperatingSystem === "none_64") return true;
  if (input.allowReinstall) return true;
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
    throw new Error("action must be field, inspect, or provision");
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

async function loadCredentials(): Promise<OvhCredentials> {
  const source = expandHome(
    process.env.OVH_CREDENTIAL_FILE ?? defaultCredentialFile,
  );
  const target = defaultCredentialFile;
  await mkdir(dirname(target), { mode: 0o700, recursive: true });
  await chmod(dirname(target), 0o700);
  if (source !== target) {
    const credential = await readFile(source);
    await writeFile(target, credential, { mode: 0o600 });
  }
  await chmod(target, 0o600);
  const parsed = JSON.parse(await readFile(target, "utf8")) as OvhCredentials;
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
  const reinstallInput = {
    allowReinstall: input.allowReinstall,
    currentOperatingSystem: current.os,
    desiredOperatingSystem: input.definition.operatingSystem,
  };
  if (!requiresReinstall(reinstallInput)) return ProvisionResult.Unchanged;
  await requireCompatibleTemplate({
    credentials: input.credentials,
    definition: input.definition,
  });
  const publicKey = await readFile(expandHome(input.definition.sshPublicKeyFile), "utf8");
  if (!/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(input.hostname)) {
    throw new Error("hostname is not a valid lowercase host label");
  }
  if (!/^ssh-(?:ed25519|rsa) [A-Za-z0-9+/=]+(?: .*)?$/.test(publicKey.trim())) {
    throw new Error("SSH public key must be an OpenSSH ed25519 or RSA key");
  }
  const payload: ReinstallRequest = {
    customizations: {
      hostname: input.hostname,
      sshKey: publicKey.trim(),
    },
    operatingSystem: input.definition.operatingSystem,
  };
  const request: ApiRequest = {
    body: JSON.stringify(payload),
    method: HttpMethod.Post,
    path: `/dedicated/server/${encodeURIComponent(input.definition.serviceName)}/reinstall`,
  };
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
  const credentials = await loadCredentials();
  if (args.action === CliAction.Inspect) {
    const server = await getServer({ credentials, definition });
    process.stdout.write(
      `${server.name}\t${server.ip}\t${server.commercialRange}\t${server.datacenter}\t${server.os}\t${server.state}\n`,
    );
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
