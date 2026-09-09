import {
  ArcTier,
  EndpointMode,
  OvhTaskStatus,
  type CompatibleTemplates,
  type DedicatedServerDefinition,
  type DedicatedServerInventory,
  type OvhCredentials,
  type OvhRecoveryMarker,
  type OvhServer,
  type OvhTask,
} from "./ovh-dedicated-contracts";

export enum OvhDocumentFailureKind {
  InvalidSchema = "invalid-schema",
}
export class OvhDocumentError extends Error {
  readonly kind = OvhDocumentFailureKind.InvalidSchema;
  constructor(schema: string) {
    super(`OVH ${schema} has an invalid schema`);
  }
}

/** Decodes the fields owned by each OVH contract without exposing credential values. */
export class OvhDocument {
  private static record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && !!value && !Array.isArray(value);
  }
  private static parse(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      throw new OvhDocumentError("JSON document");
    }
  }
  static credentials(text: string): OvhCredentials {
    const value = OvhDocument.parse(text);
    if (
      !OvhDocument.record(value) ||
      typeof value.applicationKey !== "string" ||
      typeof value.applicationSecret !== "string" ||
      typeof value.consumerKey !== "string" ||
      typeof value.endpoint !== "string"
    )
      throw new OvhDocumentError("credentials");
    return {
      applicationKey: value.applicationKey,
      applicationSecret: value.applicationSecret,
      consumerKey: value.consumerKey,
      endpoint: value.endpoint,
    };
  }
  static recoveryMarker(text: string): OvhRecoveryMarker {
    const value = OvhDocument.parse(text);
    if (
      !OvhDocument.record(value) ||
      value.version !== 1 ||
      typeof value.hostname !== "string" ||
      typeof value.operatingSystem !== "string" ||
      typeof value.serviceName !== "string"
    )
      throw new OvhDocumentError("recovery marker");
    return {
      version: value.version,
      hostname: value.hostname,
      operatingSystem: value.operatingSystem,
      serviceName: value.serviceName,
    };
  }
  static server(text: string): OvhServer {
    const value = OvhDocument.parse(text);
    if (
      !OvhDocument.record(value) ||
      typeof value.commercialRange !== "string" ||
      typeof value.datacenter !== "string" ||
      typeof value.ip !== "string" ||
      typeof value.name !== "string" ||
      typeof value.os !== "string" ||
      typeof value.state !== "string"
    )
      throw new OvhDocumentError("server");
    return {
      commercialRange: value.commercialRange,
      datacenter: value.datacenter,
      ip: value.ip,
      name: value.name,
      os: value.os,
      state: value.state,
    };
  }
  static compatibleTemplates(text: string): CompatibleTemplates {
    const value = OvhDocument.parse(text);
    if (
      !OvhDocument.record(value) ||
      !Array.isArray(value.ovh) ||
      !value.ovh.every((item): item is string => typeof item === "string")
    )
      throw new OvhDocumentError("compatible templates");
    return { ovh: value.ovh };
  }
  static task(text: string): OvhTask {
    const value = OvhDocument.parse(text);
    if (
      !OvhDocument.record(value) ||
      typeof value.taskId !== "number" ||
      !Number.isSafeInteger(value.taskId)
    )
      throw new OvhDocumentError("task");
    const status = Object.values(OvhTaskStatus).find(
      (status) => status === value.status,
    );
    if (!status) throw new OvhDocumentError("task status");
    return { taskId: value.taskId, status };
  }
  static credentialValidation(text: string): void {
    // This endpoint confirms authorization; its provider-owned record is not used internally.
    const value = OvhDocument.parse(text);
    if (!OvhDocument.record(value))
      throw new OvhDocumentError("credential validation");
  }
  static inventory(value: unknown): DedicatedServerInventory {
    if (!OvhDocument.record(value) || !OvhDocument.record(value.servers))
      throw new OvhDocumentError("server inventory");
    return {
      servers: Object.fromEntries(
        Object.entries(value.servers).map(([name, definition]) => [
          name,
          OvhDocument.definition(definition),
        ]),
      ),
    };
  }
  private static definition(value: unknown): DedicatedServerDefinition {
    if (
      !OvhDocument.record(value) ||
      typeof value.expectedCommercialRange !== "string" ||
      typeof value.expectedDatacenter !== "string" ||
      typeof value.meshAddress !== "string" ||
      typeof value.operatingSystem !== "string" ||
      typeof value.publicAddress !== "string" ||
      typeof value.serviceName !== "string" ||
      typeof value.sshPublicKeyFile !== "string" ||
      typeof value.sshUser !== "string"
    )
      throw new OvhDocumentError("server definition");
    const arcTier = Object.values(ArcTier).find(
      (tier) => tier === value.arcTier,
    );
    const endpointMode = Object.values(EndpointMode).find(
      (mode) => mode === value.endpointMode,
    );
    if (!arcTier || !endpointMode)
      throw new OvhDocumentError("server definition mode");
    return {
      arcTier,
      endpointMode,
      expectedCommercialRange: value.expectedCommercialRange,
      expectedDatacenter: value.expectedDatacenter,
      meshAddress: value.meshAddress,
      operatingSystem: value.operatingSystem,
      publicAddress: value.publicAddress,
      serviceName: value.serviceName,
      sshPublicKeyFile: value.sshPublicKeyFile,
      sshUser: value.sshUser,
    };
  }
}
