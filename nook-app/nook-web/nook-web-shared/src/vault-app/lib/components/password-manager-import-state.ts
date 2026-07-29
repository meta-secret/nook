import type { NookImportResult } from '$lib/nook'

export enum ImportFileSelectionKind {
  NotSelected = 'not-selected',
  Selected = 'selected',
}

export type ImportFileSelection =
  | { kind: ImportFileSelectionKind.NotSelected }
  | { kind: ImportFileSelectionKind.Selected; file: File }

export enum PasswordImportOutcomeKind {
  NotRun = 'not-run',
  Completed = 'completed',
}

export enum PasswordImportIcon {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Archive = 'archive',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Spreadsheet = 'spreadsheet',
}

export enum PasswordImportFormat {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Text = 'text',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Binary = 'binary',
}

export type PasswordImportOutcome =
  | { kind: PasswordImportOutcomeKind.NotRun }
  | { kind: PasswordImportOutcomeKind.Completed; result: NookImportResult }
