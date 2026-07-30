export enum FocusedWordKind {
  None = "none",
  Focused = "focused",
}

export type FocusedWord =
  | { kind: FocusedWordKind.None }
  | { kind: FocusedWordKind.Focused; index: number };

export enum ChecksumStatusKind {
  NotChecked = "not-checked",
  Checked = "checked",
}

export type ChecksumStatus =
  | { kind: ChecksumStatusKind.NotChecked }
  | { kind: ChecksumStatusKind.Checked; valid: boolean };
