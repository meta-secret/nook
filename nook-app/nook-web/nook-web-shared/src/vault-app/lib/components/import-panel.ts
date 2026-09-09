type TextVaultImport = {
  readonly file: File;
  readonly isSaving: boolean;
  readonly onImport: (text: string) => Promise<NookImportResult>;
};

type BinaryVaultImport = {
  readonly file: File;
  readonly isSaving: boolean;
  readonly onImport: (bytes: Uint8Array) => Promise<NookImportResult>;
};

import type { NookImportResult } from "$lib/nook";
import type { VaultState } from "$lib/vault.svelte";

export type ImportPanelProps<ImportSource> = {
  vault: VaultState;
  isSaving: boolean;
  onImport: (source: ImportSource) => Promise<NookImportResult>;
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

export class TextVaultFileImport {
  constructor(private readonly request: TextVaultImport) {}
  async execute(): Promise<ImportAttempt> {
    const { file, isSaving, onImport } = this.request;
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
}
export class BinaryVaultFileImport {
  constructor(private readonly request: BinaryVaultImport) {}
  async execute(): Promise<ImportAttempt> {
    const { file, isSaving, onImport } = this.request;
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
}
