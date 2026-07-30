import type { SyncActionsContext } from "$lib/vault/action-contexts";
import { createLogger } from "$lib/log";
import { isVaultSessionLocked } from "$app-wasm";

const log = createLogger("vault-sync");

export function syncError(context: string, error: unknown): void {
  log.warn(`${context} failed`, {
    error: error instanceof Error ? error.message : String(error),
    ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
  });
}

export function scheduleAutoConnectAfterApproval(
  state: SyncActionsContext,
): void {
  if (
    !state.clientPolicy.shouldAutoConnectAfterApproval(
      state.isAuthenticated,
      state.isVerifying,
      state.loginPasswordPrompt,
      state.sessionExpiredByIdle,
      isVaultSessionLocked(),
    )
  ) {
    return;
  }
  log.info("scheduling auto-connect after join approval");
  setTimeout(() => {
    if (state.isAuthenticated || state.isVerifying) return;
    void state.loadDb();
  }, 0);
}
