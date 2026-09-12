import type { ExtensionEventLogRecord as RustExtensionEventLogRecord } from "./nook-companion-wasm/nook_companion_wasm";

export enum OpenSimpleVaultMessageType {
  NookOpenSimpleVault = "nook:open-simple-vault",
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class OpenSimpleVaultMessage {
  private constructor() {}
  declare readonly type: OpenSimpleVaultMessageType.NookOpenSimpleVault;
  // eslint-disable-next-line @typescript-eslint/no-restricted-types -- Foreign browser data is narrowed at this adapter boundary.
  static is(message: unknown): message is OpenSimpleVaultMessage {
    return (
      RuntimeMessageEnvelope.hasRuntimeMessageType(message) &&
      message.type === OpenSimpleVaultMessageType.NookOpenSimpleVault
    );
  }
}

export enum BeginExtensionPairingMessageType {
  NookBeginExtensionPairing = "nook:begin-extension-pairing",
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class BeginExtensionPairingMessage {
  private constructor() {}
  declare readonly type: BeginExtensionPairingMessageType.NookBeginExtensionPairing;
  declare readonly payload: {
    deviceId: string;
    devicePublicKey: string;
    deviceSigningPublicKey: string;
    deviceLabel: string;
  };
  // eslint-disable-next-line @typescript-eslint/no-restricted-types -- Foreign browser data is narrowed at this adapter boundary.
  static is(message: unknown): message is BeginExtensionPairingMessage {
    if (
      !RuntimeMessageEnvelope.hasRuntimeMessageType(message) ||
      message.type !==
        BeginExtensionPairingMessageType.NookBeginExtensionPairing ||
      !("payload" in message) ||
      typeof message.payload !== "object" ||
      !message.payload
    ) {
      return false;
    }
    const { payload } = message;
    return (
      "deviceId" in payload &&
      typeof payload.deviceId === "string" &&
      payload.deviceId.length > 0 &&
      "devicePublicKey" in payload &&
      typeof payload.devicePublicKey === "string" &&
      payload.devicePublicKey.length > 0 &&
      "deviceSigningPublicKey" in payload &&
      typeof payload.deviceSigningPublicKey === "string" &&
      payload.deviceSigningPublicKey.length > 0 &&
      "deviceLabel" in payload &&
      typeof payload.deviceLabel === "string" &&
      payload.deviceLabel.length > 0
    );
  }
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export type ExtensionEventLogRecord = RustExtensionEventLogRecord;
export class ExtensionEventLogRecordAdmission {
  private constructor() {}
  // eslint-disable-next-line @typescript-eslint/no-restricted-types -- Foreign browser data is narrowed at this adapter boundary.
  static is(value: unknown): value is ExtensionEventLogRecord {
    if (!value || typeof value !== "object") return false;
    return (
      "eventId" in value &&
      typeof value.eventId === "string" &&
      value.eventId.length > 0 &&
      "path" in value &&
      typeof value.path === "string" &&
      value.path.length > 0 &&
      "event" in value &&
      !!value.event &&
      typeof value.event === "object" &&
      "schema_version" in value.event &&
      typeof value.event.schema_version === "number"
    );
  }
}

export enum ExtensionLocalEventLogUpdatedMessageType {
  NookExtensionLocalEventLogUpdated = "nook:extension-local-event-log-updated",
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class ExtensionLocalEventLogUpdatedMessage {
  private constructor() {}
  declare readonly type: ExtensionLocalEventLogUpdatedMessageType.NookExtensionLocalEventLogUpdated;
  declare readonly payload: {
    vaultStoreId: string;
    eventLogRecords: ExtensionEventLogRecord[];
  };
  // eslint-disable-next-line @typescript-eslint/no-restricted-types -- Foreign browser data is narrowed at this adapter boundary.
  static is(message: unknown): message is ExtensionLocalEventLogUpdatedMessage {
    if (
      !RuntimeMessageEnvelope.hasRuntimeMessageType(message) ||
      message.type !==
        ExtensionLocalEventLogUpdatedMessageType.NookExtensionLocalEventLogUpdated ||
      !("payload" in message) ||
      typeof message.payload !== "object" ||
      !message.payload
    ) {
      return false;
    }
    const { payload } = message;
    return (
      "vaultStoreId" in payload &&
      typeof payload.vaultStoreId === "string" &&
      payload.vaultStoreId.length > 0 &&
      "eventLogRecords" in payload &&
      Array.isArray(payload.eventLogRecords) &&
      payload.eventLogRecords.length > 0 &&
      payload.eventLogRecords.every(ExtensionEventLogRecord.is)
    );
  }
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class RuntimeMessageEnvelope {
  private constructor() {}
  declare readonly type: string;
  // eslint-disable-next-line @typescript-eslint/no-restricted-types -- Foreign browser data is narrowed at this adapter boundary.
  static hasRuntimeMessageType(message: unknown): message is { type: string } {
    return (
      !!message &&
      typeof message === "object" &&
      "type" in message &&
      typeof message.type === "string"
    );
  }
}

export const ExtensionEventLogRecord = ExtensionEventLogRecordAdmission;
