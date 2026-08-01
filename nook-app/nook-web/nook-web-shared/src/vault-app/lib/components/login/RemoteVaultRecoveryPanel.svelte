<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { AlertTriangle, RefreshCw } from '@lucide/svelte'
  import type { RemoteVaultRecoveryState } from '$app-wasm'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    state,
    isBusy = false,
    onRecover,
    onCreateFresh,
    onDismiss,
  }: {
    vault: VaultState
    state: RemoteVaultRecoveryState
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
        {vault.t(I18N_KEYS.LoginWizardRemoteRecoveryTitle)}
      </p>
      <p class="text-xs leading-relaxed text-muted-foreground">
        {#if vault.clientPolicy.remoteRecoveryPromptHasCache(state)}
          {vault.t(I18N_KEYS.LoginWizardRemoteRecoveryDescWithCache)}
        {:else}
          {vault.t(I18N_KEYS.LoginWizardRemoteRecoveryDescMissingOnly)}
        {/if}
      </p>
    </div>
  </div>

  <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
    {#if vault.clientPolicy.remoteRecoveryPromptHasCache(state)}
      <Button
        type="button"
        class="sm:min-w-[160px]"
        data-testid="remote-vault-recover-btn"
        disabled={isBusy}
        onclick={() => void onRecover?.()}
      >
        {#if isBusy}
          <RefreshCw class="size-4 animate-spin" />
          {vault.t(I18N_KEYS.LoginWizardRemoteRecoveryRecovering)}
        {:else}
          {vault.t(I18N_KEYS.LoginWizardRemoteRecoveryRecoverBtn)}
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
      {vault.t(I18N_KEYS.LoginWizardRemoteRecoveryCreateFreshBtn)}
    </Button>
    {#if onDismiss}
      <Button
        type="button"
        variant="ghost"
        class="text-muted-foreground"
        disabled={isBusy}
        onclick={() => onDismiss?.()}
      >
        {vault.t(I18N_KEYS.CommonCancel)}
      </Button>
    {/if}
  </div>
</div>
