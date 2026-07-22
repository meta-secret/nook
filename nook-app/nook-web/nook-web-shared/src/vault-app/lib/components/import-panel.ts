import type { NookImportResult } from "$lib/nook";
import type { VaultState } from "$lib/vault.svelte";

export type ImportPanelProps<Input> = {
  vault: VaultState;
  isSaving: boolean;
  onImport: (input: Input) => Promise<NookImportResult>;
  embedded?: boolean;
};

export type ImportAttempt = {
  result: NookImportResult | undefined;
  error: string;
};

export function selectedImportFile(event: Event): File | undefined {
  return (event.currentTarget as HTMLInputElement).files?.[0] ?? undefined;
}

export async function importTextFile(
  file: File | undefined,
  isSaving: boolean,
  onImport: (text: string) => Promise<NookImportResult>,
): Promise<ImportAttempt> {
  if (!file || isSaving) return { result: undefined, error: "" };
  try {
    return { result: await onImport(await file.text()), error: "" };
  } catch (cause: unknown) {
    return {
      result: undefined,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export async function importBinaryFile(
  file: File | undefined,
  isSaving: boolean,
  onImport: (bytes: Uint8Array) => Promise<NookImportResult>,
): Promise<ImportAttempt> {
  if (!file || isSaving) return { result: undefined, error: "" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return { result: await onImport(bytes), error: "" };
  } catch (cause: unknown) {
    return {
      result: undefined,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  } finally {
    bytes.fill(0);
  }
}
