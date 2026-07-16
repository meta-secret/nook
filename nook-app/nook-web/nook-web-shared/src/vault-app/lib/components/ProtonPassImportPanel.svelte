<script lang="ts">
  import { Archive, Upload } from '@lucide/svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import type { NookImportResult } from '$lib/nook'
  import { Button } from '$lib/components/ui/button'
  import { Card, CardContent } from '$lib/components/ui/card'

  let {
    vault,
    isSaving,
    onImport,
    embedded = false,
  }: {
    vault: VaultState
    isSaving: boolean
    onImport: (exportBytes: Uint8Array) => Promise<NookImportResult>
    embedded?: boolean
  } = $props()

  let selectedFile = $state<File | undefined>(undefined)
  let result = $state<NookImportResult | undefined>(undefined)
  let error = $state('')

  function selectFile(event: Event) {
    selectedFile = (event.currentTarget as HTMLInputElement).files?.[0]
    result = undefined
    error = ''
  }

  async function importFile() {
    if (!selectedFile || isSaving) return
    error = ''
    result = undefined
    let exportBytes: Uint8Array | undefined
    try {
      exportBytes = new Uint8Array(await selectedFile.arrayBuffer())
      result = await onImport(exportBytes)
    } catch (cause: unknown) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      exportBytes?.fill(0)
    }
  }
</script>

<div class="space-y-4" data-testid="proton-pass-import-panel">
  {#if !embedded}
    <div>
      <h2 class="text-lg font-semibold text-foreground">
        {vault.t('proton_pass_import.title')}
      </h2>
      <p class="mt-1 text-sm text-muted-foreground">
        {vault.t('proton_pass_import.description')}
      </p>
    </div>
  {/if}

  <Card class="gap-0 border-border/60 bg-card py-0">
    <CardContent class="space-y-4 p-4 sm:p-5">
      <div class="flex items-start gap-3">
        <Archive class="mt-0.5 size-5 shrink-0 text-primary" />
        <div class="space-y-1 text-sm">
          <p class="font-medium text-foreground">
            {vault.t('proton_pass_import.export_hint_title')}
          </p>
          <p class="text-muted-foreground">
            {vault.t('proton_pass_import.export_hint')}
          </p>
        </div>
      </div>

      <label class="block space-y-2 text-sm font-medium text-foreground">
        <span>{vault.t('proton_pass_import.file_label')}</span>
        <input
          type="file"
          accept=".zip,.json,application/zip,application/x-zip-compressed,application/json"
          data-testid="proton-pass-export-file"
          onchange={selectFile}
          class="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
        />
      </label>

      <p class="text-xs text-muted-foreground">
        {vault.t('proton_pass_import.supported_types')}
      </p>

      <Button
        data-testid="proton-pass-import-submit"
        disabled={!selectedFile || isSaving}
        onclick={() => void importFile()}
      >
        <Upload class="size-4" />
        {isSaving
          ? vault.t('proton_pass_import.importing')
          : vault.t('proton_pass_import.import')}
      </Button>

      {#if error}
        <p class="text-sm text-destructive" data-testid="proton-pass-import-error">
          {error}
        </p>
      {/if}

      {#if result}
        <div
          class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-foreground"
          data-testid="proton-pass-import-result"
        >
          <p class="font-medium">
            {vault.t('proton_pass_import.result_imported', {
              count: String(result.imported),
            })}
          </p>
          <p class="mt-1 text-xs text-muted-foreground">
            {vault.t('proton_pass_import.result_skipped', {
              unsupported: String(result.skippedUnsupported),
              duplicates: String(result.skippedDuplicates),
            })}
          </p>
        </div>
      {/if}
    </CardContent>
  </Card>
</div>
