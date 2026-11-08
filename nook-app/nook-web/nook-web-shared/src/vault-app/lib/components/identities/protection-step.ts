import { NookIdentityNextStep } from "$app-wasm";
import { WorkspaceSection } from "$lib/vault/state/ui.svelte";

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
