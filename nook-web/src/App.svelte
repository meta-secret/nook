<script lang="ts">
  import { onMount } from 'svelte'
  import { ArrowLeft, BookOpen, GitFork, Moon, Sun } from '@lucide/svelte'
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

  async function handleProviderReconnect(id: string) {
    await vault.selectProvider(id)
    await vault.loadDb()
  }

  function toggleColorMode() {
    colorMode = colorMode === 'dark' ? 'light' : 'dark'
    localStorage.setItem(THEME_STORAGE_KEY, colorMode)
  }

  const shellWidth = 'max-w-xl'
  const appVersion = '0.1.0'
</script>

<main
  class="min-h-svh bg-background text-foreground"
  class:dark={colorMode === 'dark'}
>
  <header
    class="border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-40"
  >
    <div
      class="mx-auto flex items-center justify-between gap-4 px-4 py-2 sm:px-6 {vault.helpOpen
        ? 'max-w-5xl'
        : shellWidth}"
    >
      <div class="flex min-w-0 items-center gap-3">
        <div
          class="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/80 bg-card shadow-xs dark:border-transparent"
        >
          <img
            src="/nook-logo.png"
            alt="Nook logo"
            class="size-full object-contain"
          />
        </div>
      </div>

      <div class="flex items-center gap-2">
        {#if vault.isAuthenticated && !vault.helpOpen}
          {#if vault.settingsOpen}
            <Button
              variant="outline"
              size="sm"
              class="h-10 rounded-lg border-border px-3.5 text-sm text-muted-foreground"
              data-testid="storage-settings-close"
              onclick={() => vault.closeSettings()}
            >
              Back to vault
            </Button>
          {:else}
            <button
              type="button"
              onclick={() => vault.openSettings()}
              class="relative inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
        {/if}

        {#if vault.isAuthenticated && !vault.helpOpen}
          <span class="mx-0.5 h-4 border-l border-border" aria-hidden="true"
          ></span>
        {/if}

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
          <GitFork class="size-4" />
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
    class="mx-auto px-4 sm:px-6 {vault.helpOpen
      ? 'max-w-5xl'
      : shellWidth} {vault.isAuthenticated ? 'py-8' : 'py-5 sm:py-6'}"
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
