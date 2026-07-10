<script lang="ts">
  import { Cloud } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import VaultArchitectureSelect from '$lib/components/VaultArchitectureSelect.svelte'
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
  type WizardStep = 'vault' | 'replication' | 'create'
  let wizardStep = $state<WizardStep>('vault')

  function continueWizard() {
    if (wizardStep === 'vault') {
      wizardStep = 'replication'
    } else if (wizardStep === 'replication') {
      wizardStep = 'create'
    }
  }

  function goBack() {
    if (wizardStep === 'create') {
      wizardStep = 'replication'
    } else if (wizardStep === 'replication') {
      wizardStep = 'vault'
    }
  }
</script>

<div class="space-y-5" data-testid="login-create-vault-chooser">
  <p class="text-sm text-pretty text-muted-foreground">
    {vault.t('login.create_vault_intro')}
  </p>

  <ol class="grid grid-cols-3 gap-2" data-testid="create-vault-wizard-progress">
    <li>
      <button
        type="button"
        class:border-foreground={wizardStep === 'vault'}
        class:text-foreground={wizardStep === 'vault'}
        class="w-full border-b-2 pb-2 text-left text-muted-foreground transition-colors"
        data-testid="create-vault-wizard-nav-vault"
        aria-current={wizardStep === 'vault' ? 'step' : undefined}
        disabled={isBusy}
        onclick={() => (wizardStep = 'vault')}
      >
        <span class="block text-xs font-medium">01</span>
        <span class="block text-sm font-semibold">
          {vault.t('login.create_wizard_vault_label')}
        </span>
      </button>
    </li>
    <li>
      <button
        type="button"
        class:border-foreground={wizardStep === 'replication'}
        class:text-foreground={wizardStep === 'replication'}
        class="w-full border-b-2 pb-2 text-left text-muted-foreground transition-colors disabled:cursor-default disabled:opacity-50"
        data-testid="create-vault-wizard-nav-replication"
        aria-current={wizardStep === 'replication' ? 'step' : undefined}
        disabled={isBusy || wizardStep === 'vault'}
        onclick={() => (wizardStep = 'replication')}
      >
        <span class="block text-xs font-medium">02</span>
        <span class="block text-sm font-semibold">
          {vault.t('login.create_wizard_replication_label')}
        </span>
      </button>
    </li>
    <li>
      <button
        type="button"
        class:border-foreground={wizardStep === 'create'}
        class:text-foreground={wizardStep === 'create'}
        class="w-full border-b-2 pb-2 text-left text-muted-foreground transition-colors disabled:cursor-default disabled:opacity-50"
        data-testid="create-vault-wizard-nav-create"
        aria-current={wizardStep === 'create' ? 'step' : undefined}
        disabled={isBusy || wizardStep !== 'create'}
        onclick={() => (wizardStep = 'create')}
      >
        <span class="block text-xs font-medium">03</span>
        <span class="block text-sm font-semibold">
          {vault.t('login.create_wizard_create_label')}
        </span>
      </button>
    </li>
  </ol>

  {#if wizardStep === 'vault'}
    <section class="space-y-4" data-testid="create-vault-wizard-vault">
      <div class="space-y-1">
        <h3 class="text-lg font-semibold text-foreground">
          {vault.t('login.create_wizard_vault_title')}
        </h3>
        <p class="text-sm text-pretty text-muted-foreground">
          {vault.t('login.create_wizard_vault_description')}
        </p>
      </div>

      <VaultArchitectureSelect
        {vault}
        kind="vault"
        id="vault-type"
        disabled={isBusy}
      />

      {#if vault.draftVaultType === 'nexus'}
        <div
          class="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-foreground"
          data-testid="nexus-readiness-gate"
        >
          <p class="font-medium">
            {vault.t('architecture_modes.nexus_gate_title')}
          </p>
          <p class="mt-1 text-xs text-muted-foreground">
            {vault.t('architecture_modes.nexus_gate_description')}
          </p>
        </div>
      {/if}

      <div class="flex justify-end pt-1">
        <Button
          type="button"
          class="min-w-[140px]"
          data-testid="create-vault-wizard-continue"
          disabled={isBusy}
          onclick={continueWizard}
        >
          {vault.t('login.create_wizard_continue')}
        </Button>
      </div>
    </section>
  {:else if wizardStep === 'replication'}
    <section class="space-y-4" data-testid="create-vault-wizard-replication">
      <div class="space-y-1">
        <h3 class="text-lg font-semibold text-foreground">
          {vault.t('login.create_wizard_replication_title')}
        </h3>
        <p class="text-sm text-pretty text-muted-foreground">
          {vault.t('login.create_wizard_replication_description')}
        </p>
      </div>

      <VaultArchitectureSelect
        {vault}
        kind="replication"
        id="replication-type"
        disabled={isBusy}
      />

      <div class="flex items-center justify-between gap-3 pt-1">
        <Button
          type="button"
          variant="ghost"
          data-testid="create-vault-wizard-back"
          disabled={isBusy}
          onclick={goBack}
        >
          {vault.t('common.back')}
        </Button>
        <Button
          type="button"
          class="min-w-[140px]"
          data-testid="create-vault-wizard-continue"
          disabled={isBusy}
          onclick={continueWizard}
        >
          {vault.t('login.create_wizard_continue')}
        </Button>
      </div>
    </section>
  {:else}
    <section class="space-y-4" data-testid="create-vault-wizard-create">
      <div class="space-y-1">
        <h3 class="text-lg font-semibold text-foreground">
          {vault.t('login.create_wizard_create_title')}
        </h3>
        <p class="text-sm text-pretty text-muted-foreground">
          {vault.t('login.create_wizard_create_description')}
        </p>
      </div>

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

      <div class="pt-1">
        <Button
          type="button"
          variant="ghost"
          data-testid="create-vault-wizard-back"
          disabled={isBusy}
          onclick={goBack}
        >
          {vault.t('common.back')}
        </Button>
      </div>
    </section>
  {/if}
</div>
