<script lang="ts">
  import { Cloud, ShieldCheck, RefreshCw } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    isVerifying,
    isInitializing,
    onCreateDeviceVault,
    onConnectStorage,
  }: {
    vault: VaultState
    isVerifying: boolean
    isInitializing: boolean
    onCreateDeviceVault: () => void | Promise<void>
    onConnectStorage: () => void
  } = $props()

  const isBusy = $derived(isVerifying || isInitializing)
</script>

<div class="space-y-3" data-testid="login-create-vault-chooser">
  <div
    class="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3"
    data-testid="login-path-local"
  >
    <div class="flex items-start gap-3">
      <ShieldCheck class="mt-0.5 size-5 shrink-0 text-foreground" />
      <div class="min-w-0 space-y-1">
        <p class="text-sm font-semibold text-foreground">
          {vault.t('login.path_local_title')}
        </p>
        <p class="text-sm text-pretty text-muted-foreground">
          {vault.t('login.path_local_description')}
        </p>
      </div>
    </div>
    <Button
      type="button"
      class="w-full sm:w-auto sm:min-w-[180px]"
      data-testid="login-create-device-vault-btn"
      disabled={isBusy}
      onclick={() => onCreateDeviceVault()}
    >
      {#if isVerifying}
        <RefreshCw class="size-4 animate-spin" />
        {vault.t('login.creating_vault')}
      {:else if isInitializing}
        <RefreshCw class="size-4 animate-spin" />
        {vault.t('onboarding.loading_engine')}
      {:else}
        <ShieldCheck class="size-4" />
        {vault.t('login.path_local_btn')}
      {/if}
    </Button>
  </div>

  <div
    class="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3"
    data-testid="login-path-cloud"
  >
    <div class="flex items-start gap-3">
      <Cloud class="mt-0.5 size-5 shrink-0 text-foreground" />
      <div class="min-w-0 space-y-1">
        <p class="text-sm font-semibold text-foreground">
          {vault.t('login.path_cloud_title')}
        </p>
        <p class="text-sm text-pretty text-muted-foreground">
          {vault.t('login.path_cloud_description')}
        </p>
      </div>
    </div>
    <Button
      type="button"
      variant="outline"
      class="w-full sm:w-auto sm:min-w-[180px]"
      data-testid="login-connect-storage-btn"
      disabled={isBusy}
      onclick={onConnectStorage}
    >
      {vault.t('login.path_cloud_btn')}
    </Button>
  </div>
</div>
