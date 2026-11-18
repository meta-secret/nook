import { Effect } from "effect";
import {
  NativeVaultStorageFailure,
  VaultStorageFailure,
  VaultStorageFailureKind,
} from "$lib/runtime/storage-failure";
import { err as storageErr, ok as storageOk, type Result } from "neverthrow";

import type { SyncActionsContext } from "$lib/vault/action-contexts";
import type { ExtensionEventLogPublicationSnapshot } from "$lib/vault/action-contexts";
import { extensionEventLogPublisher } from "$web-shared/extension/event-log-bridge";
import { ActiveVaultKind } from "$lib/vault/state/provider.svelte";
import type {
  NookEncryptedSearchCatalogHint,
  NookVaultManager,
} from "$app-wasm";

type ExtensionPublicationManager = Pick<
  NookVaultManager,
  | "vaultStoreId"
  | "export_event_log_records_js"
  | "export_extension_search_catalog_hint_js"
>;
type ExtensionSyncPublicationContext = Pick<
  SyncActionsContext,
  "activeVault" | "enqueueStorage"
> & {
  admitManager(): Result<ExtensionPublicationManager, VaultStorageFailure>;
};
type ExtensionCatalogExport = {
  manager: ExtensionPublicationManager;
  vaultStoreId: string;
  publishedRecordCount: number;
};

/** Owns browser orchestration for one sync extension bridge context. */
export class ExtensionSyncPublication {
  constructor(private readonly state: ExtensionSyncPublicationContext) {}

  async publishExtensionEventLogUpdateForVault(): Promise<
    Result<ExtensionEventLogPublicationSnapshot, VaultStorageFailure>
  > {
    const state = this.state;
    const admitted = state.admitManager();
    if (admitted.isErr()) return storageErr(admitted.error);
    const vaultStoreId =
      state.activeVault.kind === ActiveVaultKind.Open
        ? storageOk(state.activeVault.storeId)
        : await state.enqueueStorage(() => {
            const manager = state.admitManager();
            if (manager.isErr()) return storageErr(manager.error);
            try {
              return storageOk(manager.value.vaultStoreId);
            } catch (nativeFailure) {
              return storageErr(new NativeVaultStorageFailure(nativeFailure));
            }
          });
    if (vaultStoreId.isErr()) return storageErr(vaultStoreId.error);
    const publicationRequest = await state.enqueueStorage(async () => {
      const manager = state.admitManager();
      if (manager.isErr()) return storageErr(manager.error);
      let eventLogRecords;
      try {
        const records = await manager.value.export_event_log_records_js();
        try {
          eventLogRecords = records.to_array();
        } finally {
          records.free();
        }
      } catch (nativeFailure) {
        return storageErr(new NativeVaultStorageFailure(nativeFailure));
      }
      const catalogExport: ExtensionCatalogExport = {
        manager: manager.value,
        vaultStoreId: vaultStoreId.value,
        publishedRecordCount: eventLogRecords.length,
      };
      const request: Parameters<
        typeof extensionEventLogPublisher.publishExtensionEventLogUpdate
      >[0] = {
        vaultStoreId: vaultStoreId.value,
        eventLogRecords,
        catalogHint: await this.catalogHint(catalogExport),
      };
      return storageOk(request);
    });
    if (publicationRequest.isErr()) return storageErr(publicationRequest.error);
    const publication =
      extensionEventLogPublisher.publishExtensionEventLogUpdate(
        publicationRequest.value,
      );
    if (publication.isErr()) {
      return storageErr(
        new VaultStorageFailure(
          VaultStorageFailureKind.ExtensionPublicationFailed,
        ),
      );
    }
    const snapshot: ExtensionEventLogPublicationSnapshot = {
      vaultStoreId: vaultStoreId.value,
      publishedRecordCount: publicationRequest.value.eventLogRecords.length,
    };
    return storageOk(snapshot);
  }

  private catalogHint({
    manager,
    vaultStoreId,
    publishedRecordCount,
  }: ExtensionCatalogExport): Promise<NookEncryptedSearchCatalogHint> {
    const absent: NookEncryptedSearchCatalogHint = { kind: "absent" };
    switch (publishedRecordCount) {
      case 0:
        return Promise.resolve(absent);
      default:
        return Effect.runPromise(
          Effect.tryPromise(() =>
            manager.export_extension_search_catalog_hint_js(vaultStoreId),
          ).pipe(Effect.catch(() => Effect.succeed(absent))),
        );
    }
  }
}
