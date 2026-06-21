<script lang="ts">
  import {
    Cloud,
    HardDrive,
    RefreshCw,
    ShieldCheck,
    TriangleAlert,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'

  let {
    storageMode,
    githubRepo = '',
    lastSyncedAt = null as Date | null,
    isSyncing = false,
    successMsg = '',
    errorMsg = '',
    onRefresh,
    onDismissSuccess,
    onDismissError,
  }: {
    storageMode: 'local' | 'github'
    githubRepo?: string
    lastSyncedAt?: Date | null
    isSyncing?: boolean
    successMsg?: string
    errorMsg?: string
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
    if (!at) return 'not yet'
    const secs = Math.max(0, Math.floor((now - at.getTime()) / 1000))
    if (secs < 5) return 'just now'
    if (secs < 60) return `${secs}s ago`
    const mins = Math.floor(secs / 60)
    if (mins < 60) return `${mins}m ago`
    return `${Math.floor(mins / 60)}h ago`
  }

  const storageLabel = $derived(
    storageMode === 'github'
      ? githubRepo.trim() || 'GitHub'
      : 'This device',
  )
</script>

<div
  class="border-t border-border bg-muted/30 px-4 py-2.5 sm:px-5"
  data-testid="vault-status-bar"
>
  <div class="flex flex-col gap-2">
    <div
      class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-xs"
    >
      <div
        class="flex min-w-0 items-center gap-2 text-muted-foreground"
      >
        {#if storageMode === 'github'}
          <Cloud class="size-3.5 shrink-0 text-primary/80" aria-hidden="true" />
        {:else}
          <HardDrive
            class="size-3.5 shrink-0 text-primary/80"
            aria-hidden="true"
          />
        {/if}
        <span class="truncate font-medium text-foreground">{storageLabel}</span>
        <span class="hidden text-muted-foreground sm:inline" aria-hidden="true"
          >·</span
        >
        <span class="shrink-0 text-muted-foreground" data-testid="vault-last-sync">
          Synced {formatLastSync(lastSyncedAt)}
        </span>
      </div>

      {#if onRefresh}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
          disabled={isSyncing}
          data-testid="vault-sync-refresh-btn"
          aria-label="Refresh vault from storage"
          onclick={() => void onRefresh()}
        >
          <RefreshCw class="size-3.5 {isSyncing ? 'animate-spin' : ''}" />
          <span class="ml-1">Refresh</span>
        </Button>
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
