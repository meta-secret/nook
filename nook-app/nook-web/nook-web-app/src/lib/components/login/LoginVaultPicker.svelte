<script lang="ts">
  import { ShieldCheck } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import LoginVaultCard from '$lib/components/login/LoginVaultCard.svelte'
  import LoginVaultNameForm from '$lib/components/login/LoginVaultNameForm.svelte'
  import LoginVaultWorkflowNav from '$lib/components/login/LoginVaultWorkflowNav.svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import type { NookLocalVaultEntry } from '$lib/nook-wasm/nook_wasm'

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
  let workflow = $state<'open' | 'create' | 'import'>('open')
</script>

<div class="space-y-5" data-testid="login-vault-picker">
  <LoginVaultWorkflowNav
    {vault}
    active={workflow}
    onSelect={(selected) => (workflow = selected)}
  />

  {#if workflow === 'open'}
    <section class="space-y-3" data-testid="login-vault-picker-existing">
      <div class="space-y-1">
        <h3
          class="text-xs font-medium tracking-wide text-muted-foreground uppercase"
        >
          {vault.t('login.vault_picker_on_device')}
        </h3>
        <p class="text-sm text-pretty text-muted-foreground">
          {vault.t('login.vault_picker_hint')}
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
  {:else if workflow === 'create'}
    <section class="space-y-3" data-testid="login-vault-picker-start-fresh">
      <div class="space-y-1">
        <h3 class="text-sm font-semibold text-foreground">
          {vault.t('login.vault_picker_create_new')}
        </h3>
        <p class="text-sm text-pretty text-muted-foreground">
          {vault.t('login.vault_workflow_create_description')}
        </p>
      </div>
      <LoginVaultNameForm
        {vault}
        {isVerifying}
        {isInitializing}
        testId="login-create-additional-vault-btn"
        submitLabel={vault.t('login.vault_picker_create_new')}
        onCreate={onCreateVault}
      />
    </section>
  {:else}
    <section class="space-y-3" data-testid="login-vault-picker-import">
      <div class="space-y-1">
        <h3 class="text-sm font-semibold text-foreground">
          {vault.t('login.vault_picker_import')}
        </h3>
        <p class="text-sm text-pretty text-muted-foreground">
          {vault.t('login.vault_workflow_import_description')}
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
        {vault.t('login.vault_picker_import')}
      </Button>
    </section>
  {/if}
</div>
