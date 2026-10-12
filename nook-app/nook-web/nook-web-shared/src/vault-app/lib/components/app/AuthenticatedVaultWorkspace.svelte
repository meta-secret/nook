<!--
Unified identity and vault workspace. Identities are the hub; a vault page
and the management pages share one shell: a quiet page bar, the page, the
status line, and (on management pages) a grouped rail that becomes a bottom
bar on phones.
-->
<script lang="ts">
  type SecretAddModeChange = {
    readonly open: boolean;
    readonly selection: SecretTypeSelection;
  };

  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { onDestroy, tick, untrack, type ComponentProps } from "svelte";
  import { Download, Puzzle, Settings2 } from "@lucide/svelte";
  import {
    ExtensionSetupOfferKind,
    type ExtensionSetupOffer,
  } from "$lib/app/extension-setup";
  import {
    configured_vault_application_supports_extension,
    NookIdentityLocalAccessKind,
    ProviderSyncFailureHandling,
    ProviderSyncVisibility,
  } from "$app-wasm";
  import { ExtensionSetupStatus } from "$lib/extension/install";
  import ExtensionInstallSetupCard from "$lib/components/ExtensionInstallSetupCard.svelte";
  import OnboardDevice from "$lib/components/OnboardDevice.svelte";
  import PendingJoinsBanner from "$lib/components/PendingJoinsBanner.svelte";
  import SecretVault from "$lib/components/SecretVault.svelte";
  import VaultAdmin from "$lib/components/VaultAdmin.svelte";
  import DevicesAccessDashboard from "$lib/components/DevicesAccessDashboard.svelte";
  import type { KeysPageLeave } from "$lib/components/devices-access-dashboard-state";
  import VaultSecurityGuideBanner from "$lib/components/VaultSecurityGuideBanner.svelte";
  import BrowserSettingsPanel from "$lib/components/settings/BrowserSettingsPanel.svelte";
  import ManageSection from "$lib/components/settings/ManageSection.svelte";
  import VaultDevicesCard from "$lib/components/settings/VaultDevicesCard.svelte";
  import {
    JoinApprovalHandlingOutcome,
    JoinDenialHandlingOutcome,
  } from "$lib/components/settings/vault-devices-card-state";
  import VaultStatusBar from "$lib/components/VaultStatusBar.svelte";
  import { VaultStatusBarVariant } from "$lib/components/vault-status-bar-state";
  import IdentitiesHub from "$lib/components/identities/IdentitiesHub.svelte";
  import { IdentityDirectoryLoader } from "$lib/components/identities/identity-directory-loader.svelte";
  import { IdentityDirectoryLoadKind } from "$lib/components/devices-access/identity-directory-view";
  import PageBar from "$lib/components/workspace/PageBar.svelte";
  import ManageNav from "$lib/components/workspace/ManageNav.svelte";
  import { ManageNavLookup } from "$lib/components/workspace/manage-nav";
  import { Button } from "$lib/components/ui/button";
  import { StatusTag, StatusTone } from "$lib/components/ui/status-tag";
  import {
    VaultExtensionPresentation,
    VaultPairingPresentation,
    type CurrentVaultPairingAvailabilityRequest,
    type VaultExtensionLinkRequest,
    type VaultSwitcherEntryLabel,
  } from "$lib/components/vault-switcher-extension";
  import { generate_password, SecretType } from "$lib/nook";
  import {
    SecretTypeSelectionKind,
    type SecretTypeSelection,
  } from "$lib/components/secret-form-state";
  import type { VaultState } from "$lib/vault.svelte";
  import { ActiveVaultKind } from "$lib/vault/state/provider.svelte";
  import {
    ManageSectionScope,
    WorkspaceSection,
    WorkspaceSectionScope,
  } from "$lib/vault/state/ui.svelte";
  import {
    SecretEditorModeKind,
    type SecretEditorMode,
  } from "./authenticated-vault-workspace-state";

  type VaultAdminProps = ComponentProps<typeof VaultAdmin>;
  type OnboardDeviceProps = ComponentProps<typeof OnboardDevice>;
  type PendingJoinsBannerProps = ComponentProps<typeof PendingJoinsBanner>;
  type SecretVaultProps = ComponentProps<typeof SecretVault>;
  type VaultDevicesCardProps = ComponentProps<typeof VaultDevicesCard>;
  type EnrollmentCodeInput = Pick<
    Parameters<VaultState["issueEnrollmentCode"]>[0],
    "entryId" | "password"
  >;

  const SUPPORTS_EXTENSION = configured_vault_application_supports_extension();

  let {
    vault,
    extensionSetupState,
    extensionInstallBusy,
    extensionConnectError,
    hasSecurityRecommendations,
    needsSyncProvider,
    needsAnotherDevice,
    onExtensionInstall,
    onExtensionConnect,
    onSettingsReconnect,
    onEditorOpenChange,
  }: {
    vault: VaultState;
    extensionSetupState: ExtensionSetupOffer;
    extensionInstallBusy: boolean;
    extensionConnectError: boolean;
    hasSecurityRecommendations: boolean;
    needsSyncProvider: boolean;
    needsAnotherDevice: boolean;
    onExtensionInstall: () => void;
    onExtensionConnect: () => void;
    onSettingsReconnect: () => void;
    onEditorOpenChange: (open: boolean) => void;
  } = $props();

  const appVersion = "0.1.0";
  let secretsAddOpen = $state(false);
  let secretsAddFormType = $state<SecretEditorMode>({
    kind: SecretEditorModeKind.Closed,
  });
  let secretsEditorResetKey = $state(0);
  let leaveKeysPage = $state<KeysPageLeave>();
  /** The page management was entered from; Back returns there. */
  let manageOrigin = $state(WorkspaceSection.Vault);
  let manageOriginRecorded = $state(false);
  const secretsNoteEditorOpen = $derived(
    secretsAddOpen &&
      secretsAddFormType.kind === SecretEditorModeKind.Adding &&
      secretsAddFormType.itemType === SecretType.SecureNote,
  );

  const section = $derived(vault.workspaceSection);
  const scope = $derived(new WorkspaceSectionScope(section).scope);
  const managing = $derived(scope !== ManageSectionScope.None);
  const navItem = $derived(new ManageNavLookup(section).item);

  const directory = new IdentityDirectoryLoader(untrack(() => vault));
  $effect(() => {
    void vault.hasManager;
    void vault.deviceProtectionStatus;
    void vault.localVaults.length;
    void directory.reload();
  });
  const identityLabel = $derived.by(() => {
    if (directory.state.kind !== IdentityDirectoryLoadKind.Ready) return "";
    for (const identity of directory.state.view.identities) {
      if (identity.localAccess === NookIdentityLocalAccessKind.CurrentBrowser)
        return identity.label;
    }
    return "";
  });

  const activeStoreId = $derived(
    vault.activeVault.kind === ActiveVaultKind.Open
      ? vault.activeVault.storeId.trim()
      : "",
  );
  const unnamedLabel = $derived(vault.t(I18N_KEYS.LoginVaultPickerUnnamed));
  const vaultLabel = $derived.by(() => {
    for (const entry of vault.localVaults) {
      if (entry.storeId === activeStoreId)
        return entry.display_label(unnamedLabel);
    }
    return vault.t(I18N_KEYS.WorkspaceVaultFallback);
  });
  const extensionEntryLabels = $derived.by((): VaultSwitcherEntryLabel[] =>
    vault.localVaults.map((entry) => {
      const label: VaultSwitcherEntryLabel = {
        storeId: entry.storeId,
        displayName: entry.display_label(unnamedLabel),
      };
      return label;
    }),
  );
  const canPairCurrentVault = $derived.by(() => {
    const linkRequest: VaultExtensionLinkRequest = {
      offer: extensionSetupState,
      activeStoreId,
      entries: extensionEntryLabels,
    };
    const request: CurrentVaultPairingAvailabilityRequest = {
      link: new VaultExtensionPresentation(linkRequest).link,
      activeStoreId,
    };
    return new VaultPairingPresentation(request).available;
  });

  const identityName = $derived(
    identityLabel || vault.t(I18N_KEYS.WorkspaceIdentityFallback),
  );
  const barEyebrow = $derived(
    section === WorkspaceSection.Vault
      ? `${identityName} / ${vault.t(I18N_KEYS.WorkspaceVaultEyebrow)}`
      : scope === ManageSectionScope.Vault
        ? `${identityName} / ${vaultLabel}`
        : `${identityName} / ${vault.t(I18N_KEYS.WorkspaceManageIdentity)}`,
  );
  const barTitle = $derived(
    section === WorkspaceSection.Vault
      ? vaultLabel
      : navItem
        ? vault.t(navItem.labelKey)
        : vaultLabel,
  );

  function setAddMode({ open, selection }: SecretAddModeChange) {
    secretsAddOpen = open;
    secretsAddFormType =
      open && selection.kind === SecretTypeSelectionKind.EditingFields
        ? {
            kind: SecretEditorModeKind.Adding,
            itemType: selection.itemType,
          }
        : { kind: SecretEditorModeKind.Closed };
    onEditorOpenChange(open);
  }

  function leaveSecretsEditor() {
    secretsAddOpen = false;
    secretsAddFormType = { kind: SecretEditorModeKind.Closed };
    secretsEditorResetKey += 1;
    onEditorOpenChange(false);
  }

  function openSection(next: WorkspaceSection): void {
    const nextManaging =
      new WorkspaceSectionScope(next).scope !== ManageSectionScope.None;
    if (nextManaging && !managing) {
      manageOrigin = section;
      manageOriginRecorded = true;
    }
    if (next !== WorkspaceSection.Vault) leaveSecretsEditor();
    vault.openSection(next);
  }

  const backDestination = $derived(
    !managing
      ? WorkspaceSection.Identities
      : manageOriginRecorded
        ? manageOrigin
        : scope === ManageSectionScope.Vault
          ? WorkspaceSection.Vault
          : WorkspaceSection.Identities,
  );

  /** Back leaves management for the page it was entered from. */
  async function goBack(): Promise<void> {
    if (section === WorkspaceSection.Keys && leaveKeysPage) {
      await leaveKeysPage();
      return;
    }
    leaveManagement();
  }

  function leaveManagement(): void {
    const destination = backDestination;
    manageOriginRecorded = false;
    openSection(destination);
  }

  function lockIdentity(): void {
    vault.openSection(WorkspaceSection.Vault);
    vault.lockVault();
  }

  async function openVaultFromCard(storeId: string): Promise<void> {
    if (storeId === activeStoreId) {
      openSection(WorkspaceSection.Vault);
      return;
    }
    vault.openSection(WorkspaceSection.Vault);
    await vault.switchToVault(storeId);
  }

  function manageIdentity(identityId: string): void {
    vault.identityFocus = identityId;
    openSection(WorkspaceSection.Keys);
  }

  function newIdentity(): void {
    vault.identityCreationRequested = true;
    openSection(WorkspaceSection.Keys);
  }

  async function focusPageBar(): Promise<void> {
    await tick();
    document
      .querySelector<HTMLElement>('[data-testid="page-bar-back"]')
      ?.focus();
  }

  $effect(() => {
    if (section === WorkspaceSection.Keys) void focusPageBar();
  });

  async function syncAll(): Promise<void> {
    const synchronized = await vault.manualSync();
    if (synchronized.isErr())
      vault.errorMsg = vault.t(synchronized.error.translationKey);
  }

  onDestroy(() => {
    onEditorOpenChange(false);
  });
</script>

{#if section === WorkspaceSection.Identities}
  <div class="grid min-w-0 grid-cols-1 gap-4" data-testid="identities-workspace">
    <IdentitiesHub
      {vault}
      canAddVault
      busy={vault.isVerifying || vault.isInitializing}
      onOpenVault={(storeId: string) => void openVaultFromCard(storeId)}
      onNewVault={() => openSection(WorkspaceSection.Vaults)}
      onManage={manageIdentity}
      onNewIdentity={newIdentity}
      onUseIdentity={manageIdentity}
      onLock={lockIdentity}
    />
    <VaultStatusBar
      {vault}
      storageMode={vault.storageMode}
      githubRepo={vault.githubRepo}
      lastSync={vault.lastSync}
      isSyncing={vault.isSyncActivityVisible}
      successMsg={vault.successMsg}
      errorMsg={vault.errorMsg}
      {appVersion}
      label="Nook"
      showSyncStatus={false}
      showStorageIcon={false}
      variant={VaultStatusBarVariant.Quiet}
      onDismissSuccess={() => vault.dismissSuccess()}
      onDismissError={() => vault.dismissError()}
    />
  </div>
{:else}
  <div
    class:authenticated-shell-editor={secretsAddOpen}
    class:nk-shell-manage={managing}
    class="authenticated-shell nk-shell w-full min-w-0 max-w-full [touch-action:pan-y_pinch-zoom]"
    data-testid="authenticated-shell"
    data-section={section}
  >
    <div class="nk-shell-bar min-w-0 pb-3">
      <PageBar
        {vault}
        eyebrow={barEyebrow}
        title={barTitle}
        testId={section === WorkspaceSection.Vault
          ? "vault-page-bar"
          : "manage-page-bar"}
        backLabel={backDestination === WorkspaceSection.Vault
          ? vault.t(I18N_KEYS.WorkspaceBackToVault)
          : vault.t(I18N_KEYS.WorkspaceBackToIdentities)}
        onBack={() => void goBack()}
      >
        {#snippet tags()}
          <StatusTag
            tone={StatusTone.Success}
            label={vault.t(I18N_KEYS.WorkspaceStatusUnlocked)}
            title={vault.t(I18N_KEYS.WorkspaceStatusUnlockedTitle)}
            testId="session-status-tag"
          />
        {/snippet}
        {#snippet actions()}
          {#if section === WorkspaceSection.Vault}
            {#if SUPPORTS_EXTENSION && canPairCurrentVault}
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="vault-pair-extension-btn"
                disabled={vault.isVerifying}
                onclick={onExtensionConnect}
              >
                <Puzzle class="size-4" />
                <span class="hidden sm:inline"
                  >{vault.t(I18N_KEYS.VaultSwitcherPairThisVault)}</span
                >
              </Button>
            {/if}
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="vault-import-btn"
              onclick={() => openSection(WorkspaceSection.Import)}
            >
              <Download class="size-4" />
              <span class="hidden sm:inline"
                >{vault.t(I18N_KEYS.WorkspaceImportAction)}</span
              >
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="vault-manage-btn"
              onclick={() => openSection(WorkspaceSection.Devices)}
            >
              <Settings2 class="size-4" />
              <span class="hidden sm:inline"
                >{vault.t(I18N_KEYS.WorkspaceManageVault)}</span
              >
            </Button>
          {/if}
        {/snippet}
      </PageBar>
    </div>

    {#if managing}
      <ManageNav
        {vault}
        active={section}
        {vaultLabel}
        onSelect={openSection}
      />
    {/if}

    <div
      class="nk-shell-main shell-scroll flex min-h-0 min-w-0 flex-col {secretsNoteEditorOpen
        ? 'overflow-hidden'
        : 'overflow-y-auto'}"
    >
      <div
        class={managing
          ? "grid min-w-0 grid-cols-1 content-start gap-6 px-0.5 py-4 md:px-6 md:py-5"
          : "flex min-h-0 flex-1 flex-col gap-4 px-0.5 py-1"}
      >
        {#if managing && navItem}
          <p
            class="max-w-[64ch] text-sm text-pretty text-muted-foreground"
            data-testid="manage-section-description"
          >
            {vault.t(navItem.descriptionKey)}
          </p>
        {/if}

        {#if section === WorkspaceSection.Vault}
          {#if !secretsAddOpen && SUPPORTS_EXTENSION && extensionSetupState.kind === ExtensionSetupOfferKind.Visible && extensionSetupState.setup.status !== ExtensionSetupStatus.Paired}
            <ExtensionInstallSetupCard
              {vault}
              state={extensionSetupState.setup}
              installBusy={extensionInstallBusy}
              onInstall={onExtensionInstall}
              onConnect={onExtensionConnect}
              connectError={extensionConnectError}
            />
          {/if}
          {#if !secretsAddOpen && hasSecurityRecommendations}
            <VaultSecurityGuideBanner
              {vault}
              {needsSyncProvider}
              {needsAnotherDevice}
              onAddSyncProvider={() => openSection(WorkspaceSection.Sync)}
              onAddDevice={() => openSection(WorkspaceSection.Devices)}
            />
          {/if}
          {#if !secretsNoteEditorOpen}
            <PendingJoinsBanner
              {vault}
              pendingJoins={vault.pendingJoins}
              isBusy={vault.isSaving || vault.isVerifying}
              onApproveJoin={(
                id: Parameters<PendingJoinsBannerProps["onApproveJoin"]>[0],
              ) => vault.approveJoin(id)}
              onRefresh={syncAll}
              onOpenDevicesSettings={() =>
                openSection(WorkspaceSection.Devices)}
            />
          {/if}
          <div class="flex min-h-0 flex-1 flex-col">
            {#key secretsEditorResetKey}
              <SecretVault
                {vault}
                isSaving={vault.isSaving}
                editRestriction={vault.editRestriction}
                secrets={vault.secrets}
                onAddModeChange={setAddMode}
                onAddSecret={(
                  secretRequest: Parameters<SecretVaultProps["onAddSecret"]>[0],
                ) => vault.handleAddSecret(secretRequest)}
                onReplaceSecret={(
                  secretRequest: Parameters<
                    SecretVaultProps["onReplaceSecret"]
                  >[0],
                ) => vault.handleReplaceSecret(secretRequest)}
                onDeleteSecret={(
                  id: Parameters<SecretVaultProps["onDeleteSecret"]>[0],
                ) => vault.handleDeleteSecret(id)}
                onGeneratePassword={generate_password}
              />
            {/key}
          </div>
        {:else if section === WorkspaceSection.Keys}
          <DevicesAccessDashboard
            {vault}
            onBack={leaveManagement}
            onLeaveReady={(leave: KeysPageLeave) => (leaveKeysPage = leave)}
          />
        {:else if section === WorkspaceSection.Devices}
          <div class="grid min-w-0 grid-cols-1 gap-8" data-testid="vault-devices-panel">
            <ManageSection
              title={vault.t(I18N_KEYS.SettingsDevices)}
              subtitle={vault.t(I18N_KEYS.SettingsDevicesDesc)}
              testId="vault-devices-section"
            >
              {#snippet badge()}
                <StatusTag
                  tone={vault.vaultMembers.length > 0
                    ? StatusTone.Success
                    : StatusTone.Neutral}
                  label={vault.vaultMembers.length === 1
                    ? vault.t(I18N_KEYS.SettingsDeviceCountSingular)
                    : (() => {
                        const countRequest: Parameters<typeof vault.t>[0] = {
                          key: I18N_KEYS.SettingsDeviceCountPlural,
                          replacements: {
                            count: String(vault.vaultMembers.length),
                          },
                        };
                        return vault.t(countRequest);
                      })()}
                  testId="vault-devices-status"
                />
              {/snippet}
              <VaultDevicesCard
                {vault}
                deviceId={vault.deviceId}
                devicePublicKey={vault.devicePublicKey}
                pendingJoins={vault.pendingJoins}
                vaultMembers={vault.vaultMembers}
                isBusy={vault.isSaving || vault.isVerifying}
                hasPasswordEnvelope={vault.hasPasswordEnvelope}
                onApproveJoin={async (
                  id: Parameters<VaultDevicesCardProps["onApproveJoin"]>[0],
                ) => {
                  await vault.approveJoin(id);
                  return JoinApprovalHandlingOutcome.Handled;
                }}
                onDenyJoin={async (
                  id: Parameters<VaultDevicesCardProps["onDenyJoin"]>[0],
                ) => {
                  await vault.denyJoin(id);
                  return JoinDenialHandlingOutcome.Handled;
                }}
                onRenameDevice={(
                  renameRequest: Parameters<
                    VaultDevicesCardProps["onRenameDevice"]
                  >[0],
                ) => vault.renameDevice(renameRequest)}
                onRevokeDevice={(
                  id: Parameters<VaultDevicesCardProps["onRevokeDevice"]>[0],
                ) => vault.revokeDevice(id)}
              />
            </ManageSection>
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
              loginSetup={vault.loginSetup}
              bind:githubPat={vault.githubPat}
              bind:githubRepo={vault.githubRepo}
              onIssueCode={(
                issueRequest: Parameters<OnboardDeviceProps["onIssueCode"]>[0],
              ) => vault.issueEnrollmentCode(issueRequest)}
              onClearCode={() => vault.clearEnrollmentCode()}
              onAddPassword={(
                passwordRequest: Parameters<
                  OnboardDeviceProps["onAddPassword"]
                >[0],
              ) => vault.addVaultPassword(passwordRequest)}
              onBeginAddProvider={() => vault.beginAddProvider()}
              onCancelAddProvider={() => vault.cancelAddProvider()}
              onBeginSetup={(
                setupRequest: Parameters<OnboardDeviceProps["onBeginSetup"]>[0],
              ) => vault.beginProviderSetup(setupRequest)}
              onCancelSetup={() => vault.cancelProviderSetup()}
              onConnectProvider={onSettingsReconnect}
            />
          </div>
        {:else if section === WorkspaceSection.Settings}
          <BrowserSettingsPanel {vault} />
        {:else}
          <VaultAdmin
            {vault}
            {extensionSetupState}
            {section}
            syncProviders={vault.syncProviders}
            manualProviderSync={vault.manualProviderSync}
            isAuthenticated={vault.isAuthenticated}
            isSaving={vault.isSaving}
            isVerifying={vault.isVerifying}
            isInitializing={vault.isInitializing}
            addProviderOpen={vault.addProviderOpen}
            loginSetup={vault.loginSetup}
            bind:githubPat={vault.githubPat}
            bind:githubRepo={vault.githubRepo}
            passwordEntries={vault.passwordEntries}
            isPasswordBusy={vault.isPasswordBusy}
            passwordError={vault.passwordError}
            enrollmentCode={vault.enrollmentCode}
            canManageExistingPasswords={vault.deviceProtectionReady}
            onReconnect={onSettingsReconnect}
            onSyncProvider={async (
              id: Parameters<NonNullable<VaultAdminProps["onSyncProvider"]>>[0],
            ) => {
              const syncRequest: Parameters<typeof vault.syncProviderById>[0] =
                {
                  providerId: id,
                  visibility: ProviderSyncVisibility.Visible,
                  failureHandling: ProviderSyncFailureHandling.Capture,
                };
              const outcome = await vault.syncProviderById(syncRequest);
              if (outcome.isErr())
                vault.errorMsg = vault.t(outcome.error.translationKey);
            }}
            onBeginAddProvider={() => vault.beginAddProvider()}
            onCancelAddProvider={() => vault.cancelAddProvider()}
            onBeginSetup={(
              setupRequest: Parameters<VaultAdminProps["onBeginSetup"]>[0],
            ) => vault.beginProviderSetup(setupRequest)}
            onCancelSetup={() => vault.cancelProviderSetup()}
            onRemoveProvider={async (
              id: Parameters<
                NonNullable<VaultAdminProps["onRemoveProvider"]>
              >[0],
            ) => {
              const removed = await vault.removeProvider(id);
              if (removed.isErr())
                vault.errorMsg = vault.t(removed.error.translationKey);
            }}
            onAddPassword={(
              passwordRequest: Parameters<VaultAdminProps["onAddPassword"]>[0],
            ) => vault.addVaultPassword(passwordRequest)}
            onUpdatePassword={(
              passwordRequest: Parameters<
                VaultAdminProps["onUpdatePassword"]
              >[0],
            ) => vault.updateVaultPasswordEntry(passwordRequest)}
            onRemovePassword={(
              id: Parameters<VaultAdminProps["onRemovePassword"]>[0],
            ) => vault.removeVaultPasswordEntry(id)}
            onIssueCode={(enrollment: EnrollmentCodeInput) => {
              const provider = vault.syncProviders[0];
              if (!provider) {
                throw new Error(
                  vault.t(I18N_KEYS.OnboardDeviceChooseSyncProviderErr),
                );
              }
              const issueRequest: Parameters<
                typeof vault.issueEnrollmentCode
              >[0] = {
                entryId: enrollment.entryId,
                password: enrollment.password,
                providerId: provider.id,
              };
              return vault.issueEnrollmentCode(issueRequest);
            }}
            onClearCode={() => vault.clearEnrollmentCode()}
            onImportBitwarden={(
              importRequest: Parameters<
                VaultAdminProps["onImportBitwarden"]
              >[0],
            ) => vault.handleBitwardenImport(importRequest)}
            onImportKeePassXc={(
              csv: Parameters<VaultAdminProps["onImportKeePassXc"]>[0],
            ) => vault.handleKeePassXcImport(csv)}
            onImportLastPass={(
              csv: Parameters<VaultAdminProps["onImportLastPass"]>[0],
            ) => vault.handleLastPassImport(csv)}
            onImportKeeper={(
              csv: Parameters<VaultAdminProps["onImportKeeper"]>[0],
            ) => vault.handleKeeperImport(csv)}
            onImportOnePassword={(
              archive: Parameters<VaultAdminProps["onImportOnePassword"]>[0],
            ) => vault.handleOnePasswordImport(archive)}
            onImportApplePasswords={(
              exportBytes: Parameters<
                VaultAdminProps["onImportApplePasswords"]
              >[0],
            ) => vault.handleApplePasswordsImport(exportBytes)}
            onImportChromePasswords={(
              csv: Parameters<VaultAdminProps["onImportChromePasswords"]>[0],
            ) => vault.handleChromePasswordsImport(csv)}
            onImportDashlane={(
              exportBytes: Parameters<VaultAdminProps["onImportDashlane"]>[0],
            ) => vault.handleDashlaneImport(exportBytes)}
            onImportGoogleAuthenticator={(
              migrationUris: Parameters<
                VaultAdminProps["onImportGoogleAuthenticator"]
              >[0],
            ) => vault.handleGoogleAuthenticatorImport(migrationUris)}
            onImportProtonPass={(
              exportBytes: Parameters<
                VaultAdminProps["onImportProtonPass"]
              >[0],
            ) => vault.handleProtonPassImport(exportBytes)}
          />
        {/if}
      </div>
    </div>

    <div class="nk-shell-status min-w-0 pt-2">
      <VaultStatusBar
        {vault}
        storageMode={vault.storageMode}
        githubRepo={vault.githubRepo}
        lastSync={vault.lastSync}
        isSyncing={vault.isSyncActivityVisible}
        successMsg={vault.successMsg}
        errorMsg={vault.errorMsg}
        syncConflictLabel={vault.syncConflictLabel}
        {appVersion}
        onRefresh={syncAll}
        onDismissSuccess={() => vault.dismissSuccess()}
        onDismissError={() => vault.dismissError()}
      />
    </div>
  </div>
{/if}
