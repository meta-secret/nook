<script lang="ts">
  import type { PasswordImportMessageKeys } from '../../../generated/i18n-keys'
  import { Archive, FileSpreadsheet, Upload } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import { Card, CardContent } from '$lib/components/ui/card'
  import ImportProgress from '$lib/components/ImportProgress.svelte'
  import {
    importBinaryFile,
    importTextFile,
    ImportAttemptKind,
    type ImportPanelProps,
  } from '$lib/components/import-panel'
  import {
    ImportFileSelectionKind,
    PasswordImportFormat,
    PasswordImportIcon,
    PasswordImportOutcomeKind,
    type ImportFileSelection,
    type PasswordImportOutcome,
  } from './password-manager-import-state'

  type CommonProps = {
    messages: PasswordImportMessageKeys
    panelTestId: string
    fileTestId: string
    submitTestId: string
    errorTestId: string
    resultTestId: string
    accept: string
    icon: PasswordImportIcon
  }
  type Props = CommonProps &
    (
      | (ImportPanelProps<string> & { format: PasswordImportFormat.Text })
      | (ImportPanelProps<Uint8Array> & {
          format: PasswordImportFormat.Binary
        })
    )

  let {
    accept,
    embedded,
    errorTestId,
    fileTestId,
    format,
    icon,
    isSaving,
    messages,
    onImport,
    panelTestId,
    resultTestId,
    submitTestId,
    vault,
  }: Props = $props()
  let selectedFile = $state<ImportFileSelection>({
    kind: ImportFileSelectionKind.NotSelected,
  })
  let result = $state<PasswordImportOutcome>({
    kind: PasswordImportOutcomeKind.NotRun,
  })
  let error = $state('')
  let isImporting = $state(false)
  const busy = $derived(isImporting || isSaving)

  function selectFile(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0]
    selectedFile = file
      ? { kind: ImportFileSelectionKind.Selected, file }
      : { kind: ImportFileSelectionKind.NotSelected }
    result = { kind: PasswordImportOutcomeKind.NotRun }
    error = ''
  }

  async function importFile() {
    if (selectedFile.kind === ImportFileSelectionKind.NotSelected || busy)
      return
    const file = selectedFile.file
    result = { kind: PasswordImportOutcomeKind.NotRun }
    error = ''
    isImporting = true
    try {
      if (format === PasswordImportFormat.Text) {
        const importRequest: Parameters<typeof importTextFile>[0] = {
          file,
          isSaving: false,
          onImport,
        }
        const imported = await importTextFile(importRequest)
        if (imported.kind === ImportAttemptKind.Completed) {
          result = {
            kind: PasswordImportOutcomeKind.Completed,
            result: imported.result,
          }
        } else if (imported.kind === ImportAttemptKind.Failed) {
          error = imported.error
        }
        return
      }
      const importRequest: Parameters<typeof importBinaryFile>[0] = {
        file,
        isSaving: false,
        onImport,
      }
      const imported = await importBinaryFile(importRequest)
      if (imported.kind === ImportAttemptKind.Completed) {
        result = {
          kind: PasswordImportOutcomeKind.Completed,
          result: imported.result,
        }
      } else if (imported.kind === ImportAttemptKind.Failed) {
        error = imported.error
      }
    } finally {
      isImporting = false
    }
  }
</script>

<div class="space-y-4" data-testid={panelTestId}>
  {#if !embedded}
    <div>
      <h2 class="text-lg font-semibold text-foreground">
        {vault.t(messages.title)}
      </h2>
      <p class="mt-1 text-sm text-muted-foreground">
        {vault.t(messages.description)}
      </p>
    </div>
  {/if}

  <Card class="gap-0 border-border/60 bg-card py-0">
    <CardContent class="space-y-4 p-4 sm:p-5">
      <div class="flex items-start gap-3">
        {#if icon === PasswordImportIcon.Archive}
          <Archive class="mt-0.5 size-5 shrink-0 text-primary" />
        {:else}
          <FileSpreadsheet class="mt-0.5 size-5 shrink-0 text-primary" />
        {/if}
        <div class="space-y-1 text-sm">
          <p class="font-medium text-foreground">
            {vault.t(messages.exportHintTitle)}
          </p>
          <p class="text-muted-foreground">
            {vault.t(messages.exportHint)}
          </p>
        </div>
      </div>

      <label class="block space-y-2 text-sm font-medium text-foreground">
        <span>{vault.t(messages.fileLabel)}</span>
        <input
          type="file"
          accept={accept}
          data-testid={fileTestId}
          disabled={busy}
          onchange={selectFile}
          class="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
        />
      </label>

      <p class="text-xs text-muted-foreground">
        {vault.t(messages.supportedTypes)}
      </p>

      <Button
        data-testid={submitTestId}
        disabled={selectedFile.kind === ImportFileSelectionKind.NotSelected ||
          busy}
        onclick={() => void importFile()}
      >
        <Upload class="size-4" />
        {busy
          ? vault.t(messages.importing)
          : vault.t(messages.import)}
      </Button>

      {#if isImporting}
        <ImportProgress
          vault={vault}
          testId={`${panelTestId}-progress`}
        />
      {/if}

      {#if error}
        <p class="text-sm text-destructive" data-testid={errorTestId}>
          {error}
        </p>
      {/if}

      {#if result.kind === PasswordImportOutcomeKind.Completed}
        <div
          class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-foreground"
          data-testid={resultTestId}
        >
          <p class="font-medium">
            {(() => { const translationRequest: Parameters<typeof vault.t>[0] = {
  key: messages.resultImported,
  replacements: {
              count: String(result.result.imported),
            },
}; return vault.t(translationRequest); })()}
          </p>
          <p class="mt-1 text-xs text-muted-foreground">
            {(() => { const translationRequest2: Parameters<typeof vault.t>[0] = {
  key: messages.resultSkipped,
  replacements: {
              unsupported: String(result.result.skippedUnsupported),
              duplicates: String(result.result.skippedDuplicates),
            },
}; return vault.t(translationRequest2); })()}
          </p>
        </div>
      {/if}
    </CardContent>
  </Card>
</div>
