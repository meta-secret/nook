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
  import ProviderVaultDecisionPanel from './ProviderVaultDecisionPanel.svelte'
  import type { ProviderVaultIdentitySelection } from '$lib/vault/provider-vault-decision'

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
    onImportAsNewVault: (
      selection: ProviderVaultIdentitySelection,
    ) => void | Promise<void>
    onCancel: () => void | Promise<void>
  } = $props()

  type ConflictView =
    | {
        kind: VaultSyncConflictKind.StoreId
        localStoreId: string
        remoteStoreId: string
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
        localStoreId: conflict.local_store_id(),
        remoteStoreId: conflict.remote_store_id(),
      }
    }
    return {
      kind: VaultSyncConflictKind.Content,
      localVersion: conflict.content_local_version(),
      remoteVersion: conflict.content_remote_version(),
    }
  })
  const isStoreIdConflict = $derived(
    conflictView.kind === VaultSyncConflictKind.StoreId,
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
      ? vault.t(I18N_KEYS.AuthStorageProviderVaultIntro)
      : (() => {
          const translationRequest2: Parameters<typeof vault.t>[0] = {
            key: I18N_KEYS.AuthStorageSyncConflictDesc,
            replacements: {
              provider: conflict.providerLabel,
              version: versionLabel,
            },
          }
          return vault.t(translationRequest2)
        })(),
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
    class="relative z-10 max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto border-border bg-card shadow-2xl shadow-black/40 animate-in fade-in zoom-in-95 duration-200"
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
      {#if conflictView.kind === VaultSyncConflictKind.StoreId}
        <ProviderVaultDecisionPanel
          {vault}
          providerLabel={conflict.providerLabel}
          localStoreId={conflictView.localStoreId}
          remoteStoreId={conflictView.remoteStoreId}
          {isBusy}
          onImport={onImportAsNewVault}
          {onCancel}
        />
      {:else}
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
                {(() => {
                  const translationRequest4: Parameters<typeof vault.t>[0] = {
                    key: I18N_KEYS.AuthStorageSyncConflictVersion,
                    replacements: {
                      version: String(conflictView.localVersion),
                    },
                  }
                  return vault.t(translationRequest4)
                })()}
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
                {(() => {
                  const translationRequest5: Parameters<typeof vault.t>[0] = {
                    key: I18N_KEYS.AuthStorageSyncConflictRemoteCopy,
                    replacements: {
                      provider: conflict.providerLabel,
                    },
                  }
                  return vault.t(translationRequest5)
                })()}
              </span>
              <span class="block text-xs text-muted-foreground">
                {(() => {
                  const translationRequest7: Parameters<typeof vault.t>[0] = {
                    key: I18N_KEYS.AuthStorageSyncConflictVersion,
                    replacements: {
                      version: String(conflictView.remoteVersion),
                    },
                  }
                  return vault.t(translationRequest7)
                })()}
              </span>
            </span>
          </li>
        </ul>

        <div
          class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end"
        >
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
            {(() => {
              const translationRequest8: Parameters<typeof vault.t>[0] = {
                key: I18N_KEYS.AuthStorageSyncConflictKeepRemote,
                replacements: {
                  provider: conflict.providerLabel,
                },
              }
              return vault.t(translationRequest8)
            })()}
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
        </div>
      {/if}
    </CardContent>
  </Card>
</div>
