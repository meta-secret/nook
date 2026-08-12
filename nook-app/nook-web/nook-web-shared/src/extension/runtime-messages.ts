import {
  isExtensionConnectScopeValue,
  type ExtensionConnectScope,
} from "./extension-connect-scope";
import { ExtensionPairedVaultIdentityStatusMessageStatus } from "./paired-vault-identity-status";
import {
  isOpenCompanionLauncherMessage,
  OpenCompanionLauncherMessageType,
  type OpenCompanionLauncherMessage,
} from "./companion-launcher-message";
import {
  BeginExtensionPairingMessageType,
  ExtensionLocalEventLogUpdatedMessageType,
  isBeginExtensionPairingMessage,
  isExtensionLocalEventLogUpdatedMessage,
  isOpenSimpleVaultMessage,
  isRuntimeMessage,
  OpenSimpleVaultMessageType,
  type BeginExtensionPairingMessage,
  type ExtensionEventLogRecord,
  type ExtensionLocalEventLogUpdatedMessage,
  type OpenSimpleVaultMessage,
} from "./lifecycle-runtime-messages";

export {
  BeginExtensionPairingMessageType,
  ExtensionLocalEventLogUpdatedMessageType,
  isBeginExtensionPairingMessage,
  isExtensionLocalEventLogUpdatedMessage,
  isOpenCompanionLauncherMessage,
  isOpenSimpleVaultMessage,
  isRuntimeMessage,
  OpenCompanionLauncherMessageType,
  OpenSimpleVaultMessageType,
  type BeginExtensionPairingMessage,
  type ExtensionEventLogRecord,
  type ExtensionLocalEventLogUpdatedMessage,
  type OpenCompanionLauncherMessage,
  type OpenSimpleVaultMessage,
};

export { ExtensionPairedVaultIdentityStatusMessageStatus };

export enum ExtensionPairingVaultType {
  Simple = "simple",
  Sentinel = "sentinel",
}

export enum GeneratePasswordRequestType {
  NookWebsiteGeneratePassword = "nook:website-generate-password",
}

export type GeneratePasswordRequest = {
  type: GeneratePasswordRequestType.NookWebsiteGeneratePassword;
  payload: { origin: string };
};

export type ExtensionPairingApprovedGrant = {
  vaultType: ExtensionPairingVaultType.Simple;
  deviceId: string;
  devicePublicKey: string;
  deviceSigningPublicKey: string;
  deviceLabel: string;
  vaultStoreId: string;
  vaultName: string;
  approvedAt: string;
  scopes: ExtensionConnectScope[];
  providers: ExtensionStorageProviderPayload[];
};

export enum ExtensionStorageProviderType {
  Local = "local",
  LocalFolder = "local-folder",
  Github = "github",
  OAuthFile = "oauth-file",
}

export type ExtensionStorageProviderPayload = {
  id: string;
  type: `${ExtensionStorageProviderType}`;
};

export enum ExtensionPairingApprovedMessageType {
  NookExtensionPairingApproved = "nook:extension-pairing-approved",
}

export type ExtensionPairingApprovedMessage = {
  type: ExtensionPairingApprovedMessageType.NookExtensionPairingApproved;
  payload: ExtensionPairingApprovedGrant;
  eventLogRecords: ExtensionEventLogRecord[];
};

export enum ExtensionIdentityHandoffRequestMessageType {
  NookExtensionIdentityHandoffRequest = "nook:extension-identity-handoff-request",
}

export type ExtensionIdentityHandoffRequestMessage = {
  type: ExtensionIdentityHandoffRequestMessageType.NookExtensionIdentityHandoffRequest;
  payload: {
    recipientPublicKey: string;
    nonce: string;
    expectedDeviceId: string;
    expectedDevicePublicKey: string;
    expectedDeviceSigningPublicKey: string;
  };
};

export enum ExtensionPairedVaultIdentityDiscoveryMessageType {
  NookExtensionPairedVaultIdentityDiscovery = "nook:extension-paired-vault-identity-discovery",
}

export type ExtensionPairedVaultIdentityDiscoveryMessage = {
  type: ExtensionPairedVaultIdentityDiscoveryMessageType.NookExtensionPairedVaultIdentityDiscovery;
  payload: {
    requestId: string;
    vaultStoreId: string;
    expiresAt: number;
  };
};

export enum ExtensionPairedVaultUnlockRequestMessageType {
  NookExtensionPairedVaultUnlockRequest = "nook:extension-paired-vault-unlock-request",
}

export type ExtensionPairedVaultUnlockRequestMessage = {
  type: ExtensionPairedVaultUnlockRequestMessageType.NookExtensionPairedVaultUnlockRequest;
  payload: {
    requestId: string;
    vaultStoreId: string;
  };
};

type ExtensionPairedVaultIdentityStatusBase = {
  requestId: string;
  vaultStoreId: string;
};

export enum ExtensionPairedVaultIdentityStatusMessageType {
  NookExtensionPairedVaultIdentityStatus = "nook:extension-paired-vault-identity-status",
}

export type ExtensionPairedVaultIdentityStatusMessage =
  | {
      type: ExtensionPairedVaultIdentityStatusMessageType.NookExtensionPairedVaultIdentityStatus;
      payload: ExtensionPairedVaultIdentityStatusBase & {
        status:
          | ExtensionPairedVaultIdentityStatusMessageStatus.Unavailable
          | ExtensionPairedVaultIdentityStatusMessageStatus.Locked;
      };
    }
  | {
      type: ExtensionPairedVaultIdentityStatusMessageType.NookExtensionPairedVaultIdentityStatus;
      payload: ExtensionPairedVaultIdentityStatusBase & {
        status: ExtensionPairedVaultIdentityStatusMessageStatus.DifferentVault;
        connectedVaultStoreId: string;
        connectedVaultName: string;
      };
    }
  | {
      type: ExtensionPairedVaultIdentityStatusMessageType.NookExtensionPairedVaultIdentityStatus;
      payload: ExtensionPairedVaultIdentityStatusBase & {
        status: ExtensionPairedVaultIdentityStatusMessageStatus.Unlocked;
        extensionRuntimeId: string;
        deviceId: string;
        devicePublicKey: string;
        deviceSigningPublicKey: string;
        deviceLabel: string;
        nonce: string;
        scopes: ExtensionConnectScope[];
      };
    };

export enum ExtensionPairedVaultIdentityHandoffRequestMessageType {
  NookExtensionPairedVaultIdentityHandoffRequest = "nook:extension-paired-vault-identity-handoff-request",
}

export type ExtensionPairedVaultIdentityHandoffRequestMessage = {
  type: ExtensionPairedVaultIdentityHandoffRequestMessageType.NookExtensionPairedVaultIdentityHandoffRequest;
  payload: ExtensionIdentityHandoffRequestMessage["payload"] & {
    vaultStoreId: string;
  };
};

export type RuntimeMessage =
  | OpenSimpleVaultMessage
  | OpenCompanionLauncherMessage
  | BeginExtensionPairingMessage
  | ExtensionIdentityHandoffRequestMessage
  | ExtensionPairedVaultIdentityDiscoveryMessage
  | ExtensionPairedVaultUnlockRequestMessage
  | ExtensionPairedVaultIdentityStatusMessage
  | ExtensionPairedVaultIdentityHandoffRequestMessage
  | ExtensionPairingApprovedMessage
  | ExtensionLocalEventLogUpdatedMessage;

function isExtensionEventLogRecord(
  value: unknown,
): value is ExtensionEventLogRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.eventId === "string" &&
    record.eventId.length > 0 &&
    typeof record.path === "string" &&
    record.path.length > 0 &&
    isExtensionEventObject(record.event) &&
    "schema_version" in record.event &&
    typeof record.event.schema_version === "number"
  );
}

function isExtensionEventObject(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isExtensionEventLogRecords(
  value: unknown,
): value is ExtensionEventLogRecord[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(isExtensionEventLogRecord)
  );
}

export function isExtensionPairingApprovedMessage(
  message: unknown,
): message is ExtensionPairingApprovedMessage {
  if (
    !isRuntimeMessage(message) ||
    message.type !==
      ExtensionPairingApprovedMessageType.NookExtensionPairingApproved ||
    typeof (message as { payload?: unknown }).payload !== "object" ||
    !(message as { payload?: unknown }).payload
  ) {
    return false;
  }

  const payload = (message as { payload: Record<string, unknown> }).payload;
  return (
    isExtensionPairingApprovedGrant(payload) &&
    isExtensionEventLogRecords(
      (message as { eventLogRecords?: unknown }).eventLogRecords,
    )
  );
}

export function isExtensionIdentityHandoffRequestMessage(
  message: unknown,
): message is ExtensionIdentityHandoffRequestMessage {
  if (
    !isRuntimeMessage(message) ||
    message.type !==
      ExtensionIdentityHandoffRequestMessageType.NookExtensionIdentityHandoffRequest ||
    typeof (message as { payload?: unknown }).payload !== "object" ||
    !(message as { payload?: unknown }).payload
  ) {
    return false;
  }
  const payload = (message as { payload: Record<string, unknown> }).payload;
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


type IsPairedVaultRequestMessageArgs = {
  message: unknown;
  type:
    | ExtensionPairedVaultIdentityDiscoveryMessage["type"]
    | ExtensionPairedVaultUnlockRequestMessage["type"];
}
function isPairedVaultRequestMessage({
  message,
  type,
}: IsPairedVaultRequestMessageArgs): boolean {
  if (
    !isRuntimeMessage(message) ||
    message.type !== type ||
    typeof (message as { payload?: unknown }).payload !== "object" ||
    !(message as { payload?: unknown }).payload
  ) {
    return false;
  }
  const payload = (message as { payload: Record<string, unknown> }).payload;
  return (
    typeof payload.requestId === "string" &&
    payload.requestId.length > 0 &&
    typeof payload.vaultStoreId === "string" &&
    payload.vaultStoreId.length > 0
  );
}

export function isExtensionPairedVaultIdentityDiscoveryMessage(
  message: unknown,
): message is ExtensionPairedVaultIdentityDiscoveryMessage {
  const nookNamedArgs0_0: Parameters<typeof isPairedVaultRequestMessage>[0] = {
    message,
    type: ExtensionPairedVaultIdentityDiscoveryMessageType.NookExtensionPairedVaultIdentityDiscovery,
  };
  return (
    isPairedVaultRequestMessage(nookNamedArgs0_0) &&
    typeof (message as ExtensionPairedVaultIdentityDiscoveryMessage).payload
      .expiresAt === "number" &&
    Number.isFinite(
      (message as ExtensionPairedVaultIdentityDiscoveryMessage).payload
        .expiresAt,
    ) &&
    (message as ExtensionPairedVaultIdentityDiscoveryMessage).payload
      .expiresAt > Date.now()
  );
}

export function isExtensionPairedVaultUnlockRequestMessage(
  message: unknown,
): message is ExtensionPairedVaultUnlockRequestMessage {
  const nookTypedArgs0_0: Parameters<typeof isPairedVaultRequestMessage>[0] = {
    message,
    type: ExtensionPairedVaultUnlockRequestMessageType.NookExtensionPairedVaultUnlockRequest,
  };
  return isPairedVaultRequestMessage(nookTypedArgs0_0);
}

export function isExtensionPairedVaultIdentityStatusMessage(
  message: unknown,
): message is ExtensionPairedVaultIdentityStatusMessage {
  if (
    !isRuntimeMessage(message) ||
    message.type !==
      ExtensionPairedVaultIdentityStatusMessageType.NookExtensionPairedVaultIdentityStatus ||
    typeof (message as { payload?: unknown }).payload !== "object" ||
    !(message as { payload?: unknown }).payload
  ) {
    return false;
  }
  const payload = (message as { payload: Record<string, unknown> }).payload;
  if (
    typeof payload.requestId !== "string" ||
    payload.requestId.length === 0 ||
    typeof payload.vaultStoreId !== "string" ||
    payload.vaultStoreId.length === 0
  ) {
    return false;
  }
  if (
    payload.status ===
      ExtensionPairedVaultIdentityStatusMessageStatus.Unavailable ||
    payload.status === ExtensionPairedVaultIdentityStatusMessageStatus.Locked
  ) {
    return true;
  }
  if (
    payload.status ===
    ExtensionPairedVaultIdentityStatusMessageStatus.DifferentVault
  ) {
    return (
      typeof payload.connectedVaultStoreId === "string" &&
      payload.connectedVaultStoreId.length > 0 &&
      typeof payload.connectedVaultName === "string" &&
      payload.connectedVaultName.length > 0
    );
  }
  return (
    payload.status ===
      ExtensionPairedVaultIdentityStatusMessageStatus.Unlocked &&
    typeof payload.extensionRuntimeId === "string" &&
    payload.extensionRuntimeId.length > 0 &&
    typeof payload.deviceId === "string" &&
    payload.deviceId.length > 0 &&
    typeof payload.devicePublicKey === "string" &&
    payload.devicePublicKey.length > 0 &&
    typeof payload.deviceSigningPublicKey === "string" &&
    payload.deviceSigningPublicKey.length > 0 &&
    typeof payload.deviceLabel === "string" &&
    payload.deviceLabel.length > 0 &&
    typeof payload.nonce === "string" &&
    payload.nonce.length > 0 &&
    Array.isArray(payload.scopes) &&
    payload.scopes.every((scope) => typeof scope === "string")
  );
}

export function isExtensionPairedVaultIdentityHandoffRequestMessage(
  message: unknown,
): message is ExtensionPairedVaultIdentityHandoffRequestMessage {
  if (
    !isRuntimeMessage(message) ||
    message.type !==
      ExtensionPairedVaultIdentityHandoffRequestMessageType.NookExtensionPairedVaultIdentityHandoffRequest ||
    typeof (message as { payload?: unknown }).payload !== "object" ||
    !(message as { payload?: unknown }).payload
  ) {
    return false;
  }
  const payload = (message as { payload: Record<string, unknown> }).payload;
  return (
    typeof payload.vaultStoreId === "string" &&
    payload.vaultStoreId.length > 0 &&
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

export function isExtensionPairingApprovedGrant(
  value: unknown,
): value is ExtensionPairingApprovedGrant {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    payload.vaultType === ExtensionPairingVaultType.Simple &&
    typeof payload.deviceId === "string" &&
    typeof payload.devicePublicKey === "string" &&
    typeof payload.deviceSigningPublicKey === "string" &&
    typeof payload.deviceLabel === "string" &&
    typeof payload.vaultStoreId === "string" &&
    typeof payload.vaultName === "string" &&
    typeof payload.approvedAt === "string" &&
    Array.isArray(payload.scopes) &&
    payload.scopes.every(isExtensionConnectScopeValue) &&
    Array.isArray(payload.providers) &&
    payload.providers.every(isExtensionStorageProviderPayload)
  );
}

function isExtensionStorageProviderPayload(
  value: unknown,
): value is ExtensionStorageProviderPayload {
  if (!value || typeof value !== "object") return false;
  const provider = value as Record<string, unknown>;
  return (
    typeof provider.id === "string" &&
    provider.id.length > 0 &&
    (provider.type === ExtensionStorageProviderType.Local ||
      provider.type === ExtensionStorageProviderType.LocalFolder ||
      provider.type === ExtensionStorageProviderType.Github ||
      provider.type === ExtensionStorageProviderType.OAuthFile)
  );
}
