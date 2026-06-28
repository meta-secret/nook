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
  import type { PendingSyncConflict } from '$lib/vault-sync'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    conflict,
    isBusy = false,
    onKeepLocal,
    onKeepRemote,
  }: {
    vault: VaultState
    conflict: PendingSyncConflict
    isBusy?: boolean
    onKeepLocal: () => void | Promise<void>
    onKeepRemote: () => void | Promise<void>
  } = $props()

  const versionLabel = $derived(
    conflict.localVersion === conflict.remoteVersion
      ? String(conflict.localVersion)
      : `${conflict.localVersion} / ${conflict.remoteVersion}`,
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
            {vault.t('auth_storage.sync_conflict_title')}
          </CardTitle>
          <CardDescription class="text-pretty">
            {vault.t('auth_storage.sync_conflict_desc', {
              provider: conflict.providerLabel,
              version: versionLabel,
            })}
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
              {vault.t('auth_storage.sync_conflict_version', {
                version: String(conflict.localVersion),
              })}
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
              {vault.t('auth_storage.sync_conflict_version', {
                version: String(conflict.remoteVersion),
              })}
            </span>
          </span>
        </li>
      </ul>

      <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
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
      </div>
    </CardContent>
  </Card>
</div>
