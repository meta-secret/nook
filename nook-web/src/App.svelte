<script lang="ts">
  import { onMount } from 'svelte'
  import { BookOpen, Lock, ShieldCheck } from '@lucide/svelte'
  import { VaultState } from '$lib/vault.svelte'
  import AuthStorage from '$lib/components/AuthStorage.svelte'
  import HelpPage from '$lib/components/HelpPage.svelte'
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

  async function handleProviderReconnect(id: string) {
    await vault.selectProvider(id)
    await vault.loadDb()
  }

  const shellWidth = 'max-w-xl'
</script>

<main class="dark min-h-svh bg-background text-foreground">
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
        {#if vault.helpOpen}
          <span class="text-xs font-medium text-muted-foreground">Help</span>
        {:else if vault.isAuthenticated}
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
        {#if !vault.helpOpen}
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="border-border"
            data-testid="help-open-btn"
            onclick={() => vault.openHelp()}
          >
            <BookOpen class="size-3.5" />
            <span class="hidden sm:inline">Help</span>
          </Button>
        {/if}
      </div>
    </div>
  </header>

  <div
    class="mx-auto px-4 sm:px-6 {shellWidth} {vault.isAuthenticated
      ? 'py-8'
      : 'py-5 sm:py-6'}"
  >
    {#if vault.helpOpen}
      <HelpPage onClose={() => vault.closeHelp()} />
    {:else if vault.isAuthenticated}
      <div
        class="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
      >
        <div class="space-y-4 p-4 sm:p-5">
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
                deviceId={vault.deviceId}
                devicePublicKey={vault.devicePublicKey}
                pendingJoins={vault.pendingJoins}
                vaultMembers={vault.vaultMembers}
                addProviderOpen={vault.addProviderOpen}
                bind:setupType={vault.loginSetupType}
                bind:githubPat={vault.githubPat}
                bind:githubRepo={vault.githubRepo}
                onReconnect={handleUnlock}
                onSelectProvider={handleProviderReconnect}
                onBeginAddProvider={() => vault.beginAddProvider()}
                onCancelAddProvider={() => vault.cancelAddProvider()}
                onBeginSetup={(type) => vault.beginProviderSetup(type)}
                onCancelSetup={() => vault.cancelProviderSetup()}
                onApproveJoin={(id) => vault.approveJoin(id)}
                onRefreshJoins={() => vault.manualSync()}
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
              onAddSecret={(key, type, value) =>
                vault.handleAddSecret(key, type, value)}
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
        </div>
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
      </div>
    {:else if vault.providersLoaded}
      <div class="space-y-4">
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
          onSelectProvider={handleProviderReconnect}
          onBeginAddProvider={() => vault.beginAddProvider()}
          onCancelAddProvider={() => vault.cancelAddProvider()}
          onBeginSetup={(type) => vault.beginProviderSetup(type)}
          onCancelSetup={() => vault.cancelProviderSetup()}
          onOpenHelp={() => vault.openHelp()}
        />
      </div>
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
    onCreateFreshVault={() => vault.createFreshVault()}
    onCancel={() => vault.dismissJoinEnrollment()}
  />
</main>
