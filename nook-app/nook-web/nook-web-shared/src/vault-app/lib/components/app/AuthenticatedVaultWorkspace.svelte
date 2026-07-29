<script lang="ts">
  import { onDestroy } from 'svelte'
  import {
    ExtensionSetupOfferKind,
    type ExtensionSetupOffer,
  } from '$lib/app-lifecycle-state'
  import { SUPPORTS_EXTENSION } from '$lib/app-kind'
  import ExtensionInstallSetupCard from '$lib/components/ExtensionInstallSetupCard.svelte'
  import OnboardDevice from '$lib/components/OnboardDevice.svelte'
  import PendingJoinsBanner from '$lib/components/PendingJoinsBanner.svelte'
  import SecretVault from '$lib/components/SecretVault.svelte'
  import VaultAdmin from '$lib/components/VaultAdmin.svelte'
  import VaultBottomNav from '$lib/components/VaultBottomNav.svelte'
  import VaultSecurityGuideBanner from '$lib/components/VaultSecurityGuideBanner.svelte'
  import VaultSettingsAccordion from '$lib/components/settings/VaultSettingsAccordion.svelte'
  import VaultStatusBar from '$lib/components/VaultStatusBar.svelte'
  import { SecretType } from '$lib/nook'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    AdminAccordionSection,
    SettingsAccordionSection,
    SettingsSection,
  } from '$lib/vault/state/ui.svelte'
  import {
    SecretEditorModeKind,
    type SecretEditorMode,
  } from './authenticated-vault-workspace-state'

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
    vault: VaultState
    extensionSetupState: ExtensionSetupOffer
    extensionInstallBusy: boolean
    extensionConnectError: boolean
    hasSecurityRecommendations: boolean
    needsSyncProvider: boolean
    needsAnotherDevice: boolean
    onExtensionInstall: () => void
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
  const secretsNoteEditorOpen = $derived(
    secretsAddOpen &&
      secretsAddFormType.kind === SecretEditorModeKind.Adding &&
      secretsAddFormType.itemType === SecretType.SecureNote,
  )

  function setAddMode(open: boolean, type: SecretType | void) {
    secretsAddOpen = open
    secretsAddFormType =
      open && type
        ? { kind: SecretEditorModeKind.Adding, itemType: type }
        : { kind: SecretEditorModeKind.Closed }
    onEditorOpenChange(open)
  }

  function leaveSecretsEditor() {
    secretsAddOpen = false
    secretsAddFormType = { kind: SecretEditorModeKind.Closed }
    secretsEditorResetKey += 1
    onEditorOpenChange(false)
  }

  onDestroy(() => {
    onEditorOpenChange(false)
  })
</script>

<div
  class:authenticated-shell-editor={secretsAddOpen}
  class="authenticated-shell flex w-full min-w-0 max-w-full flex-col overflow-hidden rounded-xl bg-card shadow-sm [touch-action:pan-y_pinch-zoom] sm:border sm:border-border/60"
  data-testid="authenticated-shell"
>
  <div
    class="shell-scroll min-h-0 min-w-0 flex-1 flex flex-col {secretsNoteEditorOpen
      ? 'overflow-hidden'
      : 'overflow-y-auto'}"
  >
    <div
      class="p-4 sm:p-5 {vault.settingsOpen
        ? 'space-y-4'
        : 'flex min-h-0 flex-1 flex-col gap-4'}"
    >
      {#if !vault.settingsOpen && !secretsAddOpen && SUPPORTS_EXTENSION && extensionSetupState.kind === ExtensionSetupOfferKind.Visible && extensionSetupState.setup.status !== 'paired'}
        <ExtensionInstallSetupCard
          {vault}
          state={extensionSetupState.setup}
          installBusy={extensionInstallBusy}
          onInstall={onExtensionInstall}
          onConnect={onExtensionConnect}
          connectError={extensionConnectError}
        />
      {/if}
      {#if !vault.settingsOpen && !secretsAddOpen && hasSecurityRecommendations}
        <VaultSecurityGuideBanner
          {vault}
          {needsSyncProvider}
          {needsAnotherDevice}
          onAddSyncProvider={() =>
            vault.openAdmin(AdminAccordionSection.Storage)}
          onAddDevice={() => vault.openSettings(SettingsSection.Onboard)}
        />
      {/if}
      {#if vault.settingsOpen && vault.settingsSection === 'admin'}
        <VaultAdmin
          {vault}
          bind:activeSection={vault.adminAccordionSection}
          syncProviders={vault.syncProviders}
          syncingProviderId={vault.syncingProviderId}
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
          onReconnect={onSettingsReconnect}
          onSyncProvider={(id) => vault.syncProviderById(id)}
          onBeginAddProvider={() => vault.beginAddProvider()}
          onCancelAddProvider={() => vault.cancelAddProvider()}
          onBeginSetup={(type, preset) =>
            vault.beginProviderSetup(type, preset)}
          onCancelSetup={() => vault.cancelProviderSetup()}
          onRemoveProvider={(id) => vault.removeProvider(id)}
          onAddPassword={(label, pw) => vault.addVaultPassword(label, pw)}
          onUpdatePassword={(id, pw) => vault.updateVaultPasswordEntry(id, pw)}
          onRemovePassword={(id) => vault.removeVaultPasswordEntry(id)}
          onIssueCode={(id, pw) => vault.issueEnrollmentCode(id, pw)}
          onClearCode={() => vault.clearEnrollmentCode()}
          onImportBitwarden={(json, password) =>
            vault.handleBitwardenImport(json, password)}
          onImportLastPass={(csv) => vault.handleLastPassImport(csv)}
          onImportOnePassword={(archive) =>
            vault.handleOnePasswordImport(archive)}
          onImportApplePasswords={(csv) =>
            vault.handleApplePasswordsImport(csv)}
          onImportChromePasswords={(csv) =>
            vault.handleChromePasswordsImport(csv)}
          onImportGoogleAuthenticator={(migrationUris) =>
            vault.handleGoogleAuthenticatorImport(migrationUris)}
          onImportProtonPass={(exportBytes) =>
            vault.handleProtonPassImport(exportBytes)}
        />
      {:else if vault.settingsOpen && vault.settingsSection === 'onboard'}
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
          onIssueCode={(entryId, pw, providerId) =>
            vault.issueEnrollmentCode(entryId, pw, providerId)}
          onClearCode={() => vault.clearEnrollmentCode()}
          onAddPassword={(label, pw) => vault.addVaultPassword(label, pw)}
          onBeginAddProvider={() => vault.beginAddProvider()}
          onCancelAddProvider={() => vault.cancelAddProvider()}
          onBeginSetup={(type, preset) =>
            vault.beginProviderSetup(type, preset)}
          onCancelSetup={() => vault.cancelProviderSetup()}
          onConnectProvider={onSettingsReconnect}
        />
      {:else if vault.settingsOpen}
        <VaultSettingsAccordion
          {vault}
          bind:accordionSection={vault.settingsAccordionSection}
          isVerifying={vault.isVerifying}
          isSaving={vault.isSaving}
          deviceId={vault.deviceId}
          devicePublicKey={vault.devicePublicKey}
          pendingJoins={vault.pendingJoins}
          vaultMembers={vault.vaultMembers}
          hasPasswordEnvelope={vault.hasPasswordEnvelope}
          onApproveJoin={(id) => vault.approveJoin(id)}
          onDenyJoin={(id) => vault.denyJoin(id)}
          onRenameDevice={(id, label) => vault.renameDevice(id, label)}
          onRevokeDevice={(id) => vault.revokeDevice(id)}
        />
      {:else}
        {#if !secretsNoteEditorOpen}
          <PendingJoinsBanner
            {vault}
            pendingJoins={vault.pendingJoins}
            isBusy={vault.isSaving || vault.isVerifying}
            onApproveJoin={(id) => vault.approveJoin(id)}
            onRefresh={() => vault.manualSync()}
            onOpenDevicesSettings={() =>
              vault.openSettings(
                SettingsSection.Storage,
                SettingsAccordionSection.Devices,
              )}
          />
        {/if}
        <div class="flex min-h-0 flex-1 flex-col">
          {#key secretsEditorResetKey}
            <SecretVault
              {vault}
              isSaving={vault.isSaving}
              editsBlocked={vault.editsBlocked}
              editBlockMessage={vault.editBlockMessage}
              secrets={vault.secrets}
              onAddModeChange={setAddMode}
              onAddSecret={(id, type, data) =>
                vault.handleAddSecret(id, type, data)}
              onReplaceSecret={(oldId, type, data) =>
                vault.handleReplaceSecret(oldId, type, data)}
              onDeleteSecret={(id) => vault.handleDeleteSecret(id)}
              onGeneratePassword={(
                length,
                lowercase,
                uppercase,
                numbers,
                symbols,
              ) =>
                vault.generatePassword(
                  length,
                  lowercase,
                  uppercase,
                  numbers,
                  symbols,
                )}
            />
          {/key}
        </div>
      {/if}
    </div>
  </div>
  <div class="shrink-0">
    <VaultStatusBar
      {vault}
      storageMode={vault.storageMode}
      githubRepo={vault.githubRepo}
      lastSyncedAt={vault.lastSyncedAt}
      isSyncing={vault.isSyncActivityVisible}
      successMsg={vault.successMsg}
      errorMsg={vault.errorMsg}
      syncConflictLabel={vault.syncConflictLabel}
      {appVersion}
      onRefresh={() => vault.manualSync()}
      onDismissSuccess={() => vault.dismissSuccess()}
      onDismissError={() => vault.dismissError()}
    />
    <VaultBottomNav
      {vault}
      settingsOpen={vault.settingsOpen}
      settingsSection={vault.settingsSection}
      onSelectSecrets={() => {
        leaveSecretsEditor()
        vault.closeSettings()
      }}
      onSelectOnboard={() => {
        leaveSecretsEditor()
        vault.openSettings(SettingsSection.Onboard)
      }}
      onSelectAdmin={() => {
        leaveSecretsEditor()
        vault.openAdmin()
      }}
      onSelectSettings={() => {
        leaveSecretsEditor()
        vault.openSettings()
      }}
    />
  </div>
</div>
