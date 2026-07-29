import type { NookSecretRecord } from "$lib/nook";

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
