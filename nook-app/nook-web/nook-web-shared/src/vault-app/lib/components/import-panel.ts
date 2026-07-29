import { omittedValue } from "../../../explicit-state";
import type { NookImportResult } from "$lib/nook";
import type { VaultState } from "$lib/vault.svelte";

export type ImportPanelProps<Input> = {
  vault: VaultState;
  isSaving: boolean;
  onImport: (input: Input) => Promise<NookImportResult>;
  embedded?: boolean;
};

export type ImportAttempt = {
  result: NookImportResult | void;
  error: string;
};

export function selectedImportFile(event: Event): File | void {
  return (event.currentTarget as HTMLInputElement).files?.[0] ?? omittedValue();
}

export async function importTextFile(
  file: File | void,
  isSaving: boolean,
  onImport: (text: string) => Promise<NookImportResult>,
): Promise<ImportAttempt> {
  if (!file || isSaving) return { result: omittedValue(), error: "" };
  try {
    return { result: await onImport(await file.text()), error: "" };
  } catch (cause: unknown) {
    return {
      result: omittedValue(),
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export async function importBinaryFile(
  file: File | void,
  isSaving: boolean,
  onImport: (bytes: Uint8Array) => Promise<NookImportResult>,
): Promise<ImportAttempt> {
  if (!file || isSaving) return { result: omittedValue(), error: "" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return { result: await onImport(bytes), error: "" };
  } catch (cause: unknown) {
    return {
      result: omittedValue(),
      error: cause instanceof Error ? cause.message : String(cause),
    };
  } finally {
    bytes.fill(0);
  }
}
