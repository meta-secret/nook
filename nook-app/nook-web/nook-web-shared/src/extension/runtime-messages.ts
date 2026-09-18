import { err, ok, type Result } from "neverthrow";
import { Effect, Schema } from "effect";
import {
  decode_extension_pairing_storage_provider,
  type ExtensionPairingStorageProviderPayload as RustExtensionPairingStorageProviderPayload,
} from "../vault-app/lib/nook-wasm/nook_wasm.js";
import type {
  ExtensionStorageProviderIdentity,
  ExtensionPairingGrantApproval,
  ExtensionStorageProviderType as RustExtensionStorageProviderType,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import { ExtensionConnectScope } from "./extension-connect-scope";
import { extensionPairingVaultType } from "./extension-pairing-vault-type";
import { ExtensionPairingApprovedMessageAdmissionFailure } from "./extension-pairing-admission-failure";
import {
  RuntimeMessageDecodeFailure,
  RuntimeMessageDecodeCauseKind,
  RuntimeMessageDecodeFailureKind,
} from "./runtime-message-decode-failure";
import type {
  CompanionIdentityDiscoveryObservation,
  CompanionIdentityStatus,
} from "./nook-companion-wasm/nook_companion_wasm.js";

import { ExtensionPairedVaultIdentityStatusMessageStatus } from "./paired-vault-identity-status";

import {
  OpenCompanionLauncherIntent,
  OpenCompanionLauncherMessageType,
  type OpenCompanionLauncherMessage,
} from "./companion-launcher-message";

import { OpenCompanionLauncherMessage as OpenCompanionLauncherMessageSchema } from "./companion-launcher-message";

import {
  BeginExtensionPairingMessageType,
  ExtensionLocalEventLogUpdatedMessageType,
  OpenSimpleVaultMessageType,
  type BeginExtensionPairingMessage,
  type ExtensionEventLogRecord,
  type ExtensionLocalEventLogUpdatedMessage,
  type OpenSimpleVaultMessage,
  RuntimeMessageEnvelope,
} from "./lifecycle-runtime-messages";

import {
  BeginExtensionPairingMessage as BeginExtensionPairingMessageSchema,
  ExtensionEventLogRecord as ExtensionEventLogRecordSchema,
  ExtensionLocalEventLogUpdatedMessage as ExtensionLocalEventLogUpdatedMessageSchema,
  OpenSimpleVaultMessage as OpenSimpleVaultMessageSchema,
} from "./lifecycle-runtime-messages";

type RuntimeMessageDecodeRequest<
  DecodedRuntimeMessage,
  RuntimeMessageWireValue,
> = {
  readonly schema: Schema.Schema<DecodedRuntimeMessage>;
  readonly value: RuntimeMessageWireValue;
  readonly kind: RuntimeMessageDecodeFailureKind;
};

function decodeRuntimeMessage<DecodedRuntimeMessage, RuntimeMessageWireValue>(
  request: RuntimeMessageDecodeRequest<
    DecodedRuntimeMessage,
    RuntimeMessageWireValue
  >,
): Effect.Effect<DecodedRuntimeMessage, RuntimeMessageDecodeFailure> {
  return Schema.decodeUnknown(request.schema)(request.value).pipe(
    Effect.mapError((cause) => {
      const failureRequest: Parameters<
        typeof RuntimeMessageDecodeFailure.fromParseError
      >[0] = { kind: request.kind, cause };
      return RuntimeMessageDecodeFailure.fromParseError(failureRequest);
    }),
  );
}

type RuntimeMessageAdmissionRequest<AdmissionValue, AdmissionFailure> = {
  readonly result: Result<AdmissionValue, AdmissionFailure>;
  readonly kind: RuntimeMessageDecodeFailureKind;
};

function decodeAdmissionResult<AdmissionValue, AdmissionFailure>(
  request: RuntimeMessageAdmissionRequest<AdmissionValue, AdmissionFailure>,
): Effect.Effect<AdmissionValue, RuntimeMessageDecodeFailure> {
  if (request.result.isErr()) {
    const failureRequest: Parameters<
      typeof RuntimeMessageDecodeFailure.fromCause
    >[0] = { kind: request.kind, cause: request.result.error };
    return Effect.fail(RuntimeMessageDecodeFailure.fromCause(failureRequest));
  }
  return Effect.succeed(request.result.value);
}

export {
  BeginExtensionPairingMessageType,
  ExtensionLocalEventLogUpdatedMessageType,
  OpenCompanionLauncherIntent,
  OpenCompanionLauncherMessageType,
  OpenSimpleVaultMessageType,
  RuntimeMessageEnvelope,
  BeginExtensionPairingMessageSchema as BeginExtensionPairingMessage,
  type ExtensionEventLogRecord,
  ExtensionLocalEventLogUpdatedMessageSchema as ExtensionLocalEventLogUpdatedMessage,
  OpenCompanionLauncherMessageSchema as OpenCompanionLauncherMessage,
  OpenSimpleVaultMessageSchema as OpenSimpleVaultMessage,
};

export { ExtensionPairedVaultIdentityStatusMessageStatus };
export { ExtensionPairingApprovedMessageAdmissionFailure };
export {
  RuntimeMessageDecodeFailure,
  RuntimeMessageDecodeFailureKind,
  RuntimeMessageDecodeCauseKind,
};
export type { RuntimeMessageDecodeCause } from "./runtime-message-decode-failure";

export type { ExtensionPairingVaultType } from "./nook-companion-wasm/nook_companion_wasm.js";

export enum GeneratePasswordRequestType {
  NookWebsiteGeneratePassword = "nook:website-generate-password",
}

export type GeneratePasswordRequest = {
  readonly type: GeneratePasswordRequestType.NookWebsiteGeneratePassword;
  readonly payload: { origin: string };
};

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export type ExtensionPairingApprovedGrant = Omit<
  ExtensionPairingGrantApproval,
  "syncProviderCount"
> & {
  providers: ExtensionPairingStorageProviderPayload[];
};
export type ExtensionPairingStorageProviderPayload =
  RustExtensionPairingStorageProviderPayload;
export class ExtensionPairingStorageProviderPayloadDecoder {
  private constructor() {}

  static decode(
    value: unknown,
  ): Effect.Effect<
    ExtensionPairingStorageProviderPayload,
    RuntimeMessageDecodeFailure
  > {
    const decodeAttempt: Parameters<typeof Effect.try>[0] = {
      try: () => decode_extension_pairing_storage_provider(value),
      catch: (cause) => {
        const failureRequest: Parameters<
          typeof RuntimeMessageDecodeFailure.fromCause
        >[0] = {
          kind: RuntimeMessageDecodeFailureKind.ExtensionPairingStorageProvider,
          cause,
        };
        return RuntimeMessageDecodeFailure.fromCause(failureRequest);
      },
    };
    return Effect.try(decodeAttempt);
  }
}

export class ExtensionPairingApprovedGrantAdmission {
  private constructor() {}
  static parse(
    value: unknown,
  ): Result<
    ExtensionPairingApprovedGrant,
    ExtensionPairingApprovedMessageAdmissionFailure
  > {
    if (!value || typeof value !== "object")
      return err(ExtensionPairingApprovedMessageAdmissionFailure.Payload);
    const payload = value;
    if (!("vaultType" in payload))
      return err(ExtensionPairingApprovedMessageAdmissionFailure.VaultType);
    if (typeof payload.vaultType !== "string")
      return err(ExtensionPairingApprovedMessageAdmissionFailure.VaultType);
    const vaultType = extensionPairingVaultType.admit(payload.vaultType);
    if (vaultType.isErr())
      return err(ExtensionPairingApprovedMessageAdmissionFailure.VaultType);
    if (!("deviceId" in payload) || typeof payload.deviceId !== "string")
      return err(ExtensionPairingApprovedMessageAdmissionFailure.DeviceId);
    if (
      !("devicePublicKey" in payload) ||
      typeof payload.devicePublicKey !== "string"
    )
      return err(
        ExtensionPairingApprovedMessageAdmissionFailure.DevicePublicKey,
      );
    if (
      !("deviceSigningPublicKey" in payload) ||
      typeof payload.deviceSigningPublicKey !== "string"
    )
      return err(
        ExtensionPairingApprovedMessageAdmissionFailure.DeviceSigningPublicKey,
      );
    if (!("deviceLabel" in payload) || typeof payload.deviceLabel !== "string")
      return err(ExtensionPairingApprovedMessageAdmissionFailure.DeviceLabel);
    if (
      !("vaultStoreId" in payload) ||
      typeof payload.vaultStoreId !== "string"
    )
      return err(ExtensionPairingApprovedMessageAdmissionFailure.VaultStoreId);
    if (!("vaultName" in payload) || typeof payload.vaultName !== "string")
      return err(ExtensionPairingApprovedMessageAdmissionFailure.VaultName);
    if (!("approvedAt" in payload) || typeof payload.approvedAt !== "number")
      return err(ExtensionPairingApprovedMessageAdmissionFailure.ApprovedAt);
    if (!("scopes" in payload) || !Array.isArray(payload.scopes))
      return err(ExtensionPairingApprovedMessageAdmissionFailure.Scopes);
    const scopes: ExtensionConnectScope[] = [];
    for (const candidate of payload.scopes) {
      const admitted = Effect.runSync(
        Effect.either(ExtensionConnectScope.decode(candidate)),
      );
      if (admitted._tag === "Left")
        return err(ExtensionPairingApprovedMessageAdmissionFailure.Scopes);
      scopes.push(admitted.right);
    }
    if (!("providers" in payload) || !Array.isArray(payload.providers))
      return err(ExtensionPairingApprovedMessageAdmissionFailure.Providers);
    const providers: ExtensionPairingStorageProviderPayload[] = [];
    for (const candidate of payload.providers) {
      const decoded = Effect.runSync(
        Effect.either(
          ExtensionPairingStorageProviderPayloadDecoder.decode(candidate),
        ),
      );
      if (decoded._tag === "Left")
        return err(ExtensionPairingApprovedMessageAdmissionFailure.Providers);
      providers.push(decoded.right);
    }
    const grant: ExtensionPairingApprovedGrant = {
      vaultType: vaultType.value,
      deviceId: payload.deviceId,
      devicePublicKey: payload.devicePublicKey,
      deviceSigningPublicKey: payload.deviceSigningPublicKey,
      deviceLabel: payload.deviceLabel,
      vaultStoreId: payload.vaultStoreId,
      vaultName: payload.vaultName,
      approvedAt: payload.approvedAt,
      scopes,
      providers,
    };
    return ok(grant);
  }
  static decode(
    value: unknown,
  ): Effect.Effect<ExtensionPairingApprovedGrant, RuntimeMessageDecodeFailure> {
    const admissionRequest: RuntimeMessageAdmissionRequest<
      ExtensionPairingApprovedGrant,
      ExtensionPairingApprovedMessageAdmissionFailure
    > = {
      result: ExtensionPairingApprovedGrantAdmission.parse(value),
      kind: RuntimeMessageDecodeFailureKind.ExtensionPairingApprovedGrant,
    };
    return decodeAdmissionResult(admissionRequest);
  }
}

export type ExtensionStorageProviderType = RustExtensionStorageProviderType;
export const ExtensionStorageProviderType = {
  Local: "local",
  LocalFolder: "local-folder",
  Github: "github",
  OAuthFile: "oauth-file",
} satisfies Record<string, RustExtensionStorageProviderType>;
export type ExtensionStorageProviderPayload = ExtensionStorageProviderIdentity;
/** Structural browser wire value; validation requires no instance methods or runtime state. */
export enum ExtensionStorageProviderIdentityFailure {
  Invalid = "invalid-provider-identity",
}
export class ExtensionStorageProviderPayloadAdmission {
  constructor(private readonly value: unknown) {}
  parse(): Result<
    ExtensionStorageProviderPayload,
    ExtensionStorageProviderIdentityFailure
  > {
    const value = this.value;
    if (!value || typeof value !== "object")
      return err(ExtensionStorageProviderIdentityFailure.Invalid);
    const provider = value;
    if (
      !("id" in provider) ||
      typeof provider.id !== "string" ||
      provider.id.length === 0 ||
      !("type" in provider)
    )
      return err(ExtensionStorageProviderIdentityFailure.Invalid);
    switch (provider.type) {
      case ExtensionStorageProviderType.Local:
      case ExtensionStorageProviderType.LocalFolder:
      case ExtensionStorageProviderType.Github:
      case ExtensionStorageProviderType.OAuthFile: {
        const admittedProvider: ExtensionStorageProviderPayload = {
          id: provider.id,
          type: provider.type,
        };
        return ok(admittedProvider);
      }
      default:
        return err(ExtensionStorageProviderIdentityFailure.Invalid);
    }
  }
}

export enum ExtensionPairingApprovedMessageType {
  NookExtensionPairingApproved = "nook:extension-pairing-approved",
}

const extensionPairingApprovedTypeSchema = Schema.Literal(
  ExtensionPairingApprovedMessageType.NookExtensionPairingApproved,
);
const extensionPairingApprovedEventLogRecordsSchema = Schema.Array(
  Schema.Unknown,
).pipe(Schema.minItems(1));
type ExtensionPairingApprovedMessageFields = {
  readonly type: typeof extensionPairingApprovedTypeSchema;
  readonly payload: typeof Schema.Unknown;
  readonly eventLogRecords: typeof extensionPairingApprovedEventLogRecordsSchema;
};
const extensionPairingApprovedMessageFields: ExtensionPairingApprovedMessageFields =
  {
    type: extensionPairingApprovedTypeSchema,
    payload: Schema.Unknown,
    eventLogRecords: extensionPairingApprovedEventLogRecordsSchema,
  };
const extensionPairingApprovedMessageSchema = Schema.Struct(
  extensionPairingApprovedMessageFields,
);
const eventLogRecordDecodeOptions: { readonly concurrency: "unbounded" } = {
  concurrency: "unbounded",
};

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class ExtensionPairingApprovedMessage {
  private constructor() {}
  declare readonly type: ExtensionPairingApprovedMessageType.NookExtensionPairingApproved;
  declare readonly payload: ExtensionPairingApprovedGrant;
  declare readonly eventLogRecords: ExtensionEventLogRecord[];
  static decode(
    message: unknown,
  ): Effect.Effect<
    ExtensionPairingApprovedMessage,
    RuntimeMessageDecodeFailure
  > {
    const request: RuntimeMessageDecodeRequest<
      ExtensionPairingApprovedMessage,
      typeof message
    > = {
      schema: extensionPairingApprovedMessageSchema,
      value: message,
      kind: RuntimeMessageDecodeFailureKind.ExtensionPairingApprovedMessage,
    };
    return decodeRuntimeMessage(request).pipe(
      Effect.flatMap(({ type, payload, eventLogRecords }) =>
        Effect.all(
          eventLogRecords.map(ExtensionEventLogRecordSchema.decode),
          eventLogRecordDecodeOptions,
        ).pipe(
          Effect.flatMap((decodedRecords) =>
            ExtensionPairingApprovedGrantAdmission.decode(payload).pipe(
              Effect.map((decodedPayload) => ({
                type,
                payload: decodedPayload,
                eventLogRecords: decodedRecords,
              })),
            ),
          ),
        ),
      ),
    );
  }
}

export enum ExtensionIdentityHandoffRequestMessageType {
  NookExtensionIdentityHandoffRequest = "nook:extension-identity-handoff-request",
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class ExtensionIdentityHandoffRequestMessage {
  private constructor() {}
  declare readonly type: ExtensionIdentityHandoffRequestMessageType.NookExtensionIdentityHandoffRequest;
  declare readonly payload: {
    recipientPublicKey: string;
    nonce: string;
    expectedDeviceId: string;
    expectedDevicePublicKey: string;
    expectedDeviceSigningPublicKey: string;
  };
  static decode(
    message: unknown,
  ): Effect.Effect<
    ExtensionIdentityHandoffRequestMessage,
    RuntimeMessageDecodeFailure
  > {
    const identityHandoffPayloadFields: Schema.Struct.Fields = {
      recipientPublicKey: Schema.String.pipe(Schema.minLength(1)),
      nonce: Schema.String.pipe(Schema.minLength(1)),
      expectedDeviceId: Schema.String.pipe(Schema.minLength(1)),
      expectedDevicePublicKey: Schema.String.pipe(Schema.minLength(1)),
      expectedDeviceSigningPublicKey: Schema.String.pipe(Schema.minLength(1)),
    };
    const identityHandoffMessageFields: Schema.Struct.Fields = {
      type: Schema.Literal(
        ExtensionIdentityHandoffRequestMessageType.NookExtensionIdentityHandoffRequest,
      ),
      payload: Schema.Struct(identityHandoffPayloadFields),
    };
    const identityHandoffRequest: RuntimeMessageDecodeRequest<
      ExtensionIdentityHandoffRequestMessage,
      typeof message
    > = {
      schema: Schema.Struct(identityHandoffMessageFields),
      value: message,
      kind: RuntimeMessageDecodeFailureKind.ExtensionIdentityHandoffRequest,
    };
    return decodeRuntimeMessage(identityHandoffRequest);
  }
}

export enum ExtensionPairedVaultIdentityDiscoveryMessageType {
  NookExtensionPairedVaultIdentityDiscovery = "nook:extension-paired-vault-identity-discovery",
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class ExtensionPairedVaultIdentityDiscoveryMessage {
  private constructor() {}
  declare readonly type: ExtensionPairedVaultIdentityDiscoveryMessageType.NookExtensionPairedVaultIdentityDiscovery;
  declare readonly payload: unknown;
  static decode(
    message: unknown,
  ): Effect.Effect<
    ExtensionPairedVaultIdentityDiscoveryMessage,
    RuntimeMessageDecodeFailure
  > {
    const discoveryMessageFields: Schema.Struct.Fields = {
      type: Schema.Literal(
        ExtensionPairedVaultIdentityDiscoveryMessageType.NookExtensionPairedVaultIdentityDiscovery,
      ),
      payload: Schema.Unknown,
    };
    const discoveryRequest: RuntimeMessageDecodeRequest<
      ExtensionPairedVaultIdentityDiscoveryMessage,
      typeof message
    > = {
      schema: Schema.Struct(discoveryMessageFields),
      value: message,
      kind: RuntimeMessageDecodeFailureKind.ExtensionPairedVaultIdentityDiscovery,
    };
    return decodeRuntimeMessage(discoveryRequest);
  }
}

export type CompanionIdentityDiscoveryTransportResponse =
  { ok: true; status: CompanionIdentityStatus } | { ok: false };

export enum ExtensionPairedVaultUnlockRequestMessageType {
  NookExtensionPairedVaultUnlockRequest = "nook:extension-paired-vault-unlock-request",
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class ExtensionPairedVaultUnlockRequestMessage {
  private constructor() {}
  declare readonly type: ExtensionPairedVaultUnlockRequestMessageType.NookExtensionPairedVaultUnlockRequest;
  declare readonly payload: {
    requestId: string;
    vaultStoreId: string;
  };
  static decode(
    message: unknown,
  ): Effect.Effect<
    ExtensionPairedVaultUnlockRequestMessage,
    RuntimeMessageDecodeFailure
  > {
    const unlockPayloadFields: Schema.Struct.Fields = {
      requestId: Schema.String.pipe(Schema.minLength(1)),
      vaultStoreId: Schema.String.pipe(Schema.minLength(1)),
    };
    const unlockMessageFields: Schema.Struct.Fields = {
      type: Schema.Literal(
        ExtensionPairedVaultUnlockRequestMessageType.NookExtensionPairedVaultUnlockRequest,
      ),
      payload: Schema.Struct(unlockPayloadFields),
    };
    const unlockRequest: RuntimeMessageDecodeRequest<
      ExtensionPairedVaultUnlockRequestMessage,
      typeof message
    > = {
      schema: Schema.Struct(unlockMessageFields),
      value: message,
      kind: RuntimeMessageDecodeFailureKind.ExtensionPairedVaultUnlockRequest,
    };
    return decodeRuntimeMessage(unlockRequest);
  }
}

export enum ExtensionPairedVaultIdentityHandoffRequestMessageType {
  NookExtensionPairedVaultIdentityHandoffRequest = "nook:extension-paired-vault-identity-handoff-request",
}

export type CompanionAdmittedIdentityDiscovery = {
  readonly discovery: CompanionIdentityDiscoveryObservation;
  readonly status: CompanionIdentityStatus;
  readonly admittedAt: number;
};

export type CompanionIdentityHandoffRequest = {
  readonly transaction: CompanionAdmittedIdentityDiscovery;
  readonly recipientPublicKey: string;
};

export type CompanionIdentityHandoffResponse = {
  readonly request: CompanionIdentityHandoffRequest;
  readonly encryptedEnvelope: string;
};

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class ExtensionPairedVaultIdentityHandoffRequestMessage {
  private constructor() {}
  declare readonly type: ExtensionPairedVaultIdentityHandoffRequestMessageType.NookExtensionPairedVaultIdentityHandoffRequest;
  declare readonly payload: unknown;
  static decode(
    message: unknown,
  ): Effect.Effect<
    ExtensionPairedVaultIdentityHandoffRequestMessage,
    RuntimeMessageDecodeFailure
  > {
    const handoffMessageFields: Schema.Struct.Fields = {
      type: Schema.Literal(
        ExtensionPairedVaultIdentityHandoffRequestMessageType.NookExtensionPairedVaultIdentityHandoffRequest,
      ),
      payload: Schema.Unknown,
    };
    const handoffRequest: RuntimeMessageDecodeRequest<
      ExtensionPairedVaultIdentityHandoffRequestMessage,
      typeof message
    > = {
      schema: Schema.Struct(handoffMessageFields),
      value: message,
      kind: RuntimeMessageDecodeFailureKind.ExtensionPairedVaultIdentityHandoffRequest,
    };
    return decodeRuntimeMessage(handoffRequest);
  }
}

export type CompanionIdentityHandoffTransportResponse =
  | { ok: true; response: CompanionIdentityHandoffResponse }
  | { ok: false; reason: string };

export type RuntimeMessage =
  | OpenSimpleVaultMessage
  | OpenCompanionLauncherMessage
  | BeginExtensionPairingMessage
  | ExtensionIdentityHandoffRequestMessage
  | ExtensionPairedVaultIdentityDiscoveryMessage
  | ExtensionPairedVaultUnlockRequestMessage
  | ExtensionPairedVaultIdentityHandoffRequestMessage
  | ExtensionPairingApprovedMessage
  | ExtensionLocalEventLogUpdatedMessage;

export const ExtensionStorageProviderPayload =
  ExtensionStorageProviderPayloadAdmission;

export const ExtensionPairingApprovedGrant =
  ExtensionPairingApprovedGrantAdmission;
