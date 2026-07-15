import type {
  ExtensionEventLogRecord,
  ExtensionLocalEventLogUpdatedMessage,
} from './runtime-messages'

/** Publish encrypted event-log records for the extension's isolated content
 * bridge. No private key or decrypted vault value crosses the page boundary. */
export function publishExtensionEventLogUpdate(
  vaultStoreId: string,
  eventLogRecords: ExtensionEventLogRecord[],
): void {
  if (typeof window === 'undefined' || eventLogRecords.length === 0) return
  const message: ExtensionLocalEventLogUpdatedMessage = {
    type: 'nook:extension-local-event-log-updated',
    payload: { vaultStoreId, eventLogRecords },
  }
  window.postMessage(message, window.location.origin)
}
