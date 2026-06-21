<script lang="ts">
  import { onMount } from 'svelte'
  import { Lock, ShieldCheck, TriangleAlert, Settings, X } from '@lucide/svelte'
  import { VaultState } from '$lib/vault.svelte'
  import AuthStorage from '$lib/components/AuthStorage.svelte'
  import LoginGate from '$lib/components/LoginGate.svelte'
  import JoinEnrollmentDialog from '$lib/components/JoinEnrollmentDialog.svelte'
  import PendingJoinsBanner from '$lib/components/PendingJoinsBanner.svelte'
  import SecretVault from '$lib/components/SecretVault.svelte'
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
              class="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              data-testid="storage-status-chip"
            >
              {vault.activeProviderLabel}
            </button>
            <Button
              variant="outline"
              size="icon"
              class="relative shrink-0 border-border"
              aria-label="Storage settings"
              data-testid="storage-settings-btn"
              onclick={() => vault.openSettings()}
            >
              <Settings class="size-4" />
              {#if vault.pendingJoins.length > 0}
                <span
                  class="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground"
                  data-testid="pending-joins-badge"
                >
                  {vault.pendingJoins.length}
                </span>
              {/if}
            </Button>
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
      ? 'py-8'
      : 'py-5 sm:py-6'}"
  >
    {#if vault.errorMsg && vault.isAuthenticated}
      <div
        class="mb-6 flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive animate-in fade-in slide-in-from-top-2"
        role="alert"
      >
        <TriangleAlert class="size-5 shrink-0 text-destructive mt-0.5" />
        <div class="flex-1 min-w-0">
          <p class="font-semibold">Action Failed</p>
          <p class="mt-1 text-destructive/90">{vault.errorMsg}</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-md p-1 text-destructive/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
          aria-label="Dismiss error"
          data-testid="dismiss-error-btn"
          onclick={() => vault.dismissError()}
        >
          <X class="size-4" />
        </button>
      </div>
    {/if}

    {#if vault.successMsg && vault.isAuthenticated}
      <div
        class="mb-6 flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/10 p-4 text-sm text-primary animate-in fade-in slide-in-from-top-2"
        role="status"
        data-testid="app-success"
      >
        <ShieldCheck class="size-5 shrink-0 text-primary mt-0.5" />
        <div class="flex-1 min-w-0">
          <p class="font-semibold">Success</p>
          <p class="mt-1 text-primary/90">{vault.successMsg}</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-md p-1 text-primary/70 transition-colors hover:bg-primary/10 hover:text-primary"
          aria-label="Dismiss success"
          data-testid="dismiss-success-btn"
          onclick={() => vault.dismissSuccess()}
        >
          <X class="size-4" />
        </button>
      </div>
    {/if}

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
            secretsCount={vault.secrets.length}
            deviceId={vault.deviceId}
            devicePublicKey={vault.devicePublicKey}
            pendingJoins={vault.pendingJoins}
            vaultMembers={vault.vaultMembers}
            onReconnect={handleUnlock}
            onSelectProvider={(id) => vault.selectProvider(id)}
            onInitializeEmpty={() => vault.handleInitializeEmpty()}
            onApproveJoin={(id) => vault.approveJoin(id)}
            onRefreshJoins={() => vault.refreshDeviceState()}
          />
        </div>
      {:else}
        <PendingJoinsBanner
          pendingJoins={vault.pendingJoins}
          isBusy={vault.isSaving || vault.isVerifying}
          onApproveJoin={(id) => vault.approveJoin(id)}
          onRefresh={() => vault.refreshDeviceState()}
        />
        <SecretVault
          isSaving={vault.isSaving}
          secretsCount={vault.secrets.length}
          storageMode={vault.storageMode}
          onAddSecret={(key, value) => vault.handleAddSecret(key, value)}
          onDeleteSecret={(key) => vault.handleDeleteSecret(key)}
          onFilterSecrets={(query) => vault.filterSecrets(query)}
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
        addProviderOpen={vault.addProviderOpen}
        isVerifying={vault.isVerifying}
        isSaving={vault.isSaving}
        isInitializing={vault.isInitializing}
        errorMsg={vault.errorMsg}
        successMsg={vault.successMsg}
        onUnlock={handleUnlock}
        onSelectProvider={(id) => vault.selectProvider(id)}
        onBeginAddProvider={() => vault.beginAddProvider()}
        onCancelAddProvider={() => vault.cancelAddProvider()}
        onBeginSetup={(type) => vault.beginProviderSetup(type)}
        onCancelSetup={() => vault.cancelProviderSetup()}
        onInitializeEmpty={() => vault.handleInitializeEmpty()}
      />
    {/if}
  </div>

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
    onCancel={() => vault.dismissJoinEnrollment()}
  />
</main>
