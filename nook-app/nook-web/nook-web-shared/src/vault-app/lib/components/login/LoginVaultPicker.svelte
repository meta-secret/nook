<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { ShieldCheck } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import LoginVaultCard from '$lib/components/login/LoginVaultCard.svelte'
  import LoginVaultNameForm from '$lib/components/login/LoginVaultNameForm.svelte'
  import LoginVaultWorkflowNav from '$lib/components/login/LoginVaultWorkflowNav.svelte'
  import { LoginVaultWorkflow } from '$lib/components/login/login-unlock-state'
  import type { VaultState } from '$lib/vault.svelte'
  import type { NookLocalVaultEntry } from '$app-wasm'

  let {
    vault,
    vaults,
    isVerifying,
    isInitializing,
    onChooseVault,
    onCreateVault,
    onConnectStorage,
  }: {
    vault: VaultState
    vaults: NookLocalVaultEntry[]
    isVerifying: boolean
    isInitializing: boolean
    onChooseVault: (storeId: string) => void | Promise<void>
    onCreateVault: (label: string) => void | Promise<void>
    onConnectStorage: () => void
  } = $props()

  const isBusy = $derived(isVerifying || isInitializing)
  let workflow = $state<LoginVaultWorkflow>(LoginVaultWorkflow.Open)
</script>

<div class="space-y-5" data-testid="login-vault-picker">
  <LoginVaultWorkflowNav
    {vault}
    active={workflow}
    onSelect={(selected) => (workflow = selected)}
  />

  {#if workflow === LoginVaultWorkflow.Open}
    <section class="space-y-3" data-testid="login-vault-picker-existing">
      <div class="space-y-1">
        <h3
          class="text-xs font-medium tracking-wide text-muted-foreground uppercase"
        >
          {vault.t(I18N_KEYS.LoginVaultPickerOnDevice)}
        </h3>
        <p class="text-sm text-pretty text-muted-foreground">
          {vault.t(I18N_KEYS.LoginVaultPickerHint)}
        </p>
      </div>
      <ul class="space-y-2">
        {#each vaults as entry (entry.storeId)}
          <li>
            <button
              type="button"
              class="block w-full text-left transition-opacity disabled:opacity-60"
              data-testid="login-vault-option"
              data-store-id={entry.storeId}
              disabled={isBusy}
              onclick={() => onChooseVault(entry.storeId)}
            >
              <LoginVaultCard {vault} {entry} interactive />
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {:else if workflow === LoginVaultWorkflow.Create}
    <section class="space-y-3" data-testid="login-vault-picker-start-fresh">
      <div class="space-y-1">
        <h3 class="text-sm font-semibold text-foreground">
          {vault.t(I18N_KEYS.LoginVaultPickerCreateNew)}
        </h3>
        <p class="text-sm text-pretty text-muted-foreground">
          {vault.t(I18N_KEYS.LoginVaultWorkflowCreateDescription)}
        </p>
      </div>
      <LoginVaultNameForm
        {vault}
        {isVerifying}
        {isInitializing}
        testId="login-create-additional-vault-btn"
        submitLabel={vault.t(I18N_KEYS.LoginVaultPickerCreateNew)}
        onCreate={onCreateVault}
      />
    </section>
  {:else}
    <section class="space-y-3" data-testid="login-vault-picker-import">
      <div class="space-y-1">
        <h3 class="text-sm font-semibold text-foreground">
          {vault.t(I18N_KEYS.LoginVaultPickerImport)}
        </h3>
        <p class="text-sm text-pretty text-muted-foreground">
          {vault.t(I18N_KEYS.LoginVaultWorkflowImportDescription)}
        </p>
      </div>
      <Button
        type="button"
        class="w-full sm:w-auto sm:min-w-[180px]"
        data-testid="login-import-vault-btn"
        disabled={isBusy}
        onclick={onConnectStorage}
      >
        <ShieldCheck class="size-4" />
        {vault.t(I18N_KEYS.LoginVaultPickerImport)}
      </Button>
    </section>
  {/if}
</div>
