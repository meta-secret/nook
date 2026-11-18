import type { NookImportResult } from "$lib/nook";

export enum ImportFileSelectionKind {
  NotSelected = "not-selected",
  Selected = "selected",
}

export type ImportFileSelection =
  | { kind: ImportFileSelectionKind.NotSelected }
  | { kind: ImportFileSelectionKind.Selected; file: File };

export enum PasswordImportOutcomeKind {
  NotRun = "not-run",
  Completed = "completed",
}

export enum PasswordImportFormat {
  Text = "text",
  Binary = "binary",
}

export type PasswordImportOutcome =
  | { kind: PasswordImportOutcomeKind.NotRun }
  | { kind: PasswordImportOutcomeKind.Completed; result: NookImportResult };
