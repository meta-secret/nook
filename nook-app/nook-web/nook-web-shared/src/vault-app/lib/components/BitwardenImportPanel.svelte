<script lang="ts">
  import { ArrowLeft, FileJson, Upload } from '@lucide/svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import type { NookImportResult } from '$lib/nook'
  import { Button } from '$lib/components/ui/button'
  import { Card, CardContent } from '$lib/components/ui/card'
  import ImportProgress from '$lib/components/ImportProgress.svelte'

  let {
    vault,
    isSaving,
    onImport,
    onClose = undefined,
    embedded = false,
  }: {
    vault: VaultState
    isSaving: boolean
    onImport: (
      json: string,
      password: string,
    ) => Promise<NookImportResult>
    onClose?: (() => void) | undefined
    embedded?: boolean
  } = $props()

  let selectedFile = $state<File | undefined>(undefined)
  let result = $state<NookImportResult | undefined>(undefined)
  let error = $state('')
  let password = $state('')
  let isImporting = $state(false)
  const busy = $derived(isImporting || isSaving)

  function selectFile(event: Event) {
    selectedFile = (event.currentTarget as HTMLInputElement).files?.[0]
    result = undefined
    error = ''
  }

  async function importFile() {
    if (!selectedFile || busy) return
    error = ''
    result = undefined
    isImporting = true
    try {
      result = await onImport(await selectedFile.text(), password)
      password = ''
    } catch (cause: unknown) {
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
      {vault.t('common.back')}
    </button>
  {/if}

  {#if !embedded}
    <div>
      <h2 class="text-lg font-semibold text-foreground">
        {vault.t('bitwarden_import.title')}
      </h2>
      <p class="mt-1 text-sm text-muted-foreground">
        {vault.t('bitwarden_import.description')}
      </p>
    </div>
  {/if}

  <Card class="gap-0 border-border/60 bg-card py-0">
    <CardContent class="space-y-4 p-4 sm:p-5">
      <div class="flex items-start gap-3">
        <FileJson class="mt-0.5 size-5 shrink-0 text-primary" />
        <div class="space-y-1 text-sm">
          <p class="font-medium text-foreground">
            {vault.t('bitwarden_import.export_hint_title')}
          </p>
          <p class="text-muted-foreground">
            {vault.t('bitwarden_import.export_hint')}
          </p>
        </div>
      </div>

      <label class="block space-y-2 text-sm font-medium text-foreground">
        <span>{vault.t('bitwarden_import.file_label')}</span>
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
        <span>{vault.t('bitwarden_import.password_label')}</span>
        <input
          type="password"
          autocomplete="off"
          data-testid="bitwarden-export-password"
          disabled={busy}
          bind:value={password}
          placeholder={vault.t('bitwarden_import.password_placeholder')}
          class="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
        />
        <span class="block text-xs font-normal text-muted-foreground">
          {vault.t('bitwarden_import.password_hint')}
        </span>
      </label>

      <p class="text-xs text-muted-foreground">
        {vault.t('bitwarden_import.supported_types')}
      </p>

      <Button
        data-testid="bitwarden-import-submit"
        disabled={!selectedFile || busy}
        onclick={() => void importFile()}
      >
        <Upload class="size-4" />
        {busy
          ? vault.t('bitwarden_import.importing')
          : vault.t('bitwarden_import.import')}
      </Button>

      {#if isImporting}
        <ImportProgress vault={vault} testId="bitwarden-import-progress" />
      {/if}

      {#if error}
        <p class="text-sm text-destructive" data-testid="bitwarden-import-error">
          {error}
        </p>
      {/if}

      {#if result}
        <div
          class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-foreground"
          data-testid="bitwarden-import-result"
        >
          <p class="font-medium">
            {vault.t('bitwarden_import.result_imported', {
              count: String(result.imported),
            })}
          </p>
          <p class="mt-1 text-xs text-muted-foreground">
            {vault.t('bitwarden_import.result_skipped', {
              unsupported: String(result.skippedUnsupported),
              duplicates: String(result.skippedDuplicates),
            })}
          </p>
        </div>
      {/if}
    </CardContent>
  </Card>
</div>
