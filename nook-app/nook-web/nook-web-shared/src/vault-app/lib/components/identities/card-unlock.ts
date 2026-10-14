import type { WorkspaceRoute } from "$lib/app/workspace-route";

export enum UnlockPageKind {
  /** Open the workspace on this page. */
  Route = "route",
  /** Stay where the URL is (an extension consent or another non-workspace
   * page that waits for the unlock). */
  Stay = "stay",
}

export type UnlockPage =
  | { readonly kind: UnlockPageKind.Route; readonly route: WorkspaceRoute }
  | { readonly kind: UnlockPageKind.Stay };

/** Where unlocking from a card leads: a vault, and the page it opens on. */
export type UnlockDestination = {
  readonly storeId: string;
  readonly page: UnlockPage;
};

export enum PinPromptKind {
  Closed = "closed",
  /** Unlock the identity only. */
  Identity = "identity",
  /** Unlock the identity, then open a vault. */
  Vault = "vault",
}

/** A PIN-protected identity asks for its PIN on its card. */
export type PinPrompt =
  | { readonly kind: PinPromptKind.Closed }
  | { readonly kind: PinPromptKind.Identity }
  | {
      readonly kind: PinPromptKind.Vault;
      readonly destination: UnlockDestination;
    };
