import { err, ok, type Result } from "neverthrow";
import type {
  ExtensionStorageProviderIdentity,
  ExtensionPairingGrantApproval,
  ExtensionStorageProviderType as RustExtensionStorageProviderType,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import { ExtensionConnectScope } from "./extension-connect-scope";

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
} from "./lifecycle-runtime-messages";

import {
  RuntimeMessageEnvelope as RuntimeMessageEnvelopeSchema,
  BeginExtensionPairingMessage as BeginExtensionPairingMessageSchema,
  ExtensionLocalEventLogUpdatedMessage as ExtensionLocalEventLogUpdatedMessageSchema,
  OpenSimpleVaultMessage as OpenSimpleVaultMessageSchema,
} from "./lifecycle-runtime-messages";

export {
  BeginExtensionPairingMessageType,
  ExtensionLocalEventLogUpdatedMessageType,
  OpenCompanionLauncherIntent,
  OpenCompanionLauncherMessageType,
  OpenSimpleVaultMessageType,
  BeginExtensionPairingMessageSchema as BeginExtensionPairingMessage,
  type ExtensionEventLogRecord,
  ExtensionLocalEventLogUpdatedMessageSchema as ExtensionLocalEventLogUpdatedMessage,
  OpenCompanionLauncherMessageSchema as OpenCompanionLauncherMessage,
  OpenSimpleVaultMessageSchema as OpenSimpleVaultMessage,
};

export { ExtensionPairedVaultIdentityStatusMessageStatus };

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
  "syncProviderCount" | "vaultType"
> & {
  vaultType: "simple";
  providers: ExtensionStorageProviderPayload[];
};
export enum ExtensionPairingApprovedMessageAdmissionFailure {
  ApprovedAt = "invalid-pairing-grant-approved-at",
  DeviceId = "invalid-pairing-grant-device-id",
  DeviceLabel = "invalid-pairing-grant-device-label",
  DevicePublicKey = "invalid-pairing-grant-device-public-key",
  DeviceSigningPublicKey = "invalid-pairing-grant-device-signing-public-key",
  EventLogRecordEvent = "invalid-pairing-grant-event-log-record-event",
  EventLogRecordEventId = "invalid-pairing-grant-event-log-record-event-id",
  EventLogRecordPath = "invalid-pairing-grant-event-log-record-path",
  EventLogRecordSchemaVersion = "invalid-pairing-grant-event-log-record-schema-version",
  EventLogRecordsEmpty = "invalid-pairing-grant-event-log-records-empty",
  EventLogRecordsNotArray = "invalid-pairing-grant-event-log-records-not-array",
  MessageEnvelope = "invalid-pairing-grant-message-envelope",
  Payload = "invalid-pairing-grant-payload",
  Providers = "invalid-pairing-grant-providers",
  Scopes = "invalid-pairing-grant-scopes",
  VaultName = "invalid-pairing-grant-vault-name",
  VaultStoreId = "invalid-pairing-grant-vault-store-id",
  VaultType = "invalid-pairing-grant-vault-type",
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
    const payload = value as Record<string, unknown>;
    if (payload.vaultType !== "simple")
      return err(ExtensionPairingApprovedMessageAdmissionFailure.VaultType);
    if (typeof payload.deviceId !== "string")
      return err(ExtensionPairingApprovedMessageAdmissionFailure.DeviceId);
    if (typeof payload.devicePublicKey !== "string")
      return err(
        ExtensionPairingApprovedMessageAdmissionFailure.DevicePublicKey,
      );
    if (typeof payload.deviceSigningPublicKey !== "string")
      return err(
        ExtensionPairingApprovedMessageAdmissionFailure.DeviceSigningPublicKey,
      );
    if (typeof payload.deviceLabel !== "string")
      return err(ExtensionPairingApprovedMessageAdmissionFailure.DeviceLabel);
    if (typeof payload.vaultStoreId !== "string")
      return err(ExtensionPairingApprovedMessageAdmissionFailure.VaultStoreId);
    if (typeof payload.vaultName !== "string")
      return err(ExtensionPairingApprovedMessageAdmissionFailure.VaultName);
    if (typeof payload.approvedAt !== "string")
      return err(ExtensionPairingApprovedMessageAdmissionFailure.ApprovedAt);
    if (
      !Array.isArray(payload.scopes) ||
      !payload.scopes.every(
        ExtensionConnectScope.isExtensionConnectScopeValue.bind(
          ExtensionConnectScope,
        ),
      )
    )
      return err(ExtensionPairingApprovedMessageAdmissionFailure.Scopes);
    if (
      !Array.isArray(payload.providers) ||
      !payload.providers.every((provider) =>
        new ExtensionStorageProviderPayloadAdmission(provider).parse().isOk(),
      )
    )
      return err(ExtensionPairingApprovedMessageAdmissionFailure.Providers);
    return ok(value as ExtensionPairingApprovedGrant);
  }
  static is(value: unknown): value is ExtensionPairingApprovedGrant {
    return ExtensionPairingApprovedGrantAdmission.parse(value).isOk();
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
    const provider = value as Record<string, unknown>;
    if (typeof provider.id !== "string" || provider.id.length === 0)
      return err(ExtensionStorageProviderIdentityFailure.Invalid);
    switch (provider.type) {
      case ExtensionStorageProviderType.Local:
      case ExtensionStorageProviderType.LocalFolder:
      case ExtensionStorageProviderType.Github:
      case ExtensionStorageProviderType.OAuthFile:
        // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
        return ok({ id: provider.id, type: provider.type });
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
  static parseExtensionEventLogRecord(
    value: unknown,
  ): Result<
    ExtensionEventLogRecord,
    ExtensionPairingApprovedMessageAdmissionFailure
  > {
    if (!value || typeof value !== "object")
      return err(
        ExtensionPairingApprovedMessageAdmissionFailure.EventLogRecordEvent,
      );
    const record = value as Record<string, unknown>;
    if (typeof record.eventId !== "string" || record.eventId.length === 0)
      return err(
        ExtensionPairingApprovedMessageAdmissionFailure.EventLogRecordEventId,
      );
    if (typeof record.path !== "string" || record.path.length === 0)
      return err(
        ExtensionPairingApprovedMessageAdmissionFailure.EventLogRecordPath,
      );
    if (!ExtensionPairingApprovedMessage.isExtensionEventObject(record.event))
      return err(
        ExtensionPairingApprovedMessageAdmissionFailure.EventLogRecordEvent,
      );
    if (
      !("schema_version" in record.event) ||
      typeof record.event.schema_version !== "number"
    )
      return err(
        ExtensionPairingApprovedMessageAdmissionFailure.EventLogRecordSchemaVersion,
      );
    return ok(value as ExtensionEventLogRecord);
  }
  static isExtensionEventObject(
    value: unknown,
  ): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object";
  }
  static parseExtensionEventLogRecords(
    value: unknown,
  ): Result<
    ExtensionEventLogRecord[],
    ExtensionPairingApprovedMessageAdmissionFailure
  > {
    if (!Array.isArray(value))
      return err(
        ExtensionPairingApprovedMessageAdmissionFailure.EventLogRecordsNotArray,
      );
    if (value.length === 0)
      return err(
        ExtensionPairingApprovedMessageAdmissionFailure.EventLogRecordsEmpty,
      );
    for (const record of value) {
      const admitted =
        ExtensionPairingApprovedMessage.parseExtensionEventLogRecord(record);
      if (admitted.isErr()) return err(admitted.error);
    }
    return ok(value);
  }
  private constructor() {}
  declare readonly type: ExtensionPairingApprovedMessageType.NookExtensionPairingApproved;
  declare readonly payload: ExtensionPairingApprovedGrant;
  declare readonly eventLogRecords: ExtensionEventLogRecord[];
  static parse(
    message: unknown,
  ): Result<
    ExtensionPairingApprovedMessage,
    ExtensionPairingApprovedMessageAdmissionFailure
  > {
    if (
      !RuntimeMessageEnvelopeSchema.hasRuntimeMessageType(message) ||
      message.type !==
        ExtensionPairingApprovedMessageType.NookExtensionPairingApproved
    ) {
      return err(
        ExtensionPairingApprovedMessageAdmissionFailure.MessageEnvelope,
      );
    }
    if (
      !("payload" in message) ||
      typeof message.payload !== "object" ||
      !message.payload
    ) {
      return err(ExtensionPairingApprovedMessageAdmissionFailure.Payload);
    }
    const payload = ExtensionPairingApprovedGrantAdmission.parse(
      message.payload,
    );
    if (payload.isErr()) return err(payload.error);
    const records =
      ExtensionPairingApprovedMessage.parseExtensionEventLogRecords(
        "eventLogRecords" in message ? message.eventLogRecords : false,
      );
    if (records.isErr()) return err(records.error);
    return ok(message as ExtensionPairingApprovedMessage);
  }
  static is(message: unknown): message is ExtensionPairingApprovedMessage {
    return ExtensionPairingApprovedMessage.parse(message).isOk();
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
  static is(
    message: unknown,
  ): message is ExtensionIdentityHandoffRequestMessage {
    if (
      !RuntimeMessageEnvelopeSchema.hasRuntimeMessageType(message) ||
      message.type !==
        ExtensionIdentityHandoffRequestMessageType.NookExtensionIdentityHandoffRequest ||
      !("payload" in message) ||
      typeof message.payload !== "object" ||
      !message.payload
    ) {
      return false;
    }
    const payload = message.payload as Record<string, unknown>;
    return (
      typeof payload.recipientPublicKey === "string" &&
      payload.recipientPublicKey.length > 0 &&
      typeof payload.nonce === "string" &&
      payload.nonce.length > 0 &&
      typeof payload.expectedDeviceId === "string" &&
      payload.expectedDeviceId.length > 0 &&
      typeof payload.expectedDevicePublicKey === "string" &&
      payload.expectedDevicePublicKey.length > 0 &&
      typeof payload.expectedDeviceSigningPublicKey === "string" &&
      payload.expectedDeviceSigningPublicKey.length > 0
    );
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
  static is(
    message: unknown,
  ): message is ExtensionPairedVaultIdentityDiscoveryMessage {
    return (
      RuntimeMessageEnvelopeSchema.hasRuntimeMessageType(message) &&
      message.type ===
        ExtensionPairedVaultIdentityDiscoveryMessageType.NookExtensionPairedVaultIdentityDiscovery &&
      "payload" in message
    );
  }
}

export type CompanionIdentityDiscoveryTransportResponse =
  { ok: true; status: unknown } | { ok: false };

export enum ExtensionPairedVaultUnlockRequestMessageType {
  NookExtensionPairedVaultUnlockRequest = "nook:extension-paired-vault-unlock-request",
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class ExtensionPairedVaultUnlockRequestMessage {
  static isPairedVaultRequestMessage({
    message,
    type,
  }: IsPairedVaultRequestMessageArgs): boolean {
    if (
      !RuntimeMessageEnvelopeSchema.hasRuntimeMessageType(message) ||
      message.type !== type ||
      !("payload" in message) ||
      typeof message.payload !== "object" ||
      !message.payload
    ) {
      return false;
    }
    const payload = message.payload as Record<string, unknown>;
    return (
      typeof payload.requestId === "string" &&
      payload.requestId.length > 0 &&
      typeof payload.vaultStoreId === "string" &&
      payload.vaultStoreId.length > 0
    );
  }
  private constructor() {}
  declare readonly type: ExtensionPairedVaultUnlockRequestMessageType.NookExtensionPairedVaultUnlockRequest;
  declare readonly payload: {
    requestId: string;
    vaultStoreId: string;
  };
  static is(
    message: unknown,
  ): message is ExtensionPairedVaultUnlockRequestMessage {
    const nookTypedArgs0_0: Parameters<
      typeof ExtensionPairedVaultUnlockRequestMessage.isPairedVaultRequestMessage
    >[0] = {
      message,
      type: ExtensionPairedVaultUnlockRequestMessageType.NookExtensionPairedVaultUnlockRequest,
    };
    return ExtensionPairedVaultUnlockRequestMessage.isPairedVaultRequestMessage(
      nookTypedArgs0_0,
    );
  }
}

export enum ExtensionPairedVaultIdentityHandoffRequestMessageType {
  NookExtensionPairedVaultIdentityHandoffRequest = "nook:extension-paired-vault-identity-handoff-request",
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class ExtensionPairedVaultIdentityHandoffRequestMessage {
  private constructor() {}
  declare readonly type: ExtensionPairedVaultIdentityHandoffRequestMessageType.NookExtensionPairedVaultIdentityHandoffRequest;
  declare readonly payload: unknown;
  static is(
    message: unknown,
  ): message is ExtensionPairedVaultIdentityHandoffRequestMessage {
    if (
      !RuntimeMessageEnvelopeSchema.hasRuntimeMessageType(message) ||
      message.type !==
        ExtensionPairedVaultIdentityHandoffRequestMessageType.NookExtensionPairedVaultIdentityHandoffRequest ||
      !("payload" in message)
    ) {
      return false;
    }
    return true;
  }
}

export type CompanionIdentityHandoffTransportResponse =
  { ok: true; response: unknown } | { ok: false; reason: string };

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

type IsPairedVaultRequestMessageArgs = {
  message: unknown;
  type: ExtensionPairedVaultUnlockRequestMessage["type"];
};

export const ExtensionStorageProviderPayload =
  ExtensionStorageProviderPayloadAdmission;

export const ExtensionPairingApprovedGrant =
  ExtensionPairingApprovedGrantAdmission;
