<script lang="ts">
  import { Cloud } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import DeviceModeSelect from '$lib/components/DeviceModeSelect.svelte'
  import LoginVaultNameForm from '$lib/components/login/LoginVaultNameForm.svelte'
  import { onboardingType } from '$lib/vault-architecture'
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
  const vaultTypes = ['simple', 'nexus'] as const
  const replicationTypes = ['personal', 'shared'] as const
  const draftOnboardingType = $derived(
    onboardingType(vault.draftVaultArchitecture),
  )
</script>

<div class="space-y-4" data-testid="login-create-vault-chooser">
  <p class="text-sm text-pretty text-muted-foreground">
    {vault.t('login.create_vault_intro')}
  </p>

  <DeviceModeSelect {vault} id="vault-device-mode" disabled={isBusy} />

  <div class="grid gap-3 sm:grid-cols-2">
    <div class="space-y-2" data-testid="mode-group-vault">
      <p class="text-sm font-semibold text-foreground">
        {vault.t('architecture_modes.vault_type_title')}
      </p>
      {#each vaultTypes as mode (mode)}
        <button
          type="button"
          class={[
            'w-full rounded-md border p-3 text-left text-sm transition-colors',
            vault.draftVaultType === mode
              ? 'border-primary bg-primary/10 text-foreground'
              : 'border-border/60 bg-background hover:bg-muted/40',
          ]}
          aria-pressed={vault.draftVaultType === mode}
          data-testid={`mode-option-${mode}`}
          disabled={isBusy}
          onclick={() => {
            vault.draftVaultType = mode
          }}
        >
          <span class="block font-medium">
            {vault.t(`architecture_modes.vault_type_${mode}_title`)}
          </span>
          <span class="mt-1 block text-xs text-muted-foreground">
            {vault.t(`architecture_modes.vault_type_${mode}_description`)}
          </span>
        </button>
      {/each}
    </div>

    <div class="space-y-2" data-testid="mode-group-replication">
      <p class="text-sm font-semibold text-foreground">
        {vault.t('architecture_modes.replication_type_title')}
      </p>
      {#each replicationTypes as mode (mode)}
        <button
          type="button"
          class={[
            'w-full rounded-md border p-3 text-left text-sm transition-colors',
            vault.draftReplicationType === mode
              ? 'border-primary bg-primary/10 text-foreground'
              : 'border-border/60 bg-background hover:bg-muted/40',
          ]}
          aria-pressed={vault.draftReplicationType === mode}
          data-testid={`mode-option-${mode}`}
          disabled={isBusy}
          onclick={() => {
            vault.draftReplicationType = mode
          }}
        >
          <span class="block font-medium">
            {vault.t(`architecture_modes.replication_type_${mode}_title`)}
          </span>
          <span class="mt-1 block text-xs text-muted-foreground">
            {vault.t(`architecture_modes.replication_type_${mode}_description`)}
          </span>
        </button>
      {/each}
    </div>
  </div>

  <div class="grid gap-3 sm:grid-cols-2">
    <div
      class="rounded-md border border-border/60 bg-muted/15 p-3"
      data-testid="mode-group-onboarding"
    >
      <p class="text-sm font-semibold text-foreground">
        {vault.t('architecture_modes.onboarding_type_title')}
      </p>
      <p class="mt-1 text-xs font-medium text-foreground">
        {vault.t(
          `architecture_modes.onboarding_type_${draftOnboardingType}_title`,
        )}
      </p>
      <p class="mt-1 text-xs text-pretty text-muted-foreground">
        {vault.t(
          `architecture_modes.onboarding_type_${draftOnboardingType}_description`,
        )}
      </p>
    </div>

    <div
      class="rounded-md border border-border/60 bg-muted/15 p-3"
      data-testid="mode-group-provider-capability"
    >
      <p class="text-sm font-semibold text-foreground">
        {vault.t('architecture_modes.provider_capability_title')}
      </p>
      <p class="mt-1 text-xs text-pretty text-muted-foreground">
        {vault.t('architecture_modes.provider_capability_description')}
      </p>
    </div>
  </div>

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
