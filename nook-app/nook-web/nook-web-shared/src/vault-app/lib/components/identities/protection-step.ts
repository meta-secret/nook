import { NookIdentityNextStep } from "$app-wasm";
import { WorkspaceSection } from "$lib/vault/state/ui.svelte";
import { extensionSetupBrowser } from "$lib/app/extension-setup";
import { showExtensionSidePanel } from "$lib/app/extension-setup-offer.svelte";
import type { VaultState } from "$lib/vault.svelte";

export enum ProtectionStepPageKind {
  /** The page that finishes the step. */
  Page = "page",
  /** The browser extension's install page, outside Nook. */
  InstallExtension = "install-extension",
  /** The installed extension's side panel, where it connects. */
  ExtensionPanel = "extension-panel",
  /** The step is already done: nothing to open. */
  Done = "done",
}

export type ProtectionStepPage =
  | {
      readonly kind: ProtectionStepPageKind.Page;
      readonly section: WorkspaceSection;
    }
  | { readonly kind: ProtectionStepPageKind.InstallExtension }
  | { readonly kind: ProtectionStepPageKind.ExtensionPanel }
  | { readonly kind: ProtectionStepPageKind.Done };

/** Where a checklist step is finished: a sync provider (cloud or any) keeps
 * the copy; Add a device brings the second device; the browser extension
 * installs from its store page and connects from its own side panel. */
export function protectionStepPage(
  action: NookIdentityNextStep,
): ProtectionStepPage {
  switch (action) {
    case NookIdentityNextStep.AddSyncProvider:
    case NookIdentityNextStep.AddCloudProvider:
      return {
        kind: ProtectionStepPageKind.Page,
        section: WorkspaceSection.Sync,
      };
    case NookIdentityNextStep.AddDevice:
      return {
        kind: ProtectionStepPageKind.Page,
        section: WorkspaceSection.AddDevice,
      };
    case NookIdentityNextStep.InstallExtension:
      return { kind: ProtectionStepPageKind.InstallExtension };
    case NookIdentityNextStep.ConnectExtension:
      return { kind: ProtectionStepPageKind.ExtensionPanel };
    case NookIdentityNextStep.Done:
      return { kind: ProtectionStepPageKind.Done };
  }
}

/** Named values required by `takeProtectionStep`. */
export type ProtectionStepRequest = {
  readonly action: NookIdentityNextStep;
  readonly vault: VaultState;
  /** Open one of the identity's own pages. */
  readonly openSection: (section: WorkspaceSection) => void;
};

/** Take a checklist step from any page that shows the keyring's card: open
 * its page, or the browser extension's store page or side panel. */
export function takeProtectionStep({
  action,
  vault,
  openSection,
}: ProtectionStepRequest): void {
  const page = protectionStepPage(action);
  switch (page.kind) {
    case ProtectionStepPageKind.Done:
      return;
    case ProtectionStepPageKind.InstallExtension:
      void extensionSetupBrowser.openExtensionInstaller();
      return;
    case ProtectionStepPageKind.ExtensionPanel:
      void showExtensionSidePanel(vault);
      return;
    case ProtectionStepPageKind.Page:
      openSection(page.section);
  }
}
