import type { SyncActionsContext } from "$lib/vault/action-contexts";
import { browserLogRuntime } from "$lib/runtime/log";
import { publishExtensionEventLogUpdate } from "$web-shared/extension/event-log-bridge";
import { ActiveVaultKind } from "$lib/vault/state/provider.svelte";

const log = browserLogRuntime.createLogger("vault-sync");

/** Owns browser orchestration for one sync extension bridge context. */
export class ExtensionSyncPublication {
  constructor(private readonly state: SyncActionsContext) {}

  async publishExtensionEventLogUpdateForVault(): Promise<void> {
    const state = this.state;
    if (!state.hasManager) return;
    try {
      const vaultStoreId =
        state.activeVault.kind === ActiveVaultKind.Open
          ? state.activeVault.storeId
          : await state.enqueueStorage(
              () => state.requireManager().vaultStoreId,
            );
      const eventLogRecords = await state.enqueueStorage(() =>
        state.requireManager().export_event_log_records_js(),
      );
      try {
        const publishExtensionEventLogUpdateArgs: Parameters<
          typeof publishExtensionEventLogUpdate
        >[0] = {
          vaultStoreId,
          eventLogRecords: eventLogRecords.to_array(),
        };
        publishExtensionEventLogUpdate(publishExtensionEventLogUpdateArgs);
      } finally {
        eventLogRecords.free();
      }
    } catch {
      // The extension bridge is optional and must never make a vault save fail.
      log.warn("extension event-log notification failed");
    }
  }
}
