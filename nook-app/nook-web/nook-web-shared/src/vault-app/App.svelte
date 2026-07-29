<script lang="ts">
  import { onMount } from "svelte";
  import { VaultState } from "$lib/vault.svelte";
  import {
    DeviceProtectionStatus,
    JoinEnrollmentState,
  } from "$app-wasm";
  import {
    saveAuthProviders,
    type AuthProvidersSnapshot,
  } from "$lib/auth-providers";
  import {
    ColorMode,
    EnrollmentSubmitQueueKind,
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
    type ExtensionSetupOffer,
    type VaultCreationQueue,
  } from "$lib/app-lifecycle-state";
  import LegalDocumentPage from "$lib/components/LegalDocumentPage.svelte";
  import LogsPage from "$lib/components/LogsPage.svelte";
  import AppLogsApiPage from "$lib/components/AppLogsApiPage.svelte";
  import AppHelpWorkspace from "$lib/components/app/AppHelpWorkspace.svelte";
  import AppPersistentChrome from "$lib/components/app/AppPersistentChrome.svelte";
  import ExtensionConnectConsentWorkspace from "$lib/components/app/ExtensionConnectConsentWorkspace.svelte";
  import InvalidExtensionConnectWorkspace from "$lib/components/app/InvalidExtensionConnectWorkspace.svelte";
  import AppHeader from "$lib/components/app/AppHeader.svelte";
  import AuthenticatedVaultWorkspace from "$lib/components/app/AuthenticatedVaultWorkspace.svelte";
  import VaultAccessGate from "$lib/components/app/VaultAccessGate.svelte";
  import {
    appPath,
    getLegalPageFromPath,
    isLogsPath,
    legalPageForId,
  } from "$lib/legal-content";
  import { isAppLogsPath } from "$lib/app-logs-api";
  import {
    adoptExtensionIdentity,
    discoverPairedExtensionIdentity,
    extensionConnectRequestFromLocation,
    isExtensionConnectPath,
    openInstalledExtension,
    requestPairedExtensionUnlock,
  } from "$lib/extension-connect";
  import {
    loadExtensionInstallTarget,
    openExtensionInstallTarget,
    resolveExtensionSetupState,
    shouldOfferExtensionSetup,
  } from "$lib/extension-install";
  import {
    assessVaultSecurity,
    configuredVaultApplication,
    VaultApplication,
  } from "$app-wasm";
  import { consumeSentinelOnboardingFromLocation } from "$lib/sentinel-onboarding-link";
  import {
    APP_KIND,
    IS_SENTINEL_APP,
    SUPPORTS_EXTENSION,
  } from "$lib/app-kind";
  import {
    initialExtensionConnectIntent,
    initialLegalRoute,
  } from "$lib/app-route-state";
  import {
    consumeSentinelGenesisParticipantResponseFromLocation,
    consumeSentinelGenesisRequestFromLocation,
  } from "$lib/sentinel-genesis-link";
  import * as deviceProtectionActions from "$lib/vault/device-protection.svelte";
  import * as sentinelGenesisActions from "$lib/vault/sentinel-genesis";
  import { subscribeToLocalBrowserDataDeletion } from "$lib/browser-data";
  const vault = new VaultState();
  const vaultSecurityRecommendations = $derived(
    assessVaultSecurity(vault.syncProviders.length, vault.vaultMembers.length),
  );
  const THEME_STORAGE_KEY = "nook_color_mode";
  let colorMode = $state<ColorMode>(systemColorMode());
  let followsSystemColorMode = $state(true);
  let legalPageState = $state(initialLegalRoute());
  let logsPage = $state<boolean>(
    "window" in globalThis && isLogsPath(window.location.pathname),
  );
  let appLogsPage = $state<boolean>(
    "window" in globalThis && isAppLogsPath(window.location.pathname),
  );
  const initialExtensionConnectRequestState =
    initialExtensionConnectIntent(SUPPORTS_EXTENSION);
  let extensionConnectRoute = $state<boolean>(
    "window" in globalThis
      ? SUPPORTS_EXTENSION && isExtensionConnectPath(window.location.pathname)
      : false,
  );
  let extensionConnectRequestState = $state(
    initialExtensionConnectRequestState,
  );
  // Keep the public extension handoff request in memory after leaving the
  // consent route. On reload, the site asks the installed extension for a new
  // vault-bound handoff only when that extension already holds an approved
  // grant for the active local vault.
  let extensionIdentityRequestState = $state(
    initialExtensionConnectRequestState,
  );
  let extensionBackedVaultSession = $state(false);
  let extensionDiscoveryStoreId = $state("");
  let extensionSetupStateValue = $state<ExtensionSetupOffer>({
    kind: ExtensionSetupOfferKind.Hidden,
  });
  let extensionInstallBusy = $state(false);
  let extensionConnectError = $state(false);
  const EXTENSION_LOCKED_RETRY_MS = 3_000;
  let sentinelInvitationRequest = $state(
    "window" in globalThis && APP_KIND !== VaultApplication.Simple
      ? consumeSentinelGenesisRequestFromLocation()
      : "",
  );
  let sentinelParticipantResponse = $state(
    "window" in globalThis && APP_KIND !== VaultApplication.Simple
      ? consumeSentinelGenesisParticipantResponseFromLocation()
      : "",
  );
  let sentinelOnboardingPackage = $state(
    "window" in globalThis && APP_KIND !== VaultApplication.Simple
      ? consumeSentinelOnboardingFromLocation()
      : "",
  );

  function syncRoute() {
    const routeLegalPage = getLegalPageFromPath(window.location.pathname);
    legalPageState = legalRoute(routeLegalPage);
    logsPage = isLogsPath(window.location.pathname);
    appLogsPage = isAppLogsPath(window.location.pathname);
    extensionConnectRoute =
      SUPPORTS_EXTENSION && isExtensionConnectPath(window.location.pathname);
    const routeConnectRequest = SUPPORTS_EXTENSION
      ? extensionConnectRequestFromLocation(window.location)
      : false;
    extensionConnectRequestState = routeConnectRequest
      ? extensionConnectIntent(routeConnectRequest)
      : { kind: ExtensionConnectIntentKind.Absent };
    if (routeConnectRequest) {
      extensionIdentityRequestState = {
        kind: ExtensionConnectIntentKind.Requested,
        request: routeConnectRequest,
      };
    }
    if (APP_KIND !== VaultApplication.Simple) {
      const invitationRequest = consumeSentinelGenesisRequestFromLocation();
      if (invitationRequest) sentinelInvitationRequest = invitationRequest;
      const participantResponse =
        consumeSentinelGenesisParticipantResponseFromLocation();
      if (participantResponse)
        sentinelParticipantResponse = participantResponse;
      const onboardingPackage = consumeSentinelOnboardingFromLocation();
      if (onboardingPackage) sentinelOnboardingPackage = onboardingPackage;
    }
  }

  function navigateHome() {
    vault.closeHelp();
    history.pushState({}, "", appPath("/"));
    legalPageState = { kind: LegalRouteKind.Application };
    logsPage = false;
    appLogsPage = false;
    extensionConnectRoute = false;
    extensionConnectRequestState = {
      kind: ExtensionConnectIntentKind.Absent,
    };
  }

  function finishExtensionConnect(approved = false) {
    if (!approved) {
      extensionIdentityRequestState = {
        kind: ExtensionConnectIntentKind.Absent,
      };
    }
    vault.closeHelp();
    history.pushState({}, "", appPath("/"));
    legalPageState = { kind: LegalRouteKind.Application };
    logsPage = false;
    appLogsPage = false;
    extensionConnectRoute = false;
    extensionConnectRequestState = {
      kind: ExtensionConnectIntentKind.Absent,
    };
  }

  onMount(() => {
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const savedMode = localStorage.getItem(THEME_STORAGE_KEY);
    if (
      savedMode === ColorMode.Light ||
      savedMode === ColorMode.Dark
    ) {
      colorMode = savedMode;
      followsSystemColorMode = false;
    } else {
      colorMode = colorScheme.matches ? ColorMode.Dark : ColorMode.Light;
    }
    const handleColorSchemeChange = (event: MediaQueryListEvent) => {
      if (followsSystemColorMode) {
        colorMode = event.matches ? ColorMode.Dark : ColorMode.Light;
      }
    };
    colorScheme.addEventListener("change", handleColorSchemeChange);
    const unsubscribeLocalDataDeletion = subscribeToLocalBrowserDataDeletion(
      () => vault.handleRemoteLocalBrowserDataDeletion(),
    );
    void vault.init();

    if (vault.runtimeConfig.exposeDebugHooks()) {
      (window as Window & { __nookVault?: VaultState }).__nookVault = vault;
      (
        window as Window & { __nookConfiguredVaultApplication?: string }
      ).__nookConfiguredVaultApplication = configuredVaultApplication();
      (
        window as Window & {
          __nookAuthProviders?: {
            loadAuthProviders: () => Promise<AuthProvidersSnapshot>;
            saveAuthProviders: (
              snapshot: Parameters<typeof saveAuthProviders>[1],
            ) => ReturnType<typeof saveAuthProviders>;
          };
        }
      ).__nookAuthProviders = {
        loadAuthProviders: () =>
          vault.enqueueStorage(() => vault.manager!.loadAuthProviders()),
        saveAuthProviders: (snapshot) =>
          vault.enqueueStorage(() =>
            saveAuthProviders(vault.manager!, snapshot),
          ),
      };
    }

    syncRoute();
    window.addEventListener("popstate", syncRoute);
    window.addEventListener("hashchange", syncRoute);

    return () => {
      vault.stopVaultSync();
      vault.stopIdleSessionTracking();
      void vault.lockDeviceProtection();
      window.removeEventListener("popstate", syncRoute);
      window.removeEventListener("hashchange", syncRoute);
      colorScheme.removeEventListener("change", handleColorSchemeChange);
      unsubscribeLocalDataDeletion();
    };
  });

  $effect(() => {
    document.documentElement.classList.toggle(
      "dark",
      colorMode === ColorMode.Dark,
    );
  });

  $effect(() => {
    if (legalPageState.kind === LegalRouteKind.Legal) {
      document.title = `${legalPageForId(legalPageState.page).title} · Nook`;
      return;
    }
    if (logsPage) {
      document.title = "Application logs · Nook";
      return;
    }
    if (extensionConnectRoute) {
      document.title = "Approve extension · Nook";
      return;
    }
    document.title = IS_SENTINEL_APP
      ? "Nook Sentinel Vault"
      : "Nook Simple Vault";
  });

  async function handleUnlock(skipExtensionDiscovery = false) {
    const existingVaultImport =
      vault.loginRequiresExistingVault && vault.loginSetupActive;
    const existingVaultImportNeedsIdentity =
      vault.clientPolicy.existingVaultIdentityRecoveryRequired(
        vault.loginRequiresExistingVault,
        vault.loginSetupActive,
        vault.deviceProtectionReady,
      );
    if (
      vault.addProviderOpen &&
      vault.loginSetupType &&
      !existingVaultImportNeedsIdentity
    ) {
      await vault.connectStagedProvider();
      return;
    }
    let activeStoreId = vault.activeVaultStoreId?.trim() ?? "";
    if (existingVaultImport) {
      try {
        activeStoreId = await vault.discoverStagedVaultStoreId();
        if (!activeStoreId) {
          vault.errorMsg = vault.t("auth_storage.existing_vault_not_found");
          return;
        }
        rememberExistingVaultImport(activeStoreId);
      } catch (error) {
        vault.errorMsg =
          error instanceof Error ? error.message : vault.t("auth_storage.sync_failed");
        return;
      }
    }
    if (
      extensionIdentityRequestState.kind ===
        ExtensionConnectIntentKind.Requested &&
      extensionIdentityRequestState.request.source === "paired-vault" &&
      extensionIdentityRequestState.request.vaultStoreId === activeStoreId
    ) {
      const connectRequest = extensionIdentityRequestState.request;
      const adopted = await vault.authorizeWithExternalDeviceIdentity(
        (manager) => adoptExtensionIdentity(manager, connectRequest),
        { deferInitialization: existingVaultImport },
      );
      if (!adopted) return;
      extensionBackedVaultSession = true;
      await (existingVaultImport
        ? resumeExistingVaultImport()
        : vault.loadDb());
      return;
    }
    if (
      !skipExtensionDiscovery &&
      SUPPORTS_EXTENSION &&
      (vault.localVaultPresent || existingVaultImport) &&
      activeStoreId
    ) {
      extensionDiscoveryStoreId = "";
      const discoveryStatus = await resumePairedExtensionVault(activeStoreId);
      if (vault.isAuthenticated) return;
      if (discoveryStatus === "locked") {
        const requested = await requestPairedExtensionUnlock(activeStoreId);
        if (requested) return;
      }
    }
    if (existingVaultNeedsDeviceUnlock || existingVaultImportNeedsIdentity) {
      const extensionIdentityCanUnlock =
        connectRequest &&
        (connectRequest.source !== "paired-vault" ||
          connectRequest.vaultStoreId === activeStoreId) &&
        (connectRequest.source === "paired-vault" ||
          extensionBackedVaultSession ||
          vault.deviceProtectionStatus === DeviceProtectionStatus.Missing);
      if (extensionIdentityCanUnlock) {
        const adopted = await vault.authorizeWithExternalDeviceIdentity(
          (manager) => adoptExtensionIdentity(manager, connectRequest),
          { deferInitialization: existingVaultImport },
        );
        if (!adopted) return;
        extensionBackedVaultSession = true;
        await (existingVaultImport
          ? resumeExistingVaultImport()
          : vault.loadDb());
        return;
      }
      pendingExistingVaultUnlock = true;
      if (vault.deviceProtectionStatus === DeviceProtectionStatus.Passkey) {
        await deviceProtectionActions.unlockDeviceProtection(vault);
      }
      return;
    }
    if (existingVaultImport) {
      await resumeExistingVaultImport();
      return;
    }
    if (vault.loginSetupType) {
      await vault.connectStagedProvider();
      return;
    }
    await vault.loadDb();
  }

  async function handlePasswordUnlock(entryId: string, password: string) {
    await vault.unlockWithPassword(entryId, password);
    if (vault.isAuthenticated) {
      if (
        pendingExistingVaultImportState.kind ===
        ExistingVaultImportQueueKind.WaitingForDevice
      ) {
        await vault.activateConnectedExistingVault(
          pendingExistingVaultImportState.request.storeId,
        );
      }
      pendingExistingVaultImportState = {
        kind: ExistingVaultImportQueueKind.Idle,
      };
      vault.clearExistingVaultRecoverySummary();
    }
  }

  async function handleSettingsReconnect() {
    if (vault.loginSetupType) {
      await vault.connectAndSyncStagedProvider();
      return;
    }
    await vault.manualSync();
  }

  function toggleColorMode() {
    followsSystemColorMode = false;
    colorMode = manualColorMode(colorMode, THEME_STORAGE_KEY);
  }

  const compactShellWidth = "max-w-5xl";
  const authenticatedShellWidth = "max-w-5xl";
  const appVersion = "0.1.0";
  const shellWidth = $derived(
    vault.isAuthenticated ? authenticatedShellWidth : compactShellWidth,
  );
  let secretsAddOpen = $state(false);
  const authenticatedShellSpacing = $derived(
    secretsAddOpen ? "py-4 sm:py-8" : "pb-28 pt-4 sm:py-8",
  );
  const shellSpacing = $derived(
    legalPageState.kind === LegalRouteKind.Legal ||
    logsPage ||
    extensionConnectRoute
      ? "py-5 sm:py-6"
      : vault.isAuthenticated
        ? authenticatedShellSpacing
        : "py-5 sm:py-6",
  );

  /** Existing vault unlock / `#enroll=` join keep passkey-first; empty create defers passkey. */
  const urlEnrollmentPending = $derived(vault.enrollmentFromUrlPending);
  const requiresPasskeyFirst = $derived(
    vault.localVaultPresent ||
      vault.localVaults.length > 0 ||
      vault.loginRequiresExistingVault ||
      urlEnrollmentPending,
  );
  const existingVaultNeedsDeviceUnlock = $derived(
    requiresPasskeyFirst && !vault.deviceProtectionReady,
  );
  const showLoginWithoutPasskey = $derived(
    !requiresPasskeyFirst && vault.providersLoaded,
  );
  let pendingVaultCreationState = $state<VaultCreationQueue>({
    kind: VaultCreationQueueKind.Idle,
  });
  let pendingExistingVaultImportState = $state<ExistingVaultImportQueue>({
    kind: ExistingVaultImportQueueKind.Idle,
  });
  let pendingExistingVaultUnlock = $state(false);
  let pendingEnrollmentDeviceUnlock = $state(false);
  let pendingEnrollmentSubmitState = $state<EnrollmentSubmitQueue>({
    kind: EnrollmentSubmitQueueKind.Idle,
  });
  const showPasskeyOverlay = $derived(
    pendingVaultCreationState.kind ===
      VaultCreationQueueKind.WaitingForDevice &&
      !vault.deviceProtectionReady,
  );
  const showExistingVaultPasskeyOverlay = $derived(
    pendingExistingVaultUnlock && existingVaultNeedsDeviceUnlock,
  );
  const showEnrollmentPasskeyOverlay = $derived(
    pendingEnrollmentDeviceUnlock &&
      urlEnrollmentPending &&
      !vault.deviceProtectionReady,
  );

  function rememberExistingVaultImport(storeId: string): void {
    const setupType = vault.loginSetupType;
    if (!setupType) return;
    pendingExistingVaultImportState = {
      kind: ExistingVaultImportQueueKind.WaitingForDevice,
      request: {
        storeId,
        previousActiveStoreId: vault.activeVaultStoreId,
        setupType,
        githubPat: vault.githubPat,
        githubRepo: vault.githubRepo,
        oauthFile: vault.oauthFile
          ? $state.snapshot(vault.oauthFile)
          : vault.oauthFile,
        localFolder: vault.localFolder
          ? $state.snapshot(vault.localFolder)
          : vault.localFolder,
      },
    };
  }

  async function resumeExistingVaultImport(): Promise<void> {
    if (
      pendingExistingVaultImportState.kind !==
      ExistingVaultImportQueueKind.WaitingForDevice
    ) {
      await vault.loadDb();
      return;
    }
    const pending = pendingExistingVaultImportState.request;
    if (vault.isAuthenticated) {
      vault.clearUnlockedSession();
    }
    const existingLocalVault = vault.localVaults.some(
      (entry) => entry.storeId === pending.storeId,
    );
    if (existingLocalVault) {
      await vault.selectVaultForUnlock(pending.storeId);
      if (vault.activeVaultStoreId !== pending.storeId) {
        throw new Error(vault.t("errors.vault_selection_failed"));
      }
    } else {
      await vault.prepareExistingVaultImportSlot();
    }
    vault.loginRequiresExistingVault = true;
    vault.loginSetupType = pending.setupType;
    vault.storageMode = pending.setupType;
    vault.githubPat = pending.githubPat;
    vault.githubRepo = pending.githubRepo;
    vault.oauthFile = pending.oauthFile;
    vault.localFolder = pending.localFolder;
    const recoverySummary = vault.existingVaultRecoverySummary;
    await vault.connectStagedProvider();
    if (vault.isAuthenticated) {
      await vault.activateConnectedExistingVault(pending.storeId);
      pendingExistingVaultImportState = {
        kind: ExistingVaultImportQueueKind.Idle,
      };
      vault.clearExistingVaultRecoverySummary();
      return;
    }
    if (vault.loginPasswordPrompt) {
      if (recoverySummary?.passwordEntries.length) {
        if (recoverySummary.passwordEntries.length === 1) {
          vault.selectedPasswordEntryId =
            recoverySummary.passwordEntries[0]!.id;
        } else {
          vault.clearSelectedPasswordEntry();
        }
      }
      return;
    }
    if (
      vault.joinEnrollmentPrompt !== JoinEnrollmentState.None ||
      vault.sentinelCeremonyPrompt
    ) {
      return;
    }
  }

  async function finishExistingVaultImport(): Promise<void> {
    if (
      pendingExistingVaultImportState.kind !==
        ExistingVaultImportQueueKind.WaitingForDevice ||
      !vault.isAuthenticated
    )
      return;
    const pending = pendingExistingVaultImportState.request;
    await vault.activateConnectedExistingVault(pending.storeId);
    pendingExistingVaultImportState = {
      kind: ExistingVaultImportQueueKind.Idle,
    };
    vault.clearExistingVaultRecoverySummary();
  }

  async function leaveExistingVaultImport(): Promise<void> {
    const previousStoreId =
      pendingExistingVaultImportState.kind ===
      ExistingVaultImportQueueKind.WaitingForDevice
        ? (pendingExistingVaultImportState.request.previousActiveStoreId?.trim() ??
          "")
        : "";
    pendingExistingVaultImportState = {
      kind: ExistingVaultImportQueueKind.Idle,
    };
    vault.clearExistingVaultRecoverySummary();
    if (previousStoreId) {
      await vault.selectVaultForUnlock(previousStoreId);
    }
    vault.beginLoginVaultPicker();
  }

  async function handleUseEnrollmentCode(code: string, password: string) {
    if (!vault.deviceProtectionReady) {
      pendingEnrollmentSubmitState = {
        kind: EnrollmentSubmitQueueKind.WaitingForDevice,
        request: { code, password },
      };
      pendingEnrollmentDeviceUnlock = true;
      return;
    }
    pendingEnrollmentSubmitState = { kind: EnrollmentSubmitQueueKind.Idle };
    await vault.connectWithEnrollmentCode(code, password);
  }

  async function resumePairedExtensionVault(
    storeId: string,
  ): Promise<"unavailable" | "locked" | "unlocked"> {
    const discoveringStagedImport =
      vault.loginRequiresExistingVault && vault.loginSetupActive;
    extensionDiscoveryStoreId = storeId;
    const discovery = await discoverPairedExtensionIdentity(storeId);
    if (
      vault.isAuthenticated ||
      extensionConnectRoute ||
      (vault.activeVaultStoreId !== storeId && !discoveringStagedImport)
    ) {
      return discovery.status === "different-vault"
        ? "unavailable"
        : discovery.status;
    }
    if (discovery.status === "locked") {
      window.setTimeout(() => {
        if (
          !vault.isAuthenticated &&
          (vault.activeVaultStoreId === storeId || discoveringStagedImport) &&
          extensionDiscoveryStoreId === storeId
        ) {
          extensionDiscoveryStoreId = "";
        }
      }, EXTENSION_LOCKED_RETRY_MS);
      return "locked";
    }
    if (discovery.status !== "unlocked") return "unavailable";
    extensionIdentityRequestState = {
      kind: ExtensionConnectIntentKind.Requested,
      request: discovery.request,
    };
    await handleUnlock(true);
    return "unlocked";
  }

  async function handleCreateDeviceVault(label: string) {
    if (
      extensionIdentityRequestState.kind ===
        ExtensionConnectIntentKind.Requested &&
      vault.deviceId !== extensionIdentityRequestState.request.deviceId
    ) {
      const connectRequest = extensionIdentityRequestState.request;
      const adopted = await vault.authorizeWithExternalDeviceIdentity(
        (manager) => adoptExtensionIdentity(manager, connectRequest),
      );
      if (!adopted) return;
    }
    if (!vault.deviceProtectionReady) {
      pendingVaultCreationState = {
        kind: VaultCreationQueueKind.WaitingForDevice,
        request: { kind: PendingVaultCreationKind.Simple, label },
      };
      return;
    }
    pendingVaultCreationState = { kind: VaultCreationQueueKind.Idle };
    await vault.createLocalVaultWithDeviceKeys(label);
    if (connectRequest && vault.isAuthenticated) {
      extensionBackedVaultSession = true;
    }
  }

  async function handleStartSentinelGenesis(
    args: StartSentinelGenesisArgs,
  ): Promise<boolean> {
    if (!vault.deviceProtectionReady) {
      pendingVaultCreationState = {
        kind: VaultCreationQueueKind.WaitingForDevice,
        request: { kind: PendingVaultCreationKind.Sentinel, args },
      };
      return false;
    }
    pendingVaultCreationState = { kind: VaultCreationQueueKind.Idle };
    await vault.startSentinelGenesis(args);
    return true;
  }

  async function handleCreateSentinelParticipantKey(): Promise<string> {
    if (!vault.deviceProtectionReady) {
      pendingVaultCreationState = {
        kind: VaultCreationQueueKind.WaitingForDevice,
        request: { kind: PendingVaultCreationKind.SentinelParticipantKey },
      };
      return "";
    }
    pendingVaultCreationState = { kind: VaultCreationQueueKind.Idle };
    return sentinelGenesisActions.createPublicKeyAnnouncement(vault);
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
      };
      return "";
    }
    pendingVaultCreationState = { kind: VaultCreationQueueKind.Idle };
    return sentinelGenesisActions.createParticipantResponse(
      vault,
      requestPayload,
    );
  }

  async function handleAcceptSentinelOnboarding(packageJson: string) {
    if (!vault.deviceProtectionReady) {
      pendingVaultCreationState = {
        kind: VaultCreationQueueKind.WaitingForDevice,
        request: {
          kind: PendingVaultCreationKind.SentinelOnboarding,
          packageJson,
        },
      };
      return;
    }
    pendingVaultCreationState = { kind: VaultCreationQueueKind.Idle };
    await sentinelGenesisActions.acceptOnboardingPackage(vault, packageJson);
    sentinelOnboardingPackage = "";
  }

  async function refreshExtensionSetupStatus() {
    if (!SUPPORTS_EXTENSION || !vault.isAuthenticated) {
      extensionSetupStateValue = { kind: ExtensionSetupOfferKind.Hidden };
      return;
    }
    const state = await resolveExtensionSetupState(
      vault.activeVaultStoreId,
    );
    extensionSetupStateValue = shouldOfferExtensionSetup(state.status)
      ? { kind: ExtensionSetupOfferKind.Visible, setup: state }
      : { kind: ExtensionSetupOfferKind.Hidden };
  }

  async function handleExtensionInstall() {
    extensionInstallBusy = true;
    try {
      const target = await loadExtensionInstallTarget();
      openExtensionInstallTarget(target);
    } finally {
      extensionInstallBusy = false;
    }
  }

  async function handleExtensionConnect() {
    extensionInstallBusy = true;
    extensionConnectError = false;
    try {
      extensionConnectError = !(await openInstalledExtension());
    } finally {
      extensionInstallBusy = false;
    }
  }

  $effect(() => {
    void vault.isAuthenticated;
    void vault.activeVaultStoreId;
    void refreshExtensionSetupStatus();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshExtensionSetupStatus();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    const observer = new MutationObserver(() => {
      void refreshExtensionSetupStatus();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-nook-extension-runtime-id"],
    });

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      observer.disconnect();
    };
  });

  $effect(() => {
    if (
      pendingVaultCreationState.kind !==
        VaultCreationQueueKind.WaitingForDevice ||
      !vault.deviceProtectionReady ||
      vault.isVerifying
    )
      return;
    const pending = pendingVaultCreationState.request;
    pendingVaultCreationState = { kind: VaultCreationQueueKind.Idle };
    if (pending.kind === PendingVaultCreationKind.Simple) {
      void vault.createLocalVaultWithDeviceKeys(pending.label);
      return;
    }
    if (
      pending.kind === PendingVaultCreationKind.SentinelParticipantKey ||
      pending.kind === PendingVaultCreationKind.SentinelParticipantResponse
    )
      return;
    if (pending.kind === PendingVaultCreationKind.SentinelOnboarding) {
      void handleAcceptSentinelOnboarding(pending.packageJson);
      return;
    }
    void vault.startSentinelGenesis(pending.args);
  });

  $effect(() => {
    const storeId = vault.activeVaultStoreId?.trim() ?? "";
    if (
      extensionIdentityRequestState.kind ===
        ExtensionConnectIntentKind.Requested &&
      extensionIdentityRequestState.request.source === "paired-vault" &&
      extensionIdentityRequestState.request.vaultStoreId !== storeId
    ) {
      extensionIdentityRequestState = {
        kind: ExtensionConnectIntentKind.Absent,
      };
    }
    if (
      !SUPPORTS_EXTENSION ||
      extensionConnectRoute ||
      vault.isAuthenticated ||
      vault.isInitializing ||
      vault.isVerifying ||
      (!vault.localVaultPresent &&
        !(vault.loginRequiresExistingVault && vault.loginSetupType)) ||
      !storeId ||
      extensionDiscoveryStoreId === storeId
    ) {
      return;
    }
    void resumePairedExtensionVault(storeId);
  });

  $effect(() => {
    if (
      !pendingExistingVaultUnlock ||
      !vault.deviceProtectionReady ||
      vault.isVerifying
    ) {
      return;
    }
    pendingExistingVaultUnlock = false;
    const importPending =
      pendingExistingVaultImportState.kind ===
      ExistingVaultImportQueueKind.WaitingForDevice;
    void (importPending ? resumeExistingVaultImport() : vault.loadDb());
  });

  // `#enroll=` lands on an empty browser: open device protection immediately so
  // the create-vault landing never appears as the primary action.
  $effect(() => {
    if (
      !urlEnrollmentPending ||
      vault.deviceProtectionReady ||
      vault.isInitializing
    ) {
      return;
    }
    pendingEnrollmentDeviceUnlock = true;
  });

  $effect(() => {
    if (
      pendingEnrollmentSubmitState.kind !==
        EnrollmentSubmitQueueKind.WaitingForDevice ||
      !vault.deviceProtectionReady ||
      vault.isVerifying
    ) {
      return;
    }
    const pending = pendingEnrollmentSubmitState.request;
    pendingEnrollmentSubmitState = { kind: EnrollmentSubmitQueueKind.Idle };
    pendingEnrollmentDeviceUnlock = false;
    void vault.connectWithEnrollmentCode(pending.code, pending.password);
  });
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
      {:else if extensionConnectRoute &&
      extensionConnectRequestState.kind === ExtensionConnectIntentKind.Absent}
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
            (extensionIdentityRequestState.request.source === "paired-vault" ||
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
              pendingExistingVaultUnlock = false;
              pendingExistingVaultImportState = {
                kind: ExistingVaultImportQueueKind.Idle,
              };
              vault.clearExistingVaultRecoverySummary();
              return;
            }
            if (showEnrollmentPasskeyOverlay) {
              pendingEnrollmentDeviceUnlock = false;
              return;
            }
            pendingVaultCreationState = {
              kind: VaultCreationQueueKind.Idle,
            };
          }}
        />
      {:else if extensionConnectRequestState.kind ===
      ExtensionConnectIntentKind.Requested}
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
            secretsAddOpen = open;
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
