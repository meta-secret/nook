<script lang="ts">
  import { onMount } from 'svelte'
  import { Lock, ShieldCheck } from '@lucide/svelte'
  import { VaultState } from '$lib/vault.svelte'
  import AuthStorage from '$lib/components/AuthStorage.svelte'
  import LoginGate from '$lib/components/LoginGate.svelte'
  import JoinEnrollmentDialog from '$lib/components/JoinEnrollmentDialog.svelte'
  import PendingJoinsBanner from '$lib/components/PendingJoinsBanner.svelte'
  import SecretVault from '$lib/components/SecretVault.svelte'
  import VaultStatusBar from '$lib/components/VaultStatusBar.svelte'
  import { Button } from '$lib/components/ui/button'

  const vault = new VaultState()

  onMount(() => {
    void vault.init()
    return () => vault.stopVaultSync()
  })

  async function handleUnlock() {
    await vault.loadDb()
  }

  const shellWidth = 'max-w-xl'
</script>

<main class="dark min-h-svh bg-background text-foreground pb-16">
  <header
    class="border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-40"
  >
    <div
      class="mx-auto flex items-center justify-between gap-4 px-4 py-3 sm:px-6 {shellWidth}"
    >
      <div class="flex min-w-0 items-center gap-2.5">
        <div
          class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-accent text-accent-foreground"
        >
          <Lock class="size-4" />
        </div>
        <div class="flex min-w-0 items-center gap-2">
          <span class="text-base font-semibold tracking-tight text-foreground"
            >nook</span
          >
          <span
            class="shrink-0 text-[10px] font-medium text-muted-foreground border border-border px-1 py-0.5 rounded-sm"
            >v0.1.0</span
          >
        </div>
      </div>

      <div class="flex items-center gap-2">
        {#if vault.isAuthenticated}
          {#if vault.settingsOpen}
            <Button
              variant="outline"
              size="sm"
              class="border-border"
              data-testid="storage-settings-close"
              onclick={() => vault.closeSettings()}
            >
              Back to vault
            </Button>
          {:else}
            <button
              type="button"
              onclick={() => vault.openSettings()}
              class="relative inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              data-testid="storage-settings-btn"
            >
              {vault.activeProviderLabel}
              {#if vault.pendingJoins.length > 0}
                <span
                  class="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground"
                  data-testid="pending-joins-badge"
                >
                  {vault.pendingJoins.length}
                </span>
              {/if}
            </button>
          {/if}
        {:else}
          <span
            class="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground"
            data-testid="welcome-header-hint"
          >
            <ShieldCheck class="size-3 shrink-0" />
            <span class="hidden sm:inline">Encrypted in your browser</span>
            <span class="sm:hidden">Encrypted locally</span>
          </span>
        {/if}
      </div>
    </div>
  </header>

  <div
    class="mx-auto px-4 sm:px-6 {shellWidth} {vault.isAuthenticated
      ? 'py-8 pb-24'
      : 'py-5 sm:py-6'}"
  >
    {#if vault.isAuthenticated}
      {#if vault.settingsOpen}
        <div data-testid="storage-settings-panel" class="w-full">
          <AuthStorage
            providers={vault.providers}
            activeProviderId={vault.activeProviderId}
            isAuthenticated={vault.isAuthenticated}
            isVerifying={vault.isVerifying}
            isSaving={vault.isSaving}
            isInitializing={vault.isInitializing}
            errorMsg={vault.errorMsg}
            successMsg={vault.successMsg}
            deviceId={vault.deviceId}
            devicePublicKey={vault.devicePublicKey}
            pendingJoins={vault.pendingJoins}
            vaultMembers={vault.vaultMembers}
            onReconnect={handleUnlock}
            onSelectProvider={(id) => vault.selectProvider(id)}
            onApproveJoin={(id) => vault.approveJoin(id)}
            onRefreshJoins={() => vault.manualSync()}
            bind:githubRepo={vault.githubRepo}
          />
        </div>
      {:else}
        <PendingJoinsBanner
          pendingJoins={vault.pendingJoins}
          isBusy={vault.isSaving || vault.isVerifying}
          onApproveJoin={(id) => vault.approveJoin(id)}
          onRefresh={() => vault.manualSync()}
        />
        <SecretVault
          isSaving={vault.isSaving}
          secrets={vault.secrets}
          onAddSecret={(key, value) => vault.handleAddSecret(key, value)}
          onDeleteSecret={(key) => vault.handleDeleteSecret(key)}
          onGeneratePassword={(
            length,
            lowercase,
            uppercase,
            numbers,
            symbols,
          ) =>
            vault.generatePassword(
              length,
              lowercase,
              uppercase,
              numbers,
              symbols,
            )}
        />
      {/if}
    {:else if vault.providersLoaded}
      <LoginGate
        providers={vault.providers}
        activeProviderId={vault.activeProviderId}
        bind:setupType={vault.loginSetupType}
        bind:githubPat={vault.githubPat}
        bind:githubRepo={vault.githubRepo}
        addProviderOpen={vault.addProviderOpen}
        isVerifying={vault.isVerifying}
        isInitializing={vault.isInitializing}
        errorMsg={vault.errorMsg}
        successMsg={vault.successMsg}
        onUnlock={handleUnlock}
        onSelectProvider={(id) => vault.selectProvider(id)}
        onBeginAddProvider={() => vault.beginAddProvider()}
        onCancelAddProvider={() => vault.cancelAddProvider()}
        onBeginSetup={(type) => vault.beginProviderSetup(type)}
        onCancelSetup={() => vault.cancelProviderSetup()}
      />
    {/if}
  </div>

  {#if vault.isAuthenticated}
    <VaultStatusBar
      storageMode={vault.storageMode}
      githubRepo={vault.githubRepo}
      lastSyncedAt={vault.lastSyncedAt}
      isSyncing={vault.isSyncing || vault.isSaving}
      successMsg={vault.successMsg}
      errorMsg={vault.errorMsg}
      onRefresh={() => vault.manualSync()}
      onDismissSuccess={() => vault.dismissSuccess()}
      onDismissError={() => vault.dismissError()}
    />
  {/if}

  <JoinEnrollmentDialog
    open={vault.joinEnrollmentPrompt !== 'none'}
    variant={vault.joinEnrollmentPrompt === 'pending'
      ? 'pending'
      : 'needs_request'}
    deviceId={vault.deviceId}
    isBusy={vault.isVerifying}
    bind:enrollSecretsKey={vault.enrollSecretsKey}
    bind:enrollMembersKey={vault.enrollMembersKey}
    onConfirm={() => vault.confirmJoinRequest()}
    onEnrollWithKeys={() => vault.enrollAndConnect()}
    onCreateFreshVault={() => vault.createFreshVault()}
    onCancel={() => vault.dismissJoinEnrollment()}
  />
</main>
