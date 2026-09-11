import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from "$lib/runtime/storage-failure";
import type {
  SecretOperationResult,
  SecretOperationFailure,
} from "$lib/vault/secret-operation-failure";
type TextVaultImport = {
  readonly file: File;
  readonly isSaving: boolean;
  readonly onImport: (
    text: string,
  ) => Promise<SecretOperationResult<NookImportResult>>;
};

type BinaryVaultImport = {
  readonly file: File;
  readonly isSaving: boolean;
  readonly onImport: (
    bytes: Uint8Array,
  ) => Promise<SecretOperationResult<NookImportResult>>;
};

import type { NookImportResult } from "$lib/nook";
import type { VaultState } from "$lib/vault.svelte";

export type ImportPanelProps<ImportSource> = {
  vault: VaultState;
  isSaving: boolean;
  onImport: (
    source: ImportSource,
  ) => Promise<SecretOperationResult<NookImportResult>>;
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
  | { kind: ImportAttemptKind.Failed; error: SecretOperationFailure };

export class TextVaultFileImport {
  constructor(private readonly request: TextVaultImport) {}
  async execute(): Promise<ImportAttempt> {
    const { file, isSaving, onImport } = this.request;
    if (isSaving) return { kind: ImportAttemptKind.Skipped };
    let content: string;
    try {
      content = await file.text();
    } catch {
      return {
        kind: ImportAttemptKind.Failed,
        error: new VaultStorageFailure(VaultStorageFailureKind.OperationFailed),
      };
    }

    let result: Awaited<ReturnType<typeof onImport>>;
    try {
      result = await onImport(content);
    } catch {
      return {
        kind: ImportAttemptKind.Failed,
        error: new VaultStorageFailure(VaultStorageFailureKind.OperationFailed),
      };
    }
    return result.isOk()
      ? { kind: ImportAttemptKind.Completed, result: result.value }
      : { kind: ImportAttemptKind.Failed, error: result.error };
  }
}
export class BinaryVaultFileImport {
  constructor(private readonly request: BinaryVaultImport) {}
  async execute(): Promise<ImportAttempt> {
    const { file, isSaving, onImport } = this.request;
    if (isSaving) return { kind: ImportAttemptKind.Skipped };
    let content: Uint8Array;
    try {
      content = new Uint8Array(await file.arrayBuffer());
    } catch {
      return {
        kind: ImportAttemptKind.Failed,
        error: new VaultStorageFailure(VaultStorageFailureKind.OperationFailed),
      };
    }
    try {
      let result: Awaited<ReturnType<typeof onImport>>;
      try {
        result = await onImport(content);
      } catch {
        return {
          kind: ImportAttemptKind.Failed,
          error: new VaultStorageFailure(
            VaultStorageFailureKind.OperationFailed,
          ),
        };
      }
      return result.isOk()
        ? { kind: ImportAttemptKind.Completed, result: result.value }
        : { kind: ImportAttemptKind.Failed, error: result.error };
    } finally {
      content.fill(0);
    }
  }
}
