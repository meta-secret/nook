import {
  NativeVaultStorageFailure,
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import { err as storageErr, ok as storageOk, type Result } from 'neverthrow'

import type { SyncActionsContext } from '$lib/vault/action-contexts'
import { extensionEventLogPublisher } from '$web-shared/extension/event-log-bridge'
import { ActiveVaultKind } from '$lib/vault/state/provider.svelte'

/** Owns browser orchestration for one sync extension bridge context. */
export class ExtensionSyncPublication {
  constructor(private readonly state: SyncActionsContext) {}

  async publishExtensionEventLogUpdateForVault(): Promise<
    Result<void, VaultStorageFailure>
  > {
    const state = this.state
    const admitted = state.admitManager()
    if (admitted.isErr()) return storageErr(admitted.error)
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
    if (vaultStoreId.isErr()) return storageErr(vaultStoreId.error)
    const records = await state.enqueueStorage(async () => {
      const manager = state.admitManager()
      if (manager.isErr()) return storageErr(manager.error)
      try {
        return storageOk(await manager.value.export_event_log_records_js())
      } catch (nativeFailure) {
        return storageErr(new NativeVaultStorageFailure(nativeFailure))
      }
    })
    if (records.isErr()) return storageErr(records.error)
    try {
      let eventLogRecords
      try {
        eventLogRecords = records.value.to_array()
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure))
      }
      const publication = extensionEventLogPublisher.publishExtensionEventLogUpdate({
        vaultStoreId: vaultStoreId.value,
        eventLogRecords,
      })
      if (publication.isErr()) {
        return storageErr(
          new VaultStorageFailure(
            VaultStorageFailureKind.ExtensionPublicationFailed,
          ),
        )
      }
      return storageOk(undefined)
    } finally {
      records.value.free()
    }
  }
}
