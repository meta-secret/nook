<script lang="ts">
  type BitwardenVaultImport = { readonly json: string; readonly password: string }

  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { ArrowLeft, FileJson, Upload } from '@lucide/svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import type { NookImportResult } from '$lib/nook'
  import { Button } from '$lib/components/ui/button'
  import { Card, CardContent } from '$lib/components/ui/card'
  import ImportProgress from '$lib/components/ImportProgress.svelte'
  import {
    ImportFileSelectionKind,
    ImportOutcomeKind,
    type ImportFileSelection,
    type ImportOutcome,
  } from './bitwarden-import-state'

  let {
    vault,
    isSaving,
    onImport,
    onClose,
    embedded = false,
  }: {
    vault: VaultState
    isSaving: boolean
    onImport: (args: BitwardenVaultImport) => Promise<NookImportResult>
    onClose?: () => void
    embedded?: boolean
  } = $props()

  let selectedFile = $state<ImportFileSelection>({
    kind: ImportFileSelectionKind.NotSelected,
  })
  let result = $state<ImportOutcome>({ kind: ImportOutcomeKind.NotRun })
  let error = $state('')
  let password = $state('')
  let isImporting = $state(false)
  const busy = $derived(isImporting || isSaving)

  function selectFile(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0]
    selectedFile = file
      ? { kind: ImportFileSelectionKind.Selected, file }
      : { kind: ImportFileSelectionKind.NotSelected }
    result = { kind: ImportOutcomeKind.NotRun }
    error = ''
  }

  async function importFile() {
    if (selectedFile.kind === ImportFileSelectionKind.NotSelected || busy)
      return
    const file = selectedFile.file
    error = ''
    result = { kind: ImportOutcomeKind.NotRun }
    isImporting = true
    try {
      const onImportArgs: Parameters<typeof onImport>[0] = { json: await file.text(), password };
      result = {
        kind: ImportOutcomeKind.Completed,
        result: await onImport(onImportArgs),
      }
      password = ''
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      isImporting = false
    }
  }
</script>

<div class="space-y-4" data-testid="bitwarden-import-panel">
  {#if onClose}
    <button
      type="button"
      class="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      data-testid="bitwarden-import-back"
      onclick={onClose}
    >
      <ArrowLeft class="size-4" />
      {vault.t(I18N_KEYS.CommonBack)}
    </button>
  {/if}

  {#if !embedded}
    <div>
      <h2 class="text-lg font-semibold text-foreground">
        {vault.t(I18N_KEYS.BitwardenImportTitle)}
      </h2>
      <p class="mt-1 text-sm text-muted-foreground">
        {vault.t(I18N_KEYS.BitwardenImportDescription)}
      </p>
    </div>
  {/if}

  <Card class="gap-0 border-border/60 bg-card py-0">
    <CardContent class="space-y-4 p-4 sm:p-5">
      <div class="flex items-start gap-3">
        <FileJson class="mt-0.5 size-5 shrink-0 text-primary" />
        <div class="space-y-1 text-sm">
          <p class="font-medium text-foreground">
            {vault.t(I18N_KEYS.BitwardenImportExportHintTitle)}
          </p>
          <p class="text-muted-foreground">
            {vault.t(I18N_KEYS.BitwardenImportExportHint)}
          </p>
        </div>
      </div>

      <label class="block space-y-2 text-sm font-medium text-foreground">
        <span>{vault.t(I18N_KEYS.BitwardenImportFileLabel)}</span>
        <input
          type="file"
          accept="application/json,.json"
          data-testid="bitwarden-json-file"
          disabled={busy}
          onchange={selectFile}
          class="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
        />
      </label>

      <label class="block space-y-2 text-sm font-medium text-foreground">
        <span>{vault.t(I18N_KEYS.BitwardenImportPasswordLabel)}</span>
        <input
          type="password"
          autocomplete="off"
          data-testid="bitwarden-export-password"
          disabled={busy}
          bind:value={password}
          placeholder={vault.t(I18N_KEYS.BitwardenImportPasswordPlaceholder)}
          class="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
        />
        <span class="block text-xs font-normal text-muted-foreground">
          {vault.t(I18N_KEYS.BitwardenImportPasswordHint)}
        </span>
      </label>

      <p class="text-xs text-muted-foreground">
        {vault.t(I18N_KEYS.BitwardenImportSupportedTypes)}
      </p>

      <Button
        data-testid="bitwarden-import-submit"
        disabled={selectedFile.kind === ImportFileSelectionKind.NotSelected ||
          busy}
        onclick={() => void importFile()}
      >
        <Upload class="size-4" />
        {busy
          ? vault.t(I18N_KEYS.BitwardenImportImporting)
          : vault.t(I18N_KEYS.BitwardenImportImport)}
      </Button>

      {#if isImporting}
        <ImportProgress {vault} testId="bitwarden-import-progress" />
      {/if}

      {#if error}
        <p
          class="text-sm text-destructive"
          data-testid="bitwarden-import-error"
        >
          {error}
        </p>
      {/if}

      {#if result.kind === ImportOutcomeKind.Completed}
        <div
          class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-foreground"
          data-testid="bitwarden-import-result"
        >
          <p class="font-medium">
            {(() => { const tArgs: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.BitwardenImportResultImported, replacements: {
              count: String(result.result.imported),
            } }; return vault.t(tArgs); })()}
          </p>
          <p class="mt-1 text-xs text-muted-foreground">
            {(() => { const tArgs2: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.BitwardenImportResultSkipped, replacements: {
              unsupported: String(result.result.skippedUnsupported),
              duplicates: String(result.result.skippedDuplicates),
            } }; return vault.t(tArgs2); })()}
          </p>
        </div>
      {/if}
    </CardContent>
  </Card>
</div>
