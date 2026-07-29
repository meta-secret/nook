<script lang="ts">
  import { Archive, FileSpreadsheet, Upload } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import { Card, CardContent } from '$lib/components/ui/card'
  import ImportProgress from '$lib/components/ImportProgress.svelte'
  import type { NookImportResult } from '$lib/nook'
  import {
    importBinaryFile,
    importTextFile,
    selectedImportFile,
    type ImportPanelProps,
  } from '$lib/components/import-panel'
  import {
    EMPTY_VALUE,
    presentValue,
    type ValueState,
  } from '../../../explicit-state'

  type CommonProps = {
    translationPrefix: string
    panelTestId: string
    fileTestId: string
    submitTestId: string
    errorTestId: string
    resultTestId: string
    accept: string
    icon: 'archive' | 'spreadsheet'
  }
  type Props = CommonProps &
    (
      | (ImportPanelProps<string> & { format: 'text' })
      | (ImportPanelProps<Uint8Array> & { format: 'binary' })
    )

  let props: Props = $props()
  let selectedFile = $state<ValueState<File>>(EMPTY_VALUE)
  let result = $state<ValueState<NookImportResult>>(EMPTY_VALUE)
  let error = $state('')
  let isImporting = $state(false)
  const busy = $derived(isImporting || props.isSaving)

  const messageKey = (suffix: string): string =>
    `${props.translationPrefix}.${suffix}`

  function selectFile(event: Event) {
    const file = selectedImportFile(event)
    selectedFile = file ? presentValue(file) : EMPTY_VALUE
    result = EMPTY_VALUE
    error = ''
  }

  async function importFile() {
    if (selectedFile.kind === 'empty' || busy) return
    const file = selectedFile.value
    result = EMPTY_VALUE
    error = ''
    isImporting = true
    try {
      if (props.format === 'text') {
        const imported = await importTextFile(
          file,
          false,
          props.onImport,
        )
        result =
          typeof imported.result === "undefined"
            ? EMPTY_VALUE
            : presentValue(imported.result)
        error = imported.error
        return
      }
      const imported = await importBinaryFile(
        file,
        false,
        props.onImport,
      )
      result =
        typeof imported.result === "undefined"
          ? EMPTY_VALUE
          : presentValue(imported.result)
      error = imported.error
    } finally {
      isImporting = false
    }
  }
</script>

<div class="space-y-4" data-testid={props.panelTestId}>
  {#if !props.embedded}
    <div>
      <h2 class="text-lg font-semibold text-foreground">
        {props.vault.t(messageKey('title'))}
      </h2>
      <p class="mt-1 text-sm text-muted-foreground">
        {props.vault.t(messageKey('description'))}
      </p>
    </div>
  {/if}

  <Card class="gap-0 border-border/60 bg-card py-0">
    <CardContent class="space-y-4 p-4 sm:p-5">
      <div class="flex items-start gap-3">
        {#if props.icon === 'archive'}
          <Archive class="mt-0.5 size-5 shrink-0 text-primary" />
        {:else}
          <FileSpreadsheet class="mt-0.5 size-5 shrink-0 text-primary" />
        {/if}
        <div class="space-y-1 text-sm">
          <p class="font-medium text-foreground">
            {props.vault.t(messageKey('export_hint_title'))}
          </p>
          <p class="text-muted-foreground">
            {props.vault.t(messageKey('export_hint'))}
          </p>
        </div>
      </div>

      <label class="block space-y-2 text-sm font-medium text-foreground">
        <span>{props.vault.t(messageKey('file_label'))}</span>
        <input
          type="file"
          accept={props.accept}
          data-testid={props.fileTestId}
          disabled={busy}
          onchange={selectFile}
          class="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
        />
      </label>

      <p class="text-xs text-muted-foreground">
        {props.vault.t(messageKey('supported_types'))}
      </p>

      <Button
        data-testid={props.submitTestId}
        disabled={selectedFile.kind === 'empty' || busy}
        onclick={() => void importFile()}
      >
        <Upload class="size-4" />
        {busy
          ? props.vault.t(messageKey('importing'))
          : props.vault.t(messageKey('import'))}
      </Button>

      {#if isImporting}
        <ImportProgress
          vault={props.vault}
          testId={`${props.panelTestId}-progress`}
        />
      {/if}

      {#if error}
        <p class="text-sm text-destructive" data-testid={props.errorTestId}>
          {error}
        </p>
      {/if}

      {#if result.kind === 'present'}
        <div
          class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-foreground"
          data-testid={props.resultTestId}
        >
          <p class="font-medium">
            {props.vault.t(messageKey('result_imported'), {
              count: String(result.value.imported),
            })}
          </p>
          <p class="mt-1 text-xs text-muted-foreground">
            {props.vault.t(messageKey('result_skipped'), {
              unsupported: String(result.value.skippedUnsupported),
              duplicates: String(result.value.skippedDuplicates),
            })}
          </p>
        </div>
      {/if}
    </CardContent>
  </Card>
</div>
