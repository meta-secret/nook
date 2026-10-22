import {
  DeviceProtectionStatus,
  VaultCompanionLockDecision,
  set_vault_session_locked,
} from "$app-wasm";
import { extensionConnectionBrowser } from "$lib/extension/connect";
import { browserLogRuntime } from "$lib/runtime/log";
import type { VaultState } from "$lib/vault.svelte";
import { I18N_KEYS } from "../../../generated/i18n-keys";

const log = browserLogRuntime.createLogger("vault-paired-extension-lock");

export type PairedExtensionLockRequester = Pick<
  typeof extensionConnectionBrowser,
  "requestPairedExtensionLock" | "followPairedExtensionLock"
>;

export type PairedExtensionLockRequest = {
  readonly vault: VaultState;
  readonly companion: PairedExtensionLockRequester;
};

/**
 * Keeps this page and the paired extension locked together while the
 * extension holds the page's identity key: the person's lock here (Lock, an
 * idle expiry) locks the extension, and the extension's lock locks the page.
 * A page keyed on this browser locks alone either way.
 */
export class PairedExtensionLockActions {
  private readonly state: VaultState;
  private readonly companion: PairedExtensionLockRequester;

  constructor(request: PairedExtensionLockRequest) {
    this.state = request.vault;
    this.companion = request.companion;
  }

  /** This page's lock, which reaches the extension installed beside it. */
  static forPage(vault: VaultState): PairedExtensionLockActions {
    const request: PairedExtensionLockRequest = {
      vault,
      companion: extensionConnectionBrowser,
    };
    return new PairedExtensionLockActions(request);
  }

  private locksTogether(): boolean {
    return (
      this.state.clientPolicy.companion_lock_decision(
        this.state.identityKeySource,
      ) === VaultCompanionLockDecision.LockTogether
    );
  }

  /** Locks only the identity key from its card, as the person asked. */
  lockIdentityKey(): void {
    const state = this.state;
    set_vault_session_locked(true);
    void state.lockDeviceProtection().then((locked) => {
      if (locked.isErr()) state.errorMsg = state.t(locked.error.translationKey);
    });
    this.lockPairedExtension();
  }

  /** The person locked this page: the extension holding its key locks too. */
  lockPairedExtension(): void {
    if (!this.locksTogether()) return;
    const state = this.state;
    void this.companion.requestPairedExtensionLock().then((locked) => {
      if (locked) return;
      log.warn("paired extension did not lock with the page");
      state.errorMsg = state.t(I18N_KEYS.SessionPairedExtensionLockFailed);
    });
  }

  /** The extension locked: a page holding its key locks with it, without
   * asking the extension back. A page already locked has nothing to do. */
  followPairedExtensionLock(): void {
    if (!this.locksTogether()) return;
    const state = this.state;
    if (state.isAuthenticated) {
      state.lockVault();
      return;
    }
    if (state.deviceProtectionStatus !== DeviceProtectionStatus.Unlocked)
      return;
    set_vault_session_locked(true);
    void state.lockDeviceProtection().then((locked) => {
      if (locked.isErr()) state.errorMsg = state.t(locked.error.translationKey);
    });
  }

  /** Follows the extension's lock notices; returns the teardown. */
  listen(): () => void {
    return this.companion.followPairedExtensionLock(() =>
      this.followPairedExtensionLock(),
    );
  }
}
