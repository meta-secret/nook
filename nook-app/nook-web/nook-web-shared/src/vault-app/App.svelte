<script lang="ts">
  import { onMount } from "svelte";
  import { VaultState } from "$lib/vault.svelte";
  import {
    DeviceProtectionStatus,
    JoinEnrollmentState,
    type StartSentinelGenesisArgs,
  } from "$app-wasm";
  import {
    saveAuthProviders,
    type AuthProvidersSnapshot,
    type LocalFolderConfig,
    type OAuthFileConfig,
    type StorageProviderType,
  } from "$lib/auth-providers";
  import HelpPage from "$lib/components/HelpPage.svelte";
  import LegalDocumentPage from "$lib/components/LegalDocumentPage.svelte";
  import LogsPage from "$lib/components/LogsPage.svelte";
  import AppLogsApiPage from "$lib/components/AppLogsApiPage.svelte";
  import SiteFooter from "$lib/components/SiteFooter.svelte";
  import ExtensionConnectConsent from "$lib/components/ExtensionConnectConsent.svelte";
  import VaultStatusBar from "$lib/components/VaultStatusBar.svelte";
  import AppHeader from "$lib/components/app/AppHeader.svelte";
  import AuthenticatedVaultWorkspace from "$lib/components/app/AuthenticatedVaultWorkspace.svelte";
  import VaultAccessGate from "$lib/components/app/VaultAccessGate.svelte";
  import VaultDialogs from "$lib/components/app/VaultDialogs.svelte";
  import { Button } from "$lib/components/ui/button";
  import {
    appPath,
    getLegalPageFromPath,
    isLogsPath,
    legalPageForId,
    type LegalPageId,
  } from "$lib/legal-content";
  import { isAppLogsPath } from "$lib/app-logs-api";
  import {
    adoptExtensionIdentity,
    discoverPairedExtensionIdentity,
    extensionConnectRequestFromLocation,
    isExtensionConnectPath,
    openInstalledExtension,
    requestPairedExtensionUnlock,
    type ExtensionConnectRequest,
  } from "$lib/extension-connect";
  import {
    loadExtensionInstallTarget,
    openExtensionInstallTarget,
    resolveExtensionSetupState,
    shouldOfferExtensionSetup,
    type ExtensionSetupState,
  } from "$lib/extension-install";
  import { assessVaultSecurity, configuredVaultApplication } from "$app-wasm";
  import { consumeSentinelOnboardingFromLocation } from "$lib/sentinel-onboarding-link";
  import {
    APP_KIND,
    IS_SENTINEL_APP,
    SUPPORTS_EXTENSION,
  } from "$lib/app-kind";
  import {
    consumeSentinelGenesisParticipantResponseFromLocation,
    consumeSentinelGenesisRequestFromLocation,
  } from "$lib/sentinel-genesis-link";
  import * as deviceProtectionActions from "$lib/vault/device-protection.svelte";
  import * as sentinelGenesisActions from "$lib/vault/sentinel-genesis";
  import { subscribeToLocalBrowserDataDeletion } from "$lib/browser-data";
  import {
    EMPTY_VALUE,
    presentValue,
    type ValueState,
    valueFromState,
    valueState,
  } from "../explicit-state";

  const vault = new VaultState();
  const vaultSecurityRecommendations = $derived(
    assessVaultSecurity(vault.syncProviders.length, vault.vaultMembers.length),
  );
  type ColorMode = "light" | "dark";
  const THEME_STORAGE_KEY = "nook_color_mode";

  function systemColorMode(): ColorMode {
    return typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  let colorMode = $state<ColorMode>(systemColorMode());
  let followsSystemColorMode = $state(true);
  let legalPageState = $state<ValueState<LegalPageId>>(
    typeof window !== "undefined"
      ? valueState(getLegalPageFromPath(window.location.pathname))
      : EMPTY_VALUE,
  );
  const legalPage = $derived(valueFromState(legalPageState));
  let logsPage = $state<boolean>(
    typeof window !== "undefined"
      ? isLogsPath(window.location.pathname)
      : false,
  );
  let appLogsPage = $state<boolean>(
    typeof window !== "undefined"
      ? isAppLogsPath(window.location.pathname)
      : false,
  );
  const initialExtensionConnectRequest =
    typeof window !== "undefined" && SUPPORTS_EXTENSION
      ? extensionConnectRequestFromLocation(window.location)
      : undefined;
  let extensionConnectRoute = $state<boolean>(
    typeof window !== "undefined"
      ? SUPPORTS_EXTENSION && isExtensionConnectPath(window.location.pathname)
      : false,
  );
  let extensionConnectRequestState = $state<ValueState<ExtensionConnectRequest>>(
    valueState(initialExtensionConnectRequest),
  );
  const extensionConnectRequest = $derived(
    valueFromState(extensionConnectRequestState),
  );
  // Keep the public extension handoff request in memory after leaving the
  // consent route. On reload, the site asks the installed extension for a new
  // vault-bound handoff only when that extension already holds an approved
  // grant for the active local vault.
  let extensionIdentityRequestState =
    $state<ValueState<ExtensionConnectRequest>>(
      valueState(initialExtensionConnectRequest),
    );
  const extensionIdentityRequest = $derived(
    valueFromState(extensionIdentityRequestState),
  );
  let extensionBackedVaultSession = $state(false);
  let extensionDiscoveryStoreId = $state("");
  let extensionSetupStateValue =
    $state<ValueState<ExtensionSetupState>>(EMPTY_VALUE);
  const extensionSetupState = $derived(
    valueFromState(extensionSetupStateValue),
  );
  let extensionInstallBusy = $state(false);
  let extensionConnectError = $state(false);
  const EXTENSION_LOCKED_RETRY_MS = 3_000;
  let sentinelInvitationRequest = $state(
    typeof window !== "undefined" && APP_KIND !== "simple"
      ? consumeSentinelGenesisRequestFromLocation()
      : "",
  );
  let sentinelParticipantResponse = $state(
    typeof window !== "undefined" && APP_KIND !== "simple"
      ? consumeSentinelGenesisParticipantResponseFromLocation()
      : "",
  );
  let sentinelOnboardingPackage = $state(
    typeof window !== "undefined" && APP_KIND !== "simple"
      ? consumeSentinelOnboardingFromLocation()
      : "",
  );

  function syncRoute() {
    legalPageState = valueState(
      getLegalPageFromPath(window.location.pathname),
    );
    logsPage = isLogsPath(window.location.pathname);
    appLogsPage = isAppLogsPath(window.location.pathname);
    extensionConnectRoute =
      SUPPORTS_EXTENSION && isExtensionConnectPath(window.location.pathname);
    extensionConnectRequestState = SUPPORTS_EXTENSION
      ? valueState(extensionConnectRequestFromLocation(window.location))
      : EMPTY_VALUE;
    if (extensionConnectRequest) {
      extensionIdentityRequestState = presentValue(extensionConnectRequest);
    }
    if (APP_KIND !== "simple") {
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
    history.pushState(undefined, "", appPath("/"));
    legalPageState = EMPTY_VALUE;
    logsPage = false;
    appLogsPage = false;
    extensionConnectRoute = false;
    extensionConnectRequestState = EMPTY_VALUE;
  }

  function finishExtensionConnect(approved = false) {
    if (!approved) {
      extensionIdentityRequestState = EMPTY_VALUE;
    }
    vault.closeHelp();
    history.pushState(undefined, "", appPath("/"));
    legalPageState = EMPTY_VALUE;
    logsPage = false;
    appLogsPage = false;
    extensionConnectRoute = false;
    extensionConnectRequestState = EMPTY_VALUE;
  }

  onMount(() => {
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const savedMode = localStorage.getItem(THEME_STORAGE_KEY);
    if (savedMode === "light" || savedMode === "dark") {
      colorMode = savedMode;
      followsSystemColorMode = false;
    } else {
      colorMode = colorScheme.matches ? "dark" : "light";
    }
    const handleColorSchemeChange = (event: MediaQueryListEvent) => {
      if (followsSystemColorMode) {
        colorMode = event.matches ? "dark" : "light";
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
    document.documentElement.classList.toggle("dark", colorMode === "dark");
  });

  $effect(() => {
    if (legalPage) {
      document.title = `${legalPageForId(legalPage).title} · Nook`;
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
      vault.loginRequiresExistingVault && vault.loginSetupType !== undefined;
    const existingVaultImportNeedsIdentity =
      vault.clientPolicy.existingVaultIdentityRecoveryRequired(
        vault.loginRequiresExistingVault,
        vault.loginSetupType !== undefined,
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
    const connectRequest = extensionIdentityRequest;
    if (
      connectRequest?.source === "paired-vault" &&
      connectRequest.vaultStoreId === activeStoreId
    ) {
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
      const pending = pendingExistingVaultImport;
      if (pending) {
        await vault.activateConnectedExistingVault(pending.storeId);
      }
      pendingExistingVaultImportState = EMPTY_VALUE;
      vault.existingVaultRecoverySummary = undefined;
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
    colorMode = colorMode === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_STORAGE_KEY, colorMode);
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
    legalPage || logsPage || extensionConnectRoute
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
  type PendingVaultCreation =
    | { kind: "simple"; label: string }
    | { kind: "sentinel"; args: StartSentinelGenesisArgs }
    | { kind: "sentinel-participant-key" }
    | { kind: "sentinel-participant-response"; requestPayload: string }
    | { kind: "sentinel-onboarding"; packageJson: string };
  let pendingVaultCreationState =
    $state<ValueState<PendingVaultCreation>>(EMPTY_VALUE);
  const pendingVaultCreation = $derived(
    valueFromState(pendingVaultCreationState),
  );
  type PendingExistingVaultImport = {
    storeId: string;
    previousActiveStoreId: string | undefined;
    setupType: StorageProviderType;
    githubPat: string;
    githubRepo: string;
    oauthFile: OAuthFileConfig | undefined;
    localFolder: LocalFolderConfig | undefined;
  };
  let pendingExistingVaultImportState =
    $state<ValueState<PendingExistingVaultImport>>(EMPTY_VALUE);
  const pendingExistingVaultImport = $derived(
    valueFromState(pendingExistingVaultImportState),
  );
  let pendingExistingVaultUnlock = $state(false);
  let pendingEnrollmentDeviceUnlock = $state(false);
  type PendingEnrollmentSubmit = { code: string; password: string };
  let pendingEnrollmentSubmitState =
    $state<ValueState<PendingEnrollmentSubmit>>(EMPTY_VALUE);
  const pendingEnrollmentSubmit = $derived(
    valueFromState(pendingEnrollmentSubmitState),
  );
  const showPasskeyOverlay = $derived(
    pendingVaultCreation !== undefined && !vault.deviceProtectionReady,
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
    pendingExistingVaultImportState = presentValue({
      storeId,
      previousActiveStoreId: vault.activeVaultStoreId,
      setupType,
      githubPat: vault.githubPat,
      githubRepo: vault.githubRepo,
      oauthFile: vault.oauthFile
        ? $state.snapshot(vault.oauthFile)
        : undefined,
      localFolder: vault.localFolder
        ? $state.snapshot(vault.localFolder)
        : undefined,
    });
  }

  async function resumeExistingVaultImport(): Promise<void> {
    const pending = pendingExistingVaultImport;
    if (!pending) {
      await vault.loadDb();
      return;
    }
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
      pendingExistingVaultImportState = EMPTY_VALUE;
      vault.existingVaultRecoverySummary = undefined;
      return;
    }
    if (vault.loginPasswordPrompt) {
      if (recoverySummary?.passwordEntries.length) {
        vault.selectedPasswordEntryId =
          recoverySummary.passwordEntries.length === 1
            ? recoverySummary.passwordEntries[0]!.id
            : undefined;
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
    const pending = pendingExistingVaultImport;
    if (!pending || !vault.isAuthenticated) return;
    await vault.activateConnectedExistingVault(pending.storeId);
    pendingExistingVaultImportState = EMPTY_VALUE;
    vault.existingVaultRecoverySummary = undefined;
  }

  async function leaveExistingVaultImport(): Promise<void> {
    const previousStoreId =
      pendingExistingVaultImport?.previousActiveStoreId?.trim() ?? "";
    pendingExistingVaultImportState = EMPTY_VALUE;
    vault.existingVaultRecoverySummary = undefined;
    if (previousStoreId) {
      await vault.selectVaultForUnlock(previousStoreId);
    }
    vault.beginLoginVaultPicker();
  }

  async function handleUseEnrollmentCode(code: string, password: string) {
    if (!vault.deviceProtectionReady) {
      pendingEnrollmentSubmitState = presentValue({ code, password });
      pendingEnrollmentDeviceUnlock = true;
      return;
    }
    pendingEnrollmentSubmitState = EMPTY_VALUE;
    await vault.connectWithEnrollmentCode(code, password);
  }

  async function resumePairedExtensionVault(
    storeId: string,
  ): Promise<"unavailable" | "locked" | "unlocked"> {
    const discoveringStagedImport =
      vault.loginRequiresExistingVault && vault.loginSetupType !== undefined;
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
    extensionIdentityRequestState = presentValue(discovery.request);
    await handleUnlock(true);
    return "unlocked";
  }

  async function handleCreateDeviceVault(label: string) {
    const connectRequest = extensionIdentityRequest;
    if (connectRequest && vault.deviceId !== connectRequest.deviceId) {
      const adopted = await vault.authorizeWithExternalDeviceIdentity(
        (manager) => adoptExtensionIdentity(manager, connectRequest),
      );
      if (!adopted) return;
    }
    if (!vault.deviceProtectionReady) {
      pendingVaultCreationState = presentValue({ kind: "simple", label });
      return;
    }
    pendingVaultCreationState = EMPTY_VALUE;
    await vault.createLocalVaultWithDeviceKeys(label);
    if (connectRequest && vault.isAuthenticated) {
      extensionBackedVaultSession = true;
    }
  }

  async function handleStartSentinelGenesis(
    args: StartSentinelGenesisArgs,
  ): Promise<boolean> {
    if (!vault.deviceProtectionReady) {
      pendingVaultCreationState = presentValue({ kind: "sentinel", args });
      return false;
    }
    pendingVaultCreationState = EMPTY_VALUE;
    await vault.startSentinelGenesis(args);
    return true;
  }

  async function handleCreateSentinelParticipantKey(): Promise<string> {
    if (!vault.deviceProtectionReady) {
      pendingVaultCreationState = presentValue({
        kind: "sentinel-participant-key",
      });
      return "";
    }
    pendingVaultCreationState = EMPTY_VALUE;
    return sentinelGenesisActions.createPublicKeyAnnouncement(vault);
  }

  async function handleCreateSentinelParticipantResponse(
    requestPayload: string,
  ): Promise<string> {
    if (!vault.deviceProtectionReady) {
      pendingVaultCreationState = presentValue({
        kind: "sentinel-participant-response",
        requestPayload,
      });
      return "";
    }
    pendingVaultCreationState = EMPTY_VALUE;
    return sentinelGenesisActions.createParticipantResponse(
      vault,
      requestPayload,
    );
  }

  async function handleAcceptSentinelOnboarding(packageJson: string) {
    if (!vault.deviceProtectionReady) {
      pendingVaultCreationState = presentValue({
        kind: "sentinel-onboarding",
        packageJson,
      });
      return;
    }
    pendingVaultCreationState = EMPTY_VALUE;
    await sentinelGenesisActions.acceptOnboardingPackage(vault, packageJson);
    sentinelOnboardingPackage = "";
  }

  async function refreshExtensionSetupStatus() {
    if (!SUPPORTS_EXTENSION || !vault.isAuthenticated) {
      extensionSetupStateValue = EMPTY_VALUE;
      return;
    }
    const state = await resolveExtensionSetupState(
      vault.activeVaultStoreId,
    );
    extensionSetupStateValue = shouldOfferExtensionSetup(state.status)
      ? presentValue(state)
      : EMPTY_VALUE;
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
    const pending = pendingVaultCreation;
    if (!pending || !vault.deviceProtectionReady || vault.isVerifying) return;
    pendingVaultCreationState = EMPTY_VALUE;
    if (pending.kind === "simple") {
      void vault.createLocalVaultWithDeviceKeys(pending.label);
      return;
    }
    if (
      pending.kind === "sentinel-participant-key" ||
      pending.kind === "sentinel-participant-response"
    )
      return;
    if (pending.kind === "sentinel-onboarding") {
      void handleAcceptSentinelOnboarding(pending.packageJson);
      return;
    }
    void vault.startSentinelGenesis(pending.args);
  });

  $effect(() => {
    const storeId = vault.activeVaultStoreId?.trim() ?? "";
    if (
      extensionIdentityRequest?.source === "paired-vault" &&
      extensionIdentityRequest.vaultStoreId !== storeId
    ) {
      extensionIdentityRequestState = EMPTY_VALUE;
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
    const importPending = pendingExistingVaultImport !== undefined;
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
    const pending = pendingEnrollmentSubmit;
    if (!pending || !vault.deviceProtectionReady || vault.isVerifying) {
      return;
    }
    pendingEnrollmentSubmitState = EMPTY_VALUE;
    pendingEnrollmentDeviceUnlock = false;
    void vault.connectWithEnrollmentCode(pending.code, pending.password);
  });
</script>

{#if appLogsPage}
  <AppLogsApiPage />
{:else}
  <main
    class="min-h-svh min-w-0 max-w-full overflow-x-clip bg-background text-foreground"
    class:dark={colorMode === "dark"}
  >
    <AppHeader
      {vault}
      {colorMode}
      {shellWidth}
      legalPageOpen={legalPage !== undefined}
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
            label={vault.isAuthenticated ? undefined : "Nook"}
            showSyncStatus={vault.isAuthenticated}
            showStorageIcon={vault.isAuthenticated}
            variant={vault.isAuthenticated ? "panel" : "quiet"}
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
            {vault.t("extension.connect.invalid_title")}
          </h1>
          <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
            {vault.t("extension.connect.invalid_description")}
          </p>
          <Button
            type="button"
            variant="outline"
            class="mt-4"
            onclick={navigateHome}
          >
            {vault.t("extension.connect.return_to_nook")}
          </Button>
        </section>
      {:else if !vault.isAuthenticated}
        <VaultAccessGate
          {vault}
          showAccessGate={vault.deviceProtectionReady ||
            showLoginWithoutPasskey ||
            existingVaultNeedsDeviceUnlock}
          {existingVaultNeedsDeviceUnlock}
          usesExtensionDeviceIdentity={extensionIdentityRequest !== undefined &&
            (extensionIdentityRequest.source === "paired-vault" ||
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
              pendingExistingVaultImportState = EMPTY_VALUE;
              vault.existingVaultRecoverySummary = undefined;
              return;
            }
            if (showEnrollmentPasskeyOverlay) {
              pendingEnrollmentDeviceUnlock = false;
              return;
            }
            pendingVaultCreationState = EMPTY_VALUE;
          }}
        />
      {:else if extensionConnectRequest}
        <div class="mx-auto w-full max-w-2xl space-y-4">
          <ExtensionConnectConsent
            {vault}
            request={extensionConnectRequest}
            onClose={finishExtensionConnect}
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
        <AuthenticatedVaultWorkspace
          {vault}
          {extensionSetupState}
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

    {#if !legalPage && !logsPage && !extensionConnectRoute}
      <SiteFooter />
    {/if}

    <VaultDialogs {vault} />
  </main>
{/if}
