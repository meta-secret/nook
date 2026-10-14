<script lang="ts">
  import { WorkspaceLocation } from "$lib/app/workspace-route";
  import type { IdentityVaultTarget } from "$lib/components/identities/identity-card-model";
  import type { SentinelActionResult } from "$lib/vault/sentinel-genesis";
  type EnrollmentCodeUnlock = {
    readonly code: string;
    readonly password: string;
  };

  type VaultPasswordUnlock = {
    readonly entryId: string;
    readonly password: string;
  };

  import { I18N_KEYS } from "../../../generated/i18n-keys";
  import { ArrowLeft, RefreshCw, ShieldCheck } from "@lucide/svelte";
  import { tick, untrack, type ComponentProps } from "svelte";
  import type { VaultState } from "$lib/vault.svelte";
  import IdentitiesHub from "$lib/components/identities/IdentitiesHub.svelte";
  import { type StartSentinelGenesisArgs } from "$app-wasm";
  import { Button } from "$lib/components/ui/button";
  import type {
    OAuthFilePreset,
    ProviderSetupRequest,
    StorageProvider,
    StorageProviderType,
  } from "$lib/auth/providers";
  import {
    DEFAULT_GITHUB_REPO,
    LocalFolderPresentation,
    LocalFolderHandleKind,
    oauth_access_token,
  } from "$lib/auth/providers";
  import { WorkspaceRoute } from "$lib/app/workspace-route";
  import { VaultWorkspaceActions } from "$lib/vault/ui";
  import ProviderSetupFields from "$lib/components/ProviderSetupFields.svelte";
  import OAuthProviderSetupWizard from "$lib/components/OAuthProviderSetupWizard.svelte";
  import GitHubProviderSetupWizard from "$lib/components/GitHubProviderSetupWizard.svelte";
  import LocalFolderProviderSetupWizard from "$lib/components/LocalFolderProviderSetupWizard.svelte";
  import {
    LoginVaultEntryKind,
    type LoginVaultEntry,
  } from "$lib/components/login/login-unlock-state";
  import LoginCreateVaultChooser from "$lib/components/login/LoginCreateVaultChooser.svelte";
  import type { SentinelGenesisParticipation } from "$lib/components/login/login-create-vault-chooser-contract";
  import {
    LoginVaultExtensionPairingStatusLookup,
    type LoginVaultExtensionPairingStatusEntry,
  } from "$lib/components/login/login-vault-extension-pairing-status";
  import LoginVaultPicker from "$lib/components/login/LoginVaultPicker.svelte";
  import LoginNewVaultPanel from "$lib/components/login/LoginNewVaultPanel.svelte";
  import LoginProviderManagement from "$lib/components/login/LoginProviderManagement.svelte";
  import { LoginProviderManagementVariant } from "$lib/components/login/login-provider-management-state";
  import JoinThisDevice from "$lib/components/join/JoinThisDevice.svelte";
  import { NewIdentityStage } from "$lib/vault/state/ui.svelte";
  import CardPasswordUnlock from "$lib/components/identities/CardPasswordUnlock.svelte";
  import { IdentitySwitch } from "$lib/components/identities/identity-switch";
  import { DeviceProtectionActions } from "$lib/vault/device-protection.svelte";
  import SentinelCeremonyPanel from "$lib/components/login/SentinelCeremonyPanel.svelte";
  import { SentinelCeremonyVisibility } from "$lib/vault/sentinel-unlock";
  import {
    SentinelLoginPresentationReader,
    SentinelLoginPresentationKind,
  } from "$lib/vault/sentinel-login-presentation.svelte";
  import RemoteVaultRecoveryPanel from "$lib/components/login/RemoteVaultRecoveryPanel.svelte";
  import * as sentinelGenesisActions from "$lib/vault/sentinel-genesis";
  import {
    SentinelGenesisPhase,
    type VaultApplication,
  } from "$app-wasm";
  import {
    ActiveVaultKind,
    LocalFolderDraftKind,
    LoginSetupKind,
    LoginVaultSelectionKind,
    OAuthFileDraftKind,
    OAuthSetupPresetKind,
    RecoveryDiscoveryKind,
    type LoginSetup,
  } from "$lib/vault/state/provider.svelte";

  let {
    vault,
    appKind,
    providers,
    loginSetup,
    githubPat = $bindable(""),
    githubRepo = $bindable(DEFAULT_GITHUB_REPO),
    isVerifying,
    isInitializing,
    addProviderOpen = false,
    onUnlock,
    onBeginAddProvider,
    onCancelAddProvider,
    onBeginSetup,
    onCancelSetup,
    onUseEnrollmentCode,
    onUnlockWithPassword,
    onSentinelUnlocked,
    onCreateDeviceVault,
    onStartSentinelGenesis,
    onCreateSentinelGenesisPublicKeyAnnouncement,
    onCreateSentinelGenesisParticipantResponse,
    onRemoveProvider,
    prefillEnrollmentCode = "",
    enrollmentFromUrlPending = false,
    deviceAuthorizationPending = false,
    usesExtensionDeviceIdentity = false,
    sentinelInvitationRequest = "",
    sentinelParticipantResponsePending = false,
    sentinelParticipantResponse = "",
    sentinelOnboardingPackage = "",
    extensionConnectPairingStatusEntries,
    onAcceptSentinelOnboardingPackage,
  }: {
    vault: VaultState;
    appKind: VaultApplication;
    providers: StorageProvider[];
    loginSetup: LoginSetup;
    githubPat: string;
    githubRepo: string;
    isVerifying: boolean;
    isInitializing: boolean;
    addProviderOpen?: boolean;
    onUnlock: () => void | Promise<void>;
    onBeginAddProvider?: () => void;
    onCancelAddProvider?: () => void;
    onBeginSetup: (request: ProviderSetupRequest) => void;
    onCancelSetup: () => void;
    onUseEnrollmentCode?: (args: EnrollmentCodeUnlock) => void | Promise<void>;
    onUnlockWithPassword: (args: VaultPasswordUnlock) => void | Promise<void>;
    onSentinelUnlocked?: () => void | Promise<void>;
    onCreateDeviceVault: (label: string) => void | Promise<void>;
    onStartSentinelGenesis: (
      args: StartSentinelGenesisArgs,
    ) => Promise<boolean>;
    onCreateSentinelGenesisPublicKeyAnnouncement?: () => Promise<
      SentinelActionResult<string>
    >;
    onCreateSentinelGenesisParticipantResponse?: (
      requestPayload: string,
    ) => Promise<SentinelActionResult<string>>;
    onRemoveProvider?: (id: string) => void | Promise<void>;
    prefillEnrollmentCode?: string;
    enrollmentFromUrlPending?: boolean;
    deviceAuthorizationPending?: boolean;
    usesExtensionDeviceIdentity?: boolean;
    sentinelInvitationRequest?: string;
    sentinelParticipantResponsePending?: boolean;
    sentinelParticipantResponse?: string;
    sentinelOnboardingPackage?: string;
    extensionConnectPairingStatusEntries: LoginVaultExtensionPairingStatusEntry[];
    onAcceptSentinelOnboardingPackage?: (
      packageJson: string,
    ) => void | Promise<void>;
  } = $props();

  type CreateVaultChooserOptionalProps = Partial<
    Pick<
      ComponentProps<typeof LoginCreateVaultChooser>,
      | "onAcceptSentinelOnboardingPackage"
      | "onFinishSentinelInvitation"
      | "onUseEnrollmentCode"
    >
  >;
  type CreateVaultChooserProps = ComponentProps<typeof LoginCreateVaultChooser>;
  type LoginVaultPickerProps = ComponentProps<typeof LoginVaultPicker>;
  type SentinelCeremonyOptionalProps = Partial<
    Pick<ComponentProps<typeof SentinelCeremonyPanel>, "onUnlocked">
  >;
  type ProviderManagementOptionalProps = Partial<
    Pick<
      ComponentProps<typeof LoginProviderManagement>,
      "onBeginAddProvider" | "onCancelAddProvider" | "onRemoveProvider"
    >
  >;
  const createVaultChooserOptionalProps = $derived.by(() => {
    const props: CreateVaultChooserOptionalProps = {};
    if (onUseEnrollmentCode) props.onUseEnrollmentCode = onUseEnrollmentCode;
    if (onAcceptSentinelOnboardingPackage)
      props.onAcceptSentinelOnboardingPackage =
        onAcceptSentinelOnboardingPackage;
    if (onSentinelUnlocked)
      props.onFinishSentinelInvitation = onSentinelUnlocked;
    return props;
  });
  const sentinelCeremonyOptionalProps = $derived.by(() => {
    const props: SentinelCeremonyOptionalProps = {};
    if (onSentinelUnlocked) props.onUnlocked = onSentinelUnlocked;
    return props;
  });
  const providerManagementOptionalProps = $derived.by(() => {
    const props: ProviderManagementOptionalProps = {};
    if (onBeginAddProvider) props.onBeginAddProvider = onBeginAddProvider;
    if (onCancelAddProvider) props.onCancelAddProvider = onCancelAddProvider;
    if (onRemoveProvider) props.onRemoveProvider = onRemoveProvider;
    return props;
  });

  let showProviderSetupLink = $state(false);
  /** Back from restore returns to the first screen even with saved rows. */
  let firstScreenRequested = $state(false);
  let newVaultOpen = $state(false);

  /** A vault row on an identity card opens that vault's unlock panel. */
  async function openVaultFromCard(storeId: string): Promise<void> {
    newVaultOpen = false;
    if (showProviderSetupLink) {
      vault.cancelExistingVaultOpen();
      showProviderSetupLink = false;
    }
    if (addProviderOpen) onCancelAddProvider?.();
    if (showSetup) onCancelSetup();
    await vault.chooseLoginVault(storeId);
    await tick();
    const scrollRequest: ScrollIntoViewOptions = {
      block: "nearest",
      behavior: "smooth",
    };
    document
      .querySelector('[data-testid="login-local-unlock-step"]')
      ?.scrollIntoView(scrollRequest);
  }

  /** "New vault" on the identity card: create one here or import one. */
  function openNewVault(): void {
    newVaultOpen = true;
  }

  function importExistingVault(): void {
    newVaultOpen = false;
    vault.beginExistingVaultOpen();
    showProviderSetupLink = true;
  }

  /** Manage on a locked identity unlocks it (one of its vaults, with this
   * device's key) and lands on the identity home. */
  function manageIdentity(target: IdentityVaultTarget): void {
    // With no vault on this browser there is nothing to unlock it with.
    if (!target.storeId) return;
    const home: UnlockDestination = {
      storeId: target.storeId,
      route: WorkspaceRoute.Overview,
    };
    void unlockTo(home);
  }

  /** Unlock on a locked card unlocks the identity: this device's passkey
   * opens its key, and no vault is opened. A vault opens from its row. */
  async function unlockIdentity(): Promise<void> {
    if (vault.deviceProtectionReady || isVerifying) return;
    const identityOnly: Parameters<
      DeviceProtectionActions["unlockDeviceProtection"]
    >[0] = { initializeSession: false };
    await new DeviceProtectionActions(vault).unlockDeviceProtection(
      identityOnly,
    );
  }

  /** Lock on a card whose identity is unlocked without an open vault. */
  function lockIdentity(): void {
    void vault.lockDeviceProtection();
  }

  /** A vault row on a locked card unlocks that vault. */
  function unlockVault(storeId: string): void {
    const vaultPage: UnlockDestination = {
      storeId,
      route: WorkspaceRoute.Vault,
    };
    void unlockTo(vaultPage);
  }

  type UnlockDestination = {
    readonly storeId: string;
    readonly route: WorkspaceRoute;
  };

  /** Unlock a vault right away, as its Unlock button would, and open the
   * workspace on `route` once it is unlocked. */
  async function unlockTo(destination: UnlockDestination): Promise<void> {
    const navigation = new WorkspaceLocation(destination.route).navigate();
    if (navigation.isErr()) {
      vault.errorMsg = vault.t(navigation.error.translationKey);
      return;
    }
    const routeRequest: Parameters<
      VaultWorkspaceActions["applyWorkspaceRoute"]
    >[0] = { route: destination.route };
    new VaultWorkspaceActions(vault).applyWorkspaceRoute(routeRequest);
    // Choosing a vault reads it with the device key, so the identity is
    // unlocked first: passkey, then the vault, then open it.
    if (destination.storeId !== selectedCardStoreId) {
      await unlockIdentity();
      if (!vault.deviceProtectionReady) return;
      await openVaultFromCard(destination.storeId);
      await tick();
    }
    if (vault.errorMsg || isVerifying) return;
    await onUnlock();
  }

  function newIdentity(): void {
    vault.newIdentity = NewIdentityStage.Name;
  }

  const hasProviders = $derived(providers.length > 0);
  const showSetup = $derived(loginSetup.kind === LoginSetupKind.Active);
  function setupIs(type: StorageProviderType): boolean {
    return (
      loginSetup.kind === LoginSetupKind.Active &&
      loginSetup.providerType === type
    );
  }
  const showVaultPicker = $derived(
    vault.showLoginVaultPicker && !showProviderSetupLink,
  );
  const sentinelPresentation = $derived(
    new SentinelLoginPresentationReader(vault),
  );
  $effect(() => sentinelPresentation.start());
  const showSentinelCeremony = $derived(
    sentinelPresentation.presentation.kind ===
      SentinelLoginPresentationKind.Ready &&
      sentinelPresentation.presentation.projection.ceremonyVisibility ===
        SentinelCeremonyVisibility.Visible,
  );
  const hasKnownLocalVault = $derived(
    vault.localVaultPresent || vault.localVaults.length > 0,
  );
  const showLocalUnlock = $derived(
    hasKnownLocalVault &&
      vault.sentinelGenesisPhase !== SentinelGenesisPhase.DeliveringShares &&
      !showSetup &&
      !addProviderOpen &&
      !showProviderSetupLink &&
      !showVaultPicker,
  );
  const activeLoginVault = $derived.by((): LoginVaultEntry => {
    const selectedStoreId =
      vault.selectedLoginVault.kind === LoginVaultSelectionKind.Selected
        ? vault.selectedLoginVault.storeId
        : vault.activeVault.kind === ActiveVaultKind.Open
          ? vault.activeVault.storeId
          : "";
    for (const entry of vault.localVaults) {
      if (entry.storeId === selectedStoreId) {
        return { kind: LoginVaultEntryKind.Available, entry };
      }
    }
    for (const entry of vault.localVaults) {
      return { kind: LoginVaultEntryKind.Available, entry };
    }
    return { kind: LoginVaultEntryKind.Unavailable };
  });
  const selectedCardStoreId = $derived(
    showLocalUnlock && activeLoginVault.kind === LoginVaultEntryKind.Available
      ? activeLoginVault.entry.storeId
      : "",
  );
  const pairingStatusLookup = $derived(
    new LoginVaultExtensionPairingStatusLookup(
      extensionConnectPairingStatusEntries,
    ),
  );
  const showQrOnboarding = $derived(
    Boolean(
      enrollmentFromUrlPending && prefillEnrollmentCode && onUseEnrollmentCode,
    ),
  );
  const showCreateVault = $derived(
    (vault.sentinelGenesisPhase === SentinelGenesisPhase.DeliveringShares ||
      (!vault.localVaultPresent &&
        vault.localVaults.length === 0 &&
        (!hasProviders || firstScreenRequested))) &&
      !showQrOnboarding &&
      !showSetup &&
      !addProviderOpen &&
      !showProviderSetupLink &&
      !showVaultPicker,
  );
  const showProviderSetup = $derived(
    (showProviderSetupLink ||
      addProviderOpen ||
      (hasProviders && !vault.localVaultPresent)) &&
      !showSetup &&
      !showLocalUnlock &&
      !showCreateVault,
  );
  const showAccessSheet = $derived(
    (showSentinelCeremony && !showLocalUnlock && !showVaultPicker) ||
      showSetup ||
      showProviderSetup,
  );
  const isUnlocking = $derived(
    isVerifying && (showLocalUnlock || showSetup) && !showSetup,
  );
  const setupCanConnect = $derived(
    setupIs("local") ||
      (setupIs("local-folder") &&
        vault.localFolderDraft.kind === LocalFolderDraftKind.Configured &&
        new LocalFolderPresentation(
          vault.localFolderDraft.config,
        ).localFolderHandle().kind === LocalFolderHandleKind.Selected) ||
      (setupIs("oauth-file") &&
        vault.oauthFileDraft.kind === OAuthFileDraftKind.Configured &&
        oauth_access_token(vault.oauthFileDraft.config).kind === "available") ||
      (setupIs("github") && Boolean(githubPat.trim())),
  );
  const recoveryPasswordEntries = $derived(
    vault.recoveryDiscovery.kind === RecoveryDiscoveryKind.Found
      ? vault.recoveryDiscovery.summary.passwordEntries
      : [],
  );
  /** Backup passwords of the selected vault, offered on its locked card. */
  const cardPasswordEntries = $derived(
    vault.passwordEntries.length > 0
      ? vault.passwordEntries
      : recoveryPasswordEntries,
  );
  const oauthPreset = $derived<OAuthFilePreset>(
    vault.oauthFileDraft.kind === OAuthFileDraftKind.Configured
      ? vault.oauthFileDraft.config.preset
      : vault.oauthSetupSelection.kind === OAuthSetupPresetKind.Selected
        ? vault.oauthSetupSelection.preset
        : "google-drive",
  );

  function handleFirstConnectSubmit(e: Event) {
    e.preventDefault();
    void onUnlock();
  }

  $effect(() => {
    if (
      vault.sentinelGenesisPhase === SentinelGenesisPhase.DeliveringShares &&
      vault.syncProviders.length > 0 &&
      !showSetup &&
      !addProviderOpen
    ) {
      showProviderSetupLink = false;
    }
    if (showLocalUnlock && !vault.isInitializing) {
      untrack(() => void vault.prepareLocalLogin());
    }
    if (
      vault.deviceProtectionReady &&
      !deviceAuthorizationPending &&
      !vault.isAuthenticated &&
      (vault.syncProviders.length > 0 || vault.localVaultPresent)
    ) {
      untrack(() => void vault.refreshSentinelUnlockStatus());
    }
  });
</script>

{#snippet vaultSetupPanel()}
  <LoginCreateVaultChooser
    {vault}
    {appKind}
    {isVerifying}
    {isInitializing}
    {usesExtensionDeviceIdentity}
    {onCreateDeviceVault}
    {onStartSentinelGenesis}
    onAddSentinelGenesisParticipantResponse={({
      payload,
      participantLabel,
    }: SentinelGenesisParticipation) => {
      const participantRequest: Parameters<
        sentinelGenesisActions.SentinelGenesisActions["addParticipantResponse"]
      >[0] = {
        payload,
        participantLabel: participantLabel ? participantLabel : "",
      };
      return new sentinelGenesisActions.SentinelGenesisActions(
        vault,
      ).addParticipantResponse(participantRequest);
    }}
    onFinalizeSentinelGenesis={() =>
      new sentinelGenesisActions.SentinelGenesisActions(vault).finalize()}
    onCreateSentinelGenesisParticipantResponse={((
      ...[
        v = (payload) =>
          (() => {
            const createParticipantResponseArgs: Parameters<
              sentinelGenesisActions.SentinelGenesisActions["createParticipantResponse"]
            >[0] = { requestPayload: payload };
            return new sentinelGenesisActions.SentinelGenesisActions(
              vault,
            ).createParticipantResponse(createParticipantResponseArgs);
          })(),
      ]
    ) => v)(onCreateSentinelGenesisParticipantResponse)}
    onCreateSentinelGenesisPublicKeyAnnouncement={((
      ...[
        v = () =>
          new sentinelGenesisActions.SentinelGenesisActions(
            vault,
          ).createPublicKeyAnnouncement(),
      ]
    ) => v)(onCreateSentinelGenesisPublicKeyAnnouncement)}
    onRememberSentinelGenesisRequest={(
      payload: Parameters<
        NonNullable<CreateVaultChooserProps["onRememberSentinelGenesisRequest"]>
      >[0],
    ) =>
      (() => {
        const rememberRequestArgs: Parameters<
          sentinelGenesisActions.SentinelGenesisActions["rememberRequest"]
        >[0] = { requestPayload: payload };
        return new sentinelGenesisActions.SentinelGenesisActions(
          vault,
        ).rememberRequest(rememberRequestArgs);
      })()}
    onReceiveSentinelGenesisShare={(
      payload: Parameters<
        NonNullable<CreateVaultChooserProps["onReceiveSentinelGenesisShare"]>
      >[0],
    ) =>
      (() => {
        const acceptShareDeliveryArgs: Parameters<
          sentinelGenesisActions.SentinelGenesisActions["acceptShareDelivery"]
        >[0] = { payload };
        return new sentinelGenesisActions.SentinelGenesisActions(
          vault,
        ).acceptShareDelivery(acceptShareDeliveryArgs);
      })()}
    onCompleteSentinelGenesisDelivery={() =>
      new sentinelGenesisActions.SentinelGenesisActions(
        vault,
      ).completeDelivery()}
    sentinelGenesisPhase={vault.sentinelGenesisPhase}
    sentinelGenesisRequest={vault.sentinelGenesisRequest}
    sentinelGenesisParticipants={vault.sentinelGenesisParticipants}
    sentinelGenesisDeliveries={vault.sentinelGenesisDeliveries}
    {sentinelInvitationRequest}
    {sentinelParticipantResponsePending}
    {sentinelParticipantResponse}
    {sentinelOnboardingPackage}
    {...createVaultChooserOptionalProps}
    onConnectStorage={() => {
      vault.beginExistingVaultOpen();
      showProviderSetupLink = true;
      firstScreenRequested = false;
    }}
  />

{/snippet}
{#snippet newVaultPanel()}
  <LoginNewVaultPanel
    {vault}
    {isVerifying}
    {isInitializing}
    onCreateVault={onCreateDeviceVault}
    onImportVault={importExistingVault}
    onClose={() => (newVaultOpen = false)}
  />
{/snippet}
{#snippet sentinelCeremony()}
  <SentinelCeremonyPanel {vault} {isVerifying} {isInitializing} />
{/snippet}
{#snippet cardPasswordUnlock()}
  <CardPasswordUnlock
    {vault}
    vaultLabel={activeLoginVault.kind === LoginVaultEntryKind.Available
      ? activeLoginVault.entry.display_label(
          vault.t(I18N_KEYS.LoginVaultPickerUnnamed),
        )
      : ""}
    entries={cardPasswordEntries}
    {isVerifying}
    onUnlock={onUnlockWithPassword}
  />
{/snippet}
{#snippet vaultPicker()}
  <LoginVaultPicker
    {vault}
    vaults={vault.localVaults}
    {extensionConnectPairingStatusEntries}
    {isVerifying}
    {isInitializing}
    onChooseVault={(
      storeId: Parameters<LoginVaultPickerProps["onChooseVault"]>[0],
    ) => vault.chooseLoginVault(storeId)}
  />
{/snippet}

<div
  class="w-full animate-in fade-in duration-300"
  data-testid="login-gate"
  data-local-vault={vault.localVaultPresent ? "true" : "false"}
>
    <IdentitiesHub
      {vault}
      selectedStoreId={selectedCardStoreId}
      showCards={!showQrOnboarding}
      busy={isVerifying || isInitializing}
      canAddVault={!showCreateVault && !showQrOnboarding}
      onOpenVault={unlockVault}
      onNewVault={openNewVault}
      onManage={manageIdentity}
      onUnlock={() => void unlockIdentity()}
      onLock={lockIdentity}
      onNewIdentity={newIdentity}
      onUseIdentity={(target: IdentityVaultTarget) =>
        void new IdentitySwitch(vault).to(target.identityId)}
      pairingStatusFor={(storeId: string) =>
        pairingStatusLookup.statusForStore(storeId)}
      {...showLocalUnlock && !newVaultOpen && showSentinelCeremony
        ? { unlockPanel: sentinelCeremony }
        : {}}
      {...showLocalUnlock && !newVaultOpen && cardPasswordEntries.length > 0
        ? { passwordFallback: cardPasswordUnlock }
        : {}}
      {...showVaultPicker && !newVaultOpen ? { vaultPicker } : {}}
      {...(showCreateVault || sentinelInvitationRequest.trim()) &&
      !showQrOnboarding
        ? { vaultSetup: vaultSetupPanel }
        : newVaultOpen && (showLocalUnlock || showVaultPicker)
          ? { vaultSetup: newVaultPanel }
          : {}}
      vaultSetupOpen={newVaultOpen ||
        Boolean(sentinelInvitationRequest.trim()) ||
        vault.sentinelGenesisPhase === SentinelGenesisPhase.DeliveringShares}
    >
      <div class="grid min-w-0 grid-cols-1 gap-3 empty:hidden">
        {#if vault.sessionExpiredByIdle}
          <p
            class="nk-banner nk-banner-warning px-4 py-3 text-sm text-foreground"
            data-testid="login-session-expired"
            role="status"
          >
            {vault.t(I18N_KEYS.SessionExpiredIdle)}
          </p>
        {/if}

        {#if showQrOnboarding && onUseEnrollmentCode}
          <JoinThisDevice
            {vault}
            {isVerifying}
            code={prefillEnrollmentCode}
            {onUseEnrollmentCode}
          />
        {:else if !showCreateVault && !sentinelInvitationRequest.trim()}
          {#if showAccessSheet}
            <section
              class="nk-frame-sheet min-w-0"
              data-testid="login-access-sheet"
            >
              <header class="border-b border-border px-5 pb-4 pt-5 sm:px-6">
                <div class="space-y-1">
                  <h2
                    class="text-lg font-semibold tracking-tight text-foreground"
                  >
                    {#if showSentinelCeremony && !showSetup && !showProviderSetup}
                      {vault.t(I18N_KEYS.LoginUnlockVault)}
                    {:else if showSetup}
                      {(() => {
                        const tArgs: Parameters<typeof vault.t>[0] = {
                          key: I18N_KEYS.OnboardingConnectTo,
                          replacements: {
                            provider: setupIs("github")
                              ? "GitHub"
                              : setupIs("local-folder")
                                ? vault.t(I18N_KEYS.ProviderPickerLocalFolder)
                                : vault.t(I18N_KEYS.OnboardingLocalStorage),
                          },
                        };
                        return vault.t(tArgs);
                      })()}
                    {:else if addProviderOpen}
                      {vault.t(I18N_KEYS.OnboardingAddProvider)}
                    {:else if vault.loginRequiresExistingVault}
                      {vault.t(I18N_KEYS.FirstRunRestoreTitle)}
                    {:else}
                      {vault.t(I18N_KEYS.OnboardingSetupStorage)}
                    {/if}
                  </h2>
                  {#if isUnlocking}
                    <p class="text-sm text-pretty text-muted-foreground">
                      {vault.t(I18N_KEYS.LoginUnlocking)}
                    </p>
                  {:else if showSetup && setupIs("github")}
                    <p class="text-sm text-pretty text-muted-foreground">
                      {vault.t(I18N_KEYS.OnboardingGithubDescription)}
                    </p>
                  {:else if showSetup}
                    <p class="text-sm text-pretty text-muted-foreground">
                      {vault.t(I18N_KEYS.OnboardingLocalDescription)}
                    </p>
                  {:else if addProviderOpen}
                    <p class="text-sm text-pretty text-muted-foreground">
                      {vault.t(I18N_KEYS.OnboardingAnotherProvider)}
                    </p>
                  {/if}
                </div>
              </header>

              <div class="px-5 pb-5 pt-4 sm:px-6 sm:pb-6">
                {#if showSentinelCeremony && !showSetup && !showProviderSetup}
                  <SentinelCeremonyPanel
                    {vault}
                    {isVerifying}
                    {isInitializing}
                    {...sentinelCeremonyOptionalProps}
                  />
                {:else if showSetup}
                  {#if setupIs("oauth-file")}
                    <OAuthProviderSetupWizard
                      {vault}
                      bind:githubRepo
                      idPrefix="login"
                      preset={oauthPreset}
                      {isVerifying}
                      {isInitializing}
                      {onCancelSetup}
                      onConnect={onUnlock}
                    />
                  {:else if setupIs("github")}
                    <GitHubProviderSetupWizard
                      {vault}
                      bind:githubPat
                      bind:githubRepo
                      idPrefix="login"
                      {isVerifying}
                      {isInitializing}
                      connectDisabled={vault.clientPolicy.remote_recovery_prompt_visible(
                        vault.remoteVaultRecoveryState,
                      )}
                      {onCancelSetup}
                      onConnect={onUnlock}
                    >
                      {#snippet beforeConnect()}
                        {#if vault.clientPolicy.remote_recovery_prompt_visible(vault.remoteVaultRecoveryState)}
                          <RemoteVaultRecoveryPanel
                            {vault}
                            state={vault.remoteVaultRecoveryState}
                            isBusy={isVerifying}
                            onRecover={() => vault.confirmRecoverRemoteVault()}
                            onCreateFresh={() =>
                              vault.confirmCreateFreshRemoteVault()}
                            onDismiss={() => {
                              const cleared = vault.clearRemoteVaultRecovery();
                              if (cleared.isErr())
                                vault.errorMsg = vault.t(
                                  cleared.error.translationKey,
                                );
                            }}
                          />
                        {/if}
                      {/snippet}
                    </GitHubProviderSetupWizard>
                  {:else if setupIs("local-folder")}
                    <LocalFolderProviderSetupWizard
                      {vault}
                      idPrefix="login"
                      {isVerifying}
                      {isInitializing}
                      {onCancelSetup}
                      onConnect={onUnlock}
                    />
                  {:else}
                    <form
                      novalidate
                      onsubmit={handleFirstConnectSubmit}
                      class="space-y-4"
                    >
                      <ProviderSetupFields {vault} {onCancelSetup} />
                      <div
                        class="flex flex-col gap-2 sm:flex-row sm:justify-end"
                      >
                        <Button
                          type="submit"
                          class="sm:min-w-[180px]"
                          data-testid="connect-provider-btn"
                          disabled={!setupCanConnect}
                        >
                          {#if isInitializing}
                            <RefreshCw class="size-4 animate-spin" />
                            {vault.t(I18N_KEYS.OnboardingLoadingEngine)}
                          {:else if isVerifying}
                            <RefreshCw class="size-4 animate-spin" />
                            {vault.t(I18N_KEYS.CommonConnecting)}
                          {:else}
                            <ShieldCheck class="size-4" />
                            {vault.t(I18N_KEYS.CommonConnect)}
                          {/if}
                        </Button>
                      </div>
                    </form>
                  {/if}
                {:else if showProviderSetup}
                  {#if (showProviderSetupLink || !vault.localVaultPresent) && !addProviderOpen}
                    <button
                      type="button"
                      class="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                      data-testid="login-back-to-get-started"
                      onclick={() => {
                        vault.cancelExistingVaultOpen();
                        showProviderSetupLink = false;
                        firstScreenRequested = true;
                      }}
                    >
                      <ArrowLeft class="size-4" />
                      {vault.t(I18N_KEYS.FirstRunBack)}
                    </button>
                  {/if}
                  <LoginProviderManagement
                    {vault}
                    variant={LoginProviderManagementVariant.Setup}
                    {providers}
                    {isVerifying}
                    {isInitializing}
                    addingProvider={addProviderOpen}
                    {...providerManagementOptionalProps}
                    {onBeginSetup}
                  />
                {/if}
              </div>
            </section>
          {/if}

        {/if}
      </div>
    </IdentitiesHub>
</div>
