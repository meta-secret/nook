<script lang="ts">
  import { err } from 'neverthrow'
  import {
    VaultStorageFailure,
    VaultStorageFailureKind,
  } from '$lib/runtime/storage-failure'
  import type { SentinelActionResult } from '$lib/vault/sentinel-genesis'
  import { I18N_KEYS } from '../generated/i18n-keys'
  import { onMount, untrack } from 'svelte'
  import { VaultState } from '$lib/vault.svelte'
  import {
    DeviceProtectionStatus,
    ExternalDeviceIdentityAuthorizationMode,
    type StartSentinelGenesisArgs,
  } from '$app-wasm'
  import {
    ExtensionConnectIntentKind,
  } from '$lib/app/route-state'
  import { ColorMode, browserColorMode } from '$lib/app/theme'
  import {
    type EnrollmentSubmitQueue,
    EnrollmentSubmitQueueKind,
    PendingVaultCreationView as PendingCreation,
    PendingVaultCreationKind,
    type VaultCreationQueue,
    VaultCreationQueueKind,
  } from '$lib/vault/creation-queue'
  import AppSurface from '$lib/components/app/AppSurface.svelte'
  import type {
    EnrollmentCodeUseRequest,
    PairedExtensionDiscoveryRetry,
    PairedExtensionUnlockPoll,
  } from '$lib/app/app-interaction-types'
  import {
    ExtensionIdentityRequestSource,
    extensionConnectionBrowser as connectionBrowser,
  } from '$lib/extension/connect'
  import {
    ExtensionSetupOfferKind,
    type ExtensionSetupOffer,
    extensionSetupBrowser,
  } from '$lib/app/extension-setup'
  import {
    APP_SHELL_WIDTH,
    APP_SHELL_WIDTH_WIDE,
    APP_VERSION,
    ApplicationShellLayout,
  } from '$lib/app/shell-layout'
  import { SettingsSection } from '$lib/vault/state/ui.svelte'
  import {
    assess_vault_security,
    configured_vault_application_is_simple,
    configured_vault_application_is_sentinel,
    configured_vault_application_supports_extension,
  } from '$app-wasm'
  import * as deviceProtectionActions from '$lib/vault/device-protection.svelte'
  import * as sentinelGenesisActions from '$lib/vault/sentinel-genesis'
  import { ExistingVaultImportLifecycle } from '$lib/vault/existing-vault-import.svelte'
  import {
    THEME_STORAGE_KEY,
    vaultBrowserLifecycle,
  } from '$lib/app/browser-lifecycle'
  import {
    ActiveVaultKind,
    LoginSetupKind,
  } from '$lib/vault/state/provider.svelte'
  import {
    WorkspaceRouteLookupKind,
    WorkspacePath,
  } from '$lib/app/workspace-route'
  import { VaultWorkspaceActions } from '$lib/vault/ui'
  import { ExtensionPairedVaultIdentityStatusMessageStatus } from '$web-shared/extension/paired-vault-identity-status'
  import {
    VaultAppRouteCoordinator,
    type VaultAppRouteCoordinatorRequest,
  } from '$lib/app/vault-app-route-coordinator.svelte'

  const IS_SIMPLE_APP = configured_vault_application_is_simple()
  const IS_SENTINEL_APP = configured_vault_application_is_sentinel()
  const SUPPORTS_EXTENSION = configured_vault_application_supports_extension()
  const vault = new VaultState()
  const existingVaultImportLifecycle = new ExistingVaultImportLifecycle(vault)

  type ExistingVaultPasswordUnlock = {
    readonly entryId: string
    readonly password: string
  }

  function unlockExistingVaultWithPassword(
    request: ExistingVaultPasswordUnlock,
  ): Promise<void> {
    return existingVaultImportLifecycle.unlockWithPassword(request)
  }

  function setSecretsAddOpen(open: boolean): void {
    secretsAddOpen = open
  }
  const vaultSecurityRecommendations = $derived(
    assess_vault_security(
      vault.syncProviders.length,
      vault.vaultMembers.length,
    ),
  )
  let colorMode = $state<ColorMode>(browserColorMode.systemColorMode())
  let followsSystemColorMode = $state(true)
  let pendingVaultCreationState = $state<VaultCreationQueue>({
    kind: VaultCreationQueueKind.Idle,
  })
  const routeCoordinatorRequest: VaultAppRouteCoordinatorRequest = {
    vault,
    isSimpleApplication: IS_SIMPLE_APP,
    supportsExtension: SUPPORTS_EXTENSION,
    isSentinelParticipantResponsePending: () =>
      new PendingCreation(
        pendingVaultCreationState,
      ).isSentinelParticipantResponsePending(),
    isSentinelParticipantKeyPending: () =>
      new PendingCreation(
        pendingVaultCreationState,
      ).isSentinelParticipantKeyPending(),
    finishPendingCreation: () => {
      pendingVaultCreationState = { kind: VaultCreationQueueKind.Idle }
    },
  }
  const routeCoordinator = new VaultAppRouteCoordinator(routeCoordinatorRequest)
  let extensionBackedVaultSession = $state(false)
  let extensionDiscoveryStoreId = $state('')
  let extensionSetupStateValue = $state<ExtensionSetupOffer>({
    kind: ExtensionSetupOfferKind.Hidden,
  })
  let extensionInstallBusy = $state(false)
  let extensionConnectError = $state(false)
  const EXTENSION_LOCKED_RETRY_MS = 3_000
  $effect(() => {
    if (!vault.isAuthenticated || !('window' in globalThis)) return
    const workspaceRoute = new WorkspacePath(window.location.pathname).route
    if (workspaceRoute.kind === WorkspaceRouteLookupKind.Workspace) {
      untrack(() =>
        (() => {
          const workspaceRouteRequest: Parameters<
            VaultWorkspaceActions['applyWorkspaceRoute']
          >[0] = {
            route: workspaceRoute.route,
          }
          return new VaultWorkspaceActions(vault).applyWorkspaceRoute(
            workspaceRouteRequest,
          )
        })(),
      )
    }
  })
  onMount(() => {
    const mountBrowserLifecycleArgs: Parameters<
      typeof vaultBrowserLifecycle.mountBrowserLifecycle
    >[0] = {
      vault,
      followsSystemColorMode: () => followsSystemColorMode,
      setColorMode: (mode) => {
        colorMode = mode
      },
      stopFollowingSystemColorMode: () => {
        followsSystemColorMode = false
      },
      syncRoute: routeCoordinator.syncRoute,
    }
    return vaultBrowserLifecycle.mountBrowserLifecycle(
      mountBrowserLifecycleArgs,
    )
  })
  $effect(() => {
    const applicationDocumentUpdate: Parameters<
      typeof vaultBrowserLifecycle.updateApplicationDocument
    >[0] = {
      colorMode,
      legalRoute: routeCoordinator.legalPageState,
      logsPage: routeCoordinator.logsPage,
      extensionConnectRoute: routeCoordinator.extensionConnectRoute,
      sentinelApplication: IS_SENTINEL_APP,
    }
    vaultBrowserLifecycle.updateApplicationDocument(applicationDocumentUpdate)
  })
  async function handleUnlock(skipExtensionDiscovery = false) {
    const existingVaultImport =
      vault.loginRequiresExistingVault &&
      vault.loginSetup.kind === LoginSetupKind.Active
    const existingVaultImportNeedsIdentity =
      vault.clientPolicy.existing_vault_identity_recovery_required(
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
    let activeStoreId = existingVaultImportLifecycle.unlockStoreId
    if (existingVaultImport) {
      const discovered = await vault.discoverStagedVaultStoreId()
      if (discovered.isErr()) {
        vault.errorMsg = vault.t(discovered.error.translationKey)
        return
      }
      activeStoreId = discovered.value
      if (!activeStoreId) {
        vault.errorMsg = vault.t(I18N_KEYS.AuthStorageExistingVaultNotFound)
        return
      }
      existingVaultImportLifecycle.remember(activeStoreId)
    }
    if (
      routeCoordinator.extensionIdentityRequestState.kind ===
        ExtensionConnectIntentKind.Requested &&
      routeCoordinator.extensionIdentityRequestState.request.source ===
        ExtensionIdentityRequestSource.PairedVault &&
      routeCoordinator.extensionIdentityRequestState.request.vaultStoreId ===
        activeStoreId &&
      !vault.isVerifying &&
      !vault.deviceAuthorizationInProgress
    ) {
      const connectRequest = routeCoordinator.extensionIdentityRequestState.request
      const authorizeWithExternalDeviceIdentityArgs: Parameters<
        typeof vault.authorizeWithExternalDeviceIdentity
      >[0] = {
        adopt: (manager) => {
          const extensionIdentityAdoption: Parameters<
            typeof connectionBrowser.adoptExtensionIdentity
          >[0] = {
            manager,
            request: connectRequest,
          }
          return connectionBrowser.adoptExtensionIdentity(
            extensionIdentityAdoption,
          )
        },
        mode: existingVaultImport
          ? ExternalDeviceIdentityAuthorizationMode.DeferInitialization
          : ExternalDeviceIdentityAuthorizationMode.ContinueInitialization,
      }
      const adopted = await vault.authorizeWithExternalDeviceIdentity(
        authorizeWithExternalDeviceIdentityArgs,
      )
      if (adopted) {
        extensionBackedVaultSession = true
        await (existingVaultImport
          ? existingVaultImportLifecycle.resume()
          : vault.loadDb())
        return
      }
      if (skipExtensionDiscovery) {
        return
      }
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
          ExtensionPairedVaultIdentityStatusMessageStatus.Locked ||
        discoveryStatus ===
          ExtensionPairedVaultIdentityStatusMessageStatus.Unlocked
      ) {
        if (
          discoveryStatus ===
          ExtensionPairedVaultIdentityStatusMessageStatus.Locked
        ) {
          await connectionBrowser.requestPairedExtensionUnlock(activeStoreId)
        }
        const pairedExtensionUnlockRequest: Parameters<
          typeof waitForPairedExtensionUnlock
        >[0] = {
          storeId: activeStoreId,
        }
        await waitForPairedExtensionUnlock(pairedExtensionUnlockRequest)
        if (vault.isAuthenticated) return
      }
    }
    if (skipExtensionDiscovery) {
      return
    }
    if (existingVaultNeedsDeviceUnlock || existingVaultImportNeedsIdentity) {
      if (
        routeCoordinator.extensionIdentityRequestState.kind ===
        ExtensionConnectIntentKind.Requested
      ) {
        const connectRequest = routeCoordinator.extensionIdentityRequestState.request
        const extensionIdentityCanUnlock =
          (connectRequest.source !==
            ExtensionIdentityRequestSource.PairedVault ||
            connectRequest.vaultStoreId === activeStoreId) &&
          (connectRequest.source ===
            ExtensionIdentityRequestSource.PairedVault ||
            extensionBackedVaultSession ||
            vault.deviceProtectionStatus === DeviceProtectionStatus.Missing)
        if (extensionIdentityCanUnlock) {
          const authorizeWithExternalDeviceIdentityArgs2: Parameters<
            typeof vault.authorizeWithExternalDeviceIdentity
          >[0] = {
            adopt: (manager) => {
              const extensionIdentityAdoption: Parameters<
                typeof connectionBrowser.adoptExtensionIdentity
              >[0] = {
                manager,
                request: connectRequest,
              }
              return connectionBrowser.adoptExtensionIdentity(
                extensionIdentityAdoption,
              )
            },
            mode: existingVaultImport
              ? ExternalDeviceIdentityAuthorizationMode.DeferInitialization
              : ExternalDeviceIdentityAuthorizationMode.ContinueInitialization,
          }
          const adopted = await vault.authorizeWithExternalDeviceIdentity(
            authorizeWithExternalDeviceIdentityArgs2,
          )
          if (!adopted) return
          extensionBackedVaultSession = true
          await (existingVaultImport
            ? existingVaultImportLifecycle.resume()
            : vault.loadDb())
          return
        }
      }
      pendingExistingVaultUnlock = true
      if (vault.deviceProtectionStatus === DeviceProtectionStatus.Passkey) {
        const deviceProtectionUnlockRequest: Parameters<
          deviceProtectionActions.DeviceProtectionActions['unlockDeviceProtection']
        >[0] = { initializeSession: true }
        await new deviceProtectionActions.DeviceProtectionActions(
          vault,
        ).unlockDeviceProtection(deviceProtectionUnlockRequest)
      }
      return
    }
    if (existingVaultImport) {
      await existingVaultImportLifecycle.resume()
      return
    }
    if (vault.loginSetup.kind === LoginSetupKind.Active) {
      await vault.connectStagedProvider()
      return
    }
    await vault.loadDb()
  }
  async function handleSettingsReconnect() {
    if (vault.loginSetup.kind === LoginSetupKind.Active) {
      await vault.connectAndSyncStagedProvider()
      return
    }
    const synchronized = await vault.manualSync()
    if (synchronized.isErr())
      vault.errorMsg = vault.t(synchronized.error.translationKey)
  }
  function toggleColorMode() {
    followsSystemColorMode = false
    const manualColorModeRequest: Parameters<
      typeof browserColorMode.manualColorMode
    >[0] = {
      current: colorMode,
      storageKey: THEME_STORAGE_KEY,
    }
    colorMode = browserColorMode.manualColorMode(manualColorModeRequest)
  }
  const appVersion = APP_VERSION
  const shellWidth = $derived(
    vault.settingsOpen &&
      vault.settingsSection === SettingsSection.DevicesAccess
      ? APP_SHELL_WIDTH_WIDE
      : APP_SHELL_WIDTH,
  )
  let secretsAddOpen = $state(false)
  const shellSpacing = $derived.by(() => {
    const applicationShellLayoutRequest: ConstructorParameters<
      typeof ApplicationShellLayout
    >[0] = {
      legalRouteKind: routeCoordinator.legalPageState.kind,
      logsOpen: routeCoordinator.logsPage,
      extensionConnectOpen: routeCoordinator.extensionConnectRoute,
      authenticated: vault.isAuthenticated,
      editorOpen: secretsAddOpen,
    }
    return new ApplicationShellLayout(applicationShellLayoutRequest).spacing
  })
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

  async function handleUseEnrollmentCode({
    code,
    password,
  }: EnrollmentCodeUseRequest) {
    if (!vault.deviceProtectionReady) {
      pendingEnrollmentSubmitState = {
        kind: EnrollmentSubmitQueueKind.WaitingForDevice,
        request: { code, password },
      }
      pendingEnrollmentDeviceUnlock = true
      return
    }
    pendingEnrollmentSubmitState = {
      kind: EnrollmentSubmitQueueKind.Idle,
    }
    const enrollmentConnectionRequest: Parameters<
      typeof vault.connectWithEnrollmentCode
    >[0] = {
      code,
      password,
    }
    await vault.connectWithEnrollmentCode(enrollmentConnectionRequest)
  }

  async function resumePairedExtensionVault(
    storeId: string,
  ): Promise<
    | typeof ExtensionPairedVaultIdentityStatusMessageStatus.Unavailable
    | typeof ExtensionPairedVaultIdentityStatusMessageStatus.Locked
    | typeof ExtensionPairedVaultIdentityStatusMessageStatus.Unlocked
  > {
    const discoveringStagedImport =
      vault.loginRequiresExistingVault &&
      vault.loginSetup.kind === LoginSetupKind.Active
    extensionDiscoveryStoreId = storeId
    const discovery =
      await connectionBrowser.discoverPairedExtensionIdentity(storeId)
    const openVaultIsDifferentStore =
      vault.activeVault.kind === ActiveVaultKind.Open &&
      vault.activeVault.storeId !== storeId
    if (
      vault.isAuthenticated ||
      routeCoordinator.extensionConnectRoute ||
      vault.isVerifying ||
      vault.deviceAuthorizationInProgress ||
      (openVaultIsDifferentStore && !discoveringStagedImport)
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
      const discoveryRetryRequest: Parameters<
        typeof schedulePairedExtensionDiscoveryRetry
      >[0] = {
        storeId,
        discoveringStagedImport,
      }
      schedulePairedExtensionDiscoveryRetry(discoveryRetryRequest)
      return ExtensionPairedVaultIdentityStatusMessageStatus.Locked
    }
    if (
      discovery.status !==
      ExtensionPairedVaultIdentityStatusMessageStatus.Unlocked
    ) {
      const discoveryRetryRequest: Parameters<
        typeof schedulePairedExtensionDiscoveryRetry
      >[0] = {
        storeId,
        discoveringStagedImport,
      }
      schedulePairedExtensionDiscoveryRetry(discoveryRetryRequest)
      return ExtensionPairedVaultIdentityStatusMessageStatus.Unavailable
    }
    routeCoordinator.extensionIdentityRequestState = {
      kind: ExtensionConnectIntentKind.Requested,
      request: discovery.request,
    }
    await handleUnlock(true)
    return ExtensionPairedVaultIdentityStatusMessageStatus.Unlocked
  }

  const PAIRED_EXTENSION_UNLOCK_TIMEOUT_MS = 30_000
  const PAIRED_EXTENSION_UNLOCK_RETRY_MS = 350

  async function waitForPairedExtensionUnlock(
    request: PairedExtensionUnlockPoll,
  ): Promise<void> {
    const deadline = Date.now() + PAIRED_EXTENSION_UNLOCK_TIMEOUT_MS
    for (let attempt = 0; Date.now() < deadline; attempt += 1) {
      if (attempt > 0) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, PAIRED_EXTENSION_UNLOCK_RETRY_MS)
        })
      }
      await resumePairedExtensionVault(request.storeId)
      if (vault.isAuthenticated) {
        return
      }
    }
  }

  function schedulePairedExtensionDiscoveryRetry(
    request: PairedExtensionDiscoveryRetry,
  ) {
    window.setTimeout(() => {
      if (
        !vault.isAuthenticated &&
        (existingVaultImportLifecycle.unlockStoreId === request.storeId ||
          request.discoveringStagedImport) &&
        extensionDiscoveryStoreId === request.storeId
      ) {
        extensionDiscoveryStoreId = ''
      }
    }, EXTENSION_LOCKED_RETRY_MS)
  }

  async function handleCreateDeviceVault(label: string) {
    if (
      routeCoordinator.extensionIdentityRequestState.kind ===
        ExtensionConnectIntentKind.Requested &&
      vault.deviceId !== routeCoordinator.extensionIdentityRequestState.request.deviceId
    ) {
      const connectRequest = routeCoordinator.extensionIdentityRequestState.request
      const authorizationRequest: Parameters<
        typeof vault.authorizeWithExternalDeviceIdentity
      >[0] = {
        adopt: (manager) => {
          const extensionIdentityAdoption: Parameters<
            typeof connectionBrowser.adoptExtensionIdentity
          >[0] = {
            manager,
            request: connectRequest,
          }
          return connectionBrowser.adoptExtensionIdentity(
            extensionIdentityAdoption,
          )
        },
        mode: ExternalDeviceIdentityAuthorizationMode.ContinueInitialization,
      }
      const adopted =
        await vault.authorizeWithExternalDeviceIdentity(authorizationRequest)
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
      routeCoordinator.extensionIdentityRequestState.kind ===
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
    const started = await vault.startSentinelGenesis(args)
    if (started.isErr()) {
      vault.errorMsg = vault.t(started.error.translationKey)
      return false
    }
    return true
  }
  function finishPendingCreation(): void {
    pendingVaultCreationState = { kind: VaultCreationQueueKind.Idle }
  }
  const sentinelParticipantKeyCreationRequest: ConstructorParameters<
    typeof sentinelGenesisActions.SentinelParticipantKeyCreationLifecycle
  >[0] = {
    vault,
    waitForDevice: () => {
      pendingVaultCreationState = {
        kind: VaultCreationQueueKind.WaitingForDevice,
        request: { kind: PendingVaultCreationKind.SentinelParticipantKey },
      }
    },
    finishPendingCreation,
  }
  const sentinelParticipantKeyCreation =
    new sentinelGenesisActions.SentinelParticipantKeyCreationLifecycle(
      sentinelParticipantKeyCreationRequest,
    )
  async function handleCreateSentinelParticipantResponse(
    requestPayload: string,
  ): Promise<SentinelActionResult<string>> {
    if (!vault.deviceProtectionReady) {
      pendingVaultCreationState = {
        kind: VaultCreationQueueKind.WaitingForDevice,
        request: {
          kind: PendingVaultCreationKind.SentinelParticipantResponse,
          requestPayload,
        },
      }
      return err(
        new VaultStorageFailure(
          VaultStorageFailureKind.DeviceAuthorizationRequired,
        ),
      )
    }

    const participantResponseRequest: Parameters<
      sentinelGenesisActions.SentinelGenesisActions['createParticipantResponse']
    >[0] = { requestPayload }
    return new sentinelGenesisActions.SentinelGenesisActions(vault)
      .createParticipantResponse(participantResponseRequest)
      .finally(finishPendingCreation)
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

    const onboardingPackageRequest: Parameters<
      sentinelGenesisActions.SentinelGenesisActions['acceptOnboardingPackage']
    >[0] = { packageJson }
    const accepted = await new sentinelGenesisActions.SentinelGenesisActions(
      vault,
    ).acceptOnboardingPackage(onboardingPackageRequest)
    if (accepted.isErr()) {
      vault.errorMsg = vault.t(accepted.error.translationKey)
      return
    }
    routeCoordinator.sentinelOnboardingPackage = ''
  }

  async function refreshExtensionSetupStatus() {
    if (!SUPPORTS_EXTENSION || !vault.isAuthenticated) {
      extensionSetupStateValue = { kind: ExtensionSetupOfferKind.Hidden }
      return
    }
    extensionSetupStateValue =
      await extensionSetupBrowser.loadExtensionSetupOffer(vault.activeVault)
  }

  async function handleExtensionInstall() {
    extensionInstallBusy = true
    try {
      await extensionSetupBrowser.openExtensionInstaller()
    } finally {
      extensionInstallBusy = false
    }
  }

  async function handleExtensionConnect() {
    extensionInstallBusy = true
    extensionConnectError = false
    try {
      extensionConnectError =
        !(await extensionSetupBrowser.connectInstalledExtension())
    } finally {
      extensionInstallBusy = false
    }
  }

  $effect(() => {
    void vault.isAuthenticated
    void vault.activeVault
    void refreshExtensionSetupStatus()

    return extensionSetupBrowser.observeExtensionSetupChanges(
      refreshExtensionSetupStatus,
    )
  })

  $effect(() => {
    if (
      vault.helpOpen &&
      new PendingCreation(
        pendingVaultCreationState,
      ).isSentinelParticipantKeyPending()
    )
      return finishPendingCreation()
    if (
      pendingVaultCreationState.kind !==
        VaultCreationQueueKind.WaitingForDevice ||
      !vault.deviceProtectionReady ||
      vault.isVerifying
    )
      return
    const pending = pendingVaultCreationState.request
    if (
      pending.kind === PendingVaultCreationKind.SentinelParticipantKey ||
      pending.kind === PendingVaultCreationKind.SentinelParticipantResponse
    )
      return
    pendingVaultCreationState = { kind: VaultCreationQueueKind.Idle }
    if (pending.kind === PendingVaultCreationKind.Simple) {
      void vault.createLocalVaultWithDeviceKeys(pending.label)
      return
    }
    if (pending.kind === PendingVaultCreationKind.SentinelOnboarding) {
      void handleAcceptSentinelOnboarding(pending.packageJson)
      return
    }
    if (pending.kind === PendingVaultCreationKind.Sentinel) {
      void vault.startSentinelGenesis(pending.args).then((started) => {
        if (started.isErr())
          vault.errorMsg = vault.t(started.error.translationKey)
      })
    }
  })

  $effect(() => {
    const storeId = existingVaultImportLifecycle.unlockStoreId
    if (
      routeCoordinator.extensionIdentityRequestState.kind ===
        ExtensionConnectIntentKind.Requested &&
      routeCoordinator.extensionIdentityRequestState.request.source ===
        ExtensionIdentityRequestSource.PairedVault &&
      storeId &&
      routeCoordinator.extensionIdentityRequestState.request.vaultStoreId !== storeId
    ) {
      routeCoordinator.extensionIdentityRequestState = {
        kind: ExtensionConnectIntentKind.Absent,
      }
    }
    if (
      !SUPPORTS_EXTENSION ||
      routeCoordinator.extensionConnectRoute ||
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
    void (existingVaultImportLifecycle.waitingForDevice
      ? existingVaultImportLifecycle.resume()
      : vault.loadDb())
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
    pendingEnrollmentSubmitState = {
      kind: EnrollmentSubmitQueueKind.Idle,
    }
    pendingEnrollmentDeviceUnlock = false
    void vault.connectWithEnrollmentCode(pending)
  })
</script>

<AppSurface
  {vault}
  appLogsPage={routeCoordinator.appLogsPage}
  {colorMode}
  {shellWidth}
  {shellSpacing}
  legalPageState={routeCoordinator.legalPageState}
  logsPage={routeCoordinator.logsPage}
  extensionConnectRoute={routeCoordinator.extensionConnectRoute}
  extensionSetupState={extensionSetupStateValue}
  {appVersion}
  extensionConnectRequestState={routeCoordinator.extensionConnectRequestState}
  preserveAccessGate={pendingVaultCreationState.kind ===
    VaultCreationQueueKind.WaitingForDevice ||
    Boolean(routeCoordinator.sentinelInvitationRequest.trim())}
  accessGateProps={{
    vault,
    showAccessGate:
      vault.deviceProtectionReady ||
      showLoginWithoutPasskey ||
      existingVaultNeedsDeviceUnlock,
    existingVaultNeedsDeviceUnlock,
    usesExtensionDeviceIdentity:
      routeCoordinator.extensionIdentityRequestState.kind ===
        ExtensionConnectIntentKind.Requested &&
      (routeCoordinator.extensionIdentityRequestState.request.source ===
        ExtensionIdentityRequestSource.PairedVault ||
        !requiresPasskeyFirst ||
        extensionBackedVaultSession ||
        vault.deviceProtectionStatus === DeviceProtectionStatus.Missing),
    showPasskeyOverlay:
      showPasskeyOverlay ||
      showExistingVaultPasskeyOverlay ||
      showEnrollmentPasskeyOverlay,
    sentinelInvitationRequest: routeCoordinator.sentinelInvitationRequest,
    sentinelParticipantResponsePending: new PendingCreation(
      pendingVaultCreationState,
    ).isSentinelParticipantResponsePending(),
    sentinelParticipantResponse: routeCoordinator.sentinelParticipantResponse,
    sentinelOnboardingPackage: routeCoordinator.sentinelOnboardingPackage,
    onUnlock: handleUnlock,
    onUseEnrollmentCode: handleUseEnrollmentCode,
    onAcceptSentinelOnboardingPackage: handleAcceptSentinelOnboarding,
    onUnlockWithPassword: unlockExistingVaultWithPassword,
    onSwitchVault: () => existingVaultImportLifecycle.leave(),
    onSentinelUnlocked: () => {
      routeCoordinator.sentinelInvitationRequest = ''
      return existingVaultImportLifecycle.finish()
    },
    onCreateDeviceVault: handleCreateDeviceVault,
    onStartSentinelGenesis: handleStartSentinelGenesis,
    onCreateSentinelParticipantKey: () =>
      sentinelParticipantKeyCreation.create(),
    onCreateSentinelParticipantResponse:
      handleCreateSentinelParticipantResponse,
    onDismissPasskey: () => {
      if (showExistingVaultPasskeyOverlay) {
        pendingExistingVaultUnlock = false
        existingVaultImportLifecycle.cancel()
        return
      }
      if (showEnrollmentPasskeyOverlay) {
        pendingEnrollmentDeviceUnlock = false
        return
      }
      pendingVaultCreationState = { kind: VaultCreationQueueKind.Idle }
    },
  }}
  authenticatedWorkspaceProps={{
    vault,
    extensionSetupState: extensionSetupStateValue,
    extensionInstallBusy,
    extensionConnectError,
    hasSecurityRecommendations: vaultSecurityRecommendations.hasRecommendations,
    needsSyncProvider: vaultSecurityRecommendations.needsSyncProvider,
    needsAnotherDevice: vaultSecurityRecommendations.needsAnotherDevice,
    onExtensionInstall: () => void handleExtensionInstall(),
    onExtensionConnect: () => void handleExtensionConnect(),
    onSettingsReconnect: handleSettingsReconnect,
    onEditorOpenChange: setSecretsAddOpen,
  }}
  onNavigateHome={routeCoordinator.navigateHome}
  onToggleColorMode={toggleColorMode}
  onExtensionConnect={handleExtensionConnect}
  onFinishExtensionConnect={routeCoordinator.finishExtensionConnect}
/>
