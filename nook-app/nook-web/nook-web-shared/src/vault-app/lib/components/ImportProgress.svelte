<script lang="ts">
  import { LoaderCircle } from '@lucide/svelte'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    testId,
  }: {
    vault: VaultState
    testId: string
  } = $props()
</script>

<div
  class="rounded-lg border border-primary/30 bg-primary/10 p-3"
  role="status"
  aria-live="polite"
  data-testid={testId}
>
  <div class="flex items-start gap-3">
    <LoaderCircle class="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
    <div class="min-w-0 flex-1 space-y-2">
      <div>
        <p class="text-sm font-medium text-foreground">
          {vault.t('common.import_progress_title')}
        </p>
        <p class="mt-0.5 text-xs text-muted-foreground">
          {vault.t('common.import_progress_description')}
        </p>
      </div>
      <div
        class="h-1.5 overflow-hidden rounded-full bg-primary/20"
        role="progressbar"
        aria-label={vault.t('common.import_progress_title')}
      >
        <div class="h-full w-2/3 animate-pulse rounded-full bg-primary"></div>
      </div>
    </div>
  </div>
</div>
