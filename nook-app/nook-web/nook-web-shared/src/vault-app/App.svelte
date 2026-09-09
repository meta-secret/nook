<script lang="ts">
  import { I18N_KEYS } from "../generated/i18n-keys";
  import { onMount, untrack } from "svelte";
  import { VaultState } from "$lib/vault.svelte";
  import {
    DeviceProtectionStatus,
    ExternalDeviceIdentityAuthorizationMode,
    type StartSentinelGenesisArgs,
  } from "$app-wasm";
  import {
    ExtensionConnectIntentKind,
    LegalRouteKind,
    ExtensionConnectionIntentProjection,
    LegalRouteProjection,
    type ExtensionConnectIntent,
  } from "$lib/app/route-state";
  import { ColorMode, browserColorMode } from "$lib/app/theme";
  import {
    type EnrollmentSubmitQueue,
    EnrollmentSubmitQueueKind,
    PendingVaultCreationView as PendingCreation,
    PendingVaultCreationKind,
    type VaultCreationQueue,
    VaultCreationQueueKind,
  } from "$lib/vault/creation-queue";
  import AppSurface from "$lib/components/app/AppSurface.svelte";
  import type {
    EnrollmentCodeUseRequest,
    PairedExtensionDiscoveryRetry,
    PairedExtensionUnlockPoll,
  } from "$lib/app/app-interaction-types";
  import { ApplicationRoutePresentation as ApplicationRoute } from "$lib/content/legal";
  import { AppLogsLocation } from "$lib/app/logs-api";
  import {
    ExtensionConnectRequestStateKind,
    ExtensionIdentityRequestSource,
    type ExtensionIdentityAdoption,
    type ExtensionConnectRequestState,
    extensionConnectionBrowser as connectionBrowser,
  } from "$lib/extension/connect";
  import {
    ExtensionSetupOfferKind,
    type ExtensionSetupOffer,
    extensionSetupBrowser,
  } from "$lib/app/extension-setup";
  import {
    APP_SHELL_WIDTH,
    APP_SHELL_WIDTH_WIDE,
    APP_VERSION,
    ApplicationShellLayout,
  } from "$lib/app/shell-layout";
  import { SettingsSection } from "$lib/vault/state/ui.svelte";
  import {
    assess_vault_security,
    configured_vault_application_is_simple,
    configured_vault_application_is_sentinel,
    configured_vault_application_supports_extension,
  } from "$app-wasm";
  import { sentinelOnboardingBrowser } from "$lib/enrollment/sentinel-onboarding-link";
  import {
    initialExtensionConnectIntent,
    initialLegalRoute,
  } from "$lib/app/route-state";
  import { sentinelGenesisBrowser } from "$lib/enrollment/sentinel-genesis-link";
  import * as deviceProtectionActions from "$lib/vault/device-protection.svelte";
  import * as sentinelGenesisActions from "$lib/vault/sentinel-genesis";
  import { ExistingVaultImportLifecycle } from "$lib/vault/existing-vault-import.svelte";
  import {
    THEME_STORAGE_KEY,
    vaultBrowserLifecycle,
  } from "$lib/app/browser-lifecycle";
  import {
    ActiveVaultKind,
    LoginSetupKind,
  } from "$lib/vault/state/provider.svelte";
  import {
    WorkspaceRoute,
    WorkspaceRouteLookupKind,
    WorkspaceLocation,
    WorkspacePath,
  } from "$lib/app/workspace-route";
  import { VaultWorkspaceActions } from "$lib/vault/ui";
  import { ExtensionPairedVaultIdentityStatusMessageStatus } from "$web-shared/extension/paired-vault-identity-status";
  const IS_SIMPLE_APP = configured_vault_application_is_simple();
  const IS_SENTINEL_APP = configured_vault_application_is_sentinel();
  const SUPPORTS_EXTENSION = configured_vault_application_supports_extension();
  const vault = new VaultState();
  const existingVaultImportLifecycle = new ExistingVaultImportLifecycle(vault);
  const vaultSecurityRecommendations = $derived(
    assess_vault_security(
      vault.syncProviders.length,
      vault.vaultMembers.length,
    ),
  );
  let colorMode = $state<ColorMode>(browserColorMode.systemColorMode());
  let followsSystemColorMode = $state(true);
  let legalPageState = $state(initialLegalRoute());
  let logsPage = $state<boolean>(
    "window" in globalThis &&
      new ApplicationRoute(window.location.pathname).isLogsPath(),
  );
  let appLogsPage = $state<boolean>(
    "window" in globalThis &&
      new AppLogsLocation(window.location.pathname).matches,
  );
  const initialExtensionConnectRequestState: ExtensionConnectIntent =
    initialExtensionConnectIntent(SUPPORTS_EXTENSION);
  let extensionConnectRoute = $state<boolean>(
    "window" in globalThis
      ? SUPPORTS_EXTENSION &&
          connectionBrowser.isExtensionConnectPath(window.location.pathname)
      : false,
  );
  let extensionConnectRequestState = $state<ExtensionConnectIntent>(
    initialExtensionConnectRequestState,
  );
  // Keep the public extension handoff request in memory after leaving the
  // consent route. On reload, the site asks the installed extension for a new
  // vault-bound handoff only when that extension already holds an approved
  // grant for the active local vault.
  let extensionIdentityRequestState = $state<ExtensionConnectIntent>(
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
    "window" in globalThis && !IS_SIMPLE_APP
      ? sentinelGenesisBrowser.consumeSentinelGenesisRequestFromLocation()
      : "",
  );
  let sentinelParticipantResponse = $state(
    "window" in globalThis && !IS_SIMPLE_APP
      ? sentinelGenesisBrowser.consumeSentinelGenesisParticipantResponseFromLocation()
      : "",
  );
  let sentinelOnboardingPackage = $state(
    "window" in globalThis && !IS_SIMPLE_APP
      ? sentinelOnboardingBrowser.consumeSentinelOnboardingFromLocation()
      : "",
  );
  function syncRoute(event?: Event) {
    if (!IS_SIMPLE_APP) {
      const invitationRequest =
        sentinelGenesisBrowser.consumeSentinelGenesisRequestFromLocation();
      if (invitationRequest || event?.type === "popstate") {
        sentinelInvitationRequest = invitationRequest;
        if (
          new PendingCreation(
            pendingVaultCreationState,
          ).isSentinelParticipantResponsePending()
        )
          finishPendingCreation();
      }
      const participantResponse =
        sentinelGenesisBrowser.consumeSentinelGenesisParticipantResponseFromLocation();
      if (participantResponse)
        sentinelParticipantResponse = participantResponse;
      const onboardingPackage =
        sentinelOnboardingBrowser.consumeSentinelOnboardingFromLocation();
      if (onboardingPackage) sentinelOnboardingPackage = onboardingPackage;
    }
    legalPageState = new LegalRouteProjection(
      new ApplicationRoute(window.location.pathname).getLegalPageFromPath(),
    ).route;
    logsPage = new ApplicationRoute(window.location.pathname).isLogsPath();
    appLogsPage = new AppLogsLocation(window.location.pathname).matches;
    extensionConnectRoute =
      SUPPORTS_EXTENSION &&
      connectionBrowser.isExtensionConnectPath(window.location.pathname);
    const workspaceRoute = new WorkspacePath(window.location.pathname).route;
    const leavesSentinelChooser =
      legalPageState.kind !== LegalRouteKind.Application ||
      logsPage ||
      appLogsPage ||
      extensionConnectRoute ||
      (workspaceRoute.kind === WorkspaceRouteLookupKind.Workspace &&
        workspaceRoute.route !== WorkspaceRoute.Vault);
    if (
      leavesSentinelChooser &&
      new PendingCreation(
        pendingVaultCreationState,
      ).isSentinelParticipantKeyPending()
    )
      finishPendingCreation();
    if (
      legalPageState.kind === LegalRouteKind.Application &&
      !logsPage &&
      !appLogsPage &&
      !extensionConnectRoute
    ) {
      if (workspaceRoute.kind === WorkspaceRouteLookupKind.Workspace) {
        new VaultWorkspaceActions(vault).applyWorkspaceRoute({
          route: workspaceRoute.route,
        });

        history.replaceState(
          {},
          "",
          new WorkspaceLocation(workspaceRoute.route).path,
        );
      } else {
        new VaultWorkspaceActions(vault).applyWorkspaceRoute({
          route: WorkspaceRoute.Vault,
        });

        history.replaceState(
          {},
          "",
          new WorkspaceLocation(WorkspaceRoute.Vault).path,
        );
      }
    }
    const routeConnectRequest: ExtensionConnectRequestState = SUPPORTS_EXTENSION
      ? connectionBrowser.extensionConnectRequestFromLocation(window.location)
      : { kind: ExtensionConnectRequestStateKind.Absent };
    extensionConnectRequestState = new ExtensionConnectionIntentProjection(
      routeConnectRequest,
    ).intent;
    if (
      routeConnectRequest.kind === ExtensionConnectRequestStateKind.Requested
    ) {
      extensionIdentityRequestState = {
        kind: ExtensionConnectIntentKind.Requested,
        request: routeConnectRequest.request,
      };
    }
  }
  $effect(() => {
    if (!vault.isAuthenticated || !("window" in globalThis)) return;
    const workspaceRoute = new WorkspacePath(window.location.pathname).route;
    if (workspaceRoute.kind === WorkspaceRouteLookupKind.Workspace) {
      untrack(() =>
        (() => {
          return new VaultWorkspaceActions(vault).applyWorkspaceRoute({
            route: workspaceRoute.route,
          });
        })(),
      );
    }
  });
  function navigateHome() {
    new VaultWorkspaceActions(vault).applyWorkspaceRoute({
      route: WorkspaceRoute.Vault,
    });

    history.pushState({}, "", new WorkspaceLocation(WorkspaceRoute.Vault).path);
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

    new VaultWorkspaceActions(vault).applyWorkspaceRoute({
      route: WorkspaceRoute.Vault,
    });

    history.pushState({}, "", new WorkspaceLocation(WorkspaceRoute.Vault).path);
    legalPageState = { kind: LegalRouteKind.Application };
    logsPage = false;
    appLogsPage = false;
    extensionConnectRoute = false;
    extensionConnectRequestState = {
      kind: ExtensionConnectIntentKind.Absent,
    };
  }
  onMount(() => {
    const mountBrowserLifecycleArgs: Parameters<
      typeof vaultBrowserLifecycle.mountBrowserLifecycle
    >[0] = {
      vault,
      followsSystemColorMode: () => followsSystemColorMode,
      setColorMode: (mode) => {
        colorMode = mode;
      },
      stopFollowingSystemColorMode: () => {
        followsSystemColorMode = false;
      },
      syncRoute,
    };
    return vaultBrowserLifecycle.mountBrowserLifecycle(
      mountBrowserLifecycleArgs,
    );
  });
  $effect(() => {
    vaultBrowserLifecycle.updateApplicationDocument({
      colorMode,
      legalRoute: legalPageState,
      logsPage,
      extensionConnectRoute,
      sentinelApplication: IS_SENTINEL_APP,
    });
  });
  async function handleUnlock(skipExtensionDiscovery = false) {
    const existingVaultImport =
      vault.loginRequiresExistingVault &&
      vault.loginSetup.kind === LoginSetupKind.Active;
    const existingVaultImportNeedsIdentity =
      vault.clientPolicy.existing_vault_identity_recovery_required(
        vault.loginRequiresExistingVault,
        vault.loginSetup.kind === LoginSetupKind.Active,
        vault.deviceProtectionReady,
      );
    if (
      vault.addProviderOpen &&
      vault.loginSetup.kind === LoginSetupKind.Active &&
      !existingVaultImportNeedsIdentity
    ) {
      await vault.connectStagedProvider();
      return;
    }
    let activeStoreId = existingVaultImportLifecycle.unlockStoreId;
    if (existingVaultImport) {
      try {
        activeStoreId = await vault.discoverStagedVaultStoreId();
        if (!activeStoreId) {
          vault.errorMsg = vault.t(I18N_KEYS.AuthStorageExistingVaultNotFound);
          return;
        }
        existingVaultImportLifecycle.remember(activeStoreId);
      } catch (error) {
        vault.errorMsg =
          error instanceof Error
            ? error.message
            : vault.t(I18N_KEYS.AuthStorageSyncFailed);
        return;
      }
    }
    if (
      extensionIdentityRequestState.kind ===
        ExtensionConnectIntentKind.Requested &&
      extensionIdentityRequestState.request.source ===
        ExtensionIdentityRequestSource.PairedVault &&
      extensionIdentityRequestState.request.vaultStoreId === activeStoreId &&
      !vault.isVerifying &&
      !vault.deviceAuthorizationInProgress
    ) {
      const connectRequest = extensionIdentityRequestState.request;
      const authorizeWithExternalDeviceIdentityArgs: Parameters<
        typeof vault.authorizeWithExternalDeviceIdentity
      >[0] = {
        adopt: (manager) => {
          return connectionBrowser.adoptExtensionIdentity({
            manager,
            request: connectRequest,
          });
        },
        mode: existingVaultImport
          ? ExternalDeviceIdentityAuthorizationMode.DeferInitialization
          : ExternalDeviceIdentityAuthorizationMode.ContinueInitialization,
      };
      const adopted = await vault.authorizeWithExternalDeviceIdentity(
        authorizeWithExternalDeviceIdentityArgs,
      );
      if (adopted) {
        extensionBackedVaultSession = true;
        await (existingVaultImport
          ? existingVaultImportLifecycle.resume()
          : vault.loadDb());
        return;
      }
      if (skipExtensionDiscovery) {
        return;
      }
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
          await connectionBrowser.requestPairedExtensionUnlock(activeStoreId);
        }

        await waitForPairedExtensionUnlock({
          storeId: activeStoreId,
        });
        if (vault.isAuthenticated) return;
      }
    }
    if (skipExtensionDiscovery) {
      return;
    }
    if (existingVaultNeedsDeviceUnlock || existingVaultImportNeedsIdentity) {
      if (
        extensionIdentityRequestState.kind ===
        ExtensionConnectIntentKind.Requested
      ) {
        const connectRequest = extensionIdentityRequestState.request;
        const extensionIdentityCanUnlock =
          (connectRequest.source !==
            ExtensionIdentityRequestSource.PairedVault ||
            connectRequest.vaultStoreId === activeStoreId) &&
          (connectRequest.source ===
            ExtensionIdentityRequestSource.PairedVault ||
            extensionBackedVaultSession ||
            vault.deviceProtectionStatus === DeviceProtectionStatus.Missing);
        if (extensionIdentityCanUnlock) {
          const authorizeWithExternalDeviceIdentityArgs2: Parameters<
            typeof vault.authorizeWithExternalDeviceIdentity
          >[0] = {
            adopt: (manager) => {
              return connectionBrowser.adoptExtensionIdentity({
                manager,
                request: connectRequest,
              });
            },
            mode: existingVaultImport
              ? ExternalDeviceIdentityAuthorizationMode.DeferInitialization
              : ExternalDeviceIdentityAuthorizationMode.ContinueInitialization,
          };
          const adopted = await vault.authorizeWithExternalDeviceIdentity(
            authorizeWithExternalDeviceIdentityArgs2,
          );
          if (!adopted) return;
          extensionBackedVaultSession = true;
          await (existingVaultImport
            ? existingVaultImportLifecycle.resume()
            : vault.loadDb());
          return;
        }
      }
      pendingExistingVaultUnlock = true;
      if (vault.deviceProtectionStatus === DeviceProtectionStatus.Passkey) {
        await new deviceProtectionActions.DeviceProtectionActions(
          vault,
        ).unlockDeviceProtection({ initializeSession: true });
      }
      return;
    }
    if (existingVaultImport) {
      await existingVaultImportLifecycle.resume();
      return;
    }
    if (vault.loginSetup.kind === LoginSetupKind.Active) {
      await vault.connectStagedProvider();
      return;
    }
    await vault.loadDb();
  }
  async function handleSettingsReconnect() {
    if (vault.loginSetup.kind === LoginSetupKind.Active) {
      await vault.connectAndSyncStagedProvider();
      return;
    }
    await vault.manualSync();
  }
  function toggleColorMode() {
    followsSystemColorMode = false;

    colorMode = browserColorMode.manualColorMode({
      current: colorMode,
      storageKey: THEME_STORAGE_KEY,
    });
  }
  const appVersion = APP_VERSION;
  const shellWidth = $derived(
    vault.settingsOpen &&
      vault.settingsSection === SettingsSection.DevicesAccess
      ? APP_SHELL_WIDTH_WIDE
      : APP_SHELL_WIDTH,
  );
  let secretsAddOpen = $state(false);
  const shellSpacing = $derived.by(() => {
    return new ApplicationShellLayout({
      legalRouteKind: legalPageState.kind,
      logsOpen: logsPage,
      extensionConnectOpen: extensionConnectRoute,
      authenticated: vault.isAuthenticated,
      editorOpen: secretsAddOpen,
    }).spacing;
  });
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
  let pendingExistingVaultUnlock = $state(false);
  let pendingEnrollmentDeviceUnlock = $state(false);
  let pendingEnrollmentSubmitState = $state<EnrollmentSubmitQueue>({
    kind: EnrollmentSubmitQueueKind.Idle,
  });
  const showPasskeyOverlay = $derived(
    pendingVaultCreationState.kind ===
      VaultCreationQueueKind.WaitingForDevice && !vault.deviceProtectionReady,
  );
  const showExistingVaultPasskeyOverlay = $derived(
    pendingExistingVaultUnlock && existingVaultNeedsDeviceUnlock,
  );
  const showEnrollmentPasskeyOverlay = $derived(
    pendingEnrollmentDeviceUnlock &&
      urlEnrollmentPending &&
      !vault.deviceProtectionReady,
  );

  async function handleUseEnrollmentCode({
    code,
    password,
  }: EnrollmentCodeUseRequest) {
    if (!vault.deviceProtectionReady) {
      pendingEnrollmentSubmitState = {
        kind: EnrollmentSubmitQueueKind.WaitingForDevice,
        request: { code, password },
      };
      pendingEnrollmentDeviceUnlock = true;
      return;
    }
    pendingEnrollmentSubmitState = {
      kind: EnrollmentSubmitQueueKind.Idle,
    };

    await vault.connectWithEnrollmentCode({
      code,
      password,
    });
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
      vault.loginSetup.kind === LoginSetupKind.Active;
    extensionDiscoveryStoreId = storeId;
    const discovery =
      await connectionBrowser.discoverPairedExtensionIdentity(storeId);
    const openVaultIsDifferentStore =
      vault.activeVault.kind === ActiveVaultKind.Open &&
      vault.activeVault.storeId !== storeId;
    if (
      vault.isAuthenticated ||
      extensionConnectRoute ||
      vault.isVerifying ||
      vault.deviceAuthorizationInProgress ||
      (openVaultIsDifferentStore && !discoveringStagedImport)
    ) {
      return discovery.status ===
        ExtensionPairedVaultIdentityStatusMessageStatus.DifferentVault
        ? ExtensionPairedVaultIdentityStatusMessageStatus.Unavailable
        : discovery.status;
    }
    if (
      discovery.status ===
      ExtensionPairedVaultIdentityStatusMessageStatus.Locked
    ) {
      schedulePairedExtensionDiscoveryRetry({
        storeId,
        discoveringStagedImport,
      });
      return ExtensionPairedVaultIdentityStatusMessageStatus.Locked;
    }
    if (
      discovery.status !==
      ExtensionPairedVaultIdentityStatusMessageStatus.Unlocked
    ) {
      schedulePairedExtensionDiscoveryRetry({
        storeId,
        discoveringStagedImport,
      });
      return ExtensionPairedVaultIdentityStatusMessageStatus.Unavailable;
    }
    extensionIdentityRequestState = {
      kind: ExtensionConnectIntentKind.Requested,
      request: discovery.request,
    };
    await handleUnlock(true);
    return ExtensionPairedVaultIdentityStatusMessageStatus.Unlocked;
  }

  const PAIRED_EXTENSION_UNLOCK_TIMEOUT_MS = 30_000;
  const PAIRED_EXTENSION_UNLOCK_RETRY_MS = 350;

  async function waitForPairedExtensionUnlock(
    request: PairedExtensionUnlockPoll,
  ): Promise<void> {
    const deadline = Date.now() + PAIRED_EXTENSION_UNLOCK_TIMEOUT_MS;
    for (let attempt = 0; Date.now() < deadline; attempt += 1) {
      if (attempt > 0) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, PAIRED_EXTENSION_UNLOCK_RETRY_MS);
        });
      }
      await resumePairedExtensionVault(request.storeId);
      if (vault.isAuthenticated) {
        return;
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
        extensionDiscoveryStoreId = "";
      }
    }, EXTENSION_LOCKED_RETRY_MS);
  }

  async function handleCreateDeviceVault(label: string) {
    if (
      extensionIdentityRequestState.kind ===
        ExtensionConnectIntentKind.Requested &&
      vault.deviceId !== extensionIdentityRequestState.request.deviceId
    ) {
      const connectRequest = extensionIdentityRequestState.request;
      const authorizationRequest: Parameters<
        typeof vault.authorizeWithExternalDeviceIdentity
      >[0] = {
        adopt: (manager) => {
          return connectionBrowser.adoptExtensionIdentity({
            manager,
            request: connectRequest,
          });
        },
        mode: ExternalDeviceIdentityAuthorizationMode.ContinueInitialization,
      };
      const adopted =
        await vault.authorizeWithExternalDeviceIdentity(authorizationRequest);
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
    if (
      extensionIdentityRequestState.kind ===
        ExtensionConnectIntentKind.Requested &&
      vault.isAuthenticated
    ) {
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
  function finishPendingCreation(): void {
    pendingVaultCreationState = { kind: VaultCreationQueueKind.Idle };
  }
  async function handleCreateSentinelParticipantKey(): Promise<string> {
    if (!vault.deviceProtectionReady) {
      pendingVaultCreationState = {
        kind: VaultCreationQueueKind.WaitingForDevice,
        request: { kind: PendingVaultCreationKind.SentinelParticipantKey },
      };
      return "";
    }
    return new sentinelGenesisActions.SentinelGenesisActions(vault)
      .createPublicKeyAnnouncement()
      .finally(finishPendingCreation);
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

    return new sentinelGenesisActions.SentinelGenesisActions(vault)
      .createParticipantResponse({ requestPayload })
      .finally(finishPendingCreation);
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

    await new sentinelGenesisActions.SentinelGenesisActions(
      vault,
    ).acceptOnboardingPackage({ packageJson });
    sentinelOnboardingPackage = "";
  }

  async function refreshExtensionSetupStatus() {
    if (!SUPPORTS_EXTENSION || !vault.isAuthenticated) {
      extensionSetupStateValue = { kind: ExtensionSetupOfferKind.Hidden };
      return;
    }
    extensionSetupStateValue =
      await extensionSetupBrowser.loadExtensionSetupOffer(vault.activeVault);
  }

  async function handleExtensionInstall() {
    extensionInstallBusy = true;
    try {
      await extensionSetupBrowser.openExtensionInstaller();
    } finally {
      extensionInstallBusy = false;
    }
  }

  async function handleExtensionConnect() {
    extensionInstallBusy = true;
    extensionConnectError = false;
    try {
      extensionConnectError =
        !(await extensionSetupBrowser.connectInstalledExtension());
    } finally {
      extensionInstallBusy = false;
    }
  }

  $effect(() => {
    void vault.isAuthenticated;
    void vault.activeVault;
    void refreshExtensionSetupStatus();

    return extensionSetupBrowser.observeExtensionSetupChanges(
      refreshExtensionSetupStatus,
    );
  });

  $effect(() => {
    if (
      vault.helpOpen &&
      new PendingCreation(
        pendingVaultCreationState,
      ).isSentinelParticipantKeyPending()
    )
      return finishPendingCreation();
    if (
      pendingVaultCreationState.kind !==
        VaultCreationQueueKind.WaitingForDevice ||
      !vault.deviceProtectionReady ||
      vault.isVerifying
    )
      return;
    const pending = pendingVaultCreationState.request;
    if (
      pending.kind === PendingVaultCreationKind.SentinelParticipantKey ||
      pending.kind === PendingVaultCreationKind.SentinelParticipantResponse
    )
      return;
    pendingVaultCreationState = { kind: VaultCreationQueueKind.Idle };
    if (pending.kind === PendingVaultCreationKind.Simple) {
      void vault.createLocalVaultWithDeviceKeys(pending.label);
      return;
    }
    if (pending.kind === PendingVaultCreationKind.SentinelOnboarding) {
      void handleAcceptSentinelOnboarding(pending.packageJson);
      return;
    }
    if (pending.kind === PendingVaultCreationKind.Sentinel) {
      void vault.startSentinelGenesis(pending.args);
    }
  });

  $effect(() => {
    const storeId = existingVaultImportLifecycle.unlockStoreId;
    if (
      extensionIdentityRequestState.kind ===
        ExtensionConnectIntentKind.Requested &&
      extensionIdentityRequestState.request.source ===
        ExtensionIdentityRequestSource.PairedVault &&
      storeId &&
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
        !(
          vault.loginRequiresExistingVault &&
          vault.loginSetup.kind === LoginSetupKind.Active
        )) ||
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
    void (existingVaultImportLifecycle.waitingForDevice
      ? existingVaultImportLifecycle.resume()
      : vault.loadDb());
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
    pendingEnrollmentSubmitState = {
      kind: EnrollmentSubmitQueueKind.Idle,
    };
    pendingEnrollmentDeviceUnlock = false;
    void vault.connectWithEnrollmentCode(pending);
  });
</script>

<AppSurface
  {vault}
  {appLogsPage}
  {colorMode}
  {shellWidth}
  {shellSpacing}
  {legalPageState}
  {logsPage}
  {extensionConnectRoute}
  extensionSetupState={extensionSetupStateValue}
  {appVersion}
  {extensionConnectRequestState}
  preserveAccessGate={pendingVaultCreationState.kind ===
    VaultCreationQueueKind.WaitingForDevice ||
    Boolean(sentinelInvitationRequest.trim())}
  accessGateProps={{
    vault,
    showAccessGate:
      vault.deviceProtectionReady ||
      showLoginWithoutPasskey ||
      existingVaultNeedsDeviceUnlock,
    existingVaultNeedsDeviceUnlock,
    usesExtensionDeviceIdentity:
      extensionIdentityRequestState.kind ===
        ExtensionConnectIntentKind.Requested &&
      (extensionIdentityRequestState.request.source ===
        ExtensionIdentityRequestSource.PairedVault ||
        !requiresPasskeyFirst ||
        extensionBackedVaultSession ||
        vault.deviceProtectionStatus === DeviceProtectionStatus.Missing),
    showPasskeyOverlay:
      showPasskeyOverlay ||
      showExistingVaultPasskeyOverlay ||
      showEnrollmentPasskeyOverlay,
    sentinelInvitationRequest,
    sentinelParticipantResponsePending: new PendingCreation(
      pendingVaultCreationState,
    ).isSentinelParticipantResponsePending(),
    sentinelParticipantResponse,
    sentinelOnboardingPackage,
    onUnlock: handleUnlock,
    onUseEnrollmentCode: handleUseEnrollmentCode,
    onAcceptSentinelOnboardingPackage: handleAcceptSentinelOnboarding,
    onUnlockWithPassword: (unlockRequest) =>
      existingVaultImportLifecycle.unlockWithPassword(unlockRequest),
    onSwitchVault: () => existingVaultImportLifecycle.leave(),
    onSentinelUnlocked: () => {
      sentinelInvitationRequest = "";
      return existingVaultImportLifecycle.finish();
    },
    onCreateDeviceVault: handleCreateDeviceVault,
    onStartSentinelGenesis: handleStartSentinelGenesis,
    onCreateSentinelParticipantKey: handleCreateSentinelParticipantKey,
    onCreateSentinelParticipantResponse:
      handleCreateSentinelParticipantResponse,
    onDismissPasskey: () => {
      if (showExistingVaultPasskeyOverlay) {
        pendingExistingVaultUnlock = false;
        existingVaultImportLifecycle.cancel();
        return;
      }
      if (showEnrollmentPasskeyOverlay) {
        pendingEnrollmentDeviceUnlock = false;
        return;
      }
      pendingVaultCreationState = { kind: VaultCreationQueueKind.Idle };
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
    onEditorOpenChange: (open) => {
      secretsAddOpen = open;
    },
  }}
  onNavigateHome={navigateHome}
  onToggleColorMode={toggleColorMode}
  onExtensionConnect={handleExtensionConnect}
  onFinishExtensionConnect={finishExtensionConnect}
/>
