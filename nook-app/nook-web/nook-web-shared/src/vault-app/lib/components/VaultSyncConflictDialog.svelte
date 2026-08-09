<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { HardDrive, Cloud, RefreshCw, TriangleAlert } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/card'
  import type { NookSyncConflictReview } from '$app-wasm'
  import type { VaultState } from '$lib/vault.svelte'
  import { VaultSyncConflictKind } from '$app-wasm'

  let {
    vault,
    conflict,
    isBusy = false,
    onKeepLocal,
    onKeepRemote,
    onImportAsNewVault,
    onCancel,
  }: {
    vault: VaultState
    conflict: NookSyncConflictReview
    isBusy?: boolean
    onKeepLocal: () => void | Promise<void>
    onKeepRemote: () => void | Promise<void>
    onImportAsNewVault: () => void | Promise<void>
    onCancel: () => void | Promise<void>
  } = $props()

  type ConflictView =
    | {
        kind: VaultSyncConflictKind.StoreId
        localStoreId: string
        remoteStoreId: string
        eventLogStoreMismatch: boolean
      }
    | {
        kind: VaultSyncConflictKind.Content
        localVersion: number
        remoteVersion: number
      }

  const conflictView = $derived.by((): ConflictView => {
    if (conflict.conflictKind === VaultSyncConflictKind.StoreId) {
      return {
        kind: VaultSyncConflictKind.StoreId,
        localStoreId: conflict.localStoreId(),
        remoteStoreId: conflict.remoteStoreId(),
        eventLogStoreMismatch: !conflict.remoteYaml.trim(),
      }
    }
    return {
      kind: VaultSyncConflictKind.Content,
      localVersion: conflict.contentLocalVersion(),
      remoteVersion: conflict.contentRemoteVersion(),
    }
  })
  const isStoreIdConflict = $derived(
    conflictView.kind === VaultSyncConflictKind.StoreId,
  )
  const isEventLogStoreMismatch = $derived(
    conflictView.kind === VaultSyncConflictKind.StoreId &&
      conflictView.eventLogStoreMismatch,
  )
  const versionLabel = $derived(
    conflictView.kind === VaultSyncConflictKind.StoreId
      ? `${conflictView.localStoreId} / ${conflictView.remoteStoreId}`
      : conflictView.localVersion === conflictView.remoteVersion
        ? String(conflictView.localVersion)
        : `${conflictView.localVersion} / ${conflictView.remoteVersion}`,
  )
  const conflictDescription = $derived(
    conflictView.kind === VaultSyncConflictKind.StoreId
      ? (() => { const tArgs: Parameters<typeof vault.t>[1] = {
            provider: conflict.providerLabel,
            localStore: conflictView.localStoreId,
            remoteStore: conflictView.remoteStoreId,
          }; return vault.t(
          isEventLogStoreMismatch
            ? I18N_KEYS.AuthStorageSyncConflictStoreIdEventDesc
            : I18N_KEYS.AuthStorageSyncConflictStoreIdDesc,
          tArgs,
        ); })()
      : (() => { const tArgs2: Parameters<typeof vault.t>[1] = {
          provider: conflict.providerLabel,
          version: versionLabel,
        }; return vault.t(I18N_KEYS.AuthStorageSyncConflictDesc, tArgs2); })(),
  )
  const conflictTitle = $derived(
    isStoreIdConflict
      ? vault.t(I18N_KEYS.AuthStorageSyncConflictStoreIdTitle)
      : vault.t(I18N_KEYS.AuthStorageSyncConflictTitle),
  )
</script>

<div
  class="fixed inset-0 z-50 flex items-center justify-center p-4"
  role="dialog"
  aria-modal="true"
  aria-labelledby="sync-conflict-title"
  data-testid="vault-sync-conflict-dialog"
>
  <div
    class="absolute inset-0 bg-background/80 backdrop-blur-sm"
    aria-hidden="true"
  ></div>

  <Card
    class="relative z-10 w-full max-w-lg border-border bg-card shadow-2xl shadow-black/40 animate-in fade-in zoom-in-95 duration-200"
  >
    <CardHeader class="border-b border-border/60 pb-4">
      <div class="flex items-start justify-between gap-3">
        <div class="space-y-1">
          <CardTitle
            id="sync-conflict-title"
            class="text-lg font-semibold tracking-tight text-foreground inline-flex items-center gap-2"
          >
            <TriangleAlert class="size-4 shrink-0 text-amber-500" />
            {conflictTitle}
          </CardTitle>
          <CardDescription class="text-pretty">
            {conflictDescription}
          </CardDescription>
        </div>
      </div>
    </CardHeader>

    <CardContent class="space-y-4 pt-4">
      <ul class="space-y-2 text-sm">
        <li
          class="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5"
          data-testid="sync-conflict-local-option"
        >
          <HardDrive class="mt-0.5 size-4 shrink-0 text-primary" />
          <span>
            <span class="block font-medium text-foreground">
              {vault.t(I18N_KEYS.AuthStorageSyncConflictLocalCopy)}
            </span>
            <span class="block text-xs text-muted-foreground">
              {#if conflictView.kind === VaultSyncConflictKind.StoreId}
                {(() => { const tArgs3: Parameters<typeof vault.t>[1] = {
                  store: conflictView.localStoreId,
                }; return vault.t(I18N_KEYS.AuthStorageSyncConflictStoreIdLocal, tArgs3); })()}
              {:else}
                {(() => { const tArgs4: Parameters<typeof vault.t>[1] = {
                  version: String(conflictView.localVersion),
                }; return vault.t(I18N_KEYS.AuthStorageSyncConflictVersion, tArgs4); })()}
              {/if}
            </span>
          </span>
        </li>
        <li
          class="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5"
          data-testid="sync-conflict-remote-option"
        >
          <Cloud class="mt-0.5 size-4 shrink-0 text-primary" />
          <span>
            <span class="block font-medium text-foreground">
              {(() => { const tArgs5: Parameters<typeof vault.t>[1] = {
                provider: conflict.providerLabel,
              }; return vault.t(I18N_KEYS.AuthStorageSyncConflictRemoteCopy, tArgs5); })()}
            </span>
            <span class="block text-xs text-muted-foreground">
              {#if conflictView.kind === VaultSyncConflictKind.StoreId}
                {(() => { const tArgs6: Parameters<typeof vault.t>[1] = {
                  store: conflictView.remoteStoreId,
                }; return vault.t(I18N_KEYS.AuthStorageSyncConflictStoreIdRemote, tArgs6); })()}
              {:else}
                {(() => { const tArgs7: Parameters<typeof vault.t>[1] = {
                  version: String(conflictView.remoteVersion),
                }; return vault.t(I18N_KEYS.AuthStorageSyncConflictVersion, tArgs7); })()}
              {/if}
            </span>
          </span>
        </li>
      </ul>

      <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        {#if isStoreIdConflict}
          <Button
            type="button"
            variant="secondary"
            class="sm:min-w-[160px]"
            data-testid="sync-conflict-import-new-vault-btn"
            disabled={isBusy}
            onclick={() => void onImportAsNewVault()}
          >
            {#if isBusy}
              <RefreshCw class="size-4 animate-spin" />
            {/if}
            {vault.t(I18N_KEYS.AuthStorageSyncConflictImportNewVault)}
          </Button>
        {/if}
        {#if isEventLogStoreMismatch}
          <Button
            type="button"
            variant="outline"
            class="sm:min-w-[160px]"
            data-testid="sync-conflict-cancel-btn"
            disabled={isBusy}
            onclick={() => void onCancel()}
          >
            {vault.t(I18N_KEYS.AuthStorageSyncConflictChooseDifferentProvider)}
          </Button>
        {:else}
          <Button
            type="button"
            variant="outline"
            class="sm:min-w-[160px]"
            data-testid="sync-conflict-keep-remote-btn"
            disabled={isBusy}
            onclick={() => void onKeepRemote()}
          >
            {#if isBusy}
              <RefreshCw class="size-4 animate-spin" />
            {/if}
            {(() => { const tArgs8: Parameters<typeof vault.t>[1] = {
              provider: conflict.providerLabel,
            }; return vault.t(I18N_KEYS.AuthStorageSyncConflictKeepRemote, tArgs8); })()}
          </Button>
          <Button
            type="button"
            class="sm:min-w-[160px]"
            data-testid="sync-conflict-keep-local-btn"
            disabled={isBusy}
            onclick={() => void onKeepLocal()}
          >
            {#if isBusy}
              <RefreshCw class="size-4 animate-spin" />
            {/if}
            {vault.t(I18N_KEYS.AuthStorageSyncConflictKeepLocal)}
          </Button>
        {/if}
      </div>
    </CardContent>
  </Card>
</div>
