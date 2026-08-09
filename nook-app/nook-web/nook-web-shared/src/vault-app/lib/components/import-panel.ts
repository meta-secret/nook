import type { NookImportResult } from "$lib/nook";
import type { VaultState } from "$lib/vault.svelte";

export type ImportPanelProps<Input> = {
  vault: VaultState;
  isSaving: boolean;
  onImport: (input: Input) => Promise<NookImportResult>;
  embedded?: boolean;
};

export enum ImportAttemptKind {
  Skipped = "skipped",
  Completed = "completed",
  Failed = "failed",
}

export type ImportAttempt =
  | { kind: ImportAttemptKind.Skipped }
  | { kind: ImportAttemptKind.Completed; result: NookImportResult }
  | { kind: ImportAttemptKind.Failed; error: string };

export async function importTextFile({
  file,
  isSaving,
  onImport,
}: {
  readonly file: File;
  readonly isSaving: boolean;
  readonly onImport: (text: string) => Promise<NookImportResult>;
}): Promise<ImportAttempt> {
  if (isSaving) return { kind: ImportAttemptKind.Skipped };
  try {
    return {
      kind: ImportAttemptKind.Completed,
      result: await onImport(await file.text()),
    };
  } catch (cause) {
    return {
      kind: ImportAttemptKind.Failed,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export async function importBinaryFile({
  file,
  isSaving,
  onImport,
}: {
  readonly file: File;
  readonly isSaving: boolean;
  readonly onImport: (bytes: Uint8Array) => Promise<NookImportResult>;
}): Promise<ImportAttempt> {
  if (isSaving) return { kind: ImportAttemptKind.Skipped };
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return {
      kind: ImportAttemptKind.Completed,
      result: await onImport(bytes),
    };
  } catch (cause) {
    return {
      kind: ImportAttemptKind.Failed,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  } finally {
    bytes.fill(0);
  }
}
