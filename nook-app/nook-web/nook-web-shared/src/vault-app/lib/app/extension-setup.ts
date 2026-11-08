import { extensionConnectionBrowser } from "$lib/extension/connect";

import { NookBrowserExtensionInstallation } from "$app-wasm";
import {
  ExtensionSetupStatus,
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

  loadExtensionSetupOffer(): ExtensionSetupOffer {
    const setup = extensionInstallationBrowser.resolveExtensionSetupState();
    const offerRequest: Parameters<
      typeof extensionInstallationBrowser.shouldOfferExtensionSetup
    >[0] = {
      status: setup.status,
      environment: this.browser.navigator,
    };
    return extensionInstallationBrowser.shouldOfferExtensionSetup(offerRequest)
      ? { kind: ExtensionSetupOfferKind.Visible, setup }
      : { kind: ExtensionSetupOfferKind.Hidden };
  }

  async openExtensionInstaller(): Promise<void> {
    const target =
      await extensionInstallationBrowser.loadExtensionInstallTarget();
    extensionInstallationBrowser.openExtensionInstallTarget(target);
  }

  async openExtensionSidePanel(): Promise<boolean> {
    return extensionConnectionBrowser.openExtensionSidePanel();
  }

  observeExtensionSetupChanges(refresh: () => void): () => void {
    const onVisibilityChange = () => {
      if (this.browser.document.visibilityState === "visible") refresh();
    };
    this.browser.document.addEventListener(
      "visibilitychange",
      onVisibilityChange,
    );

    const observer = new MutationObserver(() => refresh());
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

/** What the identity checklist knows of the extension in this browser: the
 * app does not offer it here, or it is installed or not. */
export function extensionInstallationFor(
  offer: ExtensionSetupOffer,
): NookBrowserExtensionInstallation {
  switch (offer.kind) {
    case ExtensionSetupOfferKind.Hidden:
      return NookBrowserExtensionInstallation.NotOffered;
    case ExtensionSetupOfferKind.Visible:
      switch (offer.setup.status) {
        case ExtensionSetupStatus.Installed:
          return NookBrowserExtensionInstallation.Installed;
        case ExtensionSetupStatus.NotInstalled:
          return NookBrowserExtensionInstallation.NotInstalled;
      }
  }
}
