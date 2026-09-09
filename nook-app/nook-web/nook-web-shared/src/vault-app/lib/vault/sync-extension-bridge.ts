import { NativeVaultStorageFailure } from '$lib/runtime/storage-failure'
import { err as storageErr, ok as storageOk } from 'neverthrow'

import type { SyncActionsContext } from '$lib/vault/action-contexts'
import { browserLogRuntime } from '$lib/runtime/log'
import { extensionEventLogPublisher } from '$web-shared/extension/event-log-bridge'
import { ActiveVaultKind } from '$lib/vault/state/provider.svelte'

const log = browserLogRuntime.createLogger('vault-sync')

/** Owns browser orchestration for one sync extension bridge context. */
export class ExtensionSyncPublication {
  constructor(private readonly state: SyncActionsContext) {}

  async publishExtensionEventLogUpdateForVault(): Promise<void> {
    const state = this.state
    if (!state.hasManager) return
    const vaultStoreId =
      state.activeVault.kind === ActiveVaultKind.Open
        ? storageOk(state.activeVault.storeId)
        : await state.enqueueStorage(() => {
            const manager = state.admitManager()
            if (manager.isErr()) return storageErr(manager.error)
            try {
              return storageOk(manager.value.vaultStoreId)
            } catch (nativeFailure) {
              return storageErr(new NativeVaultStorageFailure(nativeFailure))
            }
          })
    if (vaultStoreId.isErr()) {
      log.warn('extension event-log vault identity unavailable')
      return
    }
    const records = await state.enqueueStorage(async () => {
      const manager = state.admitManager()
      if (manager.isErr()) return storageErr(manager.error)
      try {
        return storageOk(await manager.value.export_event_log_records_js())
      } catch (nativeFailure) {
        return storageErr(new NativeVaultStorageFailure(nativeFailure))
      }
    })
    if (records.isErr()) {
      log.warn('extension event-log records unavailable')
      return
    }
    try {
      let eventLogRecords
      try {
        eventLogRecords = records.value.to_array()
      } catch {
        log.warn('extension event-log transport unavailable')
        return
      }
      const publication = extensionEventLogPublisher.publishExtensionEventLogUpdate({
        vaultStoreId: vaultStoreId.value,
        eventLogRecords,
      })
      if (publication.isErr()) log.warn('extension event-log notification failed')
    } finally {
      records.value.free()
    }
  }
}
