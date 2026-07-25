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

/** Request an acknowledged unpair from the extension during local browser data
 * deletion, falling back to window postMessage broadcast. */
export async function requestExtensionUnpairVault(
  vaultStoreId: string,
): Promise<boolean> {
  if (typeof window === 'undefined' || !vaultStoreId) return true
  const runtime = (
    globalThis as typeof globalThis & {
      chrome?: {
        runtime?: {
          sendMessage?: (
            extensionId: string,
            message: unknown,
            callback: (response?: unknown) => void,
          ) => void
          lastError?: { message?: string }
        }
      }
    }
  ).chrome?.runtime

  const root = document.documentElement
  const extensionRuntimeId = root?.getAttribute('data-nook-extension-runtime-id')

  if (runtime?.sendMessage && extensionRuntimeId) {
    const message: ExtensionUnpairVaultMessage = {
      type: 'nook:extension-unpair-vault',
      payload: { vaultStoreId },
    }
    return new Promise((resolve) => {
      let done = false
      const timer = window.setTimeout(() => {
        if (!done) {
          done = true
          publishExtensionUnpairVault(vaultStoreId)
          resolve(false)
        }
      }, 1500)

      try {
        runtime.sendMessage?.(extensionRuntimeId, message, (response) => {
          if (done) return
          done = true
          window.clearTimeout(timer)
          const runtimeError = runtime.lastError?.message
          if (
            !runtimeError &&
            typeof response === 'object' &&
            response !== null &&
            'ok' in response &&
            (response as { ok?: unknown }).ok === true
          ) {
            resolve(true)
          } else {
            publishExtensionUnpairVault(vaultStoreId)
            resolve(false)
          }
        })
      } catch {
        if (!done) {
          done = true
          window.clearTimeout(timer)
          publishExtensionUnpairVault(vaultStoreId)
          resolve(false)
        }
      }
    })
  }

  publishExtensionUnpairVault(vaultStoreId)
  return true
}


