import type {
  ExtensionEventLogRecord,
  ExtensionLocalEventLogUpdatedMessage,
  ExtensionUnpairVaultMessage,
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

/** Publish an unpair notification for the extension when local vault data is
 * deleted from this browser profile. */
export function publishExtensionUnpairVault(vaultStoreId: string): void {
  if (typeof window === 'undefined' || !vaultStoreId) return
  const message: ExtensionUnpairVaultMessage = {
    type: 'nook:extension-unpair-vault',
    payload: { vaultStoreId },
  }
  window.postMessage(message, window.location.origin)
}

