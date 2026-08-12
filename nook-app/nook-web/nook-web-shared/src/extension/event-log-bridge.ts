import {
  ExtensionLocalEventLogUpdatedMessageType,
  type ExtensionEventLogRecord,
  type ExtensionLocalEventLogUpdatedMessage,
} from "./runtime-messages";

/** Publish encrypted event-log records for the extension's isolated content
 * bridge. No private key or decrypted vault value crosses the page boundary. */

type PublishExtensionEventLogUpdateArgs = {
  readonly vaultStoreId: string;
  readonly eventLogRecords: ExtensionEventLogRecord[];
}
export function publishExtensionEventLogUpdate({
  vaultStoreId,
  eventLogRecords,
}: PublishExtensionEventLogUpdateArgs): void {
  if (!("window" in globalThis) || eventLogRecords.length === 0) return;
  const message: ExtensionLocalEventLogUpdatedMessage = {
    type: ExtensionLocalEventLogUpdatedMessageType.NookExtensionLocalEventLogUpdated,
    payload: { vaultStoreId, eventLogRecords },
  };
  window.postMessage(message, window.location.origin);
}
