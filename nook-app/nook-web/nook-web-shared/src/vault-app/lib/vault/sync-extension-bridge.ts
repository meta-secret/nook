import type { SyncActionsContext } from '$lib/vault/action-contexts'
import { createLogger } from '$lib/log'
import { publishExtensionEventLogUpdate } from '$web-shared/extension/event-log-bridge'
import type { ExtensionEventLogRecord } from '$web-shared/extension/runtime-messages'

const log = createLogger('vault-sync')

export async function publishExtensionEventLogUpdateForVault(
  state: SyncActionsContext,
): Promise<void> {
  if (!state.manager) return
  try {
    const vaultStoreId =
      state.activeVaultStoreId ??
      (await state.enqueueStorage(() => state.manager!.vaultStoreId))
    const eventLogRecords = await state.enqueueStorage(() =>
      state.manager!.exportEventLogRecords(),
    )
    try {
      publishExtensionEventLogUpdate(
        vaultStoreId,
        eventLogRecords.toArray() as ExtensionEventLogRecord[],
      )
    } finally {
      eventLogRecords.free()
    }
  } catch {
    // The extension bridge is optional and must never make a vault save fail.
    log.warn('extension event-log notification failed')
  }
}
