<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { onDestroy } from "svelte";
  import { Camera, ImageUp, QrCode, Trash2, Upload, X } from "@lucide/svelte";
  import QrScanner from "qr-scanner";
  import type { VaultState } from "$lib/vault.svelte";
  import type { NookImportResult } from "$lib/nook";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent } from "$lib/components/ui/card";
  import {
    AuthenticatorImportOutcomeKind,
    ScannerLifecycleKind,
    type AuthenticatorImportOutcome,
    type ScannerLifecycle,
  } from "./google-authenticator-import-state";

  type CameraScannerOptions = {
    readonly preferredCamera: "environment";
    readonly highlightScanRegion: boolean;
    readonly highlightCodeOutline: boolean;
    readonly returnDetailedScanResult: true;
  };

  type QrImageScanOptions = {
    readonly returnDetailedScanResult: true;
  };

  let {
    vault,
    isSaving,
    onImport,
    embedded = false,
  }: {
    vault: VaultState;
    isSaving: boolean;
    onImport: (migrationUris: string[]) => Promise<NookImportResult>;
    embedded?: boolean;
  } = $props();

  let videoElement: HTMLVideoElement;
  let scannerState: ScannerLifecycle = { kind: ScannerLifecycleKind.NotCreated };
  let scanning = $state(false);
  let migrationUris = $state<string[]>([]);
  let result = $state<AuthenticatorImportOutcome>({ kind: AuthenticatorImportOutcomeKind.NotRun });
  let error = $state("");

  function stopCamera() {
    if (scannerState.kind === ScannerLifecycleKind.Created) scannerState.scanner.stop();
    scanning = false;
  }

  function addMigrationUri(value: string) {
    const uri = value.trim();
    if (!uri.startsWith("otpauth-migration://offline?")) {
      error = vault.t(I18N_KEYS.GoogleAuthenticatorImportInvalidQr);
      return;
    }
    if (migrationUris.includes(uri)) {
      error = vault.t(I18N_KEYS.GoogleAuthenticatorImportDuplicateQr);
      stopCamera();
      return;
    }
    migrationUris = [...migrationUris, uri];
    result = { kind: AuthenticatorImportOutcomeKind.NotRun };
    error = "";
    stopCamera();
  }

  async function toggleCamera() {
    if (scanning) {
      stopCamera();
      return;
    }
    error = "";
    result = { kind: AuthenticatorImportOutcomeKind.NotRun };
    if (scannerState.kind === ScannerLifecycleKind.NotCreated) {
      const scannerOptions: CameraScannerOptions = {
        preferredCamera: "environment" as const,
        highlightScanRegion: true,
        highlightCodeOutline: true,
        returnDetailedScanResult: true as const,
      };
      scannerState = {
        kind: ScannerLifecycleKind.Created,
        scanner: new QrScanner(
          videoElement,
          (scanResult) => addMigrationUri(scanResult.data),
          scannerOptions,
        ),
      };
    }
    scanning = true;
    try {
      await scannerState.scanner.start();
    } catch {
      scanning = false;
      error = vault.t(I18N_KEYS.GoogleAuthenticatorImportCameraFailed);
    }
  }

  async function scanImage(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    error = "";
    result = { kind: AuthenticatorImportOutcomeKind.NotRun };
    try {
      const scanImageOptions: QrImageScanOptions = {
        returnDetailedScanResult: true as const,
      };
      const scanResult = await QrScanner.scanImage(file, scanImageOptions);
      addMigrationUri(scanResult.data);
    } catch {
      error = vault.t(I18N_KEYS.GoogleAuthenticatorImportImageFailed);
    }
  }

  function clearScans() {
    migrationUris = [];
    result = { kind: AuthenticatorImportOutcomeKind.NotRun };
    error = "";
    stopCamera();
  }

  async function importScans() {
    if (migrationUris.length === 0 || isSaving) return;
    error = "";
    result = { kind: AuthenticatorImportOutcomeKind.NotRun };
    try {
      result = { kind: AuthenticatorImportOutcomeKind.Completed, result: await onImport(migrationUris) };
      migrationUris = [];
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  onDestroy(() => {
    if (scannerState.kind === ScannerLifecycleKind.Created) scannerState.scanner.destroy();
    scannerState = { kind: ScannerLifecycleKind.NotCreated };
    migrationUris = [];
  });
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
          onclick={() => void toggleCamera()}
        >
          {#if scanning}
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
            data-testid="google-authenticator-qr-image"
            disabled={isSaving}
            onchange={(event) => void scanImage(event)}
            class="sr-only"
          />
        </label>
      </div>

      <div class:hidden={!scanning} class="overflow-hidden rounded-lg bg-black">
        <video
          bind:this={videoElement}
          muted
          playsinline
          data-testid="google-authenticator-camera-preview"
          class="aspect-square max-h-80 w-full object-cover"
        ></video>
      </div>

      {#if migrationUris.length > 0}
        <div
          class="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3"
          data-testid="google-authenticator-scanned-count"
        >
          <p class="text-sm font-medium text-foreground">
            {(() => { const translationRequest: Parameters<typeof vault.t>[0] = {
  key: I18N_KEYS.GoogleAuthenticatorImportScannedCount,
  replacements: {
              count: String(migrationUris.length),
            },
}; return vault.t(translationRequest); })()}
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
            {(() => { const translationRequest2: Parameters<typeof vault.t>[0] = {
  key: I18N_KEYS.GoogleAuthenticatorImportResultImported,
  replacements: {
              count: String(result.result.imported),
            },
}; return vault.t(translationRequest2); })()}
          </p>
          <p class="mt-1 text-xs text-muted-foreground">
            {(() => { const translationRequest3: Parameters<typeof vault.t>[0] = {
  key: I18N_KEYS.GoogleAuthenticatorImportResultSkipped,
  replacements: {
              unsupported: String(result.result.skippedUnsupported),
              duplicates: String(result.result.skippedDuplicates),
            },
}; return vault.t(translationRequest3); })()}
          </p>
        </div>
      {/if}
    </CardContent>
  </Card>
</div>
