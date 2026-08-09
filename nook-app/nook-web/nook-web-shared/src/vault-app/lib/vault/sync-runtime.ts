import type { SyncActionsContext } from "$lib/vault/action-contexts";
import { createLogger, type RuntimeFailure } from "$lib/runtime/log";
import { isVaultSessionLocked } from "$app-wasm";

const log = createLogger("vault-sync");

export function syncError({
  context,
  failure,
}: {
  readonly context: string;
  readonly failure: RuntimeFailure;
}): void {
  const warnArgs: Parameters<typeof log.warn>[1] = {
    error: failure.message,
    ...(failure.stack ? { stack: failure.stack } : {}),
  };
  log.warn(`${context} failed`, warnArgs);
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
