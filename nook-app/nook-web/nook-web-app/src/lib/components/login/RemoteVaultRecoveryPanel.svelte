<script lang="ts">
  import { AlertTriangle, RefreshCw } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    mode,
    isBusy = false,
    onRecover,
    onCreateFresh,
    onDismiss,
  }: {
    vault: VaultState
    mode: 'with_cache' | 'missing_only'
    isBusy?: boolean
    onRecover?: () => void | Promise<void>
    onCreateFresh?: () => void | Promise<void>
    onDismiss?: () => void
  } = $props()
</script>

<div
  class="space-y-3 rounded-lg border border-amber-500/35 bg-amber-500/[0.06] p-3"
  data-testid="remote-vault-recovery-panel"
>
  <div class="flex items-start gap-2.5">
    <AlertTriangle class="mt-0.5 size-4 shrink-0 text-amber-500" />
    <div class="min-w-0 space-y-1">
      <p class="text-sm font-medium text-foreground">
        {vault.t('login_wizard.remote_recovery.title')}
      </p>
      <p class="text-xs leading-relaxed text-muted-foreground">
        {#if mode === 'with_cache'}
          {vault.t('login_wizard.remote_recovery.desc_with_cache')}
        {:else}
          {vault.t('login_wizard.remote_recovery.desc_missing_only')}
        {/if}
      </p>
    </div>
  </div>

  <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
    {#if mode === 'with_cache'}
      <Button
        type="button"
        class="sm:min-w-[160px]"
        data-testid="remote-vault-recover-btn"
        disabled={isBusy}
        onclick={() => void onRecover?.()}
      >
        {#if isBusy}
          <RefreshCw class="size-4 animate-spin" />
          {vault.t('login_wizard.remote_recovery.recovering')}
        {:else}
          {vault.t('login_wizard.remote_recovery.recover_btn')}
        {/if}
      </Button>
    {/if}
    <Button
      type="button"
      variant="outline"
      class="sm:min-w-[160px]"
      data-testid="remote-vault-create-fresh-btn"
      disabled={isBusy}
      onclick={() => void onCreateFresh?.()}
    >
      {vault.t('login_wizard.remote_recovery.create_fresh_btn')}
    </Button>
    {#if onDismiss}
      <Button
        type="button"
        variant="ghost"
        class="text-muted-foreground"
        disabled={isBusy}
        onclick={() => onDismiss?.()}
      >
        {vault.t('common.cancel')}
      </Button>
    {/if}
  </div>
</div>
