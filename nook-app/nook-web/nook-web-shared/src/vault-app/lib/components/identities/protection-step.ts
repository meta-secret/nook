import { NookIdentityNextStep } from "$app-wasm";
import { WorkspaceSection } from "$lib/vault/state/ui.svelte";

export enum ProtectionStepPageKind {
  /** The page that finishes the step. */
  Page = "page",
  /** The step is already done: nothing to open. */
  Done = "done",
}

export type ProtectionStepPage =
  | {
      readonly kind: ProtectionStepPageKind.Page;
      readonly section: WorkspaceSection;
    }
  | { readonly kind: ProtectionStepPageKind.Done };

/** Where a protection checklist step is finished: a sync provider (cloud
 * or any) keeps the copy; Add a device brings the second device. */
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
    case NookIdentityNextStep.Done:
      return { kind: ProtectionStepPageKind.Done };
  }
}
