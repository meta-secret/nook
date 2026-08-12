import type { SyncActionsContext } from "$lib/vault/action-contexts";
import { createLogger, type RuntimeFailure } from "$lib/runtime/log";
import { is_vault_session_locked } from "$app-wasm";

const log = createLogger("vault-sync");

type SyncFailureContext = {
  readonly context: string;
  readonly failure: RuntimeFailure;
};

export function syncError({ context }: SyncFailureContext): void {
  log.warn(`${context} failed`);
}

export function scheduleAutoConnectAfterApproval(
  state: SyncActionsContext,
): void {
  if (
    !state.clientPolicy.should_auto_connect_after_approval(
      state.isAuthenticated,
      state.isVerifying,
      state.loginPasswordPrompt,
      state.sessionExpiredByIdle,
      is_vault_session_locked(),
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
