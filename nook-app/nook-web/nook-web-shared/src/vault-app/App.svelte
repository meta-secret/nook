<script lang="ts">
  import { onMount } from 'svelte'
  import { ArrowLeft, BookOpen, Lock, Moon, Sun } from '@lucide/svelte'
  import { VaultState, type StartSentinelGenesisArgs } from '$lib/vault.svelte'
  import { loadAuthProviders, saveAuthProviders } from '$lib/auth-providers'
  import VaultSettingsAccordion from '$lib/components/settings/VaultSettingsAccordion.svelte'
  import VaultBottomNav from '$lib/components/VaultBottomNav.svelte'
  import HelpPage from '$lib/components/HelpPage.svelte'
  import LegalDocumentPage from '$lib/components/LegalDocumentPage.svelte'
  import LogsPage from '$lib/components/LogsPage.svelte'
  import AppLogsApiPage from '$lib/components/AppLogsApiPage.svelte'
  import SiteFooter from '$lib/components/SiteFooter.svelte'
  import LoginGate from '$lib/components/LoginGate.svelte'
  import PasskeyAuthOverlay from '$lib/components/PasskeyAuthOverlay.svelte'
  import ExtensionConnectConsent from '$lib/components/ExtensionConnectConsent.svelte'
  import JoinEnrollmentDialog from '$lib/components/JoinEnrollmentDialog.svelte'
  import LocalFolderMultipleVaultsDialog from '$lib/components/LocalFolderMultipleVaultsDialog.svelte'
  import VaultSyncConflictDialog from '$lib/components/VaultSyncConflictDialog.svelte'
  import PendingJoinsBanner from '$lib/components/PendingJoinsBanner.svelte'
  import LocalOnlyVaultWarningBanner from '$lib/components/LocalOnlyVaultWarningBanner.svelte'
  import SecretVault from '$lib/components/SecretVault.svelte'
  import OnboardDevice from '$lib/components/OnboardDevice.svelte'
  import VaultAdmin from '$lib/components/VaultAdmin.svelte'
  import VaultStatusBar from '$lib/components/VaultStatusBar.svelte'
  import NookLogo from '$lib/components/NookLogo.svelte'
  import HeaderLanguageSelect from '$lib/components/HeaderLanguageSelect.svelte'
  import VaultSwitcher from '$lib/components/VaultSwitcher.svelte'
  import { Button } from '$lib/components/ui/button'
  import {
    appPath,
    getLegalPageFromPath,
    isLogsPath,
    legalPageForId,
    type LegalPageId,
  } from '$lib/legal-content'
  import { isAppLogsPath } from '$lib/app-logs-api'
  import {
    extensionConnectRequestFromLocation,
    isExtensionConnectPath,
    type ExtensionConnectRequest,
  } from '$lib/extension-connect'
  import { isExtensionDeviceIdentityHandoffMessage } from '$web-shared/extension/runtime-messages'
  import type { VaultItemType } from '$lib/nook'
  import { configuredVaultApplication } from '$app-wasm'
  import { consumeSentinelOnboardingFromLocation } from '$lib/sentinel-onboarding-link'
  import {
    APP_KIND,
    IS_SENTINEL_APP,
    SUPPORTS_EXTENSION,
    siblingAppUrl,
  } from '$lib/app-kind'
  import {
    consumeSentinelGenesisParticipantResponseFromLocation,
    consumeSentinelGenesisRequestFromLocation,
  } from '$lib/sentinel-genesis-link'

  const vault = new VaultState()
  type ColorMode = 'light' | 'dark'
  const THEME_STORAGE_KEY = 'nook_color_mode'

  function systemColorMode(): ColorMode {
    return typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  }

  let colorMode = $state<ColorMode>(systemColorMode())
  let followsSystemColorMode = $state(true)
  let legalPage = $state<LegalPageId | undefined>(
    typeof window !== 'undefined'
      ? getLegalPageFromPath(window.location.pathname)
      : undefined,
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
  let extensionConnectRoute = $state<boolean>(
    typeof window !== 'undefined'
      ? SUPPORTS_EXTENSION && isExtensionConnectPath(window.location.pathname)
      : false,
  )
  let extensionConnectRequest = $state<ExtensionConnectRequest | undefined>(
    typeof window !== 'undefined' && SUPPORTS_EXTENSION
      ? extensionConnectRequestFromLocation(window.location)
      : undefined,
  )
  let sentinelInvitationRequest = $state(
    typeof window !== 'undefined' && APP_KIND !== 'simple'
      ? consumeSentinelGenesisRequestFromLocation()
      : '',
  )
  let sentinelParticipantResponse = $state(
    typeof window !== 'undefined' && APP_KIND !== 'simple'
      ? consumeSentinelGenesisParticipantResponseFromLocation()
      : '',
  )
  let sentinelOnboardingPackage = $state(
    typeof window !== 'undefined' && APP_KIND !== 'simple'
      ? consumeSentinelOnboardingFromLocation()
      : '',
  )

  function syncRoute() {
    legalPage = getLegalPageFromPath(window.location.pathname)
    logsPage = isLogsPath(window.location.pathname)
    appLogsPage = isAppLogsPath(window.location.pathname)
    extensionConnectRoute =
      SUPPORTS_EXTENSION && isExtensionConnectPath(window.location.pathname)
    extensionConnectRequest = SUPPORTS_EXTENSION
      ? extensionConnectRequestFromLocation(window.location)
      : undefined
    if (APP_KIND !== 'simple') {
      const invitationRequest = consumeSentinelGenesisRequestFromLocation()
      if (invitationRequest) sentinelInvitationRequest = invitationRequest
      const participantResponse =
        consumeSentinelGenesisParticipantResponseFromLocation()
      if (participantResponse) sentinelParticipantResponse = participantResponse
      const onboardingPackage = consumeSentinelOnboardingFromLocation()
      if (onboardingPackage) sentinelOnboardingPackage = onboardingPackage
    }
  }

  function conflictCandidates(
    candidatesJson: string,
  ): Array<{ eventId: string; secretId: string }> {
    try {
      const parsed = JSON.parse(candidatesJson) as Array<[string, string]>
      return parsed.map(([eventId, secretId]) => ({ eventId, secretId }))
    } catch {
      return []
    }
  }

  function shortId(id: string): string {
    return id.length > 18 ? `${id.slice(0, 18)}...` : id
  }

  function conflictReasons(reasonsJson: string): string {
    try {
      return (JSON.parse(reasonsJson) as string[]).join(', ')
    } catch {
      return 'key epoch rotation'
    }
  }

  function navigateHome() {
    vault.closeHelp()
    history.pushState(undefined, '', appPath('/'))
    legalPage = undefined
    logsPage = false
    appLogsPage = false
    extensionConnectRoute = false
    extensionConnectRequest = undefined
  }

  function navigateToSiblingApp(event: MouseEvent) {
    event.preventDefault()
    const destination = siblingAppUrl()
    if (!destination) return
    vault.lockVault()
    window.location.assign(destination)
  }

  onMount(() => {
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
    const savedMode = localStorage.getItem(THEME_STORAGE_KEY)
    if (savedMode === 'light' || savedMode === 'dark') {
      colorMode = savedMode
      followsSystemColorMode = false
    } else {
      colorMode = colorScheme.matches ? 'dark' : 'light'
    }
    const handleColorSchemeChange = (event: MediaQueryListEvent) => {
      if (followsSystemColorMode) {
        colorMode = event.matches ? 'dark' : 'light'
      }
    }
    colorScheme.addEventListener('change', handleColorSchemeChange)
    // Only one handoff can be processed at a time. The listener is removed
    // after a successful unlock so a captured MessageEvent cannot be replayed.
    let extensionHandoffInProgress = false
    const handleExtensionDeviceIdentityHandoff = (
      event: MessageEvent<unknown>,
    ) => {
      if (
        extensionHandoffInProgress ||
        !SUPPORTS_EXTENSION ||
        event.source !== window ||
        event.origin !== window.location.origin ||
        !isExtensionDeviceIdentityHandoffMessage(event.data)
      ) {
        return
      }
      const handoff = event.data
      extensionHandoffInProgress = true
      const unlock = vault.unlockWithExtensionDeviceIdentity(
        handoff.payload.identitySecret,
        handoff.payload.signingSeed,
      )
      handoff.payload.identitySecret = ''
      handoff.payload.signingSeed = ''
      void unlock
        .then((ok) => {
          window.postMessage(
            {
              type: 'nook:extension-device-identity-handoff-result',
              requestId: handoff.requestId,
              ok,
            },
            window.location.origin,
          )
          if (ok) {
            window.removeEventListener(
              'message',
              handleExtensionDeviceIdentityHandoff,
            )
          }
        })
        .finally(() => {
          extensionHandoffInProgress = false
        })
    }

    window.addEventListener('message', handleExtensionDeviceIdentityHandoff)
    void vault.init()

    if (vault.runtimeConfig.exposeDebugHooks()) {
      ;(window as Window & { __nookVault?: VaultState }).__nookVault = vault
      ;(
        window as Window & { __nookConfiguredVaultApplication?: string }
      ).__nookConfiguredVaultApplication = configuredVaultApplication()
      ;(
        window as Window & {
          __nookAuthProviders?: {
            loadAuthProviders: () => ReturnType<typeof loadAuthProviders>
            saveAuthProviders: (
              snapshot: Parameters<typeof saveAuthProviders>[1],
            ) => ReturnType<typeof saveAuthProviders>
          }
        }
      ).__nookAuthProviders = {
        loadAuthProviders: () =>
          vault.enqueueStorage(() => loadAuthProviders(vault.manager!)),
        saveAuthProviders: (snapshot) =>
          vault.enqueueStorage(() =>
            saveAuthProviders(vault.manager!, snapshot),
          ),
      }
    }

    syncRoute()
    window.addEventListener('popstate', syncRoute)
    window.addEventListener('hashchange', syncRoute)

    return () => {
      vault.stopVaultSync()
      vault.stopIdleSessionTracking()
      void vault.lockDeviceProtection()
      window.removeEventListener('popstate', syncRoute)
      window.removeEventListener('hashchange', syncRoute)
      window.removeEventListener(
        'message',
        handleExtensionDeviceIdentityHandoff,
      )
      colorScheme.removeEventListener('change', handleColorSchemeChange)
    }
  })

  $effect(() => {
    document.documentElement.classList.toggle('dark', colorMode === 'dark')
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
    if (extensionConnectRoute) {
      document.title = 'Approve extension · Nook'
      return
    }
    document.title = IS_SENTINEL_APP
      ? 'Nook Sentinel Vault'
      : 'Nook Simple Vault'
  })

  async function handleUnlock() {
    if (vault.loginSetupType) {
      await vault.connectStagedProvider()
      return
    }
    if (existingVaultNeedsDeviceUnlock) {
      pendingExistingVaultUnlock = true
      return
    }
    await vault.loadDb()
  }

  async function handlePasswordUnlock(entryId: string, password: string) {
    await vault.unlockWithPassword(entryId, password)
  }

  async function handleSettingsReconnect() {
    if (vault.loginSetupType) {
      await vault.connectAndSyncStagedProvider()
      return
    }
    await vault.manualSync()
  }

  function toggleColorMode() {
    followsSystemColorMode = false
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
  let secretsAddFormType = $state<VaultItemType | undefined>(undefined)
  const secretsNoteEditorOpen = $derived(
    secretsAddOpen && secretsAddFormType === 'secure-note',
  )
  const authenticatedShellSpacing = $derived(
    secretsAddOpen ? 'py-4 sm:py-8' : 'pb-28 pt-4 sm:py-8',
  )
  const shellSpacing = $derived(
    legalPage || logsPage || extensionConnectRoute
      ? 'py-5 sm:py-6'
      : vault.isAuthenticated
        ? authenticatedShellSpacing
        : 'py-5 sm:py-6',
  )
  /** Existing vault unlock keeps passkey-first; empty create defers passkey. */
  const requiresPasskeyFirst = $derived(
    vault.localVaultPresent || vault.localVaults.length > 0,
  )
  const existingVaultNeedsDeviceUnlock = $derived(
    requiresPasskeyFirst && !vault.deviceProtectionReady,
  )
  const showLoginWithoutPasskey = $derived(
    !requiresPasskeyFirst && vault.providersLoaded,
  )
  type PendingVaultCreation =
    | { kind: 'simple'; label: string }
    | { kind: 'sentinel'; args: StartSentinelGenesisArgs }
    | { kind: 'sentinel-participant-key' }
    | { kind: 'sentinel-participant-response'; requestPayload: string }
    | { kind: 'sentinel-onboarding'; packageJson: string }
  let pendingVaultCreation = $state<PendingVaultCreation | undefined>(undefined)
  let pendingExistingVaultUnlock = $state(false)
  const showPasskeyOverlay = $derived(
    pendingVaultCreation !== undefined && !vault.deviceProtectionReady,
  )
  const showExistingVaultPasskeyOverlay = $derived(
    pendingExistingVaultUnlock && existingVaultNeedsDeviceUnlock,
  )

  async function handleCreateDeviceVault(label: string) {
    if (!vault.deviceProtectionReady) {
      pendingVaultCreation = { kind: 'simple', label }
      return
    }
    pendingVaultCreation = undefined
    await vault.createLocalVaultWithDeviceKeys(label)
  }

  async function handleStartSentinelGenesis(
    args: StartSentinelGenesisArgs,
  ): Promise<boolean> {
    if (!vault.deviceProtectionReady) {
      pendingVaultCreation = { kind: 'sentinel', args }
      return false
    }
    pendingVaultCreation = undefined
    await vault.startSentinelGenesis(args)
    return true
  }

  async function handleCreateSentinelParticipantKey(): Promise<string> {
    if (!vault.deviceProtectionReady) {
      pendingVaultCreation = { kind: 'sentinel-participant-key' }
      return ''
    }
    pendingVaultCreation = undefined
    return vault.createSentinelGenesisPublicKeyAnnouncement()
  }

  async function handleCreateSentinelParticipantResponse(
    requestPayload: string,
  ): Promise<string> {
    if (!vault.deviceProtectionReady) {
      pendingVaultCreation = {
        kind: 'sentinel-participant-response',
        requestPayload,
      }
      return ''
    }
    pendingVaultCreation = undefined
    return vault.createSentinelGenesisParticipantResponse(requestPayload)
  }

  async function handleAcceptSentinelOnboarding(packageJson: string) {
    if (!vault.deviceProtectionReady) {
      pendingVaultCreation = { kind: 'sentinel-onboarding', packageJson }
      return
    }
    pendingVaultCreation = undefined
    await vault.acceptSentinelOnboardingPackage(packageJson)
    sentinelOnboardingPackage = ''
  }

  $effect(() => {
    const pending = pendingVaultCreation
    if (!pending || !vault.deviceProtectionReady || vault.isVerifying) return
    pendingVaultCreation = undefined
    if (pending.kind === 'simple') {
      void vault.createLocalVaultWithDeviceKeys(pending.label)
      return
    }
    if (
      pending.kind === 'sentinel-participant-key' ||
      pending.kind === 'sentinel-participant-response'
    )
      return
    if (pending.kind === 'sentinel-onboarding') {
      void handleAcceptSentinelOnboarding(pending.packageJson)
      return
    }
    void vault.startSentinelGenesis(pending.args)
  })

  $effect(() => {
    if (
      !pendingExistingVaultUnlock ||
      !vault.deviceProtectionReady ||
      vault.isVerifying
    ) {
      return
    }
    pendingExistingVaultUnlock = false
    void vault.loadDb()
  })
</script>

{#if appLogsPage}
  <AppLogsApiPage />
{:else}
  <main
    class="min-h-svh bg-background text-foreground"
    class:dark={colorMode === 'dark'}
  >
    <header
      class="app-header border-b border-border/50 bg-card/80 backdrop-blur-md"
    >
      <div
        class="mx-auto flex items-center justify-between gap-4 px-4 py-2 sm:px-6 {shellWidth}"
      >
        <div class="flex min-w-0 items-center gap-3">
          <NookLogo {colorMode} size="sm" class="rounded-lg overflow-hidden" />
          {#if vault.isAuthenticated && !legalPage && !logsPage && !vault.helpOpen}
            <VaultSwitcher {vault} />
          {/if}
        </div>

        <div class="flex items-center gap-2">
          {#if vault.isAuthenticated && !vault.helpOpen && !legalPage}
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

          {#if IS_SENTINEL_APP}
            <a
              href={siblingAppUrl()}
              class="hidden h-10 items-center rounded-lg border border-border/40 bg-background/60 px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:inline-flex"
              data-testid="sibling-vault-app-link"
              onclick={navigateToSiblingApp}
            >
              {vault.t('app.open_simple_app')}
            </a>
          {/if}

          <button
            type="button"
            class="inline-flex size-10 items-center justify-center rounded-lg border border-border/40 bg-background/60 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:bg-background/70"
            aria-label={colorMode === 'dark'
              ? vault.t('app.switch_light')
              : vault.t('app.switch_dark')}
            title={colorMode === 'dark'
              ? vault.t('app.switch_light')
              : vault.t('app.switch_dark')}
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
            aria-label={vault.t('app.github_aria')}
            title={vault.t('app.github_title')}
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

          {#if legalPage || logsPage || extensionConnectRoute}
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="h-10 rounded-lg border-border/40 bg-background/60 px-3.5 text-sm text-muted-foreground sm:bg-background [&_svg]:size-4"
              data-testid="legal-header-back"
              onclick={navigateHome}
            >
              <ArrowLeft class="size-4" />
              <span class="hidden sm:inline">{vault.t('app.back')}</span>
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
              <span class="hidden sm:inline">{vault.t('app.back')}</span>
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
              <span class="hidden sm:inline">{vault.t('app.help')}</span>
            </Button>
          {/if}
        </div>
      </div>
    </header>

    <div class="mx-auto px-4 sm:px-6 {shellWidth} {shellSpacing}">
      {#if logsPage}
        <LogsPage onClose={navigateHome} />
      {:else if legalPage}
        <LegalDocumentPage {vault} pageId={legalPage} onClose={navigateHome} />
      {:else if vault.helpOpen}
        <div class="space-y-4">
          <HelpPage {vault} onClose={() => vault.closeHelp()} {colorMode} />
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
      {:else if extensionConnectRoute && !extensionConnectRequest}
        <section
          class="mx-auto max-w-2xl rounded-xl border border-destructive/30 bg-card p-4 shadow-sm sm:p-5"
          data-testid="extension-connect-invalid"
        >
          <h1 class="text-lg font-semibold text-foreground">
            {vault.t('extension.connect.invalid_title')}
          </h1>
          <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
            {vault.t('extension.connect.invalid_description')}
          </p>
          <Button
            type="button"
            variant="outline"
            class="mt-4"
            onclick={navigateHome}
          >
            {vault.t('extension.connect.return_to_nook')}
          </Button>
        </section>
      {:else if !vault.isAuthenticated}
        <div class="space-y-6">
          {#if vault.deviceProtectionReady || showLoginWithoutPasskey || existingVaultNeedsDeviceUnlock}
            {#if vault.providersLoaded || existingVaultNeedsDeviceUnlock}
              <LoginGate
                {vault}
                appKind={APP_KIND}
                providers={vault.providers}
                bind:setupType={vault.loginSetupType}
                bind:githubPat={vault.githubPat}
                bind:githubRepo={vault.githubRepo}
                addProviderOpen={vault.addProviderOpen}
                isVerifying={vault.isVerifying}
                isInitializing={vault.isInitializing}
                deviceAuthorizationPending={existingVaultNeedsDeviceUnlock}
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
                {sentinelInvitationRequest}
                {sentinelParticipantResponse}
                {sentinelOnboardingPackage}
                onAcceptSentinelOnboardingPackage={handleAcceptSentinelOnboarding}
                onUnlockWithPassword={handlePasswordUnlock}
                onCreateDeviceVault={handleCreateDeviceVault}
                onStartSentinelGenesis={handleStartSentinelGenesis}
                onCreateSentinelGenesisPublicKeyAnnouncement={handleCreateSentinelParticipantKey}
                onCreateSentinelGenesisParticipantResponse={handleCreateSentinelParticipantResponse}
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
            {/if}
            {#if showPasskeyOverlay || showExistingVaultPasskeyOverlay}
              <PasskeyAuthOverlay
                {vault}
                onDismiss={() => {
                  if (showExistingVaultPasskeyOverlay) {
                    pendingExistingVaultUnlock = false
                    return
                  }
                  pendingVaultCreation = undefined
                }}
              />
            {/if}
          {/if}
        </div>
      {:else if extensionConnectRequest}
        <div class="mx-auto w-full max-w-2xl space-y-4">
          <ExtensionConnectConsent
            {vault}
            request={extensionConnectRequest}
            onClose={navigateHome}
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
            onRefresh={() => vault.manualSync()}
            onDismissSuccess={() => vault.dismissSuccess()}
            onDismissError={() => vault.dismissError()}
          />
        </div>
      {:else if vault.isAuthenticated}
        <div
          class:authenticated-shell-editor={secretsAddOpen}
          class="authenticated-shell flex w-full flex-col overflow-hidden rounded-xl bg-card shadow-sm sm:border sm:border-border/60"
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
                  onAddSyncProvider={() => vault.openAdmin('storage')}
                />
              {/if}
              {#if vault.settingsOpen && vault.settingsSection === 'admin'}
                <VaultAdmin
                  {vault}
                  bind:activeSection={vault.adminAccordionSection}
                  syncProviders={vault.syncProviders}
                  syncingProviderId={vault.syncingProviderId}
                  isAuthenticated={vault.isAuthenticated}
                  isVerifying={vault.isVerifying}
                  isInitializing={vault.isInitializing}
                  addProviderOpen={vault.addProviderOpen}
                  bind:setupType={vault.loginSetupType}
                  bind:githubPat={vault.githubPat}
                  bind:githubRepo={vault.githubRepo}
                  passwordEntries={vault.passwordEntries}
                  isPasswordBusy={vault.isPasswordBusy}
                  passwordError={vault.passwordError}
                  enrollmentCode={vault.enrollmentCode}
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
                />
              {:else if vault.settingsOpen && vault.settingsSection === 'onboard'}
                <OnboardDevice
                  {vault}
                  syncProviders={vault.syncProviders}
                  passwordEntries={vault.passwordEntries}
                  enrollmentCode={vault.enrollmentCode}
                  isBusy={vault.isPasswordBusy}
                  passwordError={vault.passwordError}
                  isVerifying={vault.isVerifying}
                  isInitializing={vault.isInitializing}
                  addProviderOpen={vault.addProviderOpen}
                  bind:setupType={vault.loginSetupType}
                  bind:githubPat={vault.githubPat}
                  bind:githubRepo={vault.githubRepo}
                  onIssueCode={(entryId, pw, providerId) =>
                    vault.issueEnrollmentCode(entryId, pw, providerId)}
                  onClearCode={() => vault.clearEnrollmentCode()}
                  onAddPassword={(label, pw) =>
                    vault.addVaultPassword(label, pw)}
                  onBeginAddProvider={() => vault.beginAddProvider()}
                  onCancelAddProvider={() => vault.cancelAddProvider()}
                  onBeginSetup={(type, preset) =>
                    vault.beginProviderSetup(type, preset)}
                  onCancelSetup={() => vault.cancelProviderSetup()}
                  onConnectProvider={handleSettingsReconnect}
                />
              {:else if vault.settingsOpen}
                <VaultSettingsAccordion
                  {vault}
                  bind:accordionSection={vault.settingsAccordionSection}
                  isVerifying={vault.isVerifying}
                  isSaving={vault.isSaving}
                  deviceId={vault.deviceId}
                  devicePublicKey={vault.devicePublicKey}
                  pendingJoins={vault.pendingJoins}
                  vaultMembers={vault.vaultMembers}
                  hasPasswordEnvelope={vault.hasPasswordEnvelope}
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
                    editsBlocked={vault.editsBlocked}
                    editBlockReason={vault.editBlockReason}
                    secrets={vault.secrets}
                    onAddModeChange={(open, type = undefined) => {
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
              syncConflictLabel={vault.syncConflictLabel}
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
                onSelectAdmin={() => vault.openAdmin()}
                onSelectSettings={() => vault.openSettings()}
              />
            {/if}
          </div>
        </div>
      {/if}
    </div>

    {#if !legalPage && !logsPage && !extensionConnectRoute}
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
        onCancel={() => vault.clearPendingSyncConflict()}
      />
    {/if}

    {#if vault.localFolderMultipleVaultsIssue}
      <LocalFolderMultipleVaultsDialog
        {vault}
        issue={vault.localFolderMultipleVaultsIssue}
        onChooseFolder={() => vault.chooseReplacementLocalFolderForIssue()}
        onDisconnect={() => vault.disconnectLocalFolderMultipleVaultsProvider()}
        onDismiss={() => vault.dismissLocalFolderMultipleVaultsIssue()}
      />
    {/if}

    {#if vault.replacementConflicts.length > 0}
      <div
        class={`fixed left-4 right-4 z-50 mx-auto max-w-2xl rounded-lg border border-amber-500/40 bg-amber-950/95 p-4 text-sm text-amber-50 shadow-lg ${
          vault.securityConflicts.length > 0 ? 'bottom-32' : 'bottom-4'
        }`}
      >
        <p class="font-medium">{vault.t('app.secret_sync_conflicts')}</p>
        <div class="mt-3 space-y-3">
          {#each vault.replacementConflicts as conflict (conflict.oldSecretId)}
            <div class="rounded border border-amber-400/30 p-3">
              <p class="text-amber-100">
                {vault.t('app.conflict_original', {
                  id: shortId(conflict.oldSecretId),
                })}
              </p>
              <div class="mt-2 flex flex-wrap gap-2">
                {#each conflictCandidates(conflict.candidatesJson) as candidate (candidate.secretId)}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={vault.isSaving}
                    onclick={() =>
                      vault.resolveReplacementConflict(
                        conflict.oldSecretId,
                        candidate.secretId,
                      )}
                  >
                    {vault.t('app.conflict_keep', {
                      id: shortId(candidate.secretId),
                    })}
                  </Button>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if vault.securityConflicts.length > 0}
      <div
        class="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-2xl rounded-lg border border-red-500/50 bg-red-950/95 p-4 text-sm text-red-50 shadow-lg"
      >
        <p class="font-medium">{vault.t('app.security_conflict')}</p>
        <div class="mt-2 space-y-2 text-red-100">
          {#each vault.securityConflicts as conflict (conflict.eventsJson)}
            <p>{conflictReasons(conflict.reasonsJson)}</p>
          {/each}
        </div>
      </div>
    {/if}
  </main>
{/if}
