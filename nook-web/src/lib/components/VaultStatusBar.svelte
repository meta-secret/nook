<script lang="ts">
  import { RefreshCw, ShieldCheck, TriangleAlert } from '@lucide/svelte'
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
      ? githubRepo.trim()
        ? `GitHub · ${githubRepo.trim()}`
        : 'GitHub'
      : 'local storage',
  )
</script>

<footer
  class="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/95 backdrop-blur-md"
  data-testid="vault-status-bar"
>
  <div
    class="mx-auto flex max-w-xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-6"
  >
    <div
      class="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground"
    >
      <span class="truncate">
        Syncing via <span class="font-medium text-foreground"
          >{storageLabel}</span
        >
      </span>
      <span class="hidden sm:inline" aria-hidden="true">·</span>
      <span class="shrink-0" data-testid="vault-last-sync">
        Last sync: {formatLastSync(lastSyncedAt)}
      </span>
      {#if onRefresh}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="h-7 shrink-0 px-2 text-xs"
          disabled={isSyncing}
          data-testid="vault-sync-refresh-btn"
          aria-label="Refresh vault from storage"
          onclick={() => void onRefresh()}
        >
          <RefreshCw class="size-3.5 {isSyncing ? 'animate-spin' : ''}" />
          <span class="ml-1 hidden sm:inline">Refresh</span>
        </Button>
      {/if}
    </div>

    {#if successMsg}
      <div
        class="flex w-full items-center gap-2 rounded-md border border-primary/20 bg-primary/10 px-2.5 py-1.5 text-xs text-primary sm:ml-auto sm:w-auto"
        role="status"
        data-testid="app-success"
      >
        <ShieldCheck class="size-3.5 shrink-0" />
        <span class="min-w-0 truncate">{successMsg}</span>
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
        class="flex w-full items-center gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive sm:ml-auto sm:w-auto"
        role="alert"
        data-testid="vault-error"
      >
        <TriangleAlert class="size-3.5 shrink-0" />
        <span class="min-w-0 truncate">{errorMsg}</span>
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
</footer>
