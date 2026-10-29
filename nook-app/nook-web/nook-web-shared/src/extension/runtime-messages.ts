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
  ExtensionIdentityInviteWireKind,
  type ExtensionIdentityInviteWire,
} from "./identity-invite-wire";
import {
  RuntimeMessageDecodeFailure,
  RuntimeMessageDecodeCauseKind,
  RuntimeMessageDecodeFailureKind,
} from "./runtime-message-decode-failure";
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
  /** How the extension joins the vault's identity, beyond this vault. */
  identityInvite: ExtensionIdentityInviteWire;
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

export class ExtensionPairingApprovedGrantAdmission {
  private constructor() {}

  /** The identity invite beside an approval; an approval without one comes
   * from a web app that predates identity connection. */
  private static identityInvite(
    payload: unknown,
  ): Result<
    ExtensionIdentityInviteWire,
    ExtensionPairingApprovedMessageAdmissionFailure
  > {
    const notOffered: ExtensionIdentityInviteWire = {
      kind: ExtensionIdentityInviteWireKind.NotOffered,
    };
    if (!payload || typeof payload !== "object") return ok(notOffered);
    if (!("identityInvite" in payload)) return ok(notOffered);
    const invite = payload.identityInvite;
    if (!invite || typeof invite !== "object" || !("kind" in invite))
      return err(
        ExtensionPairingApprovedMessageAdmissionFailure.IdentityInvite,
      );
    if (invite.kind === ExtensionIdentityInviteWireKind.NotOffered)
      return ok(notOffered);
    if (invite.kind === ExtensionIdentityInviteWireKind.NeedsCloud) {
      const needsCloud: ExtensionIdentityInviteWire = {
        kind: ExtensionIdentityInviteWireKind.NeedsCloud,
      };
      return ok(needsCloud);
    }
    if (
      invite.kind !== ExtensionIdentityInviteWireKind.Invited ||
      !("identityId" in invite) ||
      typeof invite.identityId !== "string" ||
      !invite.identityId.trim() ||
      !("identityLabel" in invite) ||
      typeof invite.identityLabel !== "string" ||
      !("code" in invite) ||
      typeof invite.code !== "string" ||
      !invite.code.trim() ||
      !("sealedPassphrase" in invite) ||
      typeof invite.sealedPassphrase !== "string" ||
      !invite.sealedPassphrase.trim() ||
      !("mountProviderId" in invite) ||
      typeof invite.mountProviderId !== "string" ||
      !invite.mountProviderId.trim()
    )
      return err(
        ExtensionPairingApprovedMessageAdmissionFailure.IdentityInvite,
      );
    const invited: ExtensionIdentityInviteWire = {
      kind: ExtensionIdentityInviteWireKind.Invited,
      identityId: invite.identityId,
      identityLabel: invite.identityLabel,
      code: invite.code,
      sealedPassphrase: invite.sealedPassphrase,
      mountProviderId: invite.mountProviderId,
    };
    return ok(invited);
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
    const identityInvite =
      ExtensionPairingApprovedGrantAdmission.identityInvite(payload);
    if (identityInvite.isErr())
      return err(
        ExtensionPairingApprovedMessageAdmissionFailure.IdentityInvite,
      );
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
      identityInvite: identityInvite.value,
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

export type RuntimeMessage =
  | ExtensionVaultEventLogRequestMessage
  | OpenSimpleVaultMessage
  | OpenCompanionLauncherMessage
  | BeginExtensionPairingMessage
  | ExtensionPairingApprovedMessage
  | ExtensionLocalEventLogUpdatedMessage
  | ExtensionSidePanelSignal;

export const ExtensionStorageProviderPayload =
  ExtensionStorageProviderPayloadAdmission;

export const ExtensionPairingApprovedGrant =
  ExtensionPairingApprovedGrantAdmission;
