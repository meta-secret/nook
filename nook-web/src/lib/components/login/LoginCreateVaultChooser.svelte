<script lang="ts">
  import { Cloud } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import LoginVaultNameForm from '$lib/components/login/LoginVaultNameForm.svelte'
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
    onCreateDeviceVault: (label: string) => void | Promise<void>
    onConnectStorage: () => void
  } = $props()

  const isBusy = $derived(isVerifying || isInitializing)
</script>

<div class="space-y-4" data-testid="login-create-vault-chooser">
  <p class="text-sm text-pretty text-muted-foreground">
    {vault.t('login.create_vault_intro')}
  </p>

  <div
    class="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3"
    data-testid="login-path-local"
  >
    <div class="space-y-1">
      <p class="text-sm font-semibold text-foreground">
        {vault.t('login.path_local_title')}
      </p>
      <p class="text-sm text-pretty text-muted-foreground">
        {vault.t('login.path_local_description')}
      </p>
    </div>
    <LoginVaultNameForm
      {vault}
      {isVerifying}
      {isInitializing}
      submitLabel={vault.t('login.path_local_btn')}
      onCreate={onCreateDeviceVault}
    />
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
