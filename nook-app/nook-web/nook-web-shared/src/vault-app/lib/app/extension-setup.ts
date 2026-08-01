import { openInstalledExtension } from "$lib/extension/connect";
import {
  type ExtensionSetupState,
  loadExtensionInstallTarget,
  openExtensionInstallTarget,
  resolveExtensionSetupState,
  shouldOfferExtensionSetup,
} from "$lib/extension/install";
import type { ActiveVault } from "$lib/vault/state/provider.svelte";

export enum ExtensionSetupOfferKind {
  Hidden = "hidden",
  Visible = "visible",
}

export type ExtensionSetupOffer =
  | { kind: ExtensionSetupOfferKind.Hidden }
  | { kind: ExtensionSetupOfferKind.Visible; setup: ExtensionSetupState };

export async function loadExtensionSetupOffer(
  activeVault: ActiveVault,
): Promise<ExtensionSetupOffer> {
  const setup = await resolveExtensionSetupState(activeVault);
  return shouldOfferExtensionSetup(setup.status)
    ? { kind: ExtensionSetupOfferKind.Visible, setup }
    : { kind: ExtensionSetupOfferKind.Hidden };
}

export async function openExtensionInstaller(): Promise<void> {
  const target = await loadExtensionInstallTarget();
  openExtensionInstallTarget(target);
}

export async function connectInstalledExtension(): Promise<boolean> {
  return openInstalledExtension();
}

export function observeExtensionSetupChanges(
  refresh: () => Promise<void>,
): () => void {
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") void refresh();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  const observer = new MutationObserver(() => void refresh());
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-nook-extension-runtime-id"],
  });

  return () => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    observer.disconnect();
  };
}
