<script lang="ts">
  import {
    Cloud,
    HardDrive,
    RefreshCw,
    ShieldCheck,
    TriangleAlert,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    storageMode,
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
    onRefresh,
    onDismissSuccess,
    onDismissError,
  }: {
    vault?: VaultState
    storageMode: 'local' | 'github'
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

  const statusLabel = $derived(
    label ??
      (storageMode === 'github'
        ? githubRepo.trim() || 'GitHub'
        : vault
          ? vault.t('provider_picker.this_device')
          : 'This device'),
  )
  const isQuiet = $derived(variant === 'quiet')
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
          {#if storageMode === 'github'}
            <Cloud
              class="size-3.5 shrink-0 text-primary/80"
              aria-hidden="true"
            />
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
        {#if showSyncStatus}
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

      {#if onRefresh}
        <div class="group relative inline-block">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
            disabled={isSyncing}
            data-testid="vault-sync-refresh-btn"
            aria-label={storageMode === 'github'
              ? vault
                ? vault.t('status_bar.sync_aria_github')
                : 'Sync vault with GitHub'
              : vault
                ? vault.t('status_bar.refresh_aria_local')
                : 'Refresh vault from browser storage'}
            onclick={() => void onRefresh()}
          >
            <RefreshCw class="size-3.5 {isSyncing ? 'animate-spin' : ''}" />
            <span class="ml-1"
              >{storageMode === 'github'
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
            {storageMode === 'github'
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
