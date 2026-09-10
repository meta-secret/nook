import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
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
  type DedicatedServerInventory,
  type OvhCredentials,
  type OvhTask,
} from "./ovh-dedicated-contracts";

const credentialsSchema = z.object({
  applicationKey: z.string(),
  applicationSecret: z.string(),
  consumerKey: z.string(),
  endpoint: z.string(),
});
const recoveryMarkerSchema = z.object({
  version: z.literal(1),
  hostname: z.string(),
  operatingSystem: z.string(),
  serviceName: z.string(),
});
const serverSchema = z.object({
  commercialRange: z.string(),
  datacenter: z.string(),
  ip: z.string(),
  name: z.string(),
  os: z.string(),
  state: z.string(),
});
const templatesSchema = z.object({ ovh: z.array(z.string()) });
const taskSchema = z.object({
  taskId: z.number().refine(Number.isSafeInteger),
  status: z.enum(OvhTaskStatus),
});
const credentialValidationSchema = z.object({});
const inventorySchema = z.object({
  servers: z.record(
    z.string(),
    z.object({
      expectedCommercialRange: z.string(),
      expectedDatacenter: z.string(),
      meshAddress: z.string(),
      operatingSystem: z.string(),
      publicAddress: z.string(),
      serviceName: z.string(),
      sshPublicKeyFile: z.string(),
      sshUser: z.string(),
      arcTier: z.enum(ArcTier),
      endpointMode: z.enum(EndpointMode),
    }),
  ),
});

/** Provider documents project only declared fields; failures never expose their contents. */
export class OvhDocument {
  constructor(private readonly input: unknown) {}
  private failure(schema: string): OvhFailure {
    return new OvhFailure(
      OvhFailureKind.Schema,
      `OVH ${schema} has an invalid schema`,
    );
  }
  private parse(): Result<unknown, OvhFailure> {
    if (typeof this.input !== "string")
      return err(this.failure("JSON document"));
    try {
      return ok(JSON.parse(this.input));
    } catch {
      return err(this.failure("JSON document"));
    }
  }
  credentials(): Result<OvhCredentials, OvhFailure> {
    return this.parse().andThen((value) => {
      const parsed = credentialsSchema.safeParse(value);
      return parsed.success
        ? ok(parsed.data)
        : err(this.failure("credentials"));
    });
  }
  recoveryMarker(): Result<OvhRecoveryMarkerObservation, OvhFailure> {
    return this.parse().andThen((value) => {
      const parsed = recoveryMarkerSchema.safeParse(value);
      return parsed.success
        ? ok(OvhRecoveryMarkerObservation.fromRecord(parsed.data))
        : err(this.failure("recovery marker"));
    });
  }
  server(): Result<OvhServerObservation, OvhFailure> {
    return this.parse().andThen((value) => {
      const parsed = serverSchema.safeParse(value);
      return parsed.success
        ? ok(OvhServerObservation.fromRecord(parsed.data))
        : err(this.failure("server"));
    });
  }
  compatibleTemplates(): Result<CompatibleTemplates, OvhFailure> {
    return this.parse().andThen((value) => {
      const parsed = templatesSchema.safeParse(value);
      return parsed.success
        ? ok(parsed.data)
        : err(this.failure("compatible templates"));
    });
  }
  task(): Result<OvhTask, OvhFailure> {
    return this.parse().andThen((value) => {
      const parsed = taskSchema.safeParse(value);
      return parsed.success
        ? ok(parsed.data)
        : err(
            this.failure(
              parsed.error.issues[0]?.path[0] === "status"
                ? "task status"
                : "task",
            ),
          );
    });
  }
  credentialValidation(): Result<void, OvhFailure> {
    // Only the provider's authorization success matters; none of its record is consumed.
    return this.parse().andThen((value) =>
      credentialValidationSchema.safeParse(value).success
        ? ok()
        : err(this.failure("credential validation")),
    );
  }
  inventory(): Result<DedicatedServerInventory, OvhFailure> {
    const parsed = inventorySchema.safeParse(this.input);
    if (parsed.success) return ok(parsed.data);
    const path = parsed.error.issues.length > 0 ? parsed.error.issues[0].path : [];
    return err(
      this.failure(
        path.length < 2
          ? "server inventory"
          : path[2] === "arcTier" || path[2] === "endpointMode"
            ? "server definition mode"
            : "server definition",
      ),
    );
  }
}
