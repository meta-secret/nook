<script lang="ts">
  import {
    Cloud,
    HardDrive,
    RefreshCw,
    ShieldCheck,
    TriangleAlert,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import type { StorageProviderType } from '$lib/auth-providers'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    storageMode = 'local' as StorageProviderType,
    githubRepo = '',
    lastSyncedAt = null as Date | null,
    isSyncing = false,
    successMsg = '',
    errorMsg = '',
    appVersion = '',
    label,
    showSyncStatus = true,
    showStorageIcon = true,
    variant = 'panel',
    syncConflictLabel = '',
    onOpenSyncConflict,
    onRefresh,
    onDismissSuccess,
    onDismissError,
  }: {
    vault?: VaultState
    storageMode?: StorageProviderType
    githubRepo?: string
    lastSyncedAt?: Date | null
    isSyncing?: boolean
    successMsg?: string
    errorMsg?: string
    appVersion?: string
    label?: string
    showSyncStatus?: boolean
    showStorageIcon?: boolean
    variant?: 'panel' | 'quiet'
    syncConflictLabel?: string
    onOpenSyncConflict?: () => void
    onRefresh?: () => void | Promise<void>
    onDismissSuccess?: () => void
    onDismissError?: () => void
  } = $props()

  let now = $state(Date.now())

  $effect(() => {
    const timer = setInterval(() => {
      now = Date.now()
    }, 1000)
    return () => clearInterval(timer)
  })

  function formatLastSync(at: Date | null): string {
    if (!at) return vault ? vault.t('status_bar.not_yet') : 'not yet'
    const secs = Math.max(0, Math.floor((now - at.getTime()) / 1000))
    if (secs < 5) return vault ? vault.t('status_bar.just_now') : 'just now'
    if (secs < 60)
      return vault
        ? vault.t('status_bar.secs_ago', { secs: String(secs) })
        : `${secs}s ago`
    const mins = Math.floor(secs / 60)
    if (mins < 60)
      return vault
        ? vault.t('status_bar.mins_ago', { mins: String(mins) })
        : `${mins}m ago`
    return vault
      ? vault.t('status_bar.hours_ago', {
          hours: String(Math.floor(mins / 60)),
        })
      : `${Math.floor(mins / 60)}h ago`
  }

  const isAuthenticatedVault = $derived(Boolean(vault?.isAuthenticated))
  const isQuiet = $derived(variant === 'quiet')

  const statusLabel = $derived(
    label ??
      (isAuthenticatedVault
        ? vault!.t('status_bar.local_vault')
        : storageMode === 'github'
          ? githubRepo.trim() || 'GitHub'
          : storageMode === 'oauth-file'
            ? vault
              ? vault.t('provider_picker.google_drive')
              : 'Google Drive'
            : vault
              ? vault.t('provider_picker.this_device')
              : 'This device'),
  )

  const syncDetail = $derived.by(() => {
    if (!vault || !showSyncStatus) return ''
    if (vault.syncingProviderLabel) {
      return vault.t('status_bar.syncing_to', {
        provider: vault.syncingProviderLabel,
      })
    }
    if (vault.isFanOutSyncing) {
      return vault.t('status_bar.syncing_providers')
    }
    if (vault.syncProviderCount > 0) {
      return vault.syncProviderCount === 1
        ? vault.t('status_bar.sync_providers_singular')
        : vault.t('status_bar.sync_providers_plural', {
            count: String(vault.syncProviderCount),
          })
    }
    return vault.t('status_bar.saved_local_only')
  })

  const showRefresh = $derived(
    Boolean(onRefresh && (isAuthenticatedVault || storageMode === 'github')),
  )
</script>

<div
  class={isQuiet
    ? 'border-t border-foreground/15 bg-muted/20 px-3 py-2.5 dark:border-foreground/20 dark:bg-muted/10'
    : 'border-t border-border/35 bg-muted/25 px-4 py-2.5 sm:border-border/60 sm:bg-muted/30 sm:px-5'}
  data-testid="vault-status-bar"
>
  <div class="flex flex-col gap-2">
    <div
      class={isQuiet
        ? 'flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-[11px]'
        : 'flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-xs'}
    >
      <div class="flex min-w-0 items-center gap-2 text-muted-foreground">
        {#if showStorageIcon}
          {#if isAuthenticatedVault}
            <HardDrive
              class="size-3.5 shrink-0 text-primary/80"
              aria-hidden="true"
            />
          {:else if storageMode === 'github'}
            <Cloud
              class="size-3.5 shrink-0 text-primary/80"
              aria-hidden="true"
            />
          {:else if storageMode === 'oauth-file'}
            <svg
              class="size-3.5 shrink-0 text-primary/80"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              />
            </svg>
          {:else}
            <HardDrive
              class="size-3.5 shrink-0 text-primary/80"
              aria-hidden="true"
            />
          {/if}
        {/if}
        <span class="truncate font-medium text-foreground">{statusLabel}</span>
        {#if appVersion}
          <span
            class="hidden text-muted-foreground sm:inline"
            aria-hidden="true">·</span
          >
          <span class="shrink-0 text-muted-foreground/80">
            v{appVersion}
          </span>
        {/if}
        {#if showSyncStatus && isAuthenticatedVault}
          <span
            class="hidden text-muted-foreground sm:inline"
            aria-hidden="true">·</span
          >
          <span
            class="shrink-0 text-muted-foreground"
            data-testid="vault-last-sync"
          >
            {vault!.t('status_bar.saved')}
            {formatLastSync(lastSyncedAt)}
          </span>
          {#if syncDetail}
            <span
              class="hidden text-muted-foreground sm:inline"
              aria-hidden="true">·</span
            >
            <span
              class="shrink-0 text-muted-foreground"
              data-testid="vault-sync-out-status"
              class:animate-pulse={vault!.isSyncActivityVisible}
            >
              {syncDetail}
            </span>
          {/if}
        {:else if showSyncStatus}
          <span
            class="hidden text-muted-foreground sm:inline"
            aria-hidden="true">·</span
          >
          <span
            class="shrink-0 text-muted-foreground"
            data-testid="vault-last-sync"
          >
            {storageMode === 'github'
              ? vault
                ? vault.t('status_bar.synced')
                : 'Synced'
              : vault
                ? vault.t('status_bar.saved')
                : 'Saved'}
            {formatLastSync(lastSyncedAt)}
          </span>
        {/if}
      </div>

      {#if showRefresh}
        <div class="group relative inline-block">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
            disabled={isSyncing || vault?.syncBlocked}
            data-testid="vault-sync-refresh-btn"
            aria-label={isAuthenticatedVault
              ? vault!.t('status_bar.sync_all_aria')
              : storageMode === 'github'
                ? vault
                  ? vault.t('status_bar.sync_aria_github')
                  : 'Sync vault with GitHub'
                : vault
                  ? vault.t('status_bar.refresh_aria_local')
                  : 'Refresh vault from browser storage'}
            onclick={() => void onRefresh?.()}
          >
            <RefreshCw class="size-3.5 {isSyncing ? 'animate-spin' : ''}" />
            <span class="ml-1"
              >{isAuthenticatedVault
                ? vault!.t('status_bar.sync_all')
                : storageMode === 'github'
                  ? vault
                    ? vault.t('status_bar.sync')
                    : 'Sync'
                  : vault
                    ? vault.t('status_bar.refresh')
                    : 'Refresh'}</span
            >
          </Button>
          <div
            class="pointer-events-none absolute bottom-full right-0 z-50 mb-2 rounded-md border border-border bg-popover px-2.5 py-1 text-[11px] font-medium text-popover-foreground opacity-0 shadow-md transition-opacity duration-200 group-hover:opacity-100 whitespace-nowrap"
            role="tooltip"
          >
            {isAuthenticatedVault
              ? vault!.t('status_bar.sync_all_tooltip')
              : storageMode === 'github'
                ? vault
                  ? vault.t('status_bar.sync_tooltip_github')
                  : 'Synchronize latest changes with your storage provider'
                : vault
                  ? vault.t('status_bar.refresh_tooltip_local')
                  : 'Reload latest changes from browser storage'}
          </div>
        </div>
      {/if}
    </div>

    {#if syncConflictLabel}
      <div
        class="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-300"
        role="alert"
        data-testid="vault-sync-conflict-banner"
      >
        <TriangleAlert class="size-3.5 shrink-0" />
        <span class="min-w-0 flex-1 text-pretty">{syncConflictLabel}</span>
        {#if onOpenSyncConflict}
          <button
            type="button"
            class="shrink-0 rounded border border-amber-500/30 px-2 py-0.5 font-medium hover:bg-amber-500/10"
            data-testid="vault-sync-conflict-open-btn"
            onclick={() => onOpenSyncConflict()}
          >
            {vault ? vault.t('auth_storage.sync_conflict_resolve') : 'Resolve'}
          </button>
        {/if}
      </div>
    {/if}

    {#if successMsg}
      <div
        class="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/10 px-2.5 py-1.5 text-xs text-primary"
        role="status"
        data-testid="app-success"
      >
        <ShieldCheck class="size-3.5 shrink-0" />
        <span class="min-w-0 flex-1 truncate">{successMsg}</span>
        {#if onDismissSuccess}
          <button
            type="button"
            class="shrink-0 rounded p-0.5 text-primary/70 hover:text-primary"
            aria-label="Dismiss success"
            data-testid="dismiss-success-btn"
            onclick={onDismissSuccess}
          >
            ×
          </button>
        {/if}
      </div>
    {/if}

    {#if errorMsg}
      <div
        class="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive"
        role="alert"
        data-testid="vault-error"
      >
        <TriangleAlert class="size-3.5 shrink-0" />
        <span class="min-w-0 flex-1 truncate">{errorMsg}</span>
        {#if onDismissError}
          <button
            type="button"
            class="shrink-0 rounded p-0.5 text-destructive/70 hover:text-destructive"
            aria-label="Dismiss error"
            data-testid="dismiss-error-btn"
            onclick={onDismissError}
          >
            ×
          </button>
        {/if}
      </div>
    {/if}
  </div>
</div>
