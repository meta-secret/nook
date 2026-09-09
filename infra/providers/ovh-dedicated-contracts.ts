export interface OvhCredentials {
  applicationKey: string;
  applicationSecret: string;
  consumerKey: string;
  endpoint: string;
}

export interface OvhServer {
  commercialRange: string;
  datacenter: string;
  ip: string;
  name: string;
  os: string;
  state: string;
}

export enum ArcTier {
  Overflow = "overflow",
  Primary = "primary",
  Secondary = "secondary",
}

export enum EndpointMode {
  Direct = "direct",
  Roaming = "roaming",
}

export enum CliAction {
  Field = "field",
  HostFingerprint = "host-fingerprint",
  Inspect = "inspect",
  Provision = "provision",
  RecoveryComplete = "recovery-complete",
  ReinstallRequired = "reinstall-required",
}

export enum HttpMethod {
  Get = "GET",
  Post = "POST",
}

export enum ProvisionResult {
  Reinstalled = "reinstalled",
  Unchanged = "unchanged",
}

export enum RecoveryMarkerStatus {
  Absent = "absent",
  Pending = "pending",
}

export enum OvhServerState {
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

export enum DedicatedServerField {
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

export interface OvhTask {
  status: OvhTaskStatus;
  taskId: number;
}

export interface CompatibleTemplates {
  ovh: string[];
}

export interface DedicatedServerDefinition {
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

export interface DedicatedServerInventory {
  servers: Record<string, DedicatedServerDefinition>;
}

export interface CliArguments {
  action: CliAction;
  allowReinstall: boolean;
  field: DedicatedServerField;
  inventoryFile: string;
  node: string;
}

export interface ApiRequest {
  body?: string;
  method: HttpMethod;
  path: string;
}

export interface SignatureInput {
  applicationSecret: string;
  body: string;
  consumerKey: string;
  method: string;
  timestamp: number;
  url: string;
}

export interface ReinstallRequest {
  customizations: {
    hostname: string;
    postInstallationScript: string;
    sshKey: string;
  };
  operatingSystem: string;
}

export interface ProvisionContext {
  allowReinstall: boolean;
  credentials: OvhCredentials;
  definition: DedicatedServerDefinition;
  hostname: string;
}

export interface HostIdentity {
  fingerprint: string;
  privateKey: string;
  publicKey: string;
}

export interface HostIdentityInput {
  allowCreate: boolean;
  hostname: string;
}

export interface PreparedReinstall {
  hostIdentity: HostIdentity;
  publicKey: string;
}

export interface OvhRecoveryMarker {
  hostname: string;
  operatingSystem: string;
  serviceName: string;
  version: 1;
}

export interface AbsentRecoveryMarker {
  status: RecoveryMarkerStatus.Absent;
}

export interface PendingRecoveryMarker {
  marker: OvhRecoveryMarker;
  status: RecoveryMarkerStatus.Pending;
}

export type RecoveryMarkerState = AbsentRecoveryMarker | PendingRecoveryMarker;
