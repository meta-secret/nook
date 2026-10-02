import type { VaultState } from "$lib/vault.svelte";
import {
  LoginVaultExtensionPairingStatusKind,
  LoginVaultExtensionPairingStatusProjection,
  type LoginVaultExtensionPairingStatusEntry,
} from "$lib/components/login/login-vault-extension-pairing-status";
import {
  extensionConnectionBrowser,
  PairedExtensionDiscoveryFailure,
} from "$lib/extension/connect";

import {
  type ExtensionSetupState,
  extensionInstallationBrowser,
} from "$lib/extension/install";

export enum ExtensionSetupOfferKind {
  Hidden = "hidden",
  Visible = "visible",
}

export type ExtensionSetupOffer =
  | { kind: ExtensionSetupOfferKind.Hidden }
  | { kind: ExtensionSetupOfferKind.Visible; setup: ExtensionSetupState };

/** Owns this browser host’s resources and interaction lifecycle. */
class ExtensionSetupBrowser {
  constructor(private readonly browser: typeof globalThis) {}

  async discoverPairingStatus(
    storeId: string,
    vault: VaultState,
  ): Promise<LoginVaultExtensionPairingStatusEntry> {
    const admission =
      await extensionConnectionBrowser.discoverAdmittedPairedExtensionIdentity(
        storeId,
      );
    if (admission.isErr()) {
      vault.errorMsg = vault.t(admission.error.translationKey);
      return { storeId, kind: LoginVaultExtensionPairingStatusKind.Checking };
    }
    return {
      storeId,
      ...new LoginVaultExtensionPairingStatusProjection(
        admission.value.discovery,
      ).status,
    };
  }

  async loadExtensionSetupOffer(
    vault: VaultState,
  ): Promise<ExtensionSetupOffer | undefined> {
    try {
      const setup =
        await extensionInstallationBrowser.resolveExtensionSetupState(
          vault.activeVault,
        );
      const offerRequest: Parameters<
        typeof extensionInstallationBrowser.shouldOfferExtensionSetup
      >[0] = {
        status: setup.status,
        environment: this.browser.navigator,
      };
      return extensionInstallationBrowser.shouldOfferExtensionSetup(
        offerRequest,
      )
        ? { kind: ExtensionSetupOfferKind.Visible, setup }
        : { kind: ExtensionSetupOfferKind.Hidden };
    } catch (failure) {
      if (!(failure instanceof PairedExtensionDiscoveryFailure)) throw failure;
      vault.errorMsg = vault.t(failure.translationKey);
      return;
    }
  }

  async openExtensionInstaller(): Promise<void> {
    const target =
      await extensionInstallationBrowser.loadExtensionInstallTarget();
    extensionInstallationBrowser.openExtensionInstallTarget(target);
  }

  async connectInstalledExtension(): Promise<boolean> {
    return extensionConnectionBrowser.openInstalledExtension();
  }

  observeExtensionSetupChanges(refresh: () => Promise<void>): () => void {
    const onVisibilityChange = () => {
      if (this.browser.document.visibilityState === "visible") void refresh();
    };
    this.browser.document.addEventListener(
      "visibilitychange",
      onVisibilityChange,
    );

    const observer = new MutationObserver(() => void refresh());
    const observeArgs: Parameters<typeof observer.observe>[1] = {
      attributes: true,
      attributeFilter: ["data-nook-extension-runtime-id"],
    };
    observer.observe(this.browser.document.documentElement, observeArgs);

    return () => {
      this.browser.document.removeEventListener(
        "visibilitychange",
        onVisibilityChange,
      );
      observer.disconnect();
    };
  }
}

export const extensionSetupBrowser = new ExtensionSetupBrowser(globalThis);
