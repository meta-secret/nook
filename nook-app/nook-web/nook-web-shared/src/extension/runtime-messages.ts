import type { ExtensionSidePanelSignal } from "./side-panel-signal-message";
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
  ExtensionVaultEventLogRequestMessage,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import { ExtensionConnectScope } from "./extension-connect-scope";
import { extensionPairingVaultType } from "./extension-pairing-vault-type";
import { ExtensionPairingApprovedMessageAdmissionFailure } from "./extension-pairing-admission-failure";
import {
  ExtensionKeyringGrantKind,
  type ExtensionKeyringGrant,
  type ExtensionKeyringVault,
} from "./keyring-grant-wire";
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
  readonly schema: Schema.Decoder<DecodedRuntimeMessage>;
  readonly value: RuntimeMessageWireValue;
  readonly kind: RuntimeMessageDecodeFailureKind;
};

function decodeRuntimeMessage<DecodedRuntimeMessage, RuntimeMessageWireValue>(
  request: RuntimeMessageDecodeRequest<
    DecodedRuntimeMessage,
    RuntimeMessageWireValue
  >,
): Effect.Effect<DecodedRuntimeMessage, RuntimeMessageDecodeFailure> {
  return Schema.decodeUnknownEffect(request.schema)(request.value).pipe(
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
  /** The keyring the extension is an app of, beyond this vault. */
  keyring: ExtensionKeyringGrant;
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
    return Effect.try(() =>
      decode_extension_pairing_storage_provider(value),
    ).pipe(
      Effect.mapError((cause) => {
        const failureRequest: Parameters<
          typeof RuntimeMessageDecodeFailure.fromCause
        >[0] = {
          kind: RuntimeMessageDecodeFailureKind.ExtensionPairingStorageProvider,
          cause,
        };
        return RuntimeMessageDecodeFailure.fromCause(failureRequest);
      }),
    );
  }
}

const eventLogRecordDecodeOptions: { readonly concurrency: "unbounded" } = {
  concurrency: "unbounded",
};

export class ExtensionPairingApprovedGrantAdmission {
  private constructor() {}

  /** The keyring the web app added the extension to, with its log and the
   * records of its other vaults. A web app always sends one. */
  private static keyring(
    payload: unknown,
  ): Result<
    ExtensionKeyringGrant,
    ExtensionPairingApprovedMessageAdmissionFailure
  > {
    const refused = err(
      ExtensionPairingApprovedMessageAdmissionFailure.Keyring,
    );
    if (!payload || typeof payload !== "object" || !("keyring" in payload))
      return refused;
    const keyring = payload.keyring;
    if (
      !keyring ||
      typeof keyring !== "object" ||
      !("kind" in keyring) ||
      keyring.kind !== ExtensionKeyringGrantKind.Added ||
      !("identityId" in keyring) ||
      typeof keyring.identityId !== "string" ||
      !keyring.identityId.trim() ||
      !("identityLabel" in keyring) ||
      typeof keyring.identityLabel !== "string" ||
      !("identityEvents" in keyring) ||
      !Array.isArray(keyring.identityEvents) ||
      !("vaults" in keyring) ||
      !Array.isArray(keyring.vaults)
    )
      return refused;
    const identityEvents: string[] = [];
    for (const candidate of keyring.identityEvents) {
      const event: unknown = candidate;
      if (typeof event !== "string" || !event) return refused;
      identityEvents.push(event);
    }
    if (identityEvents.length === 0) return refused;
    const vaults: ExtensionKeyringVault[] = [];
    for (const candidate of keyring.vaults) {
      const vault: unknown = candidate;
      if (
        !vault ||
        typeof vault !== "object" ||
        !("storeId" in vault) ||
        typeof vault.storeId !== "string" ||
        !vault.storeId.trim() ||
        !("eventLogRecords" in vault) ||
        !Array.isArray(vault.eventLogRecords)
      )
        return refused;
      const records = Effect.runSync(
        Effect.result(
          Effect.all(
            vault.eventLogRecords.map(ExtensionEventLogRecordSchema.decode),
            eventLogRecordDecodeOptions,
          ),
        ),
      );
      if (records._tag === "Failure") return refused;
      const admitted: ExtensionKeyringVault = {
        storeId: vault.storeId,
        eventLogRecords: records.success,
      };
      vaults.push(admitted);
    }
    const added: ExtensionKeyringGrant = {
      kind: ExtensionKeyringGrantKind.Added,
      identityId: keyring.identityId,
      identityLabel: keyring.identityLabel,
      identityEvents,
      vaults,
    };
    return ok(added);
  }

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
        Effect.result(ExtensionConnectScope.decode(candidate)),
      );
      if (admitted._tag === "Failure")
        return err(ExtensionPairingApprovedMessageAdmissionFailure.Scopes);
      scopes.push(admitted.success);
    }
    if (!("providers" in payload) || !Array.isArray(payload.providers))
      return err(ExtensionPairingApprovedMessageAdmissionFailure.Providers);
    const providers: ExtensionPairingStorageProviderPayload[] = [];
    for (const candidate of payload.providers) {
      const decoded = Effect.runSync(
        Effect.result(
          ExtensionPairingStorageProviderPayloadDecoder.decode(candidate),
        ),
      );
      if (decoded._tag === "Failure")
        return err(ExtensionPairingApprovedMessageAdmissionFailure.Providers);
      providers.push(decoded.success);
    }
    const keyring = ExtensionPairingApprovedGrantAdmission.keyring(payload);
    if (keyring.isErr()) return err(keyring.error);
    const grant: ExtensionPairingApprovedGrant = {
      vaultType: vaultType.value,
      deviceId: payload.deviceId,
      devicePublicKey: payload.devicePublicKey,
      deviceSigningPublicKey: payload.deviceSigningPublicKey,
      deviceLabel: payload.deviceLabel,
      vaultStoreId: payload.vaultStoreId,
      vaultName: payload.vaultName,
      // Approvals from a web app that predates identities carry none.
      identityLabel:
        "identityLabel" in payload && typeof payload.identityLabel === "string"
          ? payload.identityLabel
          : "",
      approvedAt: payload.approvedAt,
      scopes,
      providers,
      keyring: keyring.value,
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
).pipe(Schema.check(Schema.isMinLength(1)));
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
    type ExtensionPairingApprovedMessageEnvelope = Schema.Schema.Type<
      typeof extensionPairingApprovedMessageSchema
    >;
    const request: RuntimeMessageDecodeRequest<
      ExtensionPairingApprovedMessageEnvelope,
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
    const recipientPublicKeySchema = Schema.String.pipe(
      Schema.check(Schema.isMinLength(1)),
    );
    const nonceSchema = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));
    const expectedDeviceIdSchema = Schema.String.pipe(
      Schema.check(Schema.isMinLength(1)),
    );
    const expectedDevicePublicKeySchema = Schema.String.pipe(
      Schema.check(Schema.isMinLength(1)),
    );
    const expectedDeviceSigningPublicKeySchema = Schema.String.pipe(
      Schema.check(Schema.isMinLength(1)),
    );
    const identityHandoffPayloadFields: {
      readonly recipientPublicKey: typeof recipientPublicKeySchema;
      readonly nonce: typeof nonceSchema;
      readonly expectedDeviceId: typeof expectedDeviceIdSchema;
      readonly expectedDevicePublicKey: typeof expectedDevicePublicKeySchema;
      readonly expectedDeviceSigningPublicKey: typeof expectedDeviceSigningPublicKeySchema;
    } = {
      recipientPublicKey: recipientPublicKeySchema,
      nonce: nonceSchema,
      expectedDeviceId: expectedDeviceIdSchema,
      expectedDevicePublicKey: expectedDevicePublicKeySchema,
      expectedDeviceSigningPublicKey: expectedDeviceSigningPublicKeySchema,
    };
    const identityHandoffPayloadSchema = Schema.Struct(
      identityHandoffPayloadFields,
    );
    const identityHandoffTypeSchema = Schema.Literal(
      ExtensionIdentityHandoffRequestMessageType.NookExtensionIdentityHandoffRequest,
    );
    const identityHandoffMessageFields: {
      readonly type: typeof identityHandoffTypeSchema;
      readonly payload: typeof identityHandoffPayloadSchema;
    } = {
      type: identityHandoffTypeSchema,
      payload: identityHandoffPayloadSchema,
    };
    const identityHandoffMessageSchema = Schema.Struct(
      identityHandoffMessageFields,
    );
    type IdentityHandoffEnvelope = Schema.Schema.Type<
      typeof identityHandoffMessageSchema
    >;
    const identityHandoffRequest: RuntimeMessageDecodeRequest<
      IdentityHandoffEnvelope,
      typeof message
    > = {
      schema: identityHandoffMessageSchema,
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
    const discoveryTypeSchema = Schema.Literal(
      ExtensionPairedVaultIdentityDiscoveryMessageType.NookExtensionPairedVaultIdentityDiscovery,
    );
    const discoveryMessageFields: {
      readonly type: typeof discoveryTypeSchema;
      readonly payload: typeof Schema.Unknown;
    } = {
      type: discoveryTypeSchema,
      payload: Schema.Unknown,
    };
    const discoveryMessageSchema = Schema.Struct(discoveryMessageFields);
    type DiscoveryEnvelope = Schema.Schema.Type<typeof discoveryMessageSchema>;
    const discoveryRequest: RuntimeMessageDecodeRequest<
      DiscoveryEnvelope,
      typeof message
    > = {
      schema: discoveryMessageSchema,
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
    const unlockRequestIdSchema = Schema.String.pipe(
      Schema.check(Schema.isMinLength(1)),
    );
    const unlockVaultStoreIdSchema = Schema.String.pipe(
      Schema.check(Schema.isMinLength(1)),
    );
    const unlockPayloadFields: {
      readonly requestId: typeof unlockRequestIdSchema;
      readonly vaultStoreId: typeof unlockVaultStoreIdSchema;
    } = {
      requestId: unlockRequestIdSchema,
      vaultStoreId: unlockVaultStoreIdSchema,
    };
    const unlockPayloadSchema = Schema.Struct(unlockPayloadFields);
    const unlockTypeSchema = Schema.Literal(
      ExtensionPairedVaultUnlockRequestMessageType.NookExtensionPairedVaultUnlockRequest,
    );
    const unlockMessageFields: {
      readonly type: typeof unlockTypeSchema;
      readonly payload: typeof unlockPayloadSchema;
    } = {
      type: unlockTypeSchema,
      payload: unlockPayloadSchema,
    };
    const unlockMessageSchema = Schema.Struct(unlockMessageFields);
    type UnlockEnvelope = Schema.Schema.Type<typeof unlockMessageSchema>;
    const unlockRequest: RuntimeMessageDecodeRequest<
      UnlockEnvelope,
      typeof message
    > = {
      schema: unlockMessageSchema,
      value: message,
      kind: RuntimeMessageDecodeFailureKind.ExtensionPairedVaultUnlockRequest,
    };
    return decodeRuntimeMessage(unlockRequest);
  }
}

export enum ExtensionPairedVaultLockRequestMessageType {
  NookExtensionPairedVaultLockRequest = "nook:extension-paired-vault-lock-request",
}

/** A paired vault page asks the extension to lock with it: the page's
 * identity was handed over by this extension, which holds its key. */
export class ExtensionPairedVaultLockRequestMessage {
  private constructor() {}
  declare readonly type: ExtensionPairedVaultLockRequestMessageType.NookExtensionPairedVaultLockRequest;
  declare readonly payload: { requestId: string };
  static decode(
    message: unknown,
  ): Effect.Effect<
    ExtensionPairedVaultLockRequestMessage,
    RuntimeMessageDecodeFailure
  > {
    const requestIdSchema = Schema.String.pipe(
      Schema.check(Schema.isMinLength(1)),
    );
    const payloadFields: { readonly requestId: typeof requestIdSchema } = {
      requestId: requestIdSchema,
    };
    const typeSchema = Schema.Literal(
      ExtensionPairedVaultLockRequestMessageType.NookExtensionPairedVaultLockRequest,
    );
    const messageFields: {
      readonly type: typeof typeSchema;
      readonly payload: Schema.Struct<typeof payloadFields>;
    } = { type: typeSchema, payload: Schema.Struct(payloadFields) };
    const messageSchema = Schema.Struct(messageFields);
    const lockRequest: RuntimeMessageDecodeRequest<
      Schema.Schema.Type<typeof messageSchema>,
      typeof message
    > = {
      schema: messageSchema,
      value: message,
      kind: RuntimeMessageDecodeFailureKind.ExtensionPairedVaultLockRequest,
    };
    return decodeRuntimeMessage(lockRequest);
  }
}

/** The extension's answer to a lock request: locked, for that request. */
export class ExtensionPairedVaultLockResponse {
  private constructor() {}
  declare readonly ok: true;
  declare readonly requestId: string;
  static decode(
    response: unknown,
  ): Effect.Effect<
    ExtensionPairedVaultLockResponse,
    RuntimeMessageDecodeFailure
  > {
    const responseFields: {
      readonly ok: Schema.Literal<true>;
      readonly requestId: Schema.String;
    } = { ok: Schema.Literal(true), requestId: Schema.String };
    const responseSchema = Schema.Struct(responseFields);
    const lockResponse: RuntimeMessageDecodeRequest<
      Schema.Schema.Type<typeof responseSchema>,
      typeof response
    > = {
      schema: responseSchema,
      value: response,
      kind: RuntimeMessageDecodeFailureKind.ExtensionPairedVaultLockResponse,
    };
    return decodeRuntimeMessage(lockResponse);
  }
}

export enum ExtensionSessionLockedNoticeType {
  NookExtensionSessionLocked = "nook:extension-session-locked",
}

/** The extension locked (its panel, its idle expiry, or a paired page's
 * request). Vault pages hear it through the vault bridge content script; a
 * forged notice can only lock a page, never unlock one. */
export class ExtensionSessionLockedNotice {
  private constructor() {}
  declare readonly type: ExtensionSessionLockedNoticeType.NookExtensionSessionLocked;
  static readonly locked: ExtensionSessionLockedNotice = {
    type: ExtensionSessionLockedNoticeType.NookExtensionSessionLocked,
  };
  static decode(
    message: unknown,
  ): Effect.Effect<ExtensionSessionLockedNotice, RuntimeMessageDecodeFailure> {
    const noticeFields: {
      readonly type: Schema.Literal<ExtensionSessionLockedNoticeType.NookExtensionSessionLocked>;
    } = {
      type: Schema.Literal(
        ExtensionSessionLockedNoticeType.NookExtensionSessionLocked,
      ),
    };
    const noticeSchema = Schema.Struct(noticeFields);
    const notice: RuntimeMessageDecodeRequest<
      Schema.Schema.Type<typeof noticeSchema>,
      typeof message
    > = {
      schema: noticeSchema,
      value: message,
      kind: RuntimeMessageDecodeFailureKind.ExtensionSessionLockedNotice,
    };
    return decodeRuntimeMessage(notice);
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
    const handoffTypeSchema = Schema.Literal(
      ExtensionPairedVaultIdentityHandoffRequestMessageType.NookExtensionPairedVaultIdentityHandoffRequest,
    );
    const handoffMessageFields: {
      readonly type: typeof handoffTypeSchema;
      readonly payload: typeof Schema.Unknown;
    } = {
      type: handoffTypeSchema,
      payload: Schema.Unknown,
    };
    const handoffMessageSchema = Schema.Struct(handoffMessageFields);
    type HandoffEnvelope = Schema.Schema.Type<typeof handoffMessageSchema>;
    const handoffRequest: RuntimeMessageDecodeRequest<
      HandoffEnvelope,
      typeof message
    > = {
      schema: handoffMessageSchema,
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
  | ExtensionVaultEventLogRequestMessage
  | OpenSimpleVaultMessage
  | OpenCompanionLauncherMessage
  | BeginExtensionPairingMessage
  | ExtensionIdentityHandoffRequestMessage
  | ExtensionPairedVaultIdentityDiscoveryMessage
  | ExtensionPairedVaultUnlockRequestMessage
  | ExtensionPairedVaultLockRequestMessage
  | ExtensionPairedVaultIdentityHandoffRequestMessage
  | ExtensionPairingApprovedMessage
  | ExtensionLocalEventLogUpdatedMessage
  | ExtensionSidePanelSignal;

export const ExtensionStorageProviderPayload =
  ExtensionStorageProviderPayloadAdmission;

export const ExtensionPairingApprovedGrant =
  ExtensionPairingApprovedGrantAdmission;
