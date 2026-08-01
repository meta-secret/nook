<script lang="ts">
  import { onMount } from 'svelte'
  import { VaultState } from '$lib/vault.svelte'
  import {
    DeviceProtectionStatus,
    JoinEnrollmentState,
    NookExistingVaultProviderReadiness,
    type StartSentinelGenesisArgs,
  } from '$app-wasm'
  import {
    ColorMode,
    EnrollmentSubmitQueueKind,
    ExistingVaultProviderSnapshotKind,
    ExistingVaultImportQueueKind,
    ExtensionConnectIntentKind,
    ExtensionSetupOfferKind,
    LegalRouteKind,
    PendingVaultCreationKind,
    VaultCreationQueueKind,
    extensionConnectIntent,
    legalRoute,
    manualColorMode,
    systemColorMode,
    type EnrollmentSubmitQueue,
    type ExistingVaultImportQueue,
    type ExtensionConnectIntent,
    type ExtensionSetupOffer,
    type VaultCreationQueue,
  } from '$lib/app-lifecycle-state'
  import LegalDocumentPage from '$lib/components/LegalDocumentPage.svelte'
  import LogsPage from '$lib/components/LogsPage.svelte'
  import AppLogsApiPage from '$lib/components/AppLogsApiPage.svelte'
  import AppHelpWorkspace from '$lib/components/app/AppHelpWorkspace.svelte'
  import AppPersistentChrome from '$lib/components/app/AppPersistentChrome.svelte'
  import ExtensionConnectConsentWorkspace from '$lib/components/app/ExtensionConnectConsentWorkspace.svelte'
  import InvalidExtensionConnectWorkspace from '$lib/components/app/InvalidExtensionConnectWorkspace.svelte'
  import AppHeader from '$lib/components/app/AppHeader.svelte'
  import AuthenticatedVaultWorkspace from '$lib/components/app/AuthenticatedVaultWorkspace.svelte'
  import VaultAccessGate from '$lib/components/app/VaultAccessGate.svelte'
  import { appPath, getLegalPageFromPath, isLogsPath } from '$lib/legal-content'
  import { isAppLogsPath } from '$lib/app-logs-api'
  import {
    adoptExtensionIdentity,
    discoverPairedExtensionIdentity,
    extensionConnectRequestFromLocation,
    ExtensionConnectRequestStateKind,
    ExtensionIdentityRequestSource,
    isExtensionConnectPath,
    requestPairedExtensionUnlock,
    type ExtensionConnectRequestState,
  } from '$lib/extension-connect'
  import {
    connectInstalledExtension,
    loadExtensionSetupOffer,
    observeExtensionSetupChanges,
    openExtensionInstaller,
  } from '$lib/app-extension-setup'
  import {
    APP_SHELL_WIDTH,
    APP_VERSION,
    appShellSpacing,
  } from '$lib/app-shell-layout'
  import {
    assessVaultSecurity,
    configuredVaultApplicationIsSimple,
    configuredVaultApplicationIsSentinel,
    configuredVaultApplicationSupportsExtension,
  } from '$app-wasm'
  import { consumeSentinelOnboardingFromLocation } from '$lib/sentinel-onboarding-link'
  import {
    initialExtensionConnectIntent,
    initialLegalRoute,
  } from '$lib/app-route-state'
  import {
    consumeSentinelGenesisParticipantResponseFromLocation,
    consumeSentinelGenesisRequestFromLocation,
  } from '$lib/sentinel-genesis-link'
  import * as deviceProtectionActions from '$lib/vault/device-protection.svelte'
  import * as sentinelGenesisActions from '$lib/vault/sentinel-genesis'
  import { prepareExistingVaultProvider } from '$lib/vault/existing-vault-provider.svelte'
  import {
    mountBrowserLifecycle,
    THEME_STORAGE_KEY,
    updateApplicationDocument,
  } from '$lib/app-browser-lifecycle'
  import {
    ActiveVaultKind,
    LoginSetupKind,
    RecoveryDiscoveryKind,
    type ActiveVault,
  } from '$lib/vault/state/provider.svelte'
  import { ExtensionPairedVaultIdentityStatusMessageStatus } from '$web-shared/extension/paired-vault-identity-status'
  const IS_SIMPLE_APP = configuredVaultApplicationIsSimple()
  const IS_SENTINEL_APP = configuredVaultApplicationIsSentinel()
  const SUPPORTS_EXTENSION = configuredVaultApplicationSupportsExtension()
  const vault = new VaultState()
  const vaultSecurityRecommendations = $derived(
    assessVaultSecurity(vault.syncProviders.length, vault.vaultMembers.length),
  )
  let colorMode = $state<ColorMode>(systemColorMode())
  let followsSystemColorMode = $state(true)
  let legalPageState = $state(initialLegalRoute())
  let logsPage = $state<boolean>(
    'window' in globalThis && isLogsPath(window.location.pathname),
  )
  let appLogsPage = $state<boolean>(
    'window' in globalThis && isAppLogsPath(window.location.pathname),
  )
  const initialExtensionConnectRequestState: ExtensionConnectIntent =
    initialExtensionConnectIntent(SUPPORTS_EXTENSION)
  let extensionConnectRoute = $state<boolean>(
    'window' in globalThis
      ? SUPPORTS_EXTENSION && isExtensionConnectPath(window.location.pathname)
      : false,
  )
  let extensionConnectRequestState = $state<ExtensionConnectIntent>(
    initialExtensionConnectRequestState,
  )
  // Keep the public extension handoff request in memory after leaving the
  // consent route. On reload, the site asks the installed extension for a new
  // vault-bound handoff only when that extension already holds an approved
  // grant for the active local vault.
  let extensionIdentityRequestState = $state<ExtensionConnectIntent>(
    initialExtensionConnectRequestState,
  )
  let extensionBackedVaultSession = $state(false)
  let extensionDiscoveryStoreId = $state('')
  let extensionSetupStateValue = $state<ExtensionSetupOffer>({
    kind: ExtensionSetupOfferKind.Hidden,
  })
  let extensionInstallBusy = $state(false)
  let extensionConnectError = $state(false)
  const EXTENSION_LOCKED_RETRY_MS = 3_000
  let sentinelInvitationRequest = $state(
    'window' in globalThis && !IS_SIMPLE_APP
      ? consumeSentinelGenesisRequestFromLocation()
      : '',
  )
  let sentinelParticipantResponse = $state(
    'window' in globalThis && !IS_SIMPLE_APP
      ? consumeSentinelGenesisParticipantResponseFromLocation()
      : '',
  )
  let sentinelOnboardingPackage = $state(
    'window' in globalThis && !IS_SIMPLE_APP
      ? consumeSentinelOnboardingFromLocation()
      : '',
  )

  function syncRoute() {
    const routeLegalPage = getLegalPageFromPath(window.location.pathname)
    legalPageState = legalRoute(routeLegalPage)
    logsPage = isLogsPath(window.location.pathname)
    appLogsPage = isAppLogsPath(window.location.pathname)
    extensionConnectRoute =
      SUPPORTS_EXTENSION && isExtensionConnectPath(window.location.pathname)
    const routeConnectRequest: ExtensionConnectRequestState = SUPPORTS_EXTENSION
      ? extensionConnectRequestFromLocation(window.location)
      : { kind: ExtensionConnectRequestStateKind.Absent }
    extensionConnectRequestState = extensionConnectIntent(routeConnectRequest)
    if (
      routeConnectRequest.kind === ExtensionConnectRequestStateKind.Requested
    ) {
      extensionIdentityRequestState = {
        kind: ExtensionConnectIntentKind.Requested,
        request: routeConnectRequest.request,
      }
    }
    if (!IS_SIMPLE_APP) {
      const invitationRequest = consumeSentinelGenesisRequestFromLocation()
      if (invitationRequest) sentinelInvitationRequest = invitationRequest
      const participantResponse =
        consumeSentinelGenesisParticipantResponseFromLocation()
      if (participantResponse) sentinelParticipantResponse = participantResponse
      const onboardingPackage = consumeSentinelOnboardingFromLocation()
      if (onboardingPackage) sentinelOnboardingPackage = onboardingPackage
    }
  }

  function navigateHome() {
    vault.closeHelp()
    history.pushState({}, '', appPath('/'))
    legalPageState = { kind: LegalRouteKind.Application }
    logsPage = false
    appLogsPage = false
    extensionConnectRoute = false
    extensionConnectRequestState = {
      kind: ExtensionConnectIntentKind.Absent,
    }
  }

  function finishExtensionConnect(approved = false) {
    if (!approved) {
      extensionIdentityRequestState = {
        kind: ExtensionConnectIntentKind.Absent,
      }
    }
    vault.closeHelp()
    history.pushState({}, '', appPath('/'))
    legalPageState = { kind: LegalRouteKind.Application }
    logsPage = false
    appLogsPage = false
    extensionConnectRoute = false
    extensionConnectRequestState = {
      kind: ExtensionConnectIntentKind.Absent,
    }
  }

  onMount(() => {
    return mountBrowserLifecycle({
      vault,
      followsSystemColorMode: () => followsSystemColorMode,
      setColorMode: (mode) => {
        colorMode = mode
      },
      stopFollowingSystemColorMode: () => {
        followsSystemColorMode = false
      },
      syncRoute,
    })
  })

  $effect(() => {
    updateApplicationDocument(
      colorMode,
      legalPageState,
      logsPage,
      extensionConnectRoute,
      IS_SENTINEL_APP,
    )
  })

  async function handleUnlock(skipExtensionDiscovery = false) {
    const existingVaultImport =
      vault.loginRequiresExistingVault &&
      vault.loginSetup.kind === LoginSetupKind.Active
    const existingVaultImportNeedsIdentity =
      vault.clientPolicy.existingVaultIdentityRecoveryRequired(
        vault.loginRequiresExistingVault,
        vault.loginSetup.kind === LoginSetupKind.Active,
        vault.deviceProtectionReady,
      )
    if (
      vault.addProviderOpen &&
      vault.loginSetup.kind === LoginSetupKind.Active &&
      !existingVaultImportNeedsIdentity
    ) {
      await vault.connectStagedProvider()
      return
    }
    let activeStoreId =
      vault.activeVault.kind === ActiveVaultKind.Open
        ? vault.activeVault.storeId.trim()
        : ''
    if (existingVaultImport) {
      try {
        activeStoreId = await vault.discoverStagedVaultStoreId()
        if (!activeStoreId) {
          vault.errorMsg = vault.t('auth_storage.existing_vault_not_found')
          return
        }
        rememberExistingVaultImport(activeStoreId)
      } catch (error) {
        vault.errorMsg =
          error instanceof Error
            ? error.message
            : vault.t('auth_storage.sync_failed')
        return
      }
    }
    if (
      extensionIdentityRequestState.kind ===
        ExtensionConnectIntentKind.Requested &&
      extensionIdentityRequestState.request.source ===
        ExtensionIdentityRequestSource.PairedVault &&
      extensionIdentityRequestState.request.vaultStoreId === activeStoreId
    ) {
      const connectRequest = extensionIdentityRequestState.request
      const adopted = await vault.authorizeWithExternalDeviceIdentity(
        (manager) => adoptExtensionIdentity(manager, connectRequest),
        { deferInitialization: existingVaultImport },
      )
      if (!adopted) return
      extensionBackedVaultSession = true
      await (existingVaultImport ? resumeExistingVaultImport() : vault.loadDb())
      return
    }
    if (
      !skipExtensionDiscovery &&
      SUPPORTS_EXTENSION &&
      (vault.localVaultPresent || existingVaultImport) &&
      activeStoreId
    ) {
      extensionDiscoveryStoreId = ''
      const discoveryStatus = await resumePairedExtensionVault(activeStoreId)
      if (vault.isAuthenticated) return
      if (
        discoveryStatus ===
        ExtensionPairedVaultIdentityStatusMessageStatus.Locked
      ) {
        const requested = await requestPairedExtensionUnlock(activeStoreId)
        if (requested) return
      }
    }
    if (existingVaultNeedsDeviceUnlock || existingVaultImportNeedsIdentity) {
      if (
        extensionIdentityRequestState.kind ===
        ExtensionConnectIntentKind.Requested
      ) {
        const connectRequest = extensionIdentityRequestState.request
        const extensionIdentityCanUnlock =
          (connectRequest.source !==
            ExtensionIdentityRequestSource.PairedVault ||
            connectRequest.vaultStoreId === activeStoreId) &&
          (connectRequest.source ===
            ExtensionIdentityRequestSource.PairedVault ||
            extensionBackedVaultSession ||
            vault.deviceProtectionStatus === DeviceProtectionStatus.Missing)
        if (extensionIdentityCanUnlock) {
          const adopted = await vault.authorizeWithExternalDeviceIdentity(
            (manager) => adoptExtensionIdentity(manager, connectRequest),
            { deferInitialization: existingVaultImport },
          )
          if (!adopted) return
          extensionBackedVaultSession = true
          await (existingVaultImport
            ? resumeExistingVaultImport()
            : vault.loadDb())
          return
        }
      }
      pendingExistingVaultUnlock = true
      if (vault.deviceProtectionStatus === DeviceProtectionStatus.Passkey) {
        await deviceProtectionActions.unlockDeviceProtection(vault)
      }
      return
    }
    if (existingVaultImport) {
      await resumeExistingVaultImport()
      return
    }
    if (vault.loginSetup.kind === LoginSetupKind.Active) {
      await vault.connectStagedProvider()
      return
    }
    await vault.loadDb()
  }

  async function handlePasswordUnlock(entryId: string, password: string) {
    await vault.unlockWithPassword(entryId, password)
    if (vault.isAuthenticated) {
      if (
        pendingExistingVaultImportState.kind ===
        ExistingVaultImportQueueKind.WaitingForDevice
      ) {
        await vault.activateConnectedExistingVault(
          pendingExistingVaultImportState.request.storeId,
        )
      }
      pendingExistingVaultImportState = {
        kind: ExistingVaultImportQueueKind.Idle,
      }
      vault.clearExistingVaultRecoverySummary()
    }
  }

  async function handleSettingsReconnect() {
    if (vault.loginSetup.kind === LoginSetupKind.Active) {
      await vault.connectAndSyncStagedProvider()
      return
    }
    await vault.manualSync()
  }

  function toggleColorMode() {
    followsSystemColorMode = false
    colorMode = manualColorMode(colorMode, THEME_STORAGE_KEY)
  }

  const appVersion = APP_VERSION
  const shellWidth = APP_SHELL_WIDTH
  let secretsAddOpen = $state(false)
  const shellSpacing = $derived(
    appShellSpacing({
      legalRouteKind: legalPageState.kind,
      logsOpen: logsPage,
      extensionConnectOpen: extensionConnectRoute,
      authenticated: vault.isAuthenticated,
      editorOpen: secretsAddOpen,
    }),
  )

  /** Existing vault unlock / `#enroll=` join keep passkey-first; empty create defers passkey. */
  const urlEnrollmentPending = $derived(vault.enrollmentFromUrlPending)
  const requiresPasskeyFirst = $derived(
    vault.localVaultPresent ||
      vault.localVaults.length > 0 ||
      vault.loginRequiresExistingVault ||
      urlEnrollmentPending,
  )
  const existingVaultNeedsDeviceUnlock = $derived(
    requiresPasskeyFirst && !vault.deviceProtectionReady,
  )
  const showLoginWithoutPasskey = $derived(
    !requiresPasskeyFirst && vault.providersLoaded,
  )
  let pendingVaultCreationState = $state<VaultCreationQueue>({
    kind: VaultCreationQueueKind.Idle,
  })
  let pendingExistingVaultImportState = $state<ExistingVaultImportQueue>({
    kind: ExistingVaultImportQueueKind.Idle,
  })
  let pendingExistingVaultUnlock = $state(false)
  let pendingEnrollmentDeviceUnlock = $state(false)
  let pendingEnrollmentSubmitState = $state<EnrollmentSubmitQueue>({
    kind: EnrollmentSubmitQueueKind.Idle,
  })
  const showPasskeyOverlay = $derived(
    pendingVaultCreationState.kind ===
      VaultCreationQueueKind.WaitingForDevice && !vault.deviceProtectionReady,
  )
  const showExistingVaultPasskeyOverlay = $derived(
    pendingExistingVaultUnlock && existingVaultNeedsDeviceUnlock,
  )
  const showEnrollmentPasskeyOverlay = $derived(
    pendingEnrollmentDeviceUnlock &&
      urlEnrollmentPending &&
      !vault.deviceProtectionReady,
  )

  function rememberExistingVaultImport(storeId: string): void {
    if (vault.loginSetup.kind !== LoginSetupKind.Active) return
    const preparation = prepareExistingVaultProvider(
      vault,
      vault.loginSetup.providerType,
    )
    if (
      preparation.kind === NookExistingVaultProviderReadiness.MissingOauthFile
    ) {
      vault.errorMsg = vault.t('errors.cloud_sync_provider_required')
      return
    }
    if (
      preparation.kind === NookExistingVaultProviderReadiness.MissingLocalFolder
    ) {
      vault.errorMsg = vault.t('auth_storage.local_folder_choose_err')
      return
    }
    if (preparation.kind !== NookExistingVaultProviderReadiness.Ready) return
    pendingExistingVaultImportState = {
      kind: ExistingVaultImportQueueKind.WaitingForDevice,
      request: {
        storeId,
        previousActiveVault: vault.activeVault,
        provider: preparation.provider,
      },
    }
  }

  async function resumeExistingVaultImport(): Promise<void> {
    if (
      pendingExistingVaultImportState.kind !==
      ExistingVaultImportQueueKind.WaitingForDevice
    ) {
      await vault.loadDb()
      return
    }
    const pending = pendingExistingVaultImportState.request
    if (vault.isAuthenticated) {
      vault.clearUnlockedSession()
    }
    const existingLocalVault = vault.localVaults.some(
      (entry) => entry.storeId === pending.storeId,
    )
    if (existingLocalVault) {
      await vault.selectVaultForUnlock(pending.storeId)
      if (
        vault.activeVault.kind !== ActiveVaultKind.Open ||
        vault.activeVault.storeId !== pending.storeId
      ) {
        throw new Error(vault.t('errors.vault_selection_failed'))
      }
    } else {
      await vault.prepareExistingVaultImportSlot()
    }
    vault.loginRequiresExistingVault = true
    vault.activateLoginSetup(pending.provider.setupType)
    vault.storageMode = pending.provider.setupType
    vault.githubPat =
      pending.provider.kind === ExistingVaultProviderSnapshotKind.Github
        ? pending.provider.githubPat
        : ''
    vault.githubRepo =
      pending.provider.kind === ExistingVaultProviderSnapshotKind.Github
        ? pending.provider.githubRepo
        : ''
    if (pending.provider.kind === ExistingVaultProviderSnapshotKind.OAuthFile) {
      vault.configureOauthFile(pending.provider.oauthFile)
    } else {
      vault.clearOauthFile()
    }
    if (
      pending.provider.kind === ExistingVaultProviderSnapshotKind.LocalFolder
    ) {
      vault.configureLocalFolder(pending.provider.localFolder)
    } else {
      vault.clearLocalFolder()
    }
    const recoveryDiscovery = vault.recoveryDiscovery
    await vault.connectStagedProvider()
    if (vault.isAuthenticated) {
      await vault.activateConnectedExistingVault(pending.storeId)
      pendingExistingVaultImportState = {
        kind: ExistingVaultImportQueueKind.Idle,
      }
      vault.clearExistingVaultRecoverySummary()
      return
    }
    if (vault.loginPasswordPrompt) {
      if (
        recoveryDiscovery.kind === RecoveryDiscoveryKind.Found &&
        recoveryDiscovery.summary.passwordEntries.length
      ) {
        const recoverySummary = recoveryDiscovery.summary
        if (recoverySummary.passwordEntries.length === 1) {
          for (const entry of recoverySummary.passwordEntries) {
            vault.selectPasswordEntry(entry.id)
          }
        } else {
          vault.clearSelectedPasswordEntry()
        }
      }
      return
    }
    if (
      vault.joinEnrollmentPrompt !== JoinEnrollmentState.None ||
      vault.sentinelCeremonyPrompt
    ) {
      return
    }
  }

  async function finishExistingVaultImport(): Promise<void> {
    if (
      pendingExistingVaultImportState.kind !==
        ExistingVaultImportQueueKind.WaitingForDevice ||
      !vault.isAuthenticated
    )
      return
    const pending = pendingExistingVaultImportState.request
    await vault.activateConnectedExistingVault(pending.storeId)
    pendingExistingVaultImportState = {
      kind: ExistingVaultImportQueueKind.Idle,
    }
    vault.clearExistingVaultRecoverySummary()
  }

  async function leaveExistingVaultImport(): Promise<void> {
    const previousActiveVault: ActiveVault =
      pendingExistingVaultImportState.kind ===
      ExistingVaultImportQueueKind.WaitingForDevice
        ? pendingExistingVaultImportState.request.previousActiveVault
        : { kind: ActiveVaultKind.Closed }
    pendingExistingVaultImportState = {
      kind: ExistingVaultImportQueueKind.Idle,
    }
    vault.clearExistingVaultRecoverySummary()
    if (previousActiveVault.kind === ActiveVaultKind.Open) {
      await vault.selectVaultForUnlock(previousActiveVault.storeId)
    }
    vault.beginLoginVaultPicker()
  }

  async function handleUseEnrollmentCode(code: string, password: string) {
    if (!vault.deviceProtectionReady) {
      pendingEnrollmentSubmitState = {
        kind: EnrollmentSubmitQueueKind.WaitingForDevice,
        request: { code, password },
      }
      pendingEnrollmentDeviceUnlock = true
      return
    }
    pendingEnrollmentSubmitState = { kind: EnrollmentSubmitQueueKind.Idle }
    await vault.connectWithEnrollmentCode(code, password)
  }

  async function resumePairedExtensionVault(
    storeId: string,
  ): Promise<
    | ExtensionPairedVaultIdentityStatusMessageStatus.Unavailable
    | ExtensionPairedVaultIdentityStatusMessageStatus.Locked
    | ExtensionPairedVaultIdentityStatusMessageStatus.Unlocked
  > {
    const discoveringStagedImport =
      vault.loginRequiresExistingVault &&
      vault.loginSetup.kind === LoginSetupKind.Active
    extensionDiscoveryStoreId = storeId
    const discovery = await discoverPairedExtensionIdentity(storeId)
    if (
      vault.isAuthenticated ||
      extensionConnectRoute ||
      ((vault.activeVault.kind !== ActiveVaultKind.Open ||
        vault.activeVault.storeId !== storeId) &&
        !discoveringStagedImport)
    ) {
      return discovery.status ===
        ExtensionPairedVaultIdentityStatusMessageStatus.DifferentVault
        ? ExtensionPairedVaultIdentityStatusMessageStatus.Unavailable
        : discovery.status
    }
    if (
      discovery.status ===
      ExtensionPairedVaultIdentityStatusMessageStatus.Locked
    ) {
      window.setTimeout(() => {
        if (
          !vault.isAuthenticated &&
          ((vault.activeVault.kind === ActiveVaultKind.Open &&
            vault.activeVault.storeId === storeId) ||
            discoveringStagedImport) &&
          extensionDiscoveryStoreId === storeId
        ) {
          extensionDiscoveryStoreId = ''
        }
      }, EXTENSION_LOCKED_RETRY_MS)
      return ExtensionPairedVaultIdentityStatusMessageStatus.Locked
    }
    if (
      discovery.status !==
      ExtensionPairedVaultIdentityStatusMessageStatus.Unlocked
    ) {
      return ExtensionPairedVaultIdentityStatusMessageStatus.Unavailable
    }
    extensionIdentityRequestState = {
      kind: ExtensionConnectIntentKind.Requested,
      request: discovery.request,
    }
    await handleUnlock(true)
    return ExtensionPairedVaultIdentityStatusMessageStatus.Unlocked
  }

  async function handleCreateDeviceVault(label: string) {
    if (
      extensionIdentityRequestState.kind ===
        ExtensionConnectIntentKind.Requested &&
      vault.deviceId !== extensionIdentityRequestState.request.deviceId
    ) {
      const connectRequest = extensionIdentityRequestState.request
      const adopted = await vault.authorizeWithExternalDeviceIdentity(
        (manager) => adoptExtensionIdentity(manager, connectRequest),
      )
      if (!adopted) return
    }
    if (!vault.deviceProtectionReady) {
      pendingVaultCreationState = {
        kind: VaultCreationQueueKind.WaitingForDevice,
        request: { kind: PendingVaultCreationKind.Simple, label },
      }
      return
    }
    pendingVaultCreationState = { kind: VaultCreationQueueKind.Idle }
    await vault.createLocalVaultWithDeviceKeys(label)
    if (
      extensionIdentityRequestState.kind ===
        ExtensionConnectIntentKind.Requested &&
      vault.isAuthenticated
    ) {
      extensionBackedVaultSession = true
    }
  }

  async function handleStartSentinelGenesis(
    args: StartSentinelGenesisArgs,
  ): Promise<boolean> {
    if (!vault.deviceProtectionReady) {
      pendingVaultCreationState = {
        kind: VaultCreationQueueKind.WaitingForDevice,
        request: { kind: PendingVaultCreationKind.Sentinel, args },
      }
      return false
    }
    pendingVaultCreationState = { kind: VaultCreationQueueKind.Idle }
    await vault.startSentinelGenesis(args)
    return true
  }

  async function handleCreateSentinelParticipantKey(): Promise<string> {
    if (!vault.deviceProtectionReady) {
      pendingVaultCreationState = {
        kind: VaultCreationQueueKind.WaitingForDevice,
        request: { kind: PendingVaultCreationKind.SentinelParticipantKey },
      }
      return ''
    }
    pendingVaultCreationState = { kind: VaultCreationQueueKind.Idle }
    return sentinelGenesisActions.createPublicKeyAnnouncement(vault)
  }

  async function handleCreateSentinelParticipantResponse(
    requestPayload: string,
  ): Promise<string> {
    if (!vault.deviceProtectionReady) {
      pendingVaultCreationState = {
        kind: VaultCreationQueueKind.WaitingForDevice,
        request: {
          kind: PendingVaultCreationKind.SentinelParticipantResponse,
          requestPayload,
        },
      }
      return ''
    }
    pendingVaultCreationState = { kind: VaultCreationQueueKind.Idle }
    return sentinelGenesisActions.createParticipantResponse(
      vault,
      requestPayload,
    )
  }

  async function handleAcceptSentinelOnboarding(packageJson: string) {
    if (!vault.deviceProtectionReady) {
      pendingVaultCreationState = {
        kind: VaultCreationQueueKind.WaitingForDevice,
        request: {
          kind: PendingVaultCreationKind.SentinelOnboarding,
          packageJson,
        },
      }
      return
    }
    pendingVaultCreationState = { kind: VaultCreationQueueKind.Idle }
    await sentinelGenesisActions.acceptOnboardingPackage(vault, packageJson)
    sentinelOnboardingPackage = ''
  }

  async function refreshExtensionSetupStatus() {
    if (!SUPPORTS_EXTENSION || !vault.isAuthenticated) {
      extensionSetupStateValue = { kind: ExtensionSetupOfferKind.Hidden }
      return
    }
    extensionSetupStateValue = await loadExtensionSetupOffer(vault.activeVault)
  }

  async function handleExtensionInstall() {
    extensionInstallBusy = true
    try {
      await openExtensionInstaller()
    } finally {
      extensionInstallBusy = false
    }
  }

  async function handleExtensionConnect() {
    extensionInstallBusy = true
    extensionConnectError = false
    try {
      extensionConnectError = !(await connectInstalledExtension())
    } finally {
      extensionInstallBusy = false
    }
  }

  $effect(() => {
    void vault.isAuthenticated
    void vault.activeVault
    void refreshExtensionSetupStatus()

    return observeExtensionSetupChanges(refreshExtensionSetupStatus)
  })

  $effect(() => {
    if (
      pendingVaultCreationState.kind !==
        VaultCreationQueueKind.WaitingForDevice ||
      !vault.deviceProtectionReady ||
      vault.isVerifying
    )
      return
    const pending = pendingVaultCreationState.request
    pendingVaultCreationState = { kind: VaultCreationQueueKind.Idle }
    if (pending.kind === PendingVaultCreationKind.Simple) {
      void vault.createLocalVaultWithDeviceKeys(pending.label)
      return
    }
    if (
      pending.kind === PendingVaultCreationKind.SentinelParticipantKey ||
      pending.kind === PendingVaultCreationKind.SentinelParticipantResponse
    )
      return
    if (pending.kind === PendingVaultCreationKind.SentinelOnboarding) {
      void handleAcceptSentinelOnboarding(pending.packageJson)
      return
    }
    void vault.startSentinelGenesis(pending.args)
  })

  $effect(() => {
    const storeId =
      vault.activeVault.kind === ActiveVaultKind.Open
        ? vault.activeVault.storeId.trim()
        : ''
    if (
      extensionIdentityRequestState.kind ===
        ExtensionConnectIntentKind.Requested &&
      extensionIdentityRequestState.request.source ===
        ExtensionIdentityRequestSource.PairedVault &&
      extensionIdentityRequestState.request.vaultStoreId !== storeId
    ) {
      extensionIdentityRequestState = {
        kind: ExtensionConnectIntentKind.Absent,
      }
    }
    if (
      !SUPPORTS_EXTENSION ||
      extensionConnectRoute ||
      vault.isAuthenticated ||
      vault.isInitializing ||
      vault.isVerifying ||
      (!vault.localVaultPresent &&
        !(
          vault.loginRequiresExistingVault &&
          vault.loginSetup.kind === LoginSetupKind.Active
        )) ||
      !storeId ||
      extensionDiscoveryStoreId === storeId
    ) {
      return
    }
    void resumePairedExtensionVault(storeId)
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
    const importPending =
      pendingExistingVaultImportState.kind ===
      ExistingVaultImportQueueKind.WaitingForDevice
    void (importPending ? resumeExistingVaultImport() : vault.loadDb())
  })

  // `#enroll=` lands on an empty browser: open device protection immediately so
  // the create-vault landing never appears as the primary action.
  $effect(() => {
    if (
      !urlEnrollmentPending ||
      vault.deviceProtectionReady ||
      vault.isInitializing
    ) {
      return
    }
    pendingEnrollmentDeviceUnlock = true
  })

  $effect(() => {
    if (
      pendingEnrollmentSubmitState.kind !==
        EnrollmentSubmitQueueKind.WaitingForDevice ||
      !vault.deviceProtectionReady ||
      vault.isVerifying
    ) {
      return
    }
    const pending = pendingEnrollmentSubmitState.request
    pendingEnrollmentSubmitState = { kind: EnrollmentSubmitQueueKind.Idle }
    pendingEnrollmentDeviceUnlock = false
    void vault.connectWithEnrollmentCode(pending.code, pending.password)
  })
</script>

{#if appLogsPage}
  <AppLogsApiPage />
{:else}
  <main
    class="min-h-svh min-w-0 max-w-full overflow-x-clip bg-background text-foreground"
    class:dark={colorMode === ColorMode.Dark}
  >
    <AppHeader
      {vault}
      {colorMode}
      {shellWidth}
      legalPageOpen={legalPageState.kind === LegalRouteKind.Legal}
      {logsPage}
      {extensionConnectRoute}
      onNavigateHome={navigateHome}
      onToggleColorMode={toggleColorMode}
    />

    <div
      class="mx-auto px-4 sm:px-6 {shellWidth} {shellSpacing}"
      data-testid="app-shell-content"
    >
      {#if logsPage}
        <LogsPage onClose={navigateHome} />
      {:else if legalPageState.kind === LegalRouteKind.Legal}
        <LegalDocumentPage
          {vault}
          pageId={legalPageState.page}
          onClose={navigateHome}
        />
      {:else if vault.helpOpen}
        <AppHelpWorkspace {vault} {colorMode} {appVersion} />
      {:else if extensionConnectRoute && extensionConnectRequestState.kind === ExtensionConnectIntentKind.Absent}
        <InvalidExtensionConnectWorkspace {vault} onClose={navigateHome} />
      {:else if !vault.isAuthenticated}
        <VaultAccessGate
          {vault}
          showAccessGate={vault.deviceProtectionReady ||
            showLoginWithoutPasskey ||
            existingVaultNeedsDeviceUnlock}
          {existingVaultNeedsDeviceUnlock}
          usesExtensionDeviceIdentity={extensionIdentityRequestState.kind ===
            ExtensionConnectIntentKind.Requested &&
            (extensionIdentityRequestState.request.source ===
              ExtensionIdentityRequestSource.PairedVault ||
              !requiresPasskeyFirst ||
              extensionBackedVaultSession ||
              vault.deviceProtectionStatus === DeviceProtectionStatus.Missing)}
          showPasskeyOverlay={showPasskeyOverlay ||
            showExistingVaultPasskeyOverlay ||
            showEnrollmentPasskeyOverlay}
          {sentinelInvitationRequest}
          {sentinelParticipantResponse}
          {sentinelOnboardingPackage}
          onUnlock={handleUnlock}
          onUseEnrollmentCode={handleUseEnrollmentCode}
          onAcceptSentinelOnboardingPackage={handleAcceptSentinelOnboarding}
          onUnlockWithPassword={handlePasswordUnlock}
          onSwitchVault={leaveExistingVaultImport}
          onSentinelUnlocked={finishExistingVaultImport}
          onCreateDeviceVault={handleCreateDeviceVault}
          onStartSentinelGenesis={handleStartSentinelGenesis}
          onCreateSentinelParticipantKey={handleCreateSentinelParticipantKey}
          onCreateSentinelParticipantResponse={handleCreateSentinelParticipantResponse}
          onDismissPasskey={() => {
            if (showExistingVaultPasskeyOverlay) {
              pendingExistingVaultUnlock = false
              pendingExistingVaultImportState = {
                kind: ExistingVaultImportQueueKind.Idle,
              }
              vault.clearExistingVaultRecoverySummary()
              return
            }
            if (showEnrollmentPasskeyOverlay) {
              pendingEnrollmentDeviceUnlock = false
              return
            }
            pendingVaultCreationState = {
              kind: VaultCreationQueueKind.Idle,
            }
          }}
        />
      {:else if extensionConnectRequestState.kind === ExtensionConnectIntentKind.Requested}
        <ExtensionConnectConsentWorkspace
          {vault}
          request={extensionConnectRequestState.request}
          {appVersion}
          onClose={finishExtensionConnect}
        />
      {:else if vault.isAuthenticated}
        <AuthenticatedVaultWorkspace
          {vault}
          extensionSetupState={extensionSetupStateValue}
          {extensionInstallBusy}
          {extensionConnectError}
          hasSecurityRecommendations={vaultSecurityRecommendations.hasRecommendations}
          needsSyncProvider={vaultSecurityRecommendations.needsSyncProvider}
          needsAnotherDevice={vaultSecurityRecommendations.needsAnotherDevice}
          onExtensionInstall={() => void handleExtensionInstall()}
          onExtensionConnect={() => void handleExtensionConnect()}
          onSettingsReconnect={handleSettingsReconnect}
          onEditorOpenChange={(open) => {
            secretsAddOpen = open
          }}
        />
      {/if}
    </div>

    <AppPersistentChrome
      {vault}
      showFooter={legalPageState.kind === LegalRouteKind.Application &&
        !logsPage &&
        !extensionConnectRoute}
    />
  </main>
{/if}
