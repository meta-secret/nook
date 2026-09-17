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

type RuntimeMessageDecodeRequest<DecodedMessage, WireMessage> = {
  readonly schema: Schema.Schema<DecodedMessage>;
  readonly value: WireMessage;
  readonly kind: RuntimeMessageDecodeFailureKind;
};

type RuntimeDecodeAttempt<DecodedValue> = {
  readonly try: () => DecodedValue;
  readonly catch: <Cause>(cause: Cause) => RuntimeMessageDecodeFailure;
};

type UnboundedEffectConcurrency = {
  readonly concurrency: "unbounded";
};

function decodeRuntimeMessage<DecodedMessage, WireMessage>(
  request: RuntimeMessageDecodeRequest<DecodedMessage, WireMessage>,
): Effect.Effect<DecodedMessage, RuntimeMessageDecodeFailure> {
  return Schema.decodeUnknown(request.schema)(request.value).pipe(
    Effect.mapError((cause) => {
      const failureRequest: Parameters<
        typeof RuntimeMessageDecodeFailure.fromParseError
      >[0] = { kind: request.kind, cause };
      return RuntimeMessageDecodeFailure.fromParseError(failureRequest);
    }),
  );
}

type AdmissionResultDecodeRequest<DecodedValue, AdmissionFailure> = {
  readonly result: Result<DecodedValue, AdmissionFailure>;
  readonly kind: RuntimeMessageDecodeFailureKind;
};

function decodeAdmissionResult<DecodedValue, AdmissionFailure>(
  request: AdmissionResultDecodeRequest<DecodedValue, AdmissionFailure>,
): Effect.Effect<DecodedValue, RuntimeMessageDecodeFailure> {
  if (request.result.isOk()) return Effect.succeed(request.result.value);
  const failureRequest: Parameters<
    typeof RuntimeMessageDecodeFailure.fromCause
  >[0] = {
    kind: request.kind,
    cause: request.result.error,
  };
  return Effect.fail(RuntimeMessageDecodeFailure.fromCause(failureRequest));
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
    const attempt: RuntimeDecodeAttempt<ExtensionPairingStorageProviderPayload> =
      {
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
    return Effect.try(attempt);
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
    const request: AdmissionResultDecodeRequest<
      ExtensionPairingApprovedGrant,
      ExtensionPairingApprovedMessageAdmissionFailure
    > = {
      result: ExtensionPairingApprovedGrantAdmission.parse(value),
      kind: RuntimeMessageDecodeFailureKind.ExtensionPairingApprovedGrant,
    };
    return decodeAdmissionResult(request);
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
        const identity: ExtensionStorageProviderIdentity = {
          id: provider.id,
          type: provider.type,
        };
        return ok(identity);
      }
      default:
        return err(ExtensionStorageProviderIdentityFailure.Invalid);
    }
  }
}

export enum ExtensionPairingApprovedMessageType {
  NookExtensionPairingApproved = "nook:extension-pairing-approved",
}

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
    const typeSchema = Schema.Literal(
      ExtensionPairingApprovedMessageType.NookExtensionPairingApproved,
    );
    const eventLogRecordsSchema = Schema.Array(Schema.Unknown).pipe(
      Schema.minItems(1),
    );
    const envelopeFields: {
      readonly type: typeof typeSchema;
      readonly payload: typeof Schema.Unknown;
      readonly eventLogRecords: typeof eventLogRecordsSchema;
    } = {
      type: typeSchema,
      payload: Schema.Unknown,
      eventLogRecords: eventLogRecordsSchema,
    };
    const envelopeSchema = Schema.Struct(envelopeFields);
    const decodeRequest: RuntimeMessageDecodeRequest<
      Schema.Schema.Type<typeof envelopeSchema>,
      typeof message
    > = {
      schema: envelopeSchema,
      value: message,
      kind: RuntimeMessageDecodeFailureKind.ExtensionPairingApprovedMessage,
    };
    return decodeRuntimeMessage(decodeRequest).pipe(
      Effect.flatMap(({ type, payload, eventLogRecords }) => {
        const concurrencyOptions: UnboundedEffectConcurrency = {
          concurrency: "unbounded",
        } as const;
        return Effect.all(
          eventLogRecords.map(ExtensionEventLogRecordSchema.decode),
          concurrencyOptions,
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
        );
      }),
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
    const nonEmptyString = Schema.String.pipe(Schema.minLength(1));
    const payloadFields: {
      readonly recipientPublicKey: typeof nonEmptyString;
      readonly nonce: typeof nonEmptyString;
      readonly expectedDeviceId: typeof nonEmptyString;
      readonly expectedDevicePublicKey: typeof nonEmptyString;
      readonly expectedDeviceSigningPublicKey: typeof nonEmptyString;
    } = {
      recipientPublicKey: nonEmptyString,
      nonce: nonEmptyString,
      expectedDeviceId: nonEmptyString,
      expectedDevicePublicKey: nonEmptyString,
      expectedDeviceSigningPublicKey: nonEmptyString,
    };
    const typeSchema = Schema.Literal(
      ExtensionIdentityHandoffRequestMessageType.NookExtensionIdentityHandoffRequest,
    );
    const payloadSchema = Schema.Struct(payloadFields);
    const messageFields: {
      readonly type: typeof typeSchema;
      readonly payload: typeof payloadSchema;
    } = {
      type: typeSchema,
      payload: payloadSchema,
    };
    const request: RuntimeMessageDecodeRequest<
      ExtensionIdentityHandoffRequestMessage,
      typeof message
    > = {
      schema: Schema.Struct(messageFields),
      value: message,
      kind: RuntimeMessageDecodeFailureKind.ExtensionIdentityHandoffRequest,
    };
    return decodeRuntimeMessage(request);
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
    const typeSchema = Schema.Literal(
      ExtensionPairedVaultIdentityDiscoveryMessageType.NookExtensionPairedVaultIdentityDiscovery,
    );
    const messageFields: {
      readonly type: typeof typeSchema;
      readonly payload: typeof Schema.Unknown;
    } = {
      type: typeSchema,
      payload: Schema.Unknown,
    };
    const request: RuntimeMessageDecodeRequest<
      ExtensionPairedVaultIdentityDiscoveryMessage,
      typeof message
    > = {
      schema: Schema.Struct(messageFields),
      value: message,
      kind: RuntimeMessageDecodeFailureKind.ExtensionPairedVaultIdentityDiscovery,
    };
    return decodeRuntimeMessage(request);
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
    const nonEmptyString = Schema.String.pipe(Schema.minLength(1));
    const payloadFields: {
      readonly requestId: typeof nonEmptyString;
      readonly vaultStoreId: typeof nonEmptyString;
    } = {
      requestId: nonEmptyString,
      vaultStoreId: nonEmptyString,
    };
    const typeSchema = Schema.Literal(
      ExtensionPairedVaultUnlockRequestMessageType.NookExtensionPairedVaultUnlockRequest,
    );
    const payloadSchema = Schema.Struct(payloadFields);
    const messageFields: {
      readonly type: typeof typeSchema;
      readonly payload: typeof payloadSchema;
    } = {
      type: typeSchema,
      payload: payloadSchema,
    };
    const request: RuntimeMessageDecodeRequest<
      ExtensionPairedVaultUnlockRequestMessage,
      typeof message
    > = {
      schema: Schema.Struct(messageFields),
      value: message,
      kind: RuntimeMessageDecodeFailureKind.ExtensionPairedVaultUnlockRequest,
    };
    return decodeRuntimeMessage(request);
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
    const typeSchema = Schema.Literal(
      ExtensionPairedVaultIdentityHandoffRequestMessageType.NookExtensionPairedVaultIdentityHandoffRequest,
    );
    const messageFields: {
      readonly type: typeof typeSchema;
      readonly payload: typeof Schema.Unknown;
    } = {
      type: typeSchema,
      payload: Schema.Unknown,
    };
    const request: RuntimeMessageDecodeRequest<
      ExtensionPairedVaultIdentityHandoffRequestMessage,
      typeof message
    > = {
      schema: Schema.Struct(messageFields),
      value: message,
      kind: RuntimeMessageDecodeFailureKind.ExtensionPairedVaultIdentityHandoffRequest,
    };
    return decodeRuntimeMessage(request);
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
