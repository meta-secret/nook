<script lang="ts">
  import { onMount } from 'svelte'
  import {
    ArrowLeft,
    BookOpen,
    FolderKey,
    Lock,
    Moon,
    Sun,
  } from '@lucide/svelte'
  import { VaultState } from '$lib/vault.svelte'
  import { loadAuthProviders, saveAuthProviders } from '$lib/auth-providers'
  import VaultSettingsAccordion from '$lib/components/settings/VaultSettingsAccordion.svelte'
  import VaultBottomNav from '$lib/components/VaultBottomNav.svelte'
  import HelpPage from '$lib/components/HelpPage.svelte'
  import LegalDocumentPage from '$lib/components/LegalDocumentPage.svelte'
  import LogsPage from '$lib/components/LogsPage.svelte'
  import AppLogsApiPage from '$lib/components/AppLogsApiPage.svelte'
  import SiteFooter from '$lib/components/SiteFooter.svelte'
  import LoginGate from '$lib/components/LoginGate.svelte'
  import JoinEnrollmentDialog from '$lib/components/JoinEnrollmentDialog.svelte'
  import VaultSyncConflictDialog from '$lib/components/VaultSyncConflictDialog.svelte'
  import PendingJoinsBanner from '$lib/components/PendingJoinsBanner.svelte'
  import LocalOnlyVaultWarningBanner from '$lib/components/LocalOnlyVaultWarningBanner.svelte'
  import SecretVault from '$lib/components/SecretVault.svelte'
  import OnboardDevice from '$lib/components/OnboardDevice.svelte'
  import VaultStatusBar from '$lib/components/VaultStatusBar.svelte'
  import NookLogo from '$lib/components/NookLogo.svelte'
  import HeaderLanguageSelect from '$lib/components/HeaderLanguageSelect.svelte'
  import { Button } from '$lib/components/ui/button'
  import {
    appPath,
    getLegalPageFromPath,
    isLogsPath,
    legalPageForId,
    type LegalPageId,
  } from '$lib/legal-content'
  import { isAppLogsPath } from '$lib/app-logs-api'
  import type { VaultItemType } from '$lib/nook'

  const vault = new VaultState()
  type ColorMode = 'light' | 'dark'
  const THEME_STORAGE_KEY = 'nook_color_mode'
  let colorMode = $state<ColorMode>('dark')
  let legalPage = $state<LegalPageId | null>(
    typeof window !== 'undefined'
      ? getLegalPageFromPath(window.location.pathname)
      : null,
  )
  let logsPage = $state<boolean>(
    typeof window !== 'undefined'
      ? isLogsPath(window.location.pathname)
      : false,
  )
  let appLogsPage = $state<boolean>(
    typeof window !== 'undefined'
      ? isAppLogsPath(window.location.pathname)
      : false,
  )

  function syncRoute() {
    legalPage = getLegalPageFromPath(window.location.pathname)
    logsPage = isLogsPath(window.location.pathname)
    appLogsPage = isAppLogsPath(window.location.pathname)
  }

  function navigateHome() {
    vault.closeHelp()
    history.pushState(null, '', appPath('/'))
    legalPage = null
    logsPage = false
    appLogsPage = false
  }

  onMount(() => {
    const savedMode = localStorage.getItem(THEME_STORAGE_KEY)
    if (savedMode === 'light' || savedMode === 'dark') {
      colorMode = savedMode
    }
    void vault.init()

    if (
      import.meta.env.DEV ||
      import.meta.env.VITE_E2E_EXPOSE_VAULT === 'true'
    ) {
      ;(window as Window & { __nookVault?: VaultState }).__nookVault = vault
      ;(
        window as Window & {
          __nookAuthProviders?: {
            loadAuthProviders: typeof loadAuthProviders
            saveAuthProviders: typeof saveAuthProviders
          }
        }
      ).__nookAuthProviders = {
        loadAuthProviders,
        saveAuthProviders,
      }
    }

    syncRoute()
    window.addEventListener('popstate', syncRoute)

    return () => {
      vault.stopVaultSync()
      vault.stopIdleSessionTracking()
      window.removeEventListener('popstate', syncRoute)
    }
  })

  $effect(() => {
    if (legalPage) {
      document.title = `${legalPageForId(legalPage).title} · Nook`
      return
    }
    if (logsPage) {
      document.title = 'Application logs · Nook'
      return
    }
    document.title = 'Nook'
  })

  async function handleUnlock() {
    if (vault.loginSetupType) {
      await vault.connectStagedProvider()
      return
    }
    await vault.loadDb()
  }

  async function handleSettingsReconnect() {
    if (vault.loginSetupType) {
      await vault.connectAndSyncStagedProvider()
      return
    }
    await vault.manualSync()
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
  let secretsAddFormType = $state<VaultItemType | null>(null)
  const secretsNoteEditorOpen = $derived(
    secretsAddOpen && secretsAddFormType === 'secure-note',
  )
  const authenticatedShellSpacing = $derived(
    secretsAddOpen ? 'py-4 sm:py-8' : 'pb-28 pt-4 sm:py-8',
  )
  const authenticatedShellSize = $derived(
    secretsAddOpen
      ? 'min-h-[calc(100svh-5rem)] sm:min-h-0 sm:h-[min(40rem,calc(100svh-7rem))]'
      : 'min-h-[calc(100svh-11rem)] sm:min-h-0 sm:h-[min(40rem,calc(100svh-7rem))]',
  )
</script>

{#if appLogsPage}
  <AppLogsApiPage />
{:else}
  <main
    class="min-h-svh bg-background text-foreground"
    class:dark={colorMode === 'dark'}
  >
    <header
      class="border-b border-border/50 bg-card/80 backdrop-blur-md sticky top-0 z-40"
    >
      <div
        class="mx-auto flex items-center justify-between gap-4 px-4 py-2 sm:px-6 {shellWidth}"
      >
        <div class="flex min-w-0 items-center gap-3">
          <NookLogo {colorMode} size="sm" class="rounded-lg overflow-hidden" />
        </div>

        <div class="flex items-center gap-2">
          {#if vault.isAuthenticated && !vault.helpOpen && !legalPage}
            {#if vault.hasMultipleLocalVaults}
              <Button
                type="button"
                variant="outline"
                size="sm"
                class="h-10 rounded-lg border-border/40 bg-background/60 px-3.5 text-sm text-muted-foreground sm:bg-background [&_svg]:size-4"
                data-testid="header-switch-vault-btn"
                title={vault.t('common.switch_vault')}
                disabled={vault.isVerifying || vault.isInitializing}
                onclick={() => vault.lockVault()}
              >
                <FolderKey class="size-4" />
                <span class="hidden sm:inline"
                  >{vault.t('common.switch_vault')}</span
                >
              </Button>
            {/if}
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="h-10 rounded-lg border-border/40 bg-background/60 px-3.5 text-sm text-muted-foreground sm:bg-background [&_svg]:size-4"
              data-testid="header-lock-vault-btn"
              title={vault.t('session.lock_desc')}
              disabled={vault.isVerifying || vault.isInitializing}
              onclick={() => vault.lockVault()}
            >
              <Lock class="size-4" />
              <span class="hidden sm:inline"
                >{vault.t('common.lock_vault')}</span
              >
            </Button>
            <div
              class="mx-0.5 h-6 w-px shrink-0 bg-border/60"
              aria-hidden="true"
            ></div>
          {/if}

          <HeaderLanguageSelect {vault} />

          <button
            type="button"
            class="inline-flex size-10 items-center justify-center rounded-lg border border-border/40 bg-background/60 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:bg-background/70"
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
            class="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border/40 bg-background/60 px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:bg-background {vault.isAuthenticated
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

          {#if legalPage || logsPage}
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="h-10 rounded-lg border-border/40 bg-background/60 px-3.5 text-sm text-muted-foreground sm:bg-background [&_svg]:size-4"
              data-testid="legal-header-back"
              onclick={navigateHome}
            >
              <ArrowLeft class="size-4" />
              <span class="hidden sm:inline">Back</span>
            </Button>
          {:else if vault.helpOpen}
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="h-10 rounded-lg border-border/40 bg-background/60 px-3.5 text-sm text-muted-foreground sm:bg-background [&_svg]:size-4"
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
              class="h-10 rounded-lg border-border/40 bg-background/60 px-3.5 text-sm text-muted-foreground sm:bg-background [&_svg]:size-4"
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
      class="mx-auto px-4 sm:px-6 {shellWidth} {legalPage || logsPage
        ? 'py-5 sm:py-6'
        : vault.isAuthenticated
          ? authenticatedShellSpacing
          : 'py-5 sm:py-6'}"
    >
      {#if logsPage}
        <LogsPage onClose={navigateHome} />
      {:else if legalPage}
        <LegalDocumentPage pageId={legalPage} onClose={navigateHome} />
      {:else if vault.helpOpen}
        <div class="space-y-4">
          <HelpPage onClose={() => vault.closeHelp()} {colorMode} />
          <VaultStatusBar
            {vault}
            storageMode={vault.storageMode}
            githubRepo={vault.githubRepo}
            lastSyncedAt={vault.lastSyncedAt}
            isSyncing={vault.isSyncActivityVisible}
            successMsg={vault.successMsg}
            errorMsg={vault.errorMsg}
            {appVersion}
            label={vault.isAuthenticated ? undefined : 'Nook'}
            showSyncStatus={vault.isAuthenticated}
            showStorageIcon={vault.isAuthenticated}
            variant={vault.isAuthenticated ? 'panel' : 'quiet'}
            onDismissSuccess={() => vault.dismissSuccess()}
            onDismissError={() => vault.dismissError()}
          />
        </div>
      {:else if vault.isAuthenticated}
        <div
          class="flex w-full {authenticatedShellSize} flex-col overflow-hidden rounded-xl bg-card shadow-sm sm:border sm:border-border/60"
          data-testid="authenticated-shell"
        >
          <div
            class="shell-scroll min-h-0 min-w-0 flex-1 flex flex-col {secretsNoteEditorOpen
              ? 'overflow-hidden'
              : 'overflow-y-auto'}"
          >
            <div
              class="p-4 sm:p-5 {vault.settingsOpen
                ? 'space-y-4'
                : 'flex min-h-0 flex-1 flex-col gap-4'}"
            >
              {#if vault.syncProviders.length === 0}
                <LocalOnlyVaultWarningBanner
                  {vault}
                  onAddSyncProvider={() =>
                    vault.openSettings('storage', 'storage')}
                />
              {/if}
              {#if vault.settingsOpen && vault.settingsSection === 'onboard'}
                <OnboardDevice
                  {vault}
                  syncProviders={vault.syncProviders}
                  passwordEntries={vault.passwordEntries}
                  enrollmentCode={vault.enrollmentCode}
                  isBusy={vault.isPasswordBusy}
                  onIssueCode={(entryId, pw, providerId) =>
                    vault.issueEnrollmentCode(entryId, pw, providerId)}
                  onClearCode={() => vault.clearEnrollmentCode()}
                  onOpenStorageSettings={() =>
                    vault.openSettings('storage', 'storage')}
                  onOpenPasswordSettings={() =>
                    vault.openSettings('storage', 'passwords')}
                />
              {:else if vault.settingsOpen}
                <VaultSettingsAccordion
                  {vault}
                  bind:accordionSection={vault.settingsAccordionSection}
                  syncProviders={vault.syncProviders}
                  syncingProviderId={vault.syncingProviderId}
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
                  hasPasswordEnvelope={vault.hasPasswordEnvelope}
                  onReconnect={handleSettingsReconnect}
                  onSyncProvider={(id) => vault.syncProviderById(id)}
                  onBeginAddProvider={() => vault.beginAddProvider()}
                  onCancelAddProvider={() => vault.cancelAddProvider()}
                  onBeginSetup={(type, preset) =>
                    vault.beginProviderSetup(type, preset)}
                  onCancelSetup={() => vault.cancelProviderSetup()}
                  onRemoveProvider={(id) => vault.removeProvider(id)}
                  onAddPassword={(label, pw) =>
                    vault.addVaultPassword(label, pw)}
                  onUpdatePassword={(id, pw) =>
                    vault.updateVaultPasswordEntry(id, pw)}
                  onRemovePassword={(id) => vault.removeVaultPasswordEntry(id)}
                  onIssueCode={(id, pw) => vault.issueEnrollmentCode(id, pw)}
                  onClearCode={() => vault.clearEnrollmentCode()}
                  onApproveJoin={(id) => vault.approveJoin(id)}
                  onDenyJoin={(id) => vault.denyJoin(id)}
                  onRenameDevice={(id, label) => vault.renameDevice(id, label)}
                  onRevokeDevice={(id) => vault.revokeDevice(id)}
                />
              {:else}
                {#if !secretsNoteEditorOpen}
                  <PendingJoinsBanner
                    {vault}
                    pendingJoins={vault.pendingJoins}
                    isBusy={vault.isSaving || vault.isVerifying}
                    onApproveJoin={(id) => vault.approveJoin(id)}
                    onRefresh={() => vault.manualSync()}
                    onOpenDevicesSettings={() =>
                      vault.openSettings('storage', 'devices')}
                  />
                {/if}
                <div class="flex min-h-0 flex-1 flex-col">
                  <SecretVault
                    {vault}
                    isSaving={vault.isSaving}
                    syncBlocked={vault.syncBlocked}
                    secrets={vault.secrets}
                    onAddModeChange={(open, type = null) => {
                      secretsAddOpen = open
                      secretsAddFormType = type
                    }}
                    onAddSecret={(id, type, data) =>
                      vault.handleAddSecret(id, type, data)}
                    onReplaceSecret={(oldId, type, data) =>
                      vault.handleReplaceSecret(oldId, type, data)}
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
                </div>
              {/if}
            </div>
          </div>
          <div class="shrink-0">
            <VaultStatusBar
              {vault}
              storageMode={vault.storageMode}
              githubRepo={vault.githubRepo}
              lastSyncedAt={vault.lastSyncedAt}
              isSyncing={vault.isSyncActivityVisible}
              successMsg={vault.successMsg}
              errorMsg={vault.errorMsg}
              syncConflictLabel={vault.pendingSyncConflict
                ? vault.pendingSyncConflict.kind === 'store_id'
                  ? vault.t('auth_storage.sync_conflict_store_id_banner', {
                      provider: vault.pendingSyncConflict.providerLabel,
                    })
                  : vault.t('auth_storage.sync_conflict_banner', {
                      provider: vault.pendingSyncConflict.providerLabel,
                    })
                : ''}
              {appVersion}
              onRefresh={() => vault.manualSync()}
              onDismissSuccess={() => vault.dismissSuccess()}
              onDismissError={() => vault.dismissError()}
            />
            {#if !secretsAddOpen}
              <VaultBottomNav
                {vault}
                settingsOpen={vault.settingsOpen}
                settingsSection={vault.settingsSection}
                onSelectSecrets={() => vault.closeSettings()}
                onSelectOnboard={() => vault.openSettings('onboard')}
                onSelectSettings={() => vault.openSettings()}
              />
            {/if}
          </div>
        </div>
      {:else if vault.providersLoaded}
        <div class="space-y-4">
          <LoginGate
            {vault}
            providers={vault.providers}
            bind:setupType={vault.loginSetupType}
            bind:githubPat={vault.githubPat}
            bind:githubRepo={vault.githubRepo}
            addProviderOpen={vault.addProviderOpen}
            isVerifying={vault.isVerifying}
            isInitializing={vault.isInitializing}
            onUnlock={handleUnlock}
            onBeginAddProvider={() => vault.beginAddProvider()}
            onCancelAddProvider={() => vault.cancelAddProvider()}
            onBeginSetup={(type, preset) =>
              vault.beginProviderSetup(type, preset)}
            onCancelSetup={() => vault.cancelProviderSetup()}
            onOpenHelp={() => vault.openHelp()}
            onUseEnrollmentCode={(code, password) =>
              vault.connectWithEnrollmentCode(code, password)}
            prefillEnrollmentCode={vault.prefillEnrollmentCode}
            enrollmentFromUrlPending={vault.enrollmentFromUrlPending}
            onUnlockWithPassword={(entryId, password) =>
              vault.unlockWithPassword(entryId, password)}
            onCreateDeviceVault={() => vault.createLocalVaultWithDeviceKeys()}
            onRemoveProvider={(id) => vault.removeProvider(id)}
          />
          <VaultStatusBar
            {vault}
            storageMode={vault.storageMode}
            githubRepo={vault.githubRepo}
            lastSyncedAt={vault.lastSyncedAt}
            isSyncing={vault.isSyncActivityVisible}
            successMsg={vault.successMsg}
            errorMsg={vault.errorMsg}
            {appVersion}
            label="Nook"
            showSyncStatus={false}
            showStorageIcon={false}
            variant="quiet"
            onDismissSuccess={() => vault.dismissSuccess()}
            onDismissError={() => vault.dismissError()}
          />
        </div>
      {/if}
    </div>

    {#if !legalPage && !logsPage}
      <SiteFooter />
    {/if}

    <JoinEnrollmentDialog
      {vault}
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

    {#if vault.pendingSyncConflict}
      <VaultSyncConflictDialog
        {vault}
        conflict={vault.pendingSyncConflict}
        isBusy={vault.isVerifying}
        onKeepLocal={() => vault.resolveSyncConflictKeepLocal()}
        onKeepRemote={() => vault.resolveSyncConflictKeepRemote()}
        onImportAsNewVault={() => vault.resolveSyncConflictImportRemote()}
      />
    {/if}

    {#if vault.replacementConflicts.length > 0}
      <div
        class="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-xl rounded-lg border border-amber-500/40 bg-amber-950/90 p-4 text-sm text-amber-50 shadow-lg"
      >
        <p class="font-medium">Secret sync conflicts need resolution</p>
        <p class="mt-1 text-amber-100/80">
          {vault.replacementConflicts.length} secret(s) were replaced concurrently
          on different devices. Review candidates in Settings after syncing.
        </p>
      </div>
    {/if}

    <!-- CloudKit JS mounts Sign in with Apple controls here (icloud-oauth.ts). -->
    <div id="apple-sign-in-button" class="sr-only" aria-hidden="true"></div>
    <div id="apple-sign-out-button" class="sr-only" aria-hidden="true"></div>
  </main>
{/if}
