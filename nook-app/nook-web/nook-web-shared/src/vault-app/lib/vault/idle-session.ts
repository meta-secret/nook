import { I18N_KEYS } from "../../../generated/i18n-keys";
import type { VaultState } from "$lib/vault.svelte";
import { set_vault_session_locked } from "$app-wasm";
import { browserLogRuntime } from "$lib/runtime/log";
import {
  VaultIdleSessionTracker,
  VaultIdleWarningKind,
} from "$lib/vault/idle-session-tracker";

const log = browserLogRuntime.createLogger("vault-session");

/** Owns browser orchestration for one idle session context. */
export class VaultIdleSessionActions {
  constructor(private readonly state: VaultState) {}

  ensureIdleSessionTracker(): void {
    const state = this.state;
    if (state.hasIdleSessionTracker()) return;
    const idleTimeoutConfig = import.meta.env.VITE_VAULT_IDLE_TIMEOUT_MS;
    const idleWarningConfig = import.meta.env.VITE_VAULT_IDLE_WARNING_MS;
    const createVaultIdleSessionTrackerArgs: ConstructorParameters<
      typeof VaultIdleSessionTracker
    >[0] = {
      timeoutMs:
        typeof idleTimeoutConfig === "string"
          ? state.runtimeConfig.resolve_vault_idle_timeout_ms(idleTimeoutConfig)
          : state.runtimeConfig.resolve_default_vault_idle_timeout_ms(),
      warning: {
        kind: VaultIdleWarningKind.Enabled,
        leadMs:
          typeof idleWarningConfig === "string"
            ? state.runtimeConfig.resolve_vault_idle_warning_ms(
                idleWarningConfig,
              )
            : state.runtimeConfig.resolve_default_vault_idle_warning_ms(),
        notify: () => this.showIdleLockWarning(),
      },
      onExpire: () => this.lockVaultDueToIdle(),
    };
    state.setIdleSessionTracker(
      new VaultIdleSessionTracker(createVaultIdleSessionTrackerArgs),
    );
  }

  showIdleLockWarning(): void {
    const state = this.state;
    if (!state.isAuthenticated) return;
    state.showSuccess(state.t(I18N_KEYS.SessionIdleWarning));
  }

  lockVaultDueToIdle(): void {
    const state = this.state;
    if (!state.isAuthenticated) return;
    state.sessionExpiredByIdle = true;
    state.lockVault();
  }

  startIdleSessionTracking() {
    const state = this.state;
    if (!state.isAuthenticated) return;
    state.ensureIdleSessionTracker();
    state.startIdleSessionTracker();
    log.debug("idle session tracking started");
  }

  stopIdleSessionTracking() {
    const state = this.state;
    state.stopIdleSessionTracker();
  }

  lockVault() {
    const state = this.state;
    log.info("vault locked");
    state.helpOpen = false;
    state.stopIdleSessionTracking();
    set_vault_session_locked(true);
    state.clearUnlockedSession();
    void state.lockDeviceProtection();
  }
}
