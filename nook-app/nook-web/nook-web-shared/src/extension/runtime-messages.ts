import type { ExtensionSidePanelSignal } from "./side-panel-signal-message";
import type { ExtensionKeyringProvidersMessage } from "./keyring-providers-message";
import { err, ok, type Result } from "neverthrow";
import { Effect, Schema } from "effect";
import {
  decode_extension_pairing_storage_provider,
  type ExtensionPairingStorageProviderPayload as RustExtensionPairingStorageProviderPayload,
  type NookKeyringProviderSharesAdmission,
} from "../vault-app/lib/nook-wasm/nook_wasm.js";
import type {
  ExtensionStorageProviderIdentity,
  ExtensionStorageProviderType as RustExtensionStorageProviderType,
  ExtensionVaultEventLogRequestMessage,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import { ExtensionConnectScope } from "./extension-connect-scope";
import { ExtensionPairingApprovedMessageAdmissionFailure } from "./extension-pairing-admission-failure";
import type { ExtensionKeyringVault } from "./keyring-grant-wire";
import {
  RuntimeMessageDecodeFailure,
  RuntimeMessageDecodeFailureKind,
} from "./runtime-message-decode-failure";
import {
  OpenCompanionLauncherIntent,
  type OpenCompanionLauncherMessage,
} from "./companion-launcher-message";

import { OpenCompanionLauncherMessage as OpenCompanionLauncherMessageSchema } from "./companion-launcher-message";

import type {
  BeginExtensionPairingMessage,
  ExtensionEventLogRecord,
  ExtensionLocalEventLogUpdatedMessage,
  OpenSimpleVaultMessage,
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
  OpenCompanionLauncherIntent,
  BeginExtensionPairingMessageSchema as BeginExtensionPairingMessage,
  type ExtensionEventLogRecord,
  ExtensionLocalEventLogUpdatedMessageSchema as ExtensionLocalEventLogUpdatedMessage,
  OpenCompanionLauncherMessageSchema as OpenCompanionLauncherMessage,
  OpenSimpleVaultMessageSchema as OpenSimpleVaultMessage,
};

export { ExtensionPairingApprovedMessageAdmissionFailure };
export { RuntimeMessageDecodeFailure, RuntimeMessageDecodeFailureKind };

export enum GeneratePasswordRequestType {
  NookWebsiteGeneratePassword = "nook:website-generate-password",
}

export type GeneratePasswordRequest = {
  readonly type: GeneratePasswordRequestType.NookWebsiteGeneratePassword;
  readonly payload: { origin: string };
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

/**
 * Structural browser wire value: the web app added the extension to a
 * keyring as an app with its own key, so every vault's DEK is encrypted to
 * that key. Nothing in it is tied to one vault, and a keyring with no vault
 * yet is approved the same way.
 */
export type ExtensionKeyringApproval = {
  readonly deviceId: string;
  readonly devicePublicKey: string;
  readonly deviceSigningPublicKey: string;
  readonly deviceLabel: string;
  readonly approvedAt: number;
  readonly scopes: ExtensionConnectScope[];
  readonly identityId: string;
  readonly identityLabel: string;
  /** The keyring's control log, each event's stored text. */
  readonly identityEvents: string[];
  /** Every vault of the keyring this browser holds, with its records; the
   * rest reach the extension through the keyring's sync providers. */
  readonly vaults: ExtensionKeyringVault[];
  /** The keyring's remote providers, one copy sealed in Rust to each other
   * app of the keyring; the extension's Rust takes the copy sealed to it. */
  readonly providers: NookKeyringProviderSharesAdmission;
};

const eventLogRecordDecodeOptions: { readonly concurrency: "unbounded" } = {
  concurrency: "unbounded",
};

type ExtensionKeyringHandOverFields = Pick<
  ExtensionKeyringApproval,
  "identityId" | "identityLabel" | "identityEvents" | "vaults"
>;

export class ExtensionKeyringApprovalAdmission {
  private constructor() {}

  /** The keyring's log and the vaults this browser holds, with records. */
  private static keyring(
    payload: unknown,
  ): Result<
    ExtensionKeyringHandOverFields,
    ExtensionPairingApprovedMessageAdmissionFailure
  > {
    const refused = err(
      ExtensionPairingApprovedMessageAdmissionFailure.Keyring,
    );
    if (
      !payload ||
      typeof payload !== "object" ||
      !("identityId" in payload) ||
      typeof payload.identityId !== "string" ||
      !payload.identityId.trim() ||
      !("identityLabel" in payload) ||
      typeof payload.identityLabel !== "string" ||
      !("identityEvents" in payload) ||
      !Array.isArray(payload.identityEvents) ||
      !("vaults" in payload) ||
      !Array.isArray(payload.vaults)
    )
      return refused;
    const identityEvents: string[] = [];
    for (const candidate of payload.identityEvents) {
      const event: unknown = candidate;
      if (typeof event !== "string" || !event) return refused;
      identityEvents.push(event);
    }
    if (identityEvents.length === 0) return refused;
    const vaults: ExtensionKeyringVault[] = [];
    for (const candidate of payload.vaults) {
      const vault: unknown = candidate;
      if (
        !vault ||
        typeof vault !== "object" ||
        !("storeId" in vault) ||
        typeof vault.storeId !== "string" ||
        !vault.storeId.trim() ||
        !("eventLogRecords" in vault) ||
        !Array.isArray(vault.eventLogRecords) ||
        vault.eventLogRecords.length === 0
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
    const keyring: ExtensionKeyringHandOverFields = {
      identityId: payload.identityId,
      identityLabel: payload.identityLabel,
      identityEvents,
      vaults,
    };
    return ok(keyring);
  }

  static parse(
    value: unknown,
  ): Result<
    ExtensionKeyringApproval,
    ExtensionPairingApprovedMessageAdmissionFailure
  > {
    if (!value || typeof value !== "object")
      return err(ExtensionPairingApprovedMessageAdmissionFailure.Payload);
    const payload = value;
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
    // Rust decodes the sealed providers when the extension takes them.
    if (!("providers" in payload))
      return err(ExtensionPairingApprovedMessageAdmissionFailure.Providers);
    const keyring = ExtensionKeyringApprovalAdmission.keyring(payload);
    if (keyring.isErr()) return err(keyring.error);
    const approval: ExtensionKeyringApproval = {
      deviceId: payload.deviceId,
      devicePublicKey: payload.devicePublicKey,
      deviceSigningPublicKey: payload.deviceSigningPublicKey,
      deviceLabel: payload.deviceLabel,
      approvedAt: payload.approvedAt,
      scopes,
      ...keyring.value,
      providers: payload.providers,
    };
    return ok(approval);
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
type ExtensionPairingApprovedMessageFields = {
  readonly type: typeof extensionPairingApprovedTypeSchema;
  readonly payload: typeof Schema.Unknown;
};
const extensionPairingApprovedMessageFields: ExtensionPairingApprovedMessageFields =
  {
    type: extensionPairingApprovedTypeSchema,
    payload: Schema.Unknown,
  };
const extensionPairingApprovedMessageSchema = Schema.Struct(
  extensionPairingApprovedMessageFields,
);

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class ExtensionPairingApprovedMessage {
  private constructor() {}
  declare readonly type: ExtensionPairingApprovedMessageType.NookExtensionPairingApproved;
  declare readonly payload: ExtensionKeyringApproval;
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
      Effect.flatMap(({ type, payload }) => {
        const admissionRequest: RuntimeMessageAdmissionRequest<
          ExtensionKeyringApproval,
          ExtensionPairingApprovedMessageAdmissionFailure
        > = {
          result: ExtensionKeyringApprovalAdmission.parse(payload),
          kind: RuntimeMessageDecodeFailureKind.ExtensionPairingApprovedGrant,
        };
        return decodeAdmissionResult(admissionRequest).pipe(
          Effect.map((approval) => ({ type, payload: approval })),
        );
      }),
    );
  }
}

export type RuntimeMessage =
  | ExtensionVaultEventLogRequestMessage
  | OpenSimpleVaultMessage
  | OpenCompanionLauncherMessage
  | BeginExtensionPairingMessage
  | ExtensionPairingApprovedMessage
  | ExtensionLocalEventLogUpdatedMessage
  | ExtensionKeyringProvidersMessage
  | ExtensionSidePanelSignal;

export const ExtensionStorageProviderPayload =
  ExtensionStorageProviderPayloadAdmission;
