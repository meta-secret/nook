import type { SyncActionsContext } from "$lib/vault/action-contexts";
import { createLogger } from "$lib/runtime/log";
import { publishExtensionEventLogUpdate } from "$web-shared/extension/event-log-bridge";
import type { ExtensionEventLogRecord } from "$web-shared/extension/runtime-messages";
import { ActiveVaultKind } from "$lib/vault/state/provider.svelte";

const log = createLogger("vault-sync");

export async function publishExtensionEventLogUpdateForVault(
  state: SyncActionsContext,
): Promise<void> {
  if (!state.hasManager) return;
  try {
    const vaultStoreId =
      state.activeVault.kind === ActiveVaultKind.Open
        ? state.activeVault.storeId
        : await state.enqueueStorage(() => state.requireManager().vaultStoreId);
    const eventLogRecords = await state.enqueueStorage(() =>
      state.requireManager().exportEventLogRecords(),
    );
    try {
      publishExtensionEventLogUpdate(
        vaultStoreId,
        eventLogRecords.toArray() as ExtensionEventLogRecord[],
      );
    } finally {
      eventLogRecords.free();
    }
  } catch {
    // The extension bridge is optional and must never make a vault save fail.
    log.warn("extension event-log notification failed");
  }
}
