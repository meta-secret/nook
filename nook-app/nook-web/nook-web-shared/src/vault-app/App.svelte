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
    set_vault_session_locked,
    type StartSentinelGenesisArgs,
  } from '$app-wasm'
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
    ExistingVaultPasswordUnlock,
  } from '$lib/app/app-interaction-types'
  import {
    ExtensionSetupOfferModel,
    type ExtensionSetupOfferSource,
  } from '$lib/app/extension-setup-offer.svelte'
  import {
    APP_SHELL_WIDTH,
    APP_VERSION,
    ApplicationShellLayout,
  } from '$lib/app/shell-layout'
  import {
    assess_identity_health,
    provider_carries_device_join,
    configured_vault_application_is_simple,
    configured_vault_application_is_sentinel,
    configured_vault_application_supports_extension,
  } from '$app-wasm'
  import * as deviceProtectionActions from '$lib/vault/device-protection.svelte'
  import {
    DeviceKeyUnlockPresentation,
    type DeviceKeySheetRequest,
    type VaultUnlockRequest,
  } from '$lib/vault/device-key-unlock'
  import { ExistingVaultUnlockWait } from '$lib/vault/existing-vault-unlock.svelte'
  import * as sentinelGenesisActions from '$lib/vault/sentinel-genesis'
  import { ExistingVaultImportLifecycle } from '$lib/vault/existing-vault-import.svelte'
  import { ProviderVaultActions } from '$lib/vault/provider-vaults'
  import { FirstRunActions } from '$lib/vault/first-run'
  import {
    THEME_STORAGE_KEY,
    vaultBrowserLifecycle,
  } from '$lib/app/browser-lifecycle'
  import { LoginSetupKind } from '$lib/vault/state/provider.svelte'
  import {
    WorkspaceRouteLookupKind,
    WorkspacePath,
  } from '$lib/app/workspace-route'
  import { VaultWorkspaceActions } from '$lib/vault/ui'
  import {
    VaultAppRouteCoordinator,
    type VaultAppRouteCoordinatorRequest,
  } from '$lib/app/vault-app-route-coordinator.svelte'

  const IS_SIMPLE_APP = configured_vault_application_is_simple()
  const IS_SENTINEL_APP = configured_vault_application_is_sentinel()
  const SUPPORTS_EXTENSION = configured_vault_application_supports_extension()
  const vault = new VaultState()
  const existingVaultImportLifecycle = new ExistingVaultImportLifecycle(vault)

  function unlockExistingVaultWithPassword(
    request: ExistingVaultPasswordUnlock,
  ): Promise<void> {
    return existingVaultImportLifecycle.unlockWithPassword(request)
  }

  function setSecretsAddOpen(open: boolean): void {
    secretsAddOpen = open
  }
  /** Day-2 health of the identity: a copy elsewhere, then a second app. */
  const identityHealth = $derived(
    assess_identity_health(
      vault.syncProviders.length,
      vault.syncProviders.filter((provider) =>
        provider_carries_device_join(provider),
      ).length,
      vault.identityControl.memberCount(vault.vaultMembers.length),
      vault.secretTotal,
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
  const extensionSetupOfferSource: ExtensionSetupOfferSource = {
    vault: untrack(() => vault),
    supported: SUPPORTS_EXTENSION,
  }
  const extensionSetupOffer = new ExtensionSetupOfferModel(
    extensionSetupOfferSource,
  )
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
  async function handleUnlock(): Promise<void> {
    const request: VaultUnlockRequest = {
      presentation: DeviceKeyUnlockPresentation.Sheet,
    }
    await unlockVault(request)
  }

  /** A vault unlocked from its identity card: the same path, but this
   * browser's key is unlocked on the card. */
  async function handleCardUnlock(): Promise<void> {
    const request: VaultUnlockRequest = {
      presentation: DeviceKeyUnlockPresentation.Card,
    }
    await unlockVault(request)
  }

  async function unlockVault({
    presentation,
  }: VaultUnlockRequest): Promise<void> {
    // The person's own unlock ends their explicit lock.
    set_vault_session_locked(false)
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
    if (existingVaultImport) {
      const discovered = await vault.discoverStagedVaultStoreId()
      if (discovered.isErr()) {
        vault.errorMsg = vault.t(discovered.error.translationKey)
        return
      }
      const activeStoreId = discovered.value
      // Several vaults wait for the user's choice; the import continues
      // once one is chosen.
      if (vault.remoteVaultChoices.length > 0) return
      if (!activeStoreId) {
        vault.errorMsg = vault.t(I18N_KEYS.AuthStorageExistingVaultNotFound)
        return
      }
      existingVaultImportLifecycle.remember(activeStoreId)
    }
    if (existingVaultNeedsDeviceUnlock || existingVaultImportNeedsIdentity) {
      // A card shows its key unlock, a failure, and recovery itself: no
      // sheet. The sheet stays for setting up a key this browser lacks.
      const sheetRequest: DeviceKeySheetRequest = {
        presentation,
        status: vault.deviceProtectionStatus,
      }
      existingVaultUnlock.begin(sheetRequest)
      if (vault.deviceProtectionStatus === DeviceProtectionStatus.Passkey) {
        const deviceProtectionUnlockRequest: Parameters<
          deviceProtectionActions.DeviceProtectionActions['unlockDeviceProtection']
        >[0] = { initializeSession: true }
        await new deviceProtectionActions.DeviceProtectionActions(
          vault,
        ).unlockDeviceProtection(deviceProtectionUnlockRequest)
      }
      existingVaultUnlock.settle(vault.deviceProtectionReady)
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
  const shellWidth = APP_SHELL_WIDTH
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
  const existingVaultUnlock = new ExistingVaultUnlockWait()
  let pendingEnrollmentDeviceUnlock = $state(false)
  let pendingEnrollmentSubmitState = $state<EnrollmentSubmitQueue>({
    kind: EnrollmentSubmitQueueKind.Idle,
  })
  const showPasskeyOverlay = $derived(
    pendingVaultCreationState.kind ===
      VaultCreationQueueKind.WaitingForDevice && !vault.deviceProtectionReady,
  )
  const showExistingVaultPasskeyOverlay = $derived(
    existingVaultUnlock.sheetShown(existingVaultNeedsDeviceUnlock),
  )
  // A join waits for this browser's key whether its invite came in the URL
  // or was pasted; either way the passkey asks to make or unlock it.
  const showEnrollmentPasskeyOverlay = $derived(
    pendingEnrollmentDeviceUnlock &&
      (urlEnrollmentPending ||
        pendingEnrollmentSubmitState.kind ===
          EnrollmentSubmitQueueKind.WaitingForDevice) &&
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

  async function handleCreateDeviceVault(label: string) {
    if (!vault.deviceProtectionReady) {
      pendingVaultCreationState = {
        kind: VaultCreationQueueKind.WaitingForDevice,
        request: { kind: PendingVaultCreationKind.Simple, label },
      }
      return
    }
    pendingVaultCreationState = { kind: VaultCreationQueueKind.Idle }
    await new FirstRunActions(vault).createWithDeviceKeys(label)
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

  $effect(() => {
    void vault.isAuthenticated
    return extensionSetupOffer.follow()
  })

  // A confirmed empty-vault swap finishes once the chosen vault is open.
  $effect(() => {
    void new ProviderVaultActions(vault).completeEmptyVaultReplacement()
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
      void new FirstRunActions(vault).createWithDeviceKeys(pending.label)
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
    if (
      !existingVaultUnlock.pending ||
      !vault.deviceProtectionReady ||
      vault.isVerifying
    ) {
      return
    }
    existingVaultUnlock.pending = false
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
    onUnlockOnCard: handleCardUnlock,
    identityHealth,
    onUseEnrollmentCode: handleUseEnrollmentCode,
    onAcceptSentinelOnboardingPackage: handleAcceptSentinelOnboarding,
    onUnlockWithPassword: unlockExistingVaultWithPassword,
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
        existingVaultUnlock.pending = false
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
    extensionSetupState: extensionSetupOffer.offer,
    identityHealth,
    onExtensionOpenPanel: () => void extensionSetupOffer.openSidePanel(),
    onSettingsReconnect: handleSettingsReconnect,
    onEditorOpenChange: setSecretsAddOpen,
  }}
  onNavigateHome={routeCoordinator.navigateHome}
  onToggleColorMode={toggleColorMode}
  onFinishExtensionConnect={routeCoordinator.finishExtensionConnect}
/>
