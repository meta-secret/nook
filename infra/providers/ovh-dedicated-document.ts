import { err, ok, type Result } from "neverthrow";
import { OvhFailure, OvhFailureKind } from "./ovh-dedicated-failure";
import {
  OvhRecoveryMarkerObservation,
  OvhServerObservation,
} from "./ovh-dedicated-observations";
import {
  ArcTier,
  EndpointMode,
  OvhTaskStatus,
  type CompatibleTemplates,
  type DedicatedServerDefinition,
  type DedicatedServerInventory,
  type OvhCredentials,
  type OvhTask,
} from "./ovh-dedicated-contracts";

/** Decodes the fields owned by each OVH contract without exposing credential values. */
export class OvhDocument {
  constructor(private readonly input: unknown) {}
  private failure(schema: string): OvhFailure {
    return new OvhFailure(OvhFailureKind.Schema, `OVH ${schema} has an invalid schema`);
  }
  private record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && !!value && !Array.isArray(value);
  }
  private parse(): Result<unknown, OvhFailure> {
    if (typeof this.input !== "string") return err(new OvhFailure(OvhFailureKind.Schema, "OVH JSON document has an invalid schema"));
    try {
      return ok(JSON.parse(this.input));
    } catch {
      return err(this.failure("JSON document"));
    }
  }
  credentials(): Result<OvhCredentials, OvhFailure> {
    const parsed = this.parse();
    if (parsed.isErr()) return err(parsed.error);
    const value = parsed.value;
    if (
      !this.record(value) ||
      typeof value.applicationKey !== "string" ||
      typeof value.applicationSecret !== "string" ||
      typeof value.consumerKey !== "string" ||
      typeof value.endpoint !== "string"
    )
      return err(this.failure("credentials"));
    return ok({
      applicationKey: value.applicationKey,
      applicationSecret: value.applicationSecret,
      consumerKey: value.consumerKey,
      endpoint: value.endpoint,
    });
  }
  recoveryMarker(): Result<OvhRecoveryMarkerObservation, OvhFailure> {
    const parsed = this.parse();
    if (parsed.isErr()) return err(parsed.error);
    const value = parsed.value;
    if (
      !this.record(value) ||
      value.version !== 1 ||
      typeof value.hostname !== "string" ||
      typeof value.operatingSystem !== "string" ||
      typeof value.serviceName !== "string"
    )
      return err(this.failure("recovery marker"));
    return ok(OvhRecoveryMarkerObservation.fromRecord({
      version: value.version,
      hostname: value.hostname,
      operatingSystem: value.operatingSystem,
      serviceName: value.serviceName,
    }));
  }
  server(): Result<OvhServerObservation, OvhFailure> {
    const parsed = this.parse();
    if (parsed.isErr()) return err(parsed.error);
    const value = parsed.value;
    if (
      !this.record(value) ||
      typeof value.commercialRange !== "string" ||
      typeof value.datacenter !== "string" ||
      typeof value.ip !== "string" ||
      typeof value.name !== "string" ||
      typeof value.os !== "string" ||
      typeof value.state !== "string"
    )
      return err(this.failure("server"));
    return ok(OvhServerObservation.fromRecord({
      commercialRange: value.commercialRange,
      datacenter: value.datacenter,
      ip: value.ip,
      name: value.name,
      os: value.os,
      state: value.state,
    }));
  }
  compatibleTemplates(): Result<CompatibleTemplates, OvhFailure> {
    const parsed = this.parse();
    if (parsed.isErr()) return err(parsed.error);
    const value = parsed.value;
    if (
      !this.record(value) ||
      !Array.isArray(value.ovh) ||
      !value.ovh.every((item): item is string => typeof item === "string")
    )
      return err(this.failure("compatible templates"));
    return ok({ ovh: value.ovh });
  }
  task(): Result<OvhTask, OvhFailure> {
    const parsed = this.parse();
    if (parsed.isErr()) return err(parsed.error);
    const value = parsed.value;
    if (
      !this.record(value) ||
      typeof value.taskId !== "number" ||
      !Number.isSafeInteger(value.taskId)
    )
      return err(this.failure("task"));
    const status = Object.values(OvhTaskStatus).find(
      (status): status is OvhTaskStatus =>
        typeof status === "string" && status === value.status,
    );
    if (!status) return err(this.failure("task status"));
    return ok({ taskId: value.taskId, status });
  }
  credentialValidation(): Result<void, OvhFailure> {
    // This endpoint confirms authorization; its provider-owned record is not used internally.
    const parsed = this.parse();
    if (parsed.isErr()) return err(parsed.error);
    const value = parsed.value;
    if (!this.record(value))
      return err(this.failure("credential validation"));
    return ok();
  }
  inventory(): Result<DedicatedServerInventory, OvhFailure> {
    const value = this.input;
    if (!this.record(value) || !this.record(value.servers))
      return err(this.failure("server inventory"));
    const servers: Array<[string, DedicatedServerDefinition]> = [];
    for (const [name, definitionValue] of Object.entries(value.servers)) {
      const admitted = this.definition(definitionValue);
      if (admitted.isErr()) return err(admitted.error);
      servers.push([name, admitted.value]);
    }
    return ok({ servers: Object.fromEntries(servers) });
  }
  private definition(value: unknown): Result<DedicatedServerDefinition, OvhFailure> {
    if (
      !this.record(value) ||
      typeof value.expectedCommercialRange !== "string" ||
      typeof value.expectedDatacenter !== "string" ||
      typeof value.meshAddress !== "string" ||
      typeof value.operatingSystem !== "string" ||
      typeof value.publicAddress !== "string" ||
      typeof value.serviceName !== "string" ||
      typeof value.sshPublicKeyFile !== "string" ||
      typeof value.sshUser !== "string"
    )
      return err(this.failure("server definition"));
    const arcTier = Object.values(ArcTier).find(
      (tier) => tier === value.arcTier,
    );
    const endpointMode = Object.values(EndpointMode).find(
      (mode) => mode === value.endpointMode,
    );
    if (!arcTier || !endpointMode)
      return err(this.failure("server definition mode"));
    return ok({
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
    });
  }
}
