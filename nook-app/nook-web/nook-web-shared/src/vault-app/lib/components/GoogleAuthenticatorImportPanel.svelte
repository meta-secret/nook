<script lang="ts">
  import {
    SecretFailurePresentation,
    type SecretOperationResult,
  } from '$lib/vault/secret-operation-failure'
  type AuthenticatorMigrationUriCollection = string[]

  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { onDestroy } from 'svelte'
  import { Effect, Fiber } from 'effect'
  import { Camera, ImageUp, QrCode, Trash2, Upload, X } from '@lucide/svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import type { NookImportResult } from '$lib/nook'
  import { Button } from '$lib/components/ui/button'
  import { Card, CardContent } from '$lib/components/ui/card'
  import { QrCodeReader, type QrCodeTexts } from '$lib/qr/qr-code-reader'
  import { QrCameraScan, type QrCameraScanTarget } from '$lib/qr/qr-camera-scan'
  import {
    AuthenticatorImportOutcomeKind,
    CameraScanKind,
    type AuthenticatorImportOutcome,
    type CameraScan,
  } from './google-authenticator-import-state'

  type ScanFailures = string[]
  type QrImageReadHandling = {
    readonly onSuccess: (texts: QrCodeTexts) => ScanFailures
    readonly onFailure: () => ScanFailures
  }

  let {
    vault,
    isSaving,
    onImport,
    embedded = false,
  }: {
    vault: VaultState
    isSaving: boolean
    onImport: (
      migrationUris: AuthenticatorMigrationUriCollection,
    ) => Promise<SecretOperationResult<NookImportResult>>
    embedded?: boolean
  } = $props()

  const reader = new QrCodeReader()
  let videoElement: HTMLVideoElement
  let camera = $state.raw<CameraScan>({ kind: CameraScanKind.Off })
  let migrationUris = $state<string[]>([])
  let result = $state<AuthenticatorImportOutcome>({
    kind: AuthenticatorImportOutcomeKind.NotRun,
  })
  let error = $state('')

  function stopCamera() {
    switch (camera.kind) {
      case CameraScanKind.Off:
        return
      case CameraScanKind.Scanning:
        Effect.runFork(Fiber.interrupt(camera.fiber))
        camera = { kind: CameraScanKind.Off }
    }
  }

  /** Adds one scanned code to the batch and returns why it was rejected. */
  function collectMigrationUri(value: string): ScanFailures {
    const uri = value.trim()
    if (!uri.startsWith('otpauth-migration://offline?')) {
      return [vault.t(I18N_KEYS.GoogleAuthenticatorImportInvalidQr)]
    }
    if (migrationUris.includes(uri)) {
      return [vault.t(I18N_KEYS.GoogleAuthenticatorImportDuplicateQr)]
    }
    migrationUris = [...migrationUris, uri]
    result = { kind: AuthenticatorImportOutcomeKind.NotRun }
    return []
  }

  /** Shows each distinct rejection reason; no failures clears the error. */
  function showFailures(failures: ScanFailures) {
    error = [...new Set(failures)].join(' ')
  }

  function addMigrationUri(value: string) {
    showFailures(collectMigrationUri(value))
  }

  /** A live camera sees each code for many frames; only unseen codes count. */
  function collectCameraTexts(texts: QrCodeTexts) {
    const unseen = texts.filter((text) => !migrationUris.includes(text.trim()))
    for (const text of unseen) addMigrationUri(text)
  }

  function showCameraFailure() {
    camera = { kind: CameraScanKind.Off }
    error = vault.t(I18N_KEYS.GoogleAuthenticatorImportCameraFailed)
  }

  function startCamera() {
    error = ''
    result = { kind: AuthenticatorImportOutcomeKind.NotRun }
    const target: QrCameraScanTarget = { video: videoElement, reader }
    const scan = new QrCameraScan(target)
      .run(collectCameraTexts)
      .pipe(Effect.catch(() => Effect.sync(showCameraFailure)))
    camera = { kind: CameraScanKind.Scanning, fiber: Effect.runFork(scan) }
  }

  function toggleCamera() {
    switch (camera.kind) {
      case CameraScanKind.Off:
        return startCamera()
      case CameraScanKind.Scanning:
        return stopCamera()
    }
  }

  function collectImageTexts(texts: QrCodeTexts): ScanFailures {
    switch (texts.length) {
      case 0:
        return [vault.t(I18N_KEYS.GoogleAuthenticatorImportImageFailed)]
      default:
        return texts.flatMap((text) => collectMigrationUri(text))
    }
  }

  const imageHandling: QrImageReadHandling = {
    onSuccess: collectImageTexts,
    onFailure: () => collectImageTexts([]),
  }

  /** Reads every chosen image in order; a later success never hides an earlier failure. */
  async function scanImages(event: Event) {
    const input = event.currentTarget
    if (!(input instanceof HTMLInputElement) || !input.files) return
    const files = Array.from(input.files)
    input.value = ''
    if (files.length === 0) return
    error = ''
    result = { kind: AuthenticatorImportOutcomeKind.NotRun }
    const failures: ScanFailures = []
    for (const file of files) {
      const read = Effect.match(reader.readImage(file), imageHandling)
      failures.push(...(await Effect.runPromise(read)))
    }
    showFailures(failures)
  }

  function clearScans() {
    migrationUris = []
    result = { kind: AuthenticatorImportOutcomeKind.NotRun }
    error = ''
    stopCamera()
  }

  async function importScans() {
    if (migrationUris.length === 0 || isSaving) return
    stopCamera()
    error = ''
    result = { kind: AuthenticatorImportOutcomeKind.NotRun }
    const imported = await onImport(migrationUris)
    if (imported.isErr()) {
      error = new SecretFailurePresentation(vault).message(imported.error)
      return
    }
    result = {
      kind: AuthenticatorImportOutcomeKind.Completed,
      result: imported.value,
    }
    migrationUris = []
  }

  onDestroy(() => {
    stopCamera()
    migrationUris = []
  })
</script>

<div class="space-y-4" data-testid="google-authenticator-import-panel">
  {#if !embedded}
    <div>
      <h2 class="text-lg font-semibold text-foreground">
        {vault.t(I18N_KEYS.GoogleAuthenticatorImportTitle)}
      </h2>
      <p class="mt-1 text-sm text-muted-foreground">
        {vault.t(I18N_KEYS.GoogleAuthenticatorImportDescription)}
      </p>
    </div>
  {/if}

  <Card class="gap-0 border-border/60 bg-card py-0">
    <CardContent class="space-y-4 p-4 sm:p-5">
      <div class="flex items-start gap-3">
        <QrCode class="mt-0.5 size-5 shrink-0 text-primary" />
        <div class="space-y-1 text-sm">
          <p class="font-medium text-foreground">
            {vault.t(I18N_KEYS.GoogleAuthenticatorImportExportHintTitle)}
          </p>
          <p class="text-muted-foreground">
            {vault.t(I18N_KEYS.GoogleAuthenticatorImportExportHint)}
          </p>
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          data-testid="google-authenticator-camera-toggle"
          disabled={isSaving}
          onclick={toggleCamera}
        >
          {#if camera.kind === CameraScanKind.Scanning}
            <X class="size-4" />
            {vault.t(I18N_KEYS.GoogleAuthenticatorImportStopCamera)}
          {:else}
            <Camera class="size-4" />
            {vault.t(I18N_KEYS.GoogleAuthenticatorImportScanCamera)}
          {/if}
        </Button>

        <label
          class="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground has-[:disabled]:pointer-events-none has-[:disabled]:opacity-50"
        >
          <ImageUp class="size-4" />
          {vault.t(I18N_KEYS.GoogleAuthenticatorImportScanImage)}
          <input
            type="file"
            accept="image/*"
            multiple
            data-testid="google-authenticator-qr-image"
            disabled={isSaving}
            onchange={(event) => void scanImages(event)}
            class="sr-only"
          />
        </label>
      </div>

      <div
        class:hidden={camera.kind === CameraScanKind.Off}
        class="relative overflow-hidden rounded-lg bg-black"
      >
        <video
          bind:this={videoElement}
          muted
          playsinline
          data-testid="google-authenticator-camera-preview"
          class="max-h-80 w-full object-contain"
        ></video>
        <svg
          aria-hidden="true"
          viewBox="0 0 100 100"
          class="pointer-events-none absolute inset-0 size-full text-white/80"
        >
          <rect
            x="22"
            y="22"
            width="56"
            height="56"
            rx="4"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            vector-effect="non-scaling-stroke"
          />
        </svg>
      </div>

      {#if migrationUris.length > 0}
        <div
          class="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3"
          data-testid="google-authenticator-scanned-count"
        >
          <p class="text-sm font-medium text-foreground">
            {(() => {
              const translationRequest: Parameters<typeof vault.t>[0] = {
                key: I18N_KEYS.GoogleAuthenticatorImportScannedCount,
                replacements: {
                  count: String(migrationUris.length),
                },
              }
              return vault.t(translationRequest)
            })()}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={vault.t(I18N_KEYS.GoogleAuthenticatorImportClearScans)}
            data-testid="google-authenticator-clear-scans"
            onclick={clearScans}
          >
            <Trash2 class="size-4" />
          </Button>
        </div>
      {/if}

      <p class="text-xs text-muted-foreground">
        {vault.t(I18N_KEYS.GoogleAuthenticatorImportSupportedTypes)}
      </p>

      <Button
        data-testid="google-authenticator-import-submit"
        disabled={migrationUris.length === 0 || isSaving}
        onclick={() => void importScans()}
      >
        <Upload class="size-4" />
        {isSaving
          ? vault.t(I18N_KEYS.GoogleAuthenticatorImportImporting)
          : vault.t(I18N_KEYS.GoogleAuthenticatorImportImport)}
      </Button>

      {#if error}
        <p
          class="text-sm text-destructive"
          data-testid="google-authenticator-import-error"
        >
          {error}
        </p>
      {/if}

      {#if result.kind === AuthenticatorImportOutcomeKind.Completed}
        <div
          class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-foreground"
          data-testid="google-authenticator-import-result"
        >
          <p class="font-medium">
            {(() => {
              const translationRequest2: Parameters<typeof vault.t>[0] = {
                key: I18N_KEYS.GoogleAuthenticatorImportResultImported,
                replacements: {
                  count: String(result.result.imported),
                },
              }
              return vault.t(translationRequest2)
            })()}
          </p>
          <p class="mt-1 text-xs text-muted-foreground">
            {(() => {
              const translationRequest3: Parameters<typeof vault.t>[0] = {
                key: I18N_KEYS.GoogleAuthenticatorImportResultSkipped,
                replacements: {
                  unsupported: String(result.result.skippedUnsupported),
                  duplicates: String(result.result.skippedDuplicates),
                },
              }
              return vault.t(translationRequest3)
            })()}
          </p>
        </div>
      {/if}
    </CardContent>
  </Card>
</div>
