<script lang="ts">
  import { FileSpreadsheet, Upload } from "@lucide/svelte";
  import type { VaultState } from "$lib/vault.svelte";
  import type { NookImportResult } from "$lib/nook";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent } from "$lib/components/ui/card";

  let {
    vault,
    isSaving,
    onImport,
    embedded = false,
  }: {
    vault: VaultState;
    isSaving: boolean;
    onImport: (csv: string) => Promise<NookImportResult>;
    embedded?: boolean;
  } = $props();

  let selectedFile = $state<File | undefined>(undefined);
  let result = $state<NookImportResult | undefined>(undefined);
  let error = $state("");

  function selectFile(event: Event) {
    selectedFile = (event.currentTarget as HTMLInputElement).files?.[0];
    result = undefined;
    error = "";
  }

  async function importFile() {
    if (!selectedFile || isSaving) return;
    error = "";
    result = undefined;
    try {
      result = await onImport(await selectedFile.text());
    } catch (cause: unknown) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }
</script>

<div class="space-y-4" data-testid="apple-passwords-import-panel">
  {#if !embedded}
    <div>
      <h2 class="text-lg font-semibold text-foreground">
        {vault.t("apple_passwords_import.title")}
      </h2>
      <p class="mt-1 text-sm text-muted-foreground">
        {vault.t("apple_passwords_import.description")}
      </p>
    </div>
  {/if}

  <Card class="gap-0 border-border/60 bg-card py-0">
    <CardContent class="space-y-4 p-4 sm:p-5">
      <div class="flex items-start gap-3">
        <FileSpreadsheet class="mt-0.5 size-5 shrink-0 text-primary" />
        <div class="space-y-1 text-sm">
          <p class="font-medium text-foreground">
            {vault.t("apple_passwords_import.export_hint_title")}
          </p>
          <p class="text-muted-foreground">
            {vault.t("apple_passwords_import.export_hint")}
          </p>
        </div>
      </div>

      <label class="block space-y-2 text-sm font-medium text-foreground">
        <span>{vault.t("apple_passwords_import.file_label")}</span>
        <input
          type="file"
          accept=".csv,text/csv"
          data-testid="apple-passwords-csv-file"
          onchange={selectFile}
          class="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
        />
      </label>

      <p class="text-xs text-muted-foreground">
        {vault.t("apple_passwords_import.supported_types")}
      </p>

      <Button
        data-testid="apple-passwords-import-submit"
        disabled={!selectedFile || isSaving}
        onclick={() => void importFile()}
      >
        <Upload class="size-4" />
        {isSaving
          ? vault.t("apple_passwords_import.importing")
          : vault.t("apple_passwords_import.import")}
      </Button>

      {#if error}
        <p
          class="text-sm text-destructive"
          data-testid="apple-passwords-import-error"
        >
          {error}
        </p>
      {/if}

      {#if result}
        <div
          class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-foreground"
          data-testid="apple-passwords-import-result"
        >
          <p class="font-medium">
            {vault.t("apple_passwords_import.result_imported", {
              count: String(result.imported),
            })}
          </p>
          <p class="mt-1 text-xs text-muted-foreground">
            {vault.t("apple_passwords_import.result_skipped", {
              unsupported: String(result.skippedUnsupported),
              duplicates: String(result.skippedDuplicates),
            })}
          </p>
        </div>
      {/if}
    </CardContent>
  </Card>
</div>
