import type { ExtensionEventLogRecord as RustExtensionEventLogRecord } from "./nook-companion-wasm/nook_companion_wasm";

export enum OpenSimpleVaultMessageType {
  NookOpenSimpleVault = "nook:open-simple-vault",
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class OpenSimpleVaultMessage {
  private constructor() {}
  declare readonly type: OpenSimpleVaultMessageType.NookOpenSimpleVault;
  static is<Message>(
    message: Message,
  ): message is Message & OpenSimpleVaultMessage {
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
  static is<Message>(
    message: Message,
  ): message is Message & BeginExtensionPairingMessage {
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
  static is<TransportValue>(
    value: TransportValue,
  ): value is TransportValue & ExtensionEventLogRecord {
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
  static is<Message>(
    message: Message,
  ): message is Message & ExtensionLocalEventLogUpdatedMessage {
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
  static hasRuntimeMessageType<Message>(
    message: Message,
  ): message is Message & RuntimeMessageEnvelope {
    return (
      !!message &&
      typeof message === "object" &&
      "type" in message &&
      typeof message.type === "string"
    );
  }
}

export const ExtensionEventLogRecord = ExtensionEventLogRecordAdmission;
