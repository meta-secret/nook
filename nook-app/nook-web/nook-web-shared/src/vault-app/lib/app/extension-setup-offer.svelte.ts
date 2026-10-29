import type { VaultState } from "$lib/vault.svelte";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import {
  ExtensionSetupOfferKind,
  type ExtensionSetupOffer,
  extensionSetupBrowser,
} from "$lib/app/extension-setup";

/** Named values required by `ExtensionSetupOfferModel`. */
export type ExtensionSetupOfferSource = {
  readonly vault: VaultState;
  /** This application ships the browser extension. */
  readonly supported: boolean;
};

/**
 * The open vault's offer to set up the browser extension. It stays hidden
 * where the application does not support the extension or no vault is open,
 * and follows the extension appearing or leaving while the page is open.
 */
export class ExtensionSetupOfferModel {
  offer = $state<ExtensionSetupOffer>({ kind: ExtensionSetupOfferKind.Hidden });

  private readonly vault: VaultState;
  private readonly supported: boolean;

  constructor({ vault, supported }: ExtensionSetupOfferSource) {
    this.vault = vault;
    this.supported = supported;
  }

  refresh(): void {
    this.offer =
      this.supported && this.vault.isAuthenticated
        ? extensionSetupBrowser.loadExtensionSetupOffer()
        : { kind: ExtensionSetupOfferKind.Hidden };
  }

  /** Refresh now and whenever the extension's presence changes; returns the
   * cleanup. */
  follow(): () => void {
    this.refresh();
    return extensionSetupBrowser.observeExtensionSetupChanges(() =>
      this.refresh(),
    );
  }

  /** Pair this vault from its page; Devices owns install and its errors. */
  /** Show the connected extension's side panel beside this vault, or say
   * why it did not open. */
  async openSidePanel(): Promise<void> {
    if (await extensionSetupBrowser.openExtensionSidePanel()) return;
    this.vault.errorMsg = this.vault.t(
      I18N_KEYS.ExtensionSetupVaultPanelFailed,
    );
  }
}
