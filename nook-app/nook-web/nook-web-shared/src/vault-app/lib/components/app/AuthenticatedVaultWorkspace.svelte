<!--
Unified identity and vault workspace. Identities are the hub. A vault page
holds only the vault: its items and imports, with a chip that opens the
identity. Identity management (keys, vaults, devices, sync, backup
passwords, settings) adds its rail. Every page is one framed sheet: a page
band, the scrolling page and the status line.
-->
<script lang="ts">
  type SecretAddModeChange = {
    readonly open: boolean;
    readonly selection: SecretTypeSelection;
  };

  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { onDestroy, tick, untrack, type ComponentProps } from "svelte";
  import { Download, Puzzle } from "@lucide/svelte";
  import { type ExtensionSetupOffer } from "$lib/app/extension-setup";
  import {
    configured_vault_application_supports_extension,
    NookIdentityLocalAccessKind,
    NookIdentityNextStep,
    type NookIdentityHealth,
    ProviderSyncFailureHandling,
    ProviderSyncVisibility,
  } from "$app-wasm";
  import SecretVault from "$lib/components/SecretVault.svelte";
  import VaultAdmin from "$lib/components/VaultAdmin.svelte";
  import DevicesAccessDashboard from "$lib/components/DevicesAccessDashboard.svelte";
  import type { KeysPageLeave } from "$lib/components/devices-access-dashboard-state";
  import IdentityHealthBand from "$lib/components/identity-control/IdentityHealthBand.svelte";
  import BrowserSettingsPanel from "$lib/components/settings/BrowserSettingsPanel.svelte";
  import IdentityDevicesPanel from "$lib/components/identity-control/IdentityDevicesPanel.svelte";
  import VaultStatusBar from "$lib/components/VaultStatusBar.svelte";
  import FirstRunBackupStep from "$lib/components/login/FirstRunBackupStep.svelte";
  import { VaultStatusBarVariant } from "$lib/components/vault-status-bar-state";
  import IdentitiesHub from "$lib/components/identities/IdentitiesHub.svelte";
  import LoginNewVaultPanel from "$lib/components/login/LoginNewVaultPanel.svelte";
  import type { IdentityManageRequest } from "$lib/components/identities/identity-card-model";
  import { IdentityDirectoryLoader } from "$lib/components/identities/identity-directory-loader.svelte";
  import { IdentityDirectoryLoadKind } from "$lib/components/devices-access/identity-directory-view";
  import PageBar from "$lib/components/workspace/PageBar.svelte";
  import ManageNav from "$lib/components/workspace/ManageNav.svelte";
  import {
    ManageNavEntryKind,
    ManageNavLookup,
  } from "$lib/components/workspace/manage-nav";
  import { Button } from "$lib/components/ui/button";
  import { StatusTag, StatusTone } from "$lib/components/ui/status-tag";
  import {
    ConnectedVaultMenuNoteKind,
    ConnectedVaultMenuPresentation,
    VaultExtensionPresentation,
    VaultGrantPresentation,
    VaultPairingPresentation,
    type ConnectedVaultMenuNoteRequest,
    type CurrentVaultPairingAvailabilityRequest,
    type ExtensionConnectedEntryRequest,
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
    FirstRunStage,
    ManageSectionScope,
    WorkspaceSection,
    WorkspaceSectionScope,
  } from "$lib/vault/state/ui.svelte";
  import {
    SecretEditorModeKind,
    type SecretEditorMode,
  } from "./authenticated-vault-workspace-state";

  type VaultAdminProps = ComponentProps<typeof VaultAdmin>;
  type SecretVaultProps = ComponentProps<typeof SecretVault>;

  const SUPPORTS_EXTENSION = configured_vault_application_supports_extension();

  let {
    vault,
    extensionSetupState,
    identityHealth,
    onExtensionConnect,
    onSettingsReconnect,
    onEditorOpenChange,
  }: {
    vault: VaultState;
    extensionSetupState: ExtensionSetupOffer;
    /** Day-2 health of the identity, assessed by nook-core. */
    identityHealth: NookIdentityHealth;
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
  const identityPendingJoins = $derived.by(() => {
    const snapshot = vault.identityControl.snapshot;
    return snapshot === false ? [] : snapshot.pendingJoins;
  });
  const scope = $derived(new WorkspaceSectionScope(section).scope);
  const managing = $derived(scope !== ManageSectionScope.None);
  const navEntry = $derived(new ManageNavLookup(section).entry);

  const directory = new IdentityDirectoryLoader(untrack(() => vault));
  $effect(() => {
    void vault.hasManager;
    void vault.deviceProtectionStatus;
    void vault.localVaults.length;
    void directory.reload();
  });
  const currentIdentity = $derived.by(() => {
    if (directory.state.kind !== IdentityDirectoryLoadKind.Ready) return false;
    for (const identity of directory.state.view.identities) {
      if (identity.localAccess === NookIdentityLocalAccessKind.CurrentBrowser)
        return identity;
    }
    return false;
  });
  const identityLabel = $derived(
    currentIdentity === false ? "" : currentIdentity.label,
  );

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
  const extensionLink = $derived.by(() => {
    const linkRequest: VaultExtensionLinkRequest = {
      offer: extensionSetupState,
      activeStoreId,
      entries: extensionEntryLabels,
    };
    return new VaultExtensionPresentation(linkRequest).link;
  });
  const canPairCurrentVault = $derived.by(() => {
    const request: CurrentVaultPairingAvailabilityRequest = {
      link: extensionLink,
      activeStoreId,
    };
    return new VaultPairingPresentation(request).available;
  });
  const extensionStoreIds = $derived(
    vault.localVaults
      .filter((entry) => {
        const grantRequest: ExtensionConnectedEntryRequest = {
          link: extensionLink,
          storeId: entry.storeId,
        };
        return new VaultGrantPresentation(grantRequest).connected;
      })
      .map((entry) => entry.storeId),
  );
  const extensionNote = $derived.by(() => {
    const noteRequest: ConnectedVaultMenuNoteRequest = {
      link: extensionLink,
      entries: extensionEntryLabels,
    };
    const note = new ConnectedVaultMenuPresentation(noteRequest).note;
    if (note.kind !== ConnectedVaultMenuNoteKind.MissingLocally) return "";
    const noteText: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.VaultSwitcherExtensionConnected,
      replacements: { vault: note.vaultName },
    };
    return vault.t(noteText);
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
      : navEntry.kind === ManageNavEntryKind.Listed
        ? vault.t(navEntry.item.labelKey)
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

  /** The rail acts on the unlocked identity. */
  function openFromNav(next: WorkspaceSection): void {
    if (currentIdentity !== false)
      vault.identityFocus = currentIdentity.identityId;
    openSection(next);
  }

  /** Manage on a card: the unlocked identity opens its home (vaults and
   * sync); another identity is managed from Keys, which lists them all. */
  function manageIdentity(identityId: string): void {
    vault.identityFocus = identityId;
    const unlocked =
      currentIdentity !== false && currentIdentity.identityId === identityId;
    openSection(unlocked ? WorkspaceSection.Vaults : WorkspaceSection.Keys);
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

  /** "New vault" on the identity card: the new vault belongs to it. */
  let newVaultOpen = $state(false);
  async function createVaultFromCard(label: string): Promise<void> {
    await vault.createLocalVaultWithDeviceKeys(label);
    if (!vault.errorMsg) newVaultOpen = false;
  }

  /** Leave the first-vault setup for the new vault. */
  /** Open the provider picker in the home's Sync block. Opening the
   * section resets provider setup, so the picker opens after it. */
  function addSyncProvider(): void {
    openSection(WorkspaceSection.Sync);
    vault.beginAddProvider();
  }

  /** Sync renders as part of the identity home. */
  const pageSection = $derived(new ManageNavLookup(section).navSection);
  /** Every health step is taken on the identity home, whose blocks carry
   * the action; the band's button is redundant there. */
  const healthStepHere = $derived(
    identityHealth.nextStep !== NookIdentityNextStep.Done &&
      pageSection === WorkspaceSection.Vaults,
  );
  let devicesBlock = $state<HTMLElement>();
  const devicesScroll: ScrollIntoViewOptions = { block: "start" };
  $effect(() => {
    if (section === WorkspaceSection.Devices)
      devicesBlock?.scrollIntoView(devicesScroll);
  });

  function finishFirstRun(next: WorkspaceSection): void {
    vault.firstRun = FirstRunStage.Off;
    openSection(next);
    // The setup step can be long; the vault opens from its top.
    const pageTop: ScrollToOptions = { top: 0 };
    window.scrollTo(pageTop);
  }

  onDestroy(() => {
    onEditorOpenChange(false);
  });
</script>

{#snippet newVaultPanel()}
  <LoginNewVaultPanel
    {vault}
    isVerifying={vault.isVerifying}
    isInitializing={vault.isInitializing}
    importable={false}
    onCreateVault={createVaultFromCard}
    onClose={() => (newVaultOpen = false)}
  />
{/snippet}

{#if vault.firstRun !== FirstRunStage.Off}
  <FirstRunBackupStep
    {vault}
    onReconnect={onSettingsReconnect}
    onDone={() => finishFirstRun(WorkspaceSection.Vault)}
  />
{:else if section === WorkspaceSection.Identities}
  <div
    class="grid min-w-0 grid-cols-1 gap-4"
    data-testid="identities-workspace"
  >
    <IdentitiesHub
      {vault}
      canAddVault
      {extensionStoreIds}
      {extensionNote}
      busy={vault.isVerifying || vault.isInitializing}
      onOpenVault={(storeId: string) => void openVaultFromCard(storeId)}
      onNewVault={() => (newVaultOpen = true)}
      {...newVaultOpen ? { vaultSetup: newVaultPanel } : {}}
      vaultSetupOpen={newVaultOpen}
      onManage={(request: IdentityManageRequest) =>
        manageIdentity(request.identityId)}
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
    class:nk-shell-manage={scope === ManageSectionScope.Identity}
    class="authenticated-shell nk-shell w-full min-w-0 max-w-full [touch-action:pan-y_pinch-zoom]"
    data-testid="authenticated-shell"
    data-section={section}
  >
    <div class="nk-shell-bar min-w-0">
      <PageBar
        {vault}
        band
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
          {/if}
        {/snippet}
      </PageBar>
    </div>

    {#if scope === ManageSectionScope.Identity}
      <ManageNav
        {vault}
        active={section}
        identityLabel={identityName}
        pendingJoinCount={identityPendingJoins.length}
        syncMissing={identityHealth.nextStep ===
          NookIdentityNextStep.AddSyncProvider ||
          identityHealth.nextStep === NookIdentityNextStep.AddCloudProvider}
        deviceMissing={identityHealth.nextStep ===
          NookIdentityNextStep.AddDevice}
        onSelect={openFromNav}
      />
    {/if}

    <div
      class="nk-shell-main shell-scroll flex min-h-0 min-w-0 flex-col {secretsNoteEditorOpen
        ? 'overflow-hidden'
        : 'overflow-y-auto'}"
    >
      <div
        class={managing
          ? "grid min-w-0 grid-cols-1 content-start gap-6 p-4 md:p-6"
          : "flex min-h-0 flex-1 flex-col"}
      >
        {#if scope === ManageSectionScope.Identity}
          <IdentityHealthBand
            {vault}
            health={identityHealth}
            onAddSyncProvider={() => openSection(WorkspaceSection.Sync)}
            onAddDevice={() => openSection(WorkspaceSection.Devices)}
            actionShown={!healthStepHere}
          />
        {/if}

        {#if navEntry.kind === ManageNavEntryKind.Listed && (section === WorkspaceSection.Keys || section === WorkspaceSection.Settings)}
          <p
            class="max-w-[64ch] text-sm text-pretty text-muted-foreground"
            data-testid="manage-section-description"
          >
            {vault.t(navEntry.item.descriptionKey)}
          </p>
        {/if}

        {#if section === WorkspaceSection.Vault}
          <div class="flex min-h-0 flex-1 flex-col p-4 md:p-5">
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
        {:else if section === WorkspaceSection.Settings}
          <BrowserSettingsPanel {vault} />
        {:else}
          <VaultAdmin
            {vault}
            {extensionSetupState}
            {section}
            onCreateVault={(label: string) =>
              vault.createLocalVaultWithDeviceKeys(label)}
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
              exportBytes: Parameters<VaultAdminProps["onImportProtonPass"]>[0],
            ) => vault.handleProtonPassImport(exportBytes)}
          />
          {#if pageSection === WorkspaceSection.Vaults}
            <!-- Devices close the identity home: they join through the
                 sync providers above. -->
            <div class="scroll-mt-4" bind:this={devicesBlock}>
              <IdentityDevicesPanel {vault} onOpenSync={addSyncProvider} />
            </div>
          {/if}
        {/if}
      </div>
    </div>

    <div class="nk-shell-status min-w-0 px-3 md:px-5">
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
