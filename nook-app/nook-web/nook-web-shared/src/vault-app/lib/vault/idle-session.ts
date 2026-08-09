import { I18N_KEYS } from "../../../generated/i18n-keys";
import type { VaultState } from "$lib/vault.svelte";
import { setVaultSessionLocked } from "$app-wasm";
import { createLogger } from "$lib/runtime/log";
import { createVaultIdleSessionTracker } from "$lib/vault/idle-session-tracker";

const log = createLogger("vault-session");

export function ensureIdleSessionTracker(state: VaultState): void {
  if (state.hasIdleSessionTracker()) return;
  const idleTimeoutConfig = import.meta.env.VITE_VAULT_IDLE_TIMEOUT_MS;
  const idleWarningConfig = import.meta.env.VITE_VAULT_IDLE_WARNING_MS;
  const createVaultIdleSessionTrackerArgs: Parameters<
    typeof createVaultIdleSessionTracker
  >[0] = {
    timeoutMs:
      typeof idleTimeoutConfig === "string"
        ? state.runtimeConfig.resolveVaultIdleTimeoutMs(idleTimeoutConfig)
        : state.runtimeConfig.resolveDefaultVaultIdleTimeoutMs(),
    warningMs:
      typeof idleWarningConfig === "string"
        ? state.runtimeConfig.resolveVaultIdleWarningMs(idleWarningConfig)
        : state.runtimeConfig.resolveDefaultVaultIdleWarningMs(),
    onExpire: () => lockVaultDueToIdle(state),
    onWarning: () => showIdleLockWarning(state),
  };
  state.setIdleSessionTracker(
    createVaultIdleSessionTracker(createVaultIdleSessionTrackerArgs),
  );
}

export function showIdleLockWarning(state: VaultState): void {
  if (!state.isAuthenticated) return;
  state.showSuccess(state.t(I18N_KEYS.SessionIdleWarning));
}

export function lockVaultDueToIdle(state: VaultState): void {
  if (!state.isAuthenticated) return;
  state.sessionExpiredByIdle = true;
  state.lockVault();
}

export function startIdleSessionTracking(state: VaultState) {
  if (!state.isAuthenticated) return;
  state.ensureIdleSessionTracker();
  state.startIdleSessionTracker();
  log.debug("idle session tracking started");
}

export function stopIdleSessionTracking(state: VaultState) {
  state.stopIdleSessionTracker();
}

export function lockVault(state: VaultState) {
  const infoArgs = {
    idle: state.sessionExpiredByIdle,
    secrets: state.secrets.length,
  };
  log.info("vault locked" + " " + JSON.stringify(infoArgs));
  state.helpOpen = false;
  state.stopIdleSessionTracking();
  setVaultSessionLocked(true);
  state.clearUnlockedSession();
  void state.lockDeviceProtection();
}
