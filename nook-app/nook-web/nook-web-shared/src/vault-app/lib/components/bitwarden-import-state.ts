import type { NookImportResult } from "$lib/nook";

export enum ImportFileSelectionKind {
  NotSelected = "not-selected",
  Selected = "selected",
}

export type ImportFileSelection =
  | { kind: ImportFileSelectionKind.NotSelected }
  | { kind: ImportFileSelectionKind.Selected; file: File };

export enum ImportOutcomeKind {
  NotRun = "not-run",
  Completed = "completed",
}

export type ImportOutcome =
  | { kind: ImportOutcomeKind.NotRun }
  | { kind: ImportOutcomeKind.Completed; result: NookImportResult };
