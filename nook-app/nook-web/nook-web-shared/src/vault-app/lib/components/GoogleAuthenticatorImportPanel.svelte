<script lang="ts">
  import { onDestroy } from "svelte";
  import { Camera, ImageUp, QrCode, Trash2, Upload, X } from "@lucide/svelte";
  import QrScanner from "qr-scanner";
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
    onImport: (migrationUris: string[]) => Promise<NookImportResult>;
    embedded?: boolean;
  } = $props();

  let videoElement: HTMLVideoElement;
  let scanner: QrScanner | undefined;
  let scanning = $state(false);
  let migrationUris = $state<string[]>([]);
  let result = $state<NookImportResult | undefined>(undefined);
  let error = $state("");

  function stopCamera() {
    scanner?.stop();
    scanning = false;
  }

  function addMigrationUri(value: string) {
    const uri = value.trim();
    if (!uri.startsWith("otpauth-migration://offline?")) {
      error = vault.t("google_authenticator_import.invalid_qr");
      return;
    }
    if (migrationUris.includes(uri)) {
      error = vault.t("google_authenticator_import.duplicate_qr");
      stopCamera();
      return;
    }
    migrationUris = [...migrationUris, uri];
    result = undefined;
    error = "";
    stopCamera();
  }

  async function toggleCamera() {
    if (scanning) {
      stopCamera();
      return;
    }
    error = "";
    result = undefined;
    scanner ??= new QrScanner(
      videoElement,
      (scanResult) => addMigrationUri(scanResult.data),
      {
        preferredCamera: "environment",
        highlightScanRegion: true,
        highlightCodeOutline: true,
        returnDetailedScanResult: true,
      },
    );
    scanning = true;
    try {
      await scanner.start();
    } catch {
      scanning = false;
      error = vault.t("google_authenticator_import.camera_failed");
    }
  }

  async function scanImage(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    error = "";
    result = undefined;
    try {
      const scanResult = await QrScanner.scanImage(file, {
        returnDetailedScanResult: true,
      });
      addMigrationUri(scanResult.data);
    } catch {
      error = vault.t("google_authenticator_import.image_failed");
    }
  }

  function clearScans() {
    migrationUris = [];
    result = undefined;
    error = "";
    stopCamera();
  }

  async function importScans() {
    if (migrationUris.length === 0 || isSaving) return;
    error = "";
    result = undefined;
    try {
      result = await onImport(migrationUris);
      migrationUris = [];
    } catch (cause: unknown) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  onDestroy(() => {
    scanner?.destroy();
    migrationUris = [];
  });
</script>

<div class="space-y-4" data-testid="google-authenticator-import-panel">
  {#if !embedded}
    <div>
      <h2 class="text-lg font-semibold text-foreground">
        {vault.t("google_authenticator_import.title")}
      </h2>
      <p class="mt-1 text-sm text-muted-foreground">
        {vault.t("google_authenticator_import.description")}
      </p>
    </div>
  {/if}

  <Card class="gap-0 border-border/60 bg-card py-0">
    <CardContent class="space-y-4 p-4 sm:p-5">
      <div class="flex items-start gap-3">
        <QrCode class="mt-0.5 size-5 shrink-0 text-primary" />
        <div class="space-y-1 text-sm">
          <p class="font-medium text-foreground">
            {vault.t("google_authenticator_import.export_hint_title")}
          </p>
          <p class="text-muted-foreground">
            {vault.t("google_authenticator_import.export_hint")}
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
            {vault.t("google_authenticator_import.stop_camera")}
          {:else}
            <Camera class="size-4" />
            {vault.t("google_authenticator_import.scan_camera")}
          {/if}
        </Button>

        <label
          class="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground has-[:disabled]:pointer-events-none has-[:disabled]:opacity-50"
        >
          <ImageUp class="size-4" />
          {vault.t("google_authenticator_import.scan_image")}
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
            {vault.t("google_authenticator_import.scanned_count", {
              count: String(migrationUris.length),
            })}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={vault.t("google_authenticator_import.clear_scans")}
            data-testid="google-authenticator-clear-scans"
            onclick={clearScans}
          >
            <Trash2 class="size-4" />
          </Button>
        </div>
      {/if}

      <p class="text-xs text-muted-foreground">
        {vault.t("google_authenticator_import.supported_types")}
      </p>

      <Button
        data-testid="google-authenticator-import-submit"
        disabled={migrationUris.length === 0 || isSaving}
        onclick={() => void importScans()}
      >
        <Upload class="size-4" />
        {isSaving
          ? vault.t("google_authenticator_import.importing")
          : vault.t("google_authenticator_import.import")}
      </Button>

      {#if error}
        <p
          class="text-sm text-destructive"
          data-testid="google-authenticator-import-error"
        >
          {error}
        </p>
      {/if}

      {#if result}
        <div
          class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-foreground"
          data-testid="google-authenticator-import-result"
        >
          <p class="font-medium">
            {vault.t("google_authenticator_import.result_imported", {
              count: String(result.imported),
            })}
          </p>
          <p class="mt-1 text-xs text-muted-foreground">
            {vault.t("google_authenticator_import.result_skipped", {
              unsupported: String(result.skippedUnsupported),
              duplicates: String(result.skippedDuplicates),
            })}
          </p>
        </div>
      {/if}
    </CardContent>
  </Card>
</div>
