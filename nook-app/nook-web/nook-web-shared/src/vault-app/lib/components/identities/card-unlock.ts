import type { WorkspaceRoute } from "$lib/app/workspace-route";

/** Where unlocking from a card leads: a vault, opened on a workspace page. */
export type UnlockDestination = {
  readonly storeId: string;
  readonly route: WorkspaceRoute;
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
