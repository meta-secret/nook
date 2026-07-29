<script lang="ts">
  import {
    SentinelVaultUnlockState,
    type NookPasswordEntrySummary,
  } from '$app-wasm'
  import { ShieldCheck } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import LoginAuthorizationStep from '$lib/components/login/LoginAuthorizationStep.svelte'
  import LoginVaultCard from '$lib/components/login/LoginVaultCard.svelte'
  import LoginVaultNameForm from '$lib/components/login/LoginVaultNameForm.svelte'
  import LoginVaultWorkflowNav from '$lib/components/login/LoginVaultWorkflowNav.svelte'
  import SentinelCeremonyPanel from '$lib/components/login/SentinelCeremonyPanel.svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import { isSentinelVault } from '$lib/vault/sentinel-unlock'
  import {
    PasswordEntrySelectionKind,
    type PasswordEntrySelection,
  } from '$lib/vault/state/session.svelte'
  import {
    LoginVaultEntryKind,
    LoginVaultWorkflow,
    PasswordUnlockCapabilityKind,
    type LoginVaultEntry,
    type PasswordUnlockCapability,
  } from './login-unlock-state'

  type PasswordEntrySummary = Pick<
    NookPasswordEntrySummary,
    'id' | 'label' | 'createdAt'
  >

  let {
    vault,
    vaultEntry,
    hasMultipleVaults = false,
    passwordEntries = [] as PasswordEntrySummary[],
    selectedPasswordEntry = $bindable<PasswordEntrySelection>({
      kind: PasswordEntrySelectionKind.NotSelected,
    }),
    isVerifying,
    isInitializing,
    isUnlocking = false,
    onUnlock,
    onUnlockWithPassword,
    onSwitchVault,
    onCreateAnotherVault,
    onImportFromSync,
  }: {
    vault: VaultState
    vaultEntry: LoginVaultEntry
    hasMultipleVaults?: boolean
    passwordEntries?: PasswordEntrySummary[]
    selectedPasswordEntry?: PasswordEntrySelection
    isVerifying: boolean
    isInitializing: boolean
    isUnlocking?: boolean
    onUnlock: () => void | Promise<void>
    onUnlockWithPassword: (
      entryId: string,
      password: string,
    ) => void | Promise<void>
    onSwitchVault: () => void | Promise<void>
    onCreateAnotherVault: (label: string) => void | Promise<void>
    onImportFromSync: () => void
  } = $props()

  const isBusy = $derived(isVerifying || isInitializing)
  let workflow = $state<LoginVaultWorkflow>(LoginVaultWorkflow.Open)
  const showSentinelCeremony = $derived(
    vault.sentinelCeremonyPrompt ||
      vault.sentinelUnlockStatus ===
        SentinelVaultUnlockState.CeremonyRequired ||
      vault.sentinelUnlockStatus === SentinelVaultUnlockState.AwaitingShares ||
      (isSentinelVault(vault) && !vault.isAuthenticated),
  )
  const hidePasswordUnlock = $derived(
    showSentinelCeremony || isSentinelVault(vault),
  )
  const passwordUnlock = $derived<PasswordUnlockCapability>(
    hidePasswordUnlock
      ? { kind: PasswordUnlockCapabilityKind.Unavailable }
      : {
          kind: PasswordUnlockCapabilityKind.Available,
          unlock: onUnlockWithPassword,
        },
  )
</script>

<div class="space-y-5" data-testid="login-local-unlock-step">
  <LoginVaultWorkflowNav
    {vault}
    active={workflow}
    onSelect={(selected) => (workflow = selected)}
  />

  {#if workflow === LoginVaultWorkflow.Open}
    {#if vaultEntry.kind === LoginVaultEntryKind.Available}
      <section class="space-y-2" data-testid="login-vault-context">
        <h3
          class="text-xs font-medium tracking-wide text-muted-foreground uppercase"
        >
          {vault.t('login.vault_on_device')}
        </h3>
        <LoginVaultCard {vault} entry={vaultEntry.entry} active />
        {#if hasMultipleVaults}
          <button
            type="button"
            class="text-sm font-medium text-primary underline-offset-4 hover:underline"
            data-testid="login-switch-vault-btn"
            disabled={isBusy}
            onclick={() => onSwitchVault()}
          >
            {vault.t('login.switch_vault')}
          </button>
        {/if}
      </section>
    {/if}

    {#if showSentinelCeremony}
      <SentinelCeremonyPanel {vault} {isVerifying} {isInitializing} />
    {:else}
      <section
        class="space-y-3 rounded-lg border border-border/60 bg-muted/10 p-4"
        data-testid="login-unlock-section"
      >
        <div class="space-y-1">
          <h3 class="text-sm font-semibold text-foreground">
            {vault.t('login.unlock_section_title')}
          </h3>
          <p class="text-sm text-pretty text-muted-foreground">
            {vault.t('login.unlock_section_description')}
          </p>
        </div>

        <LoginAuthorizationStep
          {vault}
          {passwordEntries}
          bind:selectedPasswordEntry
          {isVerifying}
          {isInitializing}
          {isUnlocking}
          loginPasswordPrompt={vault.loginPasswordPrompt}
          onConsumeLoginPasswordPrompt={() => {
            vault.loginPasswordPrompt = false
          }}
          {onUnlock}
          {passwordUnlock}
        />
      </section>
    {/if}
  {:else if workflow === LoginVaultWorkflow.Create}
    <section class="space-y-3" data-testid="login-vault-create-workflow">
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
        onCreate={onCreateAnotherVault}
      />
    </section>
  {:else if workflow === LoginVaultWorkflow.Import}
    <section class="space-y-3" data-testid="login-vault-import-workflow">
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
        class="sm:min-w-[180px]"
        data-testid="login-import-vault-btn"
        disabled={isBusy}
        onclick={onImportFromSync}
      >
        <ShieldCheck class="size-4" />
        {vault.t('login.vault_picker_import')}
      </Button>
    </section>
  {/if}
</div>
