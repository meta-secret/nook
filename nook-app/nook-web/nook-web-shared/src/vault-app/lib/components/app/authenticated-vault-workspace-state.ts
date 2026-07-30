import type { SecretType } from "$lib/nook";

export enum SecretEditorModeKind {
  Closed = "closed",
  Adding = "adding",
}

export type SecretEditorMode =
  | { kind: SecretEditorModeKind.Closed }
  | { kind: SecretEditorModeKind.Adding; itemType: SecretType };
