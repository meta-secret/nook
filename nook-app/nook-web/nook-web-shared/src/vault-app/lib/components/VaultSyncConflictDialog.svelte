<script lang="ts">
  import { HardDrive, Cloud, RefreshCw, TriangleAlert } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/card'
  import type { NookPendingSyncConflict } from '$app-wasm'
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
    conflict: NookPendingSyncConflict
    isBusy?: boolean
    onKeepLocal: () => void | Promise<void>
    onKeepRemote: () => void | Promise<void>
    onImportAsNewVault?: () => void | Promise<void>
    onCancel?: () => void | Promise<void>
  } = $props()

  const isStoreIdConflict = $derived(
    conflict.kind === VaultSyncConflictKind.StoreId,
  )
  const localStoreId = $derived(
    isStoreIdConflict ? conflict.localStoreId() : undefined,
  )
  const remoteStoreId = $derived(
    isStoreIdConflict ? conflict.remoteStoreId() : undefined,
  )
  const localVersion = $derived(
    isStoreIdConflict ? undefined : conflict.contentLocalVersion(),
  )
  const remoteVersion = $derived(
    isStoreIdConflict ? undefined : conflict.contentRemoteVersion(),
  )
  const isEventLogStoreMismatch = $derived(
    isStoreIdConflict && !conflict.remoteYaml.trim(),
  )
  const versionLabel = $derived(
    isStoreIdConflict
      ? `${localStoreId ?? '?'} / ${remoteStoreId ?? '?'}`
      : localVersion === remoteVersion
        ? String(localVersion)
        : `${localVersion} / ${remoteVersion}`,
  )
  const conflictDescription = $derived(
    isStoreIdConflict
      ? vault.t(
          isEventLogStoreMismatch
            ? 'auth_storage.sync_conflict_store_id_event_desc'
            : 'auth_storage.sync_conflict_store_id_desc',
          {
            provider: conflict.providerLabel,
            localStore: localStoreId ?? '?',
            remoteStore: remoteStoreId ?? '?',
          },
        )
      : vault.t('auth_storage.sync_conflict_desc', {
          provider: conflict.providerLabel,
          version: versionLabel,
        }),
  )
  const conflictTitle = $derived(
    isStoreIdConflict
      ? vault.t('auth_storage.sync_conflict_store_id_title')
      : vault.t('auth_storage.sync_conflict_title'),
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
              {vault.t('auth_storage.sync_conflict_local_copy')}
            </span>
            <span class="block text-xs text-muted-foreground">
              {#if isStoreIdConflict}
                {vault.t('auth_storage.sync_conflict_store_id_local', {
                  store: localStoreId ?? '?',
                })}
              {:else}
                {vault.t('auth_storage.sync_conflict_version', {
                  version: String(localVersion),
                })}
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
              {vault.t('auth_storage.sync_conflict_remote_copy', {
                provider: conflict.providerLabel,
              })}
            </span>
            <span class="block text-xs text-muted-foreground">
              {#if isStoreIdConflict}
                {vault.t('auth_storage.sync_conflict_store_id_remote', {
                  store: remoteStoreId ?? '?',
                })}
              {:else}
                {vault.t('auth_storage.sync_conflict_version', {
                  version: String(remoteVersion),
                })}
              {/if}
            </span>
          </span>
        </li>
      </ul>

      <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        {#if isStoreIdConflict && onImportAsNewVault}
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
            {vault.t('auth_storage.sync_conflict_import_new_vault')}
          </Button>
        {/if}
        {#if isEventLogStoreMismatch}
          <Button
            type="button"
            variant="outline"
            class="sm:min-w-[160px]"
            data-testid="sync-conflict-cancel-btn"
            disabled={isBusy}
            onclick={() => void onCancel?.()}
          >
            {vault.t('auth_storage.sync_conflict_choose_different_provider')}
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
            {vault.t('auth_storage.sync_conflict_keep_remote', {
              provider: conflict.providerLabel,
            })}
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
            {vault.t('auth_storage.sync_conflict_keep_local')}
          </Button>
        {/if}
      </div>
    </CardContent>
  </Card>
</div>
