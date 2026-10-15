<!--
Unified identity and vault workspace. Identities are the hub. A vault page
holds only the vault: its items and imports, with a chip that opens the
identity. Identity management (keys, vaults, devices, sync, backup
passwords, settings) adds its rail. Every page is one framed sheet: a page
band, the scrolling page and the status line.
-->
<script lang="ts">
  type SecretAddModeChange = {
    readonly open: boolean
    readonly selection: SecretTypeSelection
  }

  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { onDestroy, tick, untrack, type ComponentProps } from 'svelte'
  import { Download, X } from '@lucide/svelte'
  import { type ExtensionSetupOffer } from '$lib/app/extension-setup'
  import {
    configured_vault_application_supports_extension,
    NookIdentityLocalAccessKind,
    NookIdentityNextStep,
    type NookIdentityHealth,
    ProviderSyncFailureHandling,
    ProviderSyncVisibility,
  } from '$app-wasm'
  import PendingJoinsBanner from '$lib/components/PendingJoinsBanner.svelte'
  import AddDeviceFlow from '$lib/components/add-device/AddDeviceFlow.svelte'
  import SecretVault from '$lib/components/SecretVault.svelte'
  import VaultAdmin from '$lib/components/VaultAdmin.svelte'
  import IdentityKeysPage from '$lib/components/identity-control/IdentityKeysPage.svelte'
  import VaultExtensionControl from './VaultExtensionControl.svelte'
  import IdentityPageFrame from '$lib/components/identity-control/IdentityPageFrame.svelte'
  import IdentityDashboard from '$lib/components/identity-control/IdentityDashboard.svelte'
  import BrowserSettingsPanel from '$lib/components/settings/BrowserSettingsPanel.svelte'
  import IdentityDevicesPanel from '$lib/components/identity-control/IdentityDevicesPanel.svelte'
  import VaultStatusBar from '$lib/components/VaultStatusBar.svelte'
  import FirstRunBackupStep from '$lib/components/login/FirstRunBackupStep.svelte'
  import { VaultStatusBarVariant } from '$lib/components/vault-status-bar-state'
  import IdentitiesHub from '$lib/components/identities/IdentitiesHub.svelte'
  import LoginNewVaultPanel from '$lib/components/login/LoginNewVaultPanel.svelte'
  import type {
    IdentitySectionTarget,
    IdentityVaultTarget,
  } from '$lib/components/identities/identity-card-model'
  import { IdentitySwitch } from '$lib/components/identities/identity-switch'
  import { IdentityDirectoryLoader } from '$lib/components/identities/identity-directory-loader.svelte'
  import { IdentityDirectoryLoadKind } from '$lib/components/devices-access/identity-directory-view'
  import PageBar from '$lib/components/workspace/PageBar.svelte'
  import {
    ManageNavEntryKind,
    ManageNavLookup,
  } from '$lib/components/workspace/manage-nav'
  import { Button } from '$lib/components/ui/button'
  import { StatusTag, StatusTone } from '$lib/components/ui/status-tag'
  import {
    ConnectedVaultMenuNoteKind,
    ConnectedVaultMenuPresentation,
    VaultExtensionPresentation,
    VaultGrantPresentation,
    type ConnectedVaultMenuNoteRequest,
    type ExtensionConnectedEntryRequest,
    type VaultExtensionLinkRequest,
    type VaultSwitcherEntryLabel,
  } from '$lib/components/vault-switcher-extension'
  import { generate_password, SecretType } from '$lib/nook'
  import {
    SecretTypeSelectionKind,
    type SecretTypeSelection,
  } from '$lib/components/secret-form-state'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    ActiveVaultKind,
    LoginSetupKind,
  } from '$lib/vault/state/provider.svelte'
  import {
    FirstRunStage,
    ManageSectionScope,
    WorkspaceSection,
    WorkspaceSectionScope,
    NewIdentityStage,
  } from '$lib/vault/state/ui.svelte'
  import {
    SecretEditorModeKind,
    type SecretEditorMode,
  } from './authenticated-vault-workspace-state'

  type VaultAdminProps = ComponentProps<typeof VaultAdmin>
  type PendingJoinsBannerProps = ComponentProps<typeof PendingJoinsBanner>
  type SecretVaultProps = ComponentProps<typeof SecretVault>

  const SUPPORTS_EXTENSION = configured_vault_application_supports_extension()

  let {
    vault,
    extensionSetupState,
    identityHealth,
    onExtensionConnect,
    onSettingsReconnect,
    onEditorOpenChange,
  }: {
    vault: VaultState
    extensionSetupState: ExtensionSetupOffer
    /** Day-2 health of the identity, assessed by nook-core. */
    identityHealth: NookIdentityHealth
    onExtensionConnect: () => void
    onSettingsReconnect: () => void
    onEditorOpenChange: (open: boolean) => void
  } = $props()

  const appVersion = '0.1.0'
  let secretsAddOpen = $state(false)
  let secretsAddFormType = $state<SecretEditorMode>({
    kind: SecretEditorModeKind.Closed,
  })
  let secretsEditorResetKey = $state(0)
  /** The page management was entered from; Back returns there. */
  let manageOrigin = $state(WorkspaceSection.Vault)
  let manageOriginRecorded = $state(false)
  /** Where "Add a device" was opened from; the flow returns there. A link
   * straight to the flow returns to the Devices page. */
  let addDeviceOrigin = $state(WorkspaceSection.Devices)
  const secretsNoteEditorOpen = $derived(
    secretsAddOpen &&
      secretsAddFormType.kind === SecretEditorModeKind.Adding &&
      secretsAddFormType.itemType === SecretType.SecureNote,
  )

  const section = $derived(vault.workspaceSection)
  const identityPendingJoins = $derived.by(() => {
    const snapshot = vault.identityControl.snapshot
    return snapshot === false ? [] : snapshot.pendingJoins
  })
  const scope = $derived(new WorkspaceSectionScope(section).scope)
  const managing = $derived(scope !== ManageSectionScope.None)
  const navEntry = $derived(new ManageNavLookup(section).entry)

  const directory = new IdentityDirectoryLoader(untrack(() => vault))
  $effect(() => {
    void vault.hasManager
    void vault.deviceProtectionStatus
    void vault.localVaults.length
    void directory.reload()
  })
  const currentIdentity = $derived.by(() => {
    if (directory.state.kind !== IdentityDirectoryLoadKind.Ready) return false
    for (const identity of directory.state.view.identities) {
      if (identity.localAccess === NookIdentityLocalAccessKind.CurrentBrowser)
        return identity
    }
    return false
  })
  const identityLabel = $derived(
    currentIdentity === false ? '' : currentIdentity.label,
  )

  const activeStoreId = $derived(
    vault.activeVault.kind === ActiveVaultKind.Open
      ? vault.activeVault.storeId.trim()
      : '',
  )
  const unnamedLabel = $derived(vault.t(I18N_KEYS.LoginVaultPickerUnnamed))
  const vaultLabel = $derived.by(() => {
    for (const entry of vault.localVaults) {
      if (entry.storeId === activeStoreId)
        return entry.display_label(unnamedLabel)
    }
    return vault.t(I18N_KEYS.WorkspaceVaultFallback)
  })
  const extensionEntryLabels = $derived.by((): VaultSwitcherEntryLabel[] =>
    vault.localVaults.map((entry) => {
      const label: VaultSwitcherEntryLabel = {
        storeId: entry.storeId,
        displayName: entry.display_label(unnamedLabel),
      }
      return label
    }),
  )
  const extensionLink = $derived.by(() => {
    const linkRequest: VaultExtensionLinkRequest = {
      offer: extensionSetupState,
      activeStoreId,
      entries: extensionEntryLabels,
    }
    return new VaultExtensionPresentation(linkRequest).link
  })
  const extensionStoreIds = $derived(
    vault.localVaults
      .filter((entry) => {
        const grantRequest: ExtensionConnectedEntryRequest = {
          link: extensionLink,
          storeId: entry.storeId,
        }
        return new VaultGrantPresentation(grantRequest).connected
      })
      .map((entry) => entry.storeId),
  )
  const extensionNote = $derived.by(() => {
    const noteRequest: ConnectedVaultMenuNoteRequest = {
      link: extensionLink,
      entries: extensionEntryLabels,
    }
    const note = new ConnectedVaultMenuPresentation(noteRequest).note
    if (note.kind !== ConnectedVaultMenuNoteKind.MissingLocally) return ''
    const noteText: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.VaultSwitcherExtensionConnected,
      replacements: { vault: note.vaultName },
    }
    return vault.t(noteText)
  })

  /** What the unlocked identity lacks, for the chip on its hub card. */
  const currentHealthNote = $derived(
    identityHealth.nextStep === NookIdentityNextStep.AddSyncProvider ||
      identityHealth.nextStep === NookIdentityNextStep.AddCloudProvider
      ? vault.t(I18N_KEYS.IdentityOverviewRiskLocal)
      : identityHealth.nextStep === NookIdentityNextStep.AddDevice
        ? vault.t(I18N_KEYS.IdentityOverviewRiskOneDevice)
        : '',
  )
  const identityName = $derived(
    identityLabel || vault.t(I18N_KEYS.WorkspaceIdentityFallback),
  )
  const barEyebrow = $derived(
    section === WorkspaceSection.Vault
      ? `${identityName} / ${vault.t(I18N_KEYS.WorkspaceVaultEyebrow)}`
      : scope === ManageSectionScope.Vault
        ? `${identityName} / ${vaultLabel}`
        : vault.t(I18N_KEYS.WorkspaceManageIdentity),
  )
  /** Sync opened to add a provider ("Add a sync provider" in Manage): the
   * page is that task, and its Back leaves it. */
  const addingProvider = $derived(
    section === WorkspaceSection.Sync &&
      (vault.addProviderOpen ||
        vault.loginSetup.kind === LoginSetupKind.Active),
  )
  const barTitle = $derived(
    section === WorkspaceSection.Vault
      ? vaultLabel
      : addingProvider
        ? vault.t(I18N_KEYS.SettingsAddSyncProvider)
        : navEntry.kind === ManageNavEntryKind.Listed
          ? vault.t(navEntry.item.labelKey)
          : vaultLabel,
  )

  function setAddMode({ open, selection }: SecretAddModeChange) {
    secretsAddOpen = open
    secretsAddFormType =
      open && selection.kind === SecretTypeSelectionKind.EditingFields
        ? {
            kind: SecretEditorModeKind.Adding,
            itemType: selection.itemType,
          }
        : { kind: SecretEditorModeKind.Closed }
    onEditorOpenChange(open)
  }

  function leaveSecretsEditor() {
    secretsAddOpen = false
    secretsAddFormType = { kind: SecretEditorModeKind.Closed }
    secretsEditorResetKey += 1
    onEditorOpenChange(false)
  }

  function openSection(next: WorkspaceSection): void {
    if (next === WorkspaceSection.AddDevice && section !== next)
      addDeviceOrigin = section
    const nextManaging =
      new WorkspaceSectionScope(next).scope !== ManageSectionScope.None
    // Adding a device is a detour: leaving it keeps the way back the
    // control page had before.
    if (nextManaging && !managing && section !== WorkspaceSection.AddDevice) {
      manageOrigin = section
      manageOriginRecorded = true
    }
    if (next !== WorkspaceSection.Vault) leaveSecretsEditor()
    vault.openSection(next)
  }

  const backDestination = $derived(
    !managing
      ? WorkspaceSection.Identities
      : manageOriginRecorded
        ? manageOrigin
        : scope === ManageSectionScope.Vault
          ? WorkspaceSection.Vault
          : WorkspaceSection.Identities,
  )

  /** Back leaves management for the page it was entered from. */
  function goBack(): void {
    if (addingProvider) {
      vault.cancelProviderSetup()
      vault.cancelAddProvider()
    }
    leaveManagement()
  }

  function leaveManagement(): void {
    const destination = backDestination
    manageOriginRecorded = false
    openSection(destination)
  }

  function lockIdentity(): void {
    vault.openSection(WorkspaceSection.Vault)
    vault.lockVault()
  }

  /** "Import from sync provider" under New vault. Bringing a vault in from
   * a provider is the locked page's restore, so the identity locks and
   * that page continues it beside the card. */
  function importVaultFromProvider(): void {
    newVaultOpen = false
    vault.vaultImportOpen = true
    vault.lockVault()
  }

  /** One of a vault's own pages from its panel beside the card: another
   * vault of this identity is switched to first. */
  async function manageVault(target: IdentitySectionTarget): Promise<void> {
    if (target.storeId !== activeStoreId)
      await vault.switchToVault(target.storeId)
    openSection(target.section)
  }

  async function openVaultFromCard(storeId: string): Promise<void> {
    if (storeId === activeStoreId) {
      openSection(WorkspaceSection.Vault)
      return
    }
    vault.openSection(WorkspaceSection.Vault)
    await vault.switchToVault(storeId)
  }

  /** "Use identity" on another identity's card: this browser switches to
   * it; the session ends and the locked hub shows it as the current card. */
  function useIdentity(target: IdentityVaultTarget): void {
    void new IdentitySwitch(vault).to(target.identityId)
  }

  function newIdentity(): void {
    vault.newIdentity = NewIdentityStage.Name
  }

  async function focusPageBar(): Promise<void> {
    await tick()
    document
      .querySelector<HTMLElement>('[data-testid="page-bar-back"]')
      ?.focus()
  }

  $effect(() => {
    if (section === WorkspaceSection.Keys) void focusPageBar()
  })

  async function syncAll(): Promise<void> {
    const synchronized = await vault.manualSync()
    if (synchronized.isErr())
      vault.errorMsg = vault.t(synchronized.error.translationKey)
  }

  /** "New vault" on the identity card: the new vault belongs to it. */
  let newVaultOpen = $state(false)
  async function createVaultFromCard(label: string): Promise<void> {
    await vault.createLocalVaultWithDeviceKeys(label)
    if (!vault.errorMsg) newVaultOpen = false
  }

  /** Open the provider picker on the Sync page. Opening the section resets
   * provider setup, so the picker opens after it. */
  function addSyncProvider(): void {
    openSection(WorkspaceSection.Sync)
    vault.beginAddProvider()
  }

  function finishFirstRun(next: WorkspaceSection): void {
    vault.firstRun = FirstRunStage.Off
    openSection(next)
    // The setup step can be long; the vault opens from its top.
    const pageTop: ScrollToOptions = { top: 0 }
    window.scrollTo(pageTop)
  }

  onDestroy(() => {
    onEditorOpenChange(false)
  })
</script>

{#snippet newVaultPanel()}
  <LoginNewVaultPanel
    {vault}
    isVerifying={vault.isVerifying}
    isInitializing={vault.isInitializing}
    onCreateVault={createVaultFromCard}
    onImportVault={importVaultFromProvider}
    onClose={() => (newVaultOpen = false)}
  />
{/snippet}

{#snippet vaultAdmin()}
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
      id: Parameters<NonNullable<VaultAdminProps['onSyncProvider']>>[0],
    ) => {
      const syncRequest: Parameters<typeof vault.syncProviderById>[0] = {
        providerId: id,
        visibility: ProviderSyncVisibility.Visible,
        failureHandling: ProviderSyncFailureHandling.Capture,
      }
      const outcome = await vault.syncProviderById(syncRequest)
      if (outcome.isErr())
        vault.errorMsg = vault.t(outcome.error.translationKey)
    }}
    onCancelAddProvider={() => vault.cancelAddProvider()}
    onBeginSetup={(
      setupRequest: Parameters<VaultAdminProps['onBeginSetup']>[0],
    ) => vault.beginProviderSetup(setupRequest)}
    onCancelSetup={() => vault.cancelProviderSetup()}
    onRemoveProvider={async (
      id: Parameters<NonNullable<VaultAdminProps['onRemoveProvider']>>[0],
    ) => {
      const removed = await vault.removeProvider(id)
      if (removed.isErr())
        vault.errorMsg = vault.t(removed.error.translationKey)
    }}
    onAddPassword={(
      passwordRequest: Parameters<VaultAdminProps['onAddPassword']>[0],
    ) => vault.addVaultPassword(passwordRequest)}
    onUpdatePassword={(
      passwordRequest: Parameters<VaultAdminProps['onUpdatePassword']>[0],
    ) => vault.updateVaultPasswordEntry(passwordRequest)}
    onRemovePassword={(
      id: Parameters<VaultAdminProps['onRemovePassword']>[0],
    ) => vault.removeVaultPasswordEntry(id)}
    onImportBitwarden={(
      importRequest: Parameters<VaultAdminProps['onImportBitwarden']>[0],
    ) => vault.handleBitwardenImport(importRequest)}
    onImportKeePassXc={(
      csv: Parameters<VaultAdminProps['onImportKeePassXc']>[0],
    ) => vault.handleKeePassXcImport(csv)}
    onImportLastPass={(
      csv: Parameters<VaultAdminProps['onImportLastPass']>[0],
    ) => vault.handleLastPassImport(csv)}
    onImportKeeper={(csv: Parameters<VaultAdminProps['onImportKeeper']>[0]) =>
      vault.handleKeeperImport(csv)}
    onImportOnePassword={(
      archive: Parameters<VaultAdminProps['onImportOnePassword']>[0],
    ) => vault.handleOnePasswordImport(archive)}
    onImportApplePasswords={(
      exportBytes: Parameters<VaultAdminProps['onImportApplePasswords']>[0],
    ) => vault.handleApplePasswordsImport(exportBytes)}
    onImportChromePasswords={(
      csv: Parameters<VaultAdminProps['onImportChromePasswords']>[0],
    ) => vault.handleChromePasswordsImport(csv)}
    onImportDashlane={(
      exportBytes: Parameters<VaultAdminProps['onImportDashlane']>[0],
    ) => vault.handleDashlaneImport(exportBytes)}
    onImportGoogleAuthenticator={(
      migrationUris: Parameters<
        VaultAdminProps['onImportGoogleAuthenticator']
      >[0],
    ) => vault.handleGoogleAuthenticatorImport(migrationUris)}
    onImportProtonPass={(
      exportBytes: Parameters<VaultAdminProps['onImportProtonPass']>[0],
    ) => vault.handleProtonPassImport(exportBytes)}
  />
{/snippet}

<!-- The current identity's overview, opened beside its card on the hub. -->
{#snippet identityOverview()}
  <div class="grid gap-4">
    <header class="flex items-center justify-between gap-3">
      <h2 class="text-lg font-semibold tracking-tight text-foreground">
        {vault.t(I18N_KEYS.WorkspaceSectionOverview)}
      </h2>
      <button
        type="button"
        class="grid size-8 place-items-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label={vault.t(I18N_KEYS.IdentityOverviewClosePanel)}
        title={vault.t(I18N_KEYS.IdentityOverviewClosePanel)}
        data-testid="identity-overview-close"
        onclick={() => openSection(WorkspaceSection.Identities)}
      >
        <X class="size-4" aria-hidden="true" />
      </button>
    </header>
    <IdentityDashboard {vault} health={identityHealth} onOpen={openSection} />
  </div>
{/snippet}

<!-- One of the identity's pages, opened from its card or its overview. -->
{#snippet identityPanel()}
  {#if section === WorkspaceSection.Devices}
    <IdentityDevicesPanel {vault} />
  {:else if section === WorkspaceSection.Keys}
    <IdentityKeysPage {vault} />
  {:else if section === WorkspaceSection.Settings}
    <BrowserSettingsPanel {vault} />
  {:else}
    {@render vaultAdmin()}
  {/if}
{/snippet}

{#if vault.firstRun !== FirstRunStage.Off}
  <FirstRunBackupStep
    {vault}
    onReconnect={onSettingsReconnect}
    onDone={() => finishFirstRun(WorkspaceSection.Vault)}
  />
{:else if section === WorkspaceSection.Identities || section === WorkspaceSection.Overview}
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
      onUnlockVault={(storeId: string) => void vault.switchToVault(storeId)}
      onNewVault={() => (newVaultOpen = true)}
      onClosePanels={() => (newVaultOpen = false)}
      {...newVaultOpen ? { vaultSetup: newVaultPanel } : {}}
      vaultSetupOpen={newVaultOpen}
      onNewIdentity={newIdentity}
      onUseIdentity={useIdentity}
      {currentHealthNote}
      onHealth={() =>
        openSection(
          identityHealth.nextStep === NookIdentityNextStep.AddDevice
            ? WorkspaceSection.AddDevice
            : WorkspaceSection.Sync,
        )}
      onAddDevice={() => openSection(WorkspaceSection.AddDevice)}
      addDevicePrompt={identityHealth.nextStep ===
        NookIdentityNextStep.AddDevice}
      overview={identityOverview}
      overviewOpen={section === WorkspaceSection.Overview}
      onManageVault={(target: IdentitySectionTarget) =>
        void manageVault(target)}
      onManageSection={(target: IdentitySectionTarget) => {
        // "Add a sync provider" opens Sync with its form already open.
        if (target.section === WorkspaceSection.Sync) addSyncProvider()
        else openSection(target.section)
      }}
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
{:else if scope === ManageSectionScope.Identity}
  <IdentityPageFrame
    {vault}
    identityName={section === WorkspaceSection.Settings
      ? ''
      : section === WorkspaceSection.Passwords
        ? `${identityName} / ${vaultLabel}`
        : identityName}
    title={barTitle}
    testId={section}
    onBack={goBack}
  >
    {@render identityPanel()}
    {#snippet footer()}
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
    {/snippet}
  </IdentityPageFrame>
{:else if section === WorkspaceSection.AddDevice}
  <AddDeviceFlow
    {vault}
    {identityName}
    onBack={() => openSection(addDeviceOrigin)}
    onOpenSync={addSyncProvider}
  />
{:else}
  <div
    class:authenticated-shell-editor={secretsAddOpen}
    class="authenticated-shell nk-shell -mx-4 -mt-4 w-auto min-w-0 max-w-none sm:mx-0 sm:mt-0 sm:w-full sm:max-w-full [touch-action:pan-y_pinch-zoom]"
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
          ? 'vault-page-bar'
          : 'manage-page-bar'}
        backLabel={backDestination === WorkspaceSection.Vault
          ? vault.t(I18N_KEYS.WorkspaceBackToVault)
          : vault.t(I18N_KEYS.WorkspaceBackToIdentities)}
        onBack={goBack}
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
            {#if SUPPORTS_EXTENSION && !secretsNoteEditorOpen}
              <VaultExtensionControl
                {vault}
                offer={extensionSetupState}
                onConnect={onExtensionConnect}
              />
            {/if}
          {/if}
        {/snippet}
      </PageBar>
    </div>

    <div
      class="nk-shell-main shell-scroll flex min-h-0 min-w-0 flex-col {secretsNoteEditorOpen
        ? 'overflow-hidden'
        : 'overflow-y-auto'}"
    >
      <div
        class={managing
          ? 'grid min-w-0 grid-cols-1 content-start gap-6 p-4 md:p-6'
          : 'flex min-h-0 flex-1 flex-col'}
      >
        {#if section === WorkspaceSection.Vault}
          {#if !secretsNoteEditorOpen}
            <PendingJoinsBanner
              {vault}
              pendingJoins={identityPendingJoins}
              isBusy={vault.isSaving || vault.isVerifying}
              onApproveJoin={(
                appId: Parameters<PendingJoinsBannerProps['onApproveJoin']>[0],
              ) => vault.identityControl.approve(appId)}
              onRefresh={async () => {
                const synced = await vault.identityControl.syncWithMounts()
                if (synced.isErr())
                  vault.errorMsg = vault.t(synced.error.translationKey)
              }}
              onOpenDevicesSettings={() =>
                openSection(WorkspaceSection.Devices)}
            />
          {/if}
          <div class="flex min-h-0 flex-1 flex-col p-4 md:p-5">
            {#key secretsEditorResetKey}
              <SecretVault
                {vault}
                isSaving={vault.isSaving}
                editRestriction={vault.editRestriction}
                secrets={vault.secrets}
                onAddModeChange={setAddMode}
                onAddSecret={(
                  secretRequest: Parameters<SecretVaultProps['onAddSecret']>[0],
                ) => vault.handleAddSecret(secretRequest)}
                onReplaceSecret={(
                  secretRequest: Parameters<
                    SecretVaultProps['onReplaceSecret']
                  >[0],
                ) => vault.handleReplaceSecret(secretRequest)}
                onDeleteSecret={(
                  id: Parameters<SecretVaultProps['onDeleteSecret']>[0],
                ) => vault.handleDeleteSecret(id)}
                onGeneratePassword={generate_password}
              />
            {/key}
          </div>
        {:else}
          {@render vaultAdmin()}
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
