import type { AuthenticatorCodeView, NookSecretRecord } from '$lib/nook'

export enum SecretRevealKind {
  Hidden = 'hidden',
  Revealed = 'revealed',
}

export type SecretReveal =
  | { kind: SecretRevealKind.Hidden }
  | { kind: SecretRevealKind.Revealed; record: NookSecretRecord }

export enum AuthenticatorCodePresentationKind {
  Hidden = 'hidden',
  Visible = 'visible',
}

export type AuthenticatorCodePresentation =
  | { kind: AuthenticatorCodePresentationKind.Hidden }
  | {
      kind: AuthenticatorCodePresentationKind.Visible
      code: AuthenticatorCodeView
    }

export enum ClipboardNoticeKind {
  Hidden = 'hidden',
  Visible = 'visible',
}

export type ClipboardNotice =
  | { kind: ClipboardNoticeKind.Hidden }
  | { kind: ClipboardNoticeKind.Visible; fieldKey: string }

export enum SecretEditorKind {
  Creating = 'creating',
  Editing = 'editing',
}

export type SecretEditor =
  | { kind: SecretEditorKind.Creating }
  | { kind: SecretEditorKind.Editing; record: NookSecretRecord }
