<script lang="ts">
  import {
    CheckCircle2,
    ChevronDown,
    RefreshCw,
    ShieldCheck,
  } from '@lucide/svelte'
  import type { StorageProvider } from '$lib/auth-providers'
  import { providerStorageDetail } from '$lib/auth-providers'
  import type { VaultPasswordEntrySummary } from '$lib/vault-password'
  import type { VaultState } from '$lib/vault.svelte'
  import LoginConnectionStep from '$lib/components/login/LoginConnectionStep.svelte'
  import LoginAuthorizationStep from '$lib/components/login/LoginAuthorizationStep.svelte'
  import RemoteVaultRecoveryPanel from '$lib/components/login/RemoteVaultRecoveryPanel.svelte'

  let {
    vault,
    step,
    providers,
    activeProviderId,
    activeProvider = null,
    passwordEntries = [] as VaultPasswordEntrySummary[],
    selectedPasswordEntryId = $bindable(null as string | null),
    isVerifying,
    isInitializing,
    isConnecting = false,
    isUnlocking = false,
    loginPasswordPrompt = false,
    onSelectProvider,
    onConnect,
    onBackToConnection,
    onUnlock,
    onUnlockWithPassword,
    onConsumeLoginPasswordPrompt,
    remoteVaultRecoveryPrompt = 'none' as 'none' | 'with_cache' | 'missing_only',
    onRecoverRemoteVault,
    onCreateFreshRemoteVault,
    onDismissRemoteRecovery,
  }: {
    vault: VaultState
    step: 'connection' | 'authorization'
    providers: StorageProvider[]
    activeProviderId: string | null
    activeProvider?: StorageProvider | null
    passwordEntries?: VaultPasswordEntrySummary[]
    selectedPasswordEntryId?: string | null
    isVerifying: boolean
    isInitializing: boolean
    isConnecting?: boolean
    isUnlocking?: boolean
    loginPasswordPrompt?: boolean
    onSelectProvider: (id: string) => void | Promise<void>
    onConnect: () => void | Promise<void>
    onBackToConnection?: () => void
    onUnlock: () => void | Promise<void>
    onUnlockWithPassword?: (
      entryId: string,
      password: string,
    ) => void | Promise<void>
    onConsumeLoginPasswordPrompt?: () => void
    remoteVaultRecoveryPrompt?: 'none' | 'with_cache' | 'missing_only'
    onRecoverRemoteVault?: () => void | Promise<void>
    onCreateFreshRemoteVault?: () => void | Promise<void>
    onDismissRemoteRecovery?: () => void
  } = $props()

  const connectionOpen = $derived(step === 'connection')
  const authorizationOpen = $derived(step === 'authorization')
  const connectionDone = $derived(step === 'authorization')
  const authorizationEnabled = $derived(connectionDone)
</script>

<div class="space-y-2" data-testid="login-wizard">
  <section
    class="overflow-hidden rounded-xl border transition-colors {connectionOpen
      ? 'border-primary/30 bg-background shadow-sm'
      : connectionDone
        ? 'border-border/60 bg-muted/15'
        : 'border-border/60 bg-muted/10'}"
  >
    <button
      type="button"
      class="flex w-full items-center gap-3 border-l-2 px-3.5 py-2.5 text-left transition-colors {connectionOpen
        ? 'border-l-primary'
        : connectionDone
          ? 'border-l-primary/40 hover:bg-muted/25'
          : 'border-l-transparent'}"
      aria-expanded={connectionOpen}
      data-testid="login-wizard-connection-toggle"
      onclick={() => {
        if (connectionDone) {
          onBackToConnection?.()
        }
      }}
    >
      <span
        class="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold {connectionDone
          ? 'bg-primary/15 text-primary'
          : connectionOpen
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground'}"
      >
        {#if connectionDone}
          <CheckCircle2 class="size-3.5" />
        {:else}
          1
        {/if}
      </span>
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-medium text-foreground"
          >{vault.t('login_wizard.connection_step')}</span
        >
        {#if connectionDone && activeProvider}
          <span class="block truncate text-xs text-muted-foreground">
            {providerStorageDetail(activeProvider)}
          </span>
        {:else if connectionOpen}
          <span class="block text-xs text-muted-foreground">
            {vault.t('login_wizard.connection_subheader')}
          </span>
        {/if}
      </span>
      {#if isConnecting}
        <RefreshCw class="size-4 shrink-0 animate-spin text-muted-foreground" />
      {:else if connectionOpen || connectionDone}
        <ChevronDown
          class="size-4 shrink-0 text-muted-foreground transition-transform duration-200 {connectionOpen
            ? 'rotate-180'
            : ''}"
        />
      {/if}
    </button>

    {#if connectionOpen}
      <div
        class="border-t border-border/40 px-3.5 pb-3 pt-2"
        data-testid="login-wizard-connection-step"
      >
        <LoginConnectionStep
          {vault}
          {providers}
          {activeProviderId}
          {isVerifying}
          {isInitializing}
          {isConnecting}
          {onSelectProvider}
          onConnect={remoteVaultRecoveryPrompt === 'none' ? onConnect : undefined}
        />
        {#if remoteVaultRecoveryPrompt !== 'none'}
          <RemoteVaultRecoveryPanel
            {vault}
            mode={remoteVaultRecoveryPrompt}
            isBusy={isConnecting}
            onRecover={onRecoverRemoteVault}
            onCreateFresh={onCreateFreshRemoteVault}
            onDismiss={onDismissRemoteRecovery}
          />
        {/if}
      </div>
    {/if}
  </section>

  <section
    class="overflow-hidden rounded-xl border transition-colors {authorizationOpen
      ? 'border-primary/30 bg-background shadow-sm'
      : authorizationEnabled
        ? 'border-border/60 bg-muted/15'
        : 'border-border/40 bg-muted/5'}"
  >
    <button
      type="button"
      class="flex w-full items-center gap-3 border-l-2 px-3.5 py-2.5 text-left transition-colors {authorizationOpen
        ? 'border-l-primary'
        : authorizationEnabled
          ? 'border-l-transparent hover:bg-muted/25'
          : 'border-l-transparent'}"
      aria-expanded={authorizationOpen}
      disabled={!authorizationEnabled || isVerifying || isInitializing}
      data-testid="login-wizard-authorization-toggle"
    >
      <span
        class="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold {authorizationOpen
          ? 'bg-primary text-primary-foreground'
          : authorizationEnabled
            ? 'bg-muted text-muted-foreground'
            : 'bg-muted/60 text-muted-foreground/60'}"
      >
        2
      </span>
      <span class="min-w-0 flex-1">
        <span
          class="block text-sm font-medium {authorizationEnabled
            ? 'text-foreground'
            : 'text-muted-foreground'}"
        >
          {vault.t('login_wizard.get_access')}
        </span>
        {#if authorizationOpen}
          <span class="block text-xs text-muted-foreground">
            {vault.t('login_wizard.get_access_subheader')}
          </span>
        {:else if !authorizationEnabled}
          <span class="block text-xs text-muted-foreground/70">
            {vault.t('login_wizard.available_after_connect')}
          </span>
        {/if}
      </span>
      {#if isUnlocking}
        <RefreshCw class="size-4 shrink-0 animate-spin text-muted-foreground" />
      {:else if authorizationEnabled && !authorizationOpen}
        <ShieldCheck class="size-4 shrink-0 text-muted-foreground/70" />
      {/if}
    </button>

    {#if authorizationOpen}
      <div
        class="border-t border-border/40 px-3.5 pb-3 pt-2"
        data-testid="login-wizard-authorization-step"
      >
        <LoginAuthorizationStep
          {vault}
          bind:selectedPasswordEntryId
          {isVerifying}
          {isInitializing}
          {isUnlocking}
          {loginPasswordPrompt}
          {passwordEntries}
          {onUnlock}
          {onUnlockWithPassword}
          {onConsumeLoginPasswordPrompt}
        />
      </div>
    {/if}
  </section>
</div>
