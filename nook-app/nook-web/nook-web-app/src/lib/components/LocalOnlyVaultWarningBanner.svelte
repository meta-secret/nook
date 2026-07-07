<script lang="ts">
  import { ChevronDown, TriangleAlert } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'

  const EXPANDED_STORAGE_KEY = 'nook_local_only_warning_expanded'

  let {
    vault,
    onAddSyncProvider,
  }: {
    vault: VaultState
    onAddSyncProvider: () => void
  } = $props()

  let folded = $state(!readExpanded())

  function readExpanded(): boolean {
    try {
      return localStorage.getItem(EXPANDED_STORAGE_KEY) === '1'
    } catch {
      return false
    }
  }

  function persistExpanded(expanded: boolean) {
    try {
      if (expanded) {
        localStorage.setItem(EXPANDED_STORAGE_KEY, '1')
      } else {
        localStorage.removeItem(EXPANDED_STORAGE_KEY)
      }
    } catch {
      // localStorage unavailable
    }
  }

  function toggleFold() {
    folded = !folded
    persistExpanded(!folded)
  }
</script>

<div
  role="alert"
  class="rounded-lg border-2 border-amber-500/40 bg-amber-500/10 animate-in fade-in slide-in-from-top-2 {folded
    ? 'p-3'
    : 'p-4'}"
  data-testid="local-only-vault-warning"
  data-folded={folded ? 'true' : 'false'}
>
  <div class="flex items-start gap-3">
    <TriangleAlert
      class="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400"
    />
    <div class="min-w-0 flex-1">
      <div class="flex items-start gap-2">
        <p
          class="min-w-0 flex-1 text-sm font-semibold text-amber-950 dark:text-amber-100 {folded
            ? 'truncate'
            : ''}"
        >
          {vault.t('local_only_warning.title')}
        </p>
        {#if folded}
          <Button
            type="button"
            size="sm"
            variant="outline"
            class="shrink-0 border-amber-500/45 bg-background/85 text-amber-950 hover:bg-amber-500/15 dark:text-amber-50"
            data-testid="local-only-warning-add-sync-btn"
            onclick={onAddSyncProvider}
          >
            {vault.t('local_only_warning.add_sync_provider')}
          </Button>
        {/if}
        <button
          type="button"
          class="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-amber-800 transition-colors hover:bg-amber-500/15 dark:text-amber-200"
          aria-expanded={!folded}
          aria-label={folded
            ? vault.t('local_only_warning.expand')
            : vault.t('local_only_warning.collapse')}
          data-testid="local-only-warning-toggle"
          onclick={toggleFold}
        >
          <ChevronDown
            class="size-4 transition-transform duration-200 {folded
              ? ''
              : 'rotate-180'}"
          />
        </button>
      </div>

      {#if !folded}
        <div class="mt-3 space-y-3" data-testid="local-only-warning-details">
          <div class="space-y-2">
            <p
              class="text-sm leading-relaxed text-amber-900/90 dark:text-amber-100/90"
            >
              {vault.t('local_only_warning.body')}
            </p>
            <ul
              class="list-disc space-y-1 pl-4 text-xs leading-relaxed text-amber-900/80 dark:text-amber-100/80"
            >
              <li>{vault.t('local_only_warning.risk_cleared_data')}</li>
              <li>{vault.t('local_only_warning.risk_lost_device')}</li>
              <li>{vault.t('local_only_warning.risk_no_guarantee')}</li>
            </ul>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            class="border-amber-500/45 bg-background/85 text-amber-950 hover:bg-amber-500/15 dark:text-amber-50"
            data-testid="local-only-warning-add-sync-btn"
            onclick={onAddSyncProvider}
          >
            {vault.t('local_only_warning.add_sync_provider')}
          </Button>
        </div>
      {/if}
    </div>
  </div>
</div>
