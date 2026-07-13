<script lang="ts">
  import { ShieldCheck } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import LoginAuthorizationStep from '$lib/components/login/LoginAuthorizationStep.svelte'
  import LoginVaultCard from '$lib/components/login/LoginVaultCard.svelte'
  import LoginVaultNameForm from '$lib/components/login/LoginVaultNameForm.svelte'
  import LoginVaultWorkflowNav from '$lib/components/login/LoginVaultWorkflowNav.svelte'
  import SentinelCeremonyPanel from '$lib/components/login/SentinelCeremonyPanel.svelte'
  import type {
    NookLocalVaultEntry,
    NookPasswordEntrySummary,
  } from '$lib/nook-wasm/nook_wasm'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    vaultEntry = undefined as NookLocalVaultEntry | undefined,
    hasMultipleVaults = false,
    passwordEntries = [] as NookPasswordEntrySummary[],
    selectedPasswordEntryId = $bindable(undefined as string | undefined),
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
    vaultEntry?: NookLocalVaultEntry | undefined
    hasMultipleVaults?: boolean
    passwordEntries?: NookPasswordEntrySummary[]
    selectedPasswordEntryId?: string | undefined
    isVerifying: boolean
    isInitializing: boolean
    isUnlocking?: boolean
    onUnlock: () => void | Promise<void>
    onUnlockWithPassword?: (
      entryId: string,
      password: string,
    ) => void | Promise<void>
    onSwitchVault?: () => void | Promise<void>
    onCreateAnotherVault?: (label: string) => void | Promise<void>
    onImportFromSync?: () => void
  } = $props()

  const isBusy = $derived(isVerifying || isInitializing)
  let workflow = $state<'open' | 'create' | 'import'>('open')
  const showSentinelCeremony = $derived(
    vault.sentinelCeremonyPrompt ||
      vault.sentinelUnlockStatus === 'ceremony_required' ||
      vault.sentinelUnlockStatus === 'awaiting_shares' ||
      (vault.isSentinelVault() && !vault.isAuthenticated),
  )
  const hidePasswordUnlock = $derived(
    showSentinelCeremony || vault.isSentinelVault(),
  )
</script>

<div class="space-y-5" data-testid="login-local-unlock-step">
  <LoginVaultWorkflowNav
    {vault}
    active={workflow}
    onSelect={(selected) => (workflow = selected)}
  />

  {#if workflow === 'open'}
    {#if vaultEntry}
      <section class="space-y-2" data-testid="login-vault-context">
        <h3
          class="text-xs font-medium tracking-wide text-muted-foreground uppercase"
        >
          {vault.t('login.vault_on_device')}
        </h3>
        <LoginVaultCard {vault} entry={vaultEntry} active />
        {#if hasMultipleVaults && onSwitchVault}
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
          bind:selectedPasswordEntryId
          {isVerifying}
          {isInitializing}
          {isUnlocking}
          loginPasswordPrompt={vault.loginPasswordPrompt}
          onConsumeLoginPasswordPrompt={() => {
            vault.loginPasswordPrompt = false
          }}
          {onUnlock}
          onUnlockWithPassword={hidePasswordUnlock
            ? undefined
            : onUnlockWithPassword}
        />
      </section>
    {/if}
  {:else if workflow === 'create' && onCreateAnotherVault}
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
  {:else if workflow === 'import' && onImportFromSync}
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
