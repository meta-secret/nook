import type {
  AuthenticatorCodeView,
  NookSecretRecord,
  PasskeyDetailsView,
  SecretHistoryView,
} from "$lib/nook";

export enum SecretPageInteractionKind {
  Ready = "ready",
  Debouncing = "debouncing",
  Loading = "loading",
  Failed = "failed",
}

export enum SecretRevealKind {
  Hidden = "hidden",
  Revealed = "revealed",
}

export type SecretReveal =
  | { kind: SecretRevealKind.Hidden }
  | { kind: SecretRevealKind.Revealed; record: NookSecretRecord };

export enum AuthenticatorCodePresentationKind {
  Hidden = "hidden",
  Visible = "visible",
}

export type AuthenticatorCodePresentation =
  | { kind: AuthenticatorCodePresentationKind.Hidden }
  | {
      kind: AuthenticatorCodePresentationKind.Visible;
      code: AuthenticatorCodeView;
    };

export enum PasskeyDetailsPresentationKind {
  Hidden = "hidden",
  Loading = "loading",
  Loaded = "loaded",
  Failed = "failed",
}

/** Public passkey details for the selected item, fetched on selection. */
export type PasskeyDetailsPresentation =
  | { kind: PasskeyDetailsPresentationKind.Hidden }
  | { kind: PasskeyDetailsPresentationKind.Loading; id: string }
  | {
      kind: PasskeyDetailsPresentationKind.Loaded;
      id: string;
      details: PasskeyDetailsView;
    }
  | { kind: PasskeyDetailsPresentationKind.Failed; id: string };

export enum SecretHistoryPresentationKind {
  Hidden = "hidden",
  Loading = "loading",
  Loaded = "loaded",
  Failed = "failed",
}

/** Event-log history (created, modified, device) for the selected item. */
export type SecretHistoryPresentation =
  | { kind: SecretHistoryPresentationKind.Hidden }
  | { kind: SecretHistoryPresentationKind.Loading; id: string }
  | {
      kind: SecretHistoryPresentationKind.Loaded;
      id: string;
      history: SecretHistoryView;
    }
  | { kind: SecretHistoryPresentationKind.Failed; id: string };

export enum ClipboardNoticeKind {
  Hidden = "hidden",
  Visible = "visible",
}

export type ClipboardNotice =
  | { kind: ClipboardNoticeKind.Hidden }
  | { kind: ClipboardNoticeKind.Visible; fieldKey: string };

export enum SecretEditorKind {
  Creating = "creating",
  Editing = "editing",
}

export type SecretEditor =
  | { kind: SecretEditorKind.Creating }
  | { kind: SecretEditorKind.Editing; record: NookSecretRecord };

export enum SecretSelectionKind {
  None = "none",
  Selected = "selected",
}

/** The item shown in the vault's detail sheet. */
export type SecretSelection =
  | { kind: SecretSelectionKind.None }
  | { kind: SecretSelectionKind.Selected; id: string };
