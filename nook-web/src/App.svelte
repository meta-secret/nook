<script lang="ts">
  import { onMount } from 'svelte'
  import { ArrowLeft, BookOpen, Moon, Sun } from '@lucide/svelte'
  import { VaultState } from '$lib/vault.svelte'
  import VaultSettingsAccordion from '$lib/components/settings/VaultSettingsAccordion.svelte'
  import VaultBottomNav from '$lib/components/VaultBottomNav.svelte'
  import HelpPage from '$lib/components/HelpPage.svelte'
  import LoginGate from '$lib/components/LoginGate.svelte'
  import JoinEnrollmentDialog from '$lib/components/JoinEnrollmentDialog.svelte'
  import PendingJoinsBanner from '$lib/components/PendingJoinsBanner.svelte'
  import SecretVault from '$lib/components/SecretVault.svelte'
  import VaultStatusBar from '$lib/components/VaultStatusBar.svelte'
  import NookLogo from '$lib/components/NookLogo.svelte'
  import { Button } from '$lib/components/ui/button'

  const vault = new VaultState()
  type ColorMode = 'light' | 'dark'
  const THEME_STORAGE_KEY = 'nook_color_mode'
  let colorMode = $state<ColorMode>('dark')

  onMount(() => {
    const savedMode = localStorage.getItem(THEME_STORAGE_KEY)
    if (savedMode === 'light' || savedMode === 'dark') {
      colorMode = savedMode
    }
    void vault.init()
    return () => vault.stopVaultSync()
  })

  async function handleUnlock() {
    await vault.loadDb()
  }

  async function handleLoginProviderSelect(id: string) {
    await vault.selectLoginProvider(id)
  }

  async function handleLoginProviderConnect() {
    await vault.connectLoginProvider()
  }

  async function handleProviderReconnect(id: string) {
    await vault.selectProvider(id)
    await vault.loadDb()
  }

  function toggleColorMode() {
    colorMode = colorMode === 'dark' ? 'light' : 'dark'
    localStorage.setItem(THEME_STORAGE_KEY, colorMode)
  }

  const compactShellWidth = 'max-w-5xl'
  const authenticatedShellWidth = 'max-w-5xl'
  const shellWidth = $derived(
    vault.isAuthenticated ? authenticatedShellWidth : compactShellWidth,
  )
  const appVersion = '0.1.0'
  let secretsAddOpen = $state(false)
</script>

<main
  class="min-h-svh bg-background text-foreground"
  class:dark={colorMode === 'dark'}
>
  <header
    class="border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-40"
  >
    <div
      class="mx-auto flex items-center justify-between gap-4 px-4 py-2 sm:px-6 {shellWidth}"
    >
      <div class="flex min-w-0 items-center gap-3">
        <NookLogo {colorMode} size="sm" class="rounded-lg overflow-hidden" />
      </div>

      <div class="flex items-center gap-2">
        <button
          type="button"
          class="inline-flex size-10 items-center justify-center rounded-lg border border-border bg-background/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={colorMode === 'dark'
            ? 'Switch to light mode'
            : 'Switch to dark mode'}
          title={colorMode === 'dark'
            ? 'Switch to light mode'
            : 'Switch to dark mode'}
          data-testid="theme-toggle-btn"
          onclick={toggleColorMode}
        >
          {#if colorMode === 'dark'}
            <Sun class="size-4" />
          {:else}
            <Moon class="size-4" />
          {/if}
        </button>

        <a
          href="https://github.com/meta-secret/nook"
          target="_blank"
          rel="noreferrer"
          class="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground {vault.isAuthenticated
            ? 'w-10'
            : 'px-3.5'}"
          aria-label="Nook on GitHub — open source"
          title="Nook is open source on GitHub"
          data-testid="github-source-link"
        >
          <svg
            class="size-4"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              d="M12 2C6.48 2 2 6.59 2 12.25c0 4.52 2.86 8.36 6.84 9.72.5.09.68-.22.68-.49 0-.24-.01-.89-.01-1.75-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.36 1.12 2.93.86.09-.67.35-1.12.64-1.38-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.32 9.32 0 0 1 12 6.98c.85 0 1.71.12 2.51.35 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.07.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.59.69.49A10.13 10.13 0 0 0 22 12.25C22 6.59 17.52 2 12 2Z"
            />
          </svg>
          <span class={vault.isAuthenticated ? 'sr-only' : 'hidden sm:inline'}
            >GitHub</span
          >
        </a>

        {#if vault.helpOpen}
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="h-10 rounded-lg border-border px-3.5 text-sm text-muted-foreground [&_svg]:size-4"
            data-testid="help-header-close"
            onclick={() => vault.closeHelp()}
          >
            <ArrowLeft class="size-4" />
            <span class="hidden sm:inline">Back</span>
          </Button>
        {:else}
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="h-10 rounded-lg border-border px-3.5 text-sm text-muted-foreground [&_svg]:size-4"
            data-testid="help-open-btn"
            onclick={() => vault.openHelp()}
          >
            <BookOpen class="size-4" />
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
      <div class="space-y-4">
        <HelpPage onClose={() => vault.closeHelp()} />
        <VaultStatusBar
          storageMode={vault.storageMode}
          githubRepo={vault.githubRepo}
          lastSyncedAt={vault.lastSyncedAt}
          isSyncing={vault.isSyncing || vault.isSaving}
          successMsg={vault.successMsg}
          errorMsg={vault.errorMsg}
          {appVersion}
          label={vault.isAuthenticated ? undefined : 'Nook'}
          showSyncStatus={vault.isAuthenticated}
          showStorageIcon={vault.isAuthenticated}
          onDismissSuccess={() => vault.dismissSuccess()}
          onDismissError={() => vault.dismissError()}
        />
      </div>
    {:else if vault.isAuthenticated}
      <div
        class="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
      >
        <div class="space-y-4 p-4 sm:p-5">
          {#if vault.settingsOpen}
            <VaultSettingsAccordion
              providers={vault.providers}
              activeProviderId={vault.activeProviderId}
              isAuthenticated={vault.isAuthenticated}
              isVerifying={vault.isVerifying}
              isSaving={vault.isSaving}
              isInitializing={vault.isInitializing}
              addProviderOpen={vault.addProviderOpen}
              bind:setupType={vault.loginSetupType}
              bind:githubPat={vault.githubPat}
              bind:githubRepo={vault.githubRepo}
              passwordEntries={vault.passwordEntries}
              isPasswordBusy={vault.isPasswordBusy}
              passwordError={vault.passwordError}
              enrollmentCode={vault.enrollmentCode}
              deviceId={vault.deviceId}
              devicePublicKey={vault.devicePublicKey}
              pendingJoins={vault.pendingJoins}
              vaultMembers={vault.vaultMembers}
              onReconnect={handleUnlock}
              onSelectProvider={handleProviderReconnect}
              onBeginAddProvider={() => vault.beginAddProvider()}
              onCancelAddProvider={() => vault.cancelAddProvider()}
              onBeginSetup={(type) => vault.beginProviderSetup(type)}
              onCancelSetup={() => vault.cancelProviderSetup()}
              onRemoveProvider={(id) => vault.removeProvider(id)}
              onLockVault={() => vault.lockVault()}
              onAddPassword={(label, pw) => vault.addVaultPassword(label, pw)}
              onUpdatePassword={(id, pw) =>
                vault.updateVaultPasswordEntry(id, pw)}
              onRemovePassword={(id) => vault.removeVaultPasswordEntry(id)}
              onIssueCode={(id, pw) => vault.issueEnrollmentCode(id, pw)}
              onClearCode={() => vault.clearEnrollmentCode()}
              onApproveJoin={(id) => vault.approveJoin(id)}
            />
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
              onAddModeChange={(open) => {
                secretsAddOpen = open
              }}
              onAddSecret={(id, type, data) =>
                vault.handleAddSecret(id, type, data)}
              onDeleteSecret={(id) => vault.handleDeleteSecret(id)}
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
          {appVersion}
          onRefresh={() => vault.manualSync()}
          onDismissSuccess={() => vault.dismissSuccess()}
          onDismissError={() => vault.dismissError()}
        />
        {#if !secretsAddOpen}
          <VaultBottomNav
            settingsOpen={vault.settingsOpen}
            pendingJoinCount={vault.pendingJoins.length}
            onSelectSecrets={() => vault.closeSettings()}
            onSelectSettings={() => vault.openSettings()}
          />
        {/if}
      </div>
    {:else if vault.providersLoaded}
      <div class="space-y-4">
        <LoginGate
          providers={vault.providers}
          activeProviderId={vault.activeProviderId}
          loginFlowStep={vault.loginFlowStep}
          loginPasswordPrompt={vault.loginPasswordPrompt}
          passwordEntries={vault.passwordEntries}
          bind:selectedPasswordEntryId={vault.selectedPasswordEntryId}
          bind:setupType={vault.loginSetupType}
          bind:githubPat={vault.githubPat}
          bind:githubRepo={vault.githubRepo}
          addProviderOpen={vault.addProviderOpen}
          isVerifying={vault.isVerifying}
          isInitializing={vault.isInitializing}
          onUnlock={handleUnlock}
          onSelectProvider={handleLoginProviderSelect}
          onConnectProvider={handleLoginProviderConnect}
          onBackToLoginProvider={() => vault.backToLoginProviderStep()}
          onBeginAddProvider={() => vault.beginAddProvider()}
          onCancelAddProvider={() => vault.cancelAddProvider()}
          onBeginSetup={(type) => vault.beginProviderSetup(type)}
          onCancelSetup={() => vault.cancelProviderSetup()}
          onOpenHelp={() => vault.openHelp()}
          onUseEnrollmentCode={(code) => vault.connectWithEnrollmentCode(code)}
          onUnlockWithPassword={(entryId, password) =>
            vault.unlockWithPassword(entryId, password)}
          onRemoveProvider={(id) => vault.removeProvider(id)}
          onConsumeLoginPasswordPrompt={() => vault.clearLoginPasswordPrompt()}
        />
        <VaultStatusBar
          storageMode={vault.storageMode}
          githubRepo={vault.githubRepo}
          lastSyncedAt={vault.lastSyncedAt}
          isSyncing={vault.isSyncing || vault.isSaving}
          successMsg={vault.successMsg}
          errorMsg={vault.errorMsg}
          {appVersion}
          label="Nook"
          showSyncStatus={false}
          showStorageIcon={false}
          onDismissSuccess={() => vault.dismissSuccess()}
          onDismissError={() => vault.dismissError()}
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
