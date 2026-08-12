<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { onDestroy, tick } from 'svelte'
  import {
    ExtensionSetupOfferKind,
    type ExtensionSetupOffer,
  } from '$lib/app/extension-setup'
  import {
    configured_vault_application_supports_extension,
    ProviderSyncFailureHandling,
    ProviderSyncVisibility,
  } from '$app-wasm'
  import { ExtensionSetupStatus } from '$lib/extension/install'
  import ExtensionInstallSetupCard from '$lib/components/ExtensionInstallSetupCard.svelte'
  import OnboardDevice from '$lib/components/OnboardDevice.svelte'
  import PendingJoinsBanner from '$lib/components/PendingJoinsBanner.svelte'
  import SecretVault from '$lib/components/SecretVault.svelte'
  import VaultAdmin from '$lib/components/VaultAdmin.svelte'
  import DevicesAccessDashboard from '$lib/components/DevicesAccessDashboard.svelte'
  import {
    type DevicesAccessHostMount,
    DevicesAccessHostMountKind,
  } from '$lib/components/devices-access-dashboard-state'
  import VaultBottomNav from '$lib/components/VaultBottomNav.svelte'
  import VaultSecurityGuideBanner from '$lib/components/VaultSecurityGuideBanner.svelte'
  import VaultSettingsAccordion from '$lib/components/settings/VaultSettingsAccordion.svelte'
  import VaultStatusBar from '$lib/components/VaultStatusBar.svelte'
  import { generate_password, SecretType } from '$lib/nook'
  import {
    SecretTypeSelectionKind,
    type SecretTypeSelection,
  } from '$lib/components/secret-form-state'
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

  const SUPPORTS_EXTENSION = configured_vault_application_supports_extension()

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
  let devicesAccessHost = $state<DevicesAccessHostMount>({
    kind: DevicesAccessHostMountKind.Unmounted,
  })
  const secretsNoteEditorOpen = $derived(
    secretsAddOpen &&
      secretsAddFormType.kind === SecretEditorModeKind.Adding &&
      secretsAddFormType.itemType === SecretType.SecureNote,
  )

  function setAddMode({ open, selection }: { readonly open: boolean; readonly selection: SecretTypeSelection }) {
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

  function captureDevicesAccessHost(element: HTMLDivElement) {
    devicesAccessHost = {
      kind: DevicesAccessHostMountKind.Mounted,
      element,
    }
    return {
      destroy() {
        devicesAccessHost = { kind: DevicesAccessHostMountKind.Unmounted }
      },
    }
  }

  async function closeDevicesAccess(): Promise<void> {
    vault.closeSettings()
    await tick()
    if (devicesAccessHost.kind === DevicesAccessHostMountKind.Unmounted) return
    devicesAccessHost.element
      .querySelector<HTMLButtonElement>(
        '[data-testid="vault-devices-access-tab"]',
      )
      ?.focus()
  }

  async function openVaultDevices(): Promise<void> {
    const settingsRequest: Parameters<typeof vault.openSettings>[0] = {
      section: SettingsSection.Storage,
      accordion: SettingsAccordionSection.Devices,
    }
    vault.openSettings(settingsRequest)
    await tick()
    if (devicesAccessHost.kind === DevicesAccessHostMountKind.Unmounted) return
    devicesAccessHost.element
      .querySelector<HTMLButtonElement>(
        '[data-testid="vault-devices-section"] > button',
      )
      ?.focus()
  }

  async function openVaultPasswords(): Promise<void> {
    vault.openAdmin(AdminAccordionSection.Passwords)
    await tick()
    if (devicesAccessHost.kind === DevicesAccessHostMountKind.Unmounted) return
    devicesAccessHost.element
      .querySelector<HTMLButtonElement>(
        '[data-testid="vault-unlock-section"] > button',
      )
      ?.focus()
  }

  onDestroy(() => {
    onEditorOpenChange(false)
  })
</script>

<div
  use:captureDevicesAccessHost
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
      {#if !vault.settingsOpen && !secretsAddOpen && SUPPORTS_EXTENSION && extensionSetupState.kind === ExtensionSetupOfferKind.Visible && extensionSetupState.setup.status !== ExtensionSetupStatus.Paired}
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
          onAddDevice={() => {
            const settingsRequest: Parameters<typeof vault.openSettings>[0] = {
              section: SettingsSection.Onboard,
              accordion: SettingsAccordionSection.Devices,
            }
            vault.openSettings(settingsRequest)
          }}
        />
      {/if}
      {#if vault.settingsOpen && vault.settingsSection === SettingsSection.DevicesAccess}
        <DevicesAccessDashboard
          {vault}
          onBack={() => void closeDevicesAccess()}
          onManageVaultDevices={() => void openVaultDevices()}
          onManageVaultPasswords={() => void openVaultPasswords()}
        />
      {:else if vault.settingsOpen && vault.settingsSection === SettingsSection.Admin}
        <VaultAdmin
          {vault}
          bind:activeSection={vault.adminAccordionSection}
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
          onReconnect={onSettingsReconnect}
          onSyncProvider={(id) => {
            const syncRequest: Parameters<typeof vault.syncProviderById>[0] = {
              providerId: id,
              visibility: ProviderSyncVisibility.Visible,
              failureHandling: ProviderSyncFailureHandling.Capture,
            }
            return vault.syncProviderById(syncRequest)
          }}
          onBeginAddProvider={() => vault.beginAddProvider()}
          onCancelAddProvider={() => vault.cancelAddProvider()}
          onBeginSetup={(setupRequest) =>
            vault.beginProviderSetup(setupRequest)}
          onCancelSetup={() => vault.cancelProviderSetup()}
          onRemoveProvider={(id) => vault.removeProvider(id)}
          onAddPassword={(passwordRequest) =>
            vault.addVaultPassword(passwordRequest)}
          onUpdatePassword={(passwordRequest) =>
            vault.updateVaultPasswordEntry(passwordRequest)}
          onRemovePassword={(id) => vault.removeVaultPasswordEntry(id)}
          onIssueCode={({ entryId, password }) => {
            const provider = vault.syncProviders[0]
            if (!provider) {
              throw new Error(vault.t(I18N_KEYS.OnboardDeviceChooseSyncProviderErr))
            }
            const issueRequest: Parameters<typeof vault.issueEnrollmentCode>[0] = {
              entryId,
              password,
              providerId: provider.id,
            }
            return vault.issueEnrollmentCode(issueRequest)
          }}
          onClearCode={() => vault.clearEnrollmentCode()}
          onImportBitwarden={(importRequest) =>
            vault.handleBitwardenImport(importRequest)}
          onImportKeePassXc={(csv) => vault.handleKeePassXcImport(csv)}
          onImportLastPass={(csv) => vault.handleLastPassImport(csv)}
          onImportKeeper={(csv) => vault.handleKeeperImport(csv)}
          onImportOnePassword={(archive) =>
            vault.handleOnePasswordImport(archive)}
          onImportApplePasswords={(exportBytes) =>
            vault.handleApplePasswordsImport(exportBytes)}
          onImportChromePasswords={(csv) =>
            vault.handleChromePasswordsImport(csv)}
          onImportDashlane={(exportBytes) =>
            vault.handleDashlaneImport(exportBytes)}
          onImportGoogleAuthenticator={(migrationUris) =>
            vault.handleGoogleAuthenticatorImport(migrationUris)}
          onImportProtonPass={(exportBytes) =>
            vault.handleProtonPassImport(exportBytes)}
        />
      {:else if vault.settingsOpen && vault.settingsSection === SettingsSection.Onboard}
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
          onIssueCode={(issueRequest) =>
            vault.issueEnrollmentCode(issueRequest)}
          onClearCode={() => vault.clearEnrollmentCode()}
          onAddPassword={(passwordRequest) =>
            vault.addVaultPassword(passwordRequest)}
          onBeginAddProvider={() => vault.beginAddProvider()}
          onCancelAddProvider={() => vault.cancelAddProvider()}
          onBeginSetup={(setupRequest) =>
            vault.beginProviderSetup(setupRequest)}
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
          onRenameDevice={(renameRequest) =>
            vault.renameDevice(renameRequest)}
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
            onOpenDevicesSettings={() => {
              const settingsRequest: Parameters<typeof vault.openSettings>[0] = {
                section: SettingsSection.Storage,
                accordion: SettingsAccordionSection.Devices,
              }
              vault.openSettings(settingsRequest)
            }}
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
              onAddSecret={(secretRequest) =>
                vault.handleAddSecret(secretRequest)}
              onReplaceSecret={(secretRequest) =>
                vault.handleReplaceSecret(secretRequest)}
              onDeleteSecret={(id) => vault.handleDeleteSecret(id)}
              onGeneratePassword={generate_password}
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
      lastSync={vault.lastSync}
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
      onSelectDevicesAccess={() => {
        leaveSecretsEditor()
        const settingsRequest: Parameters<typeof vault.openSettings>[0] = {
          section: SettingsSection.DevicesAccess,
          accordion: SettingsAccordionSection.Devices,
        }
        vault.openSettings(settingsRequest)
      }}
      onSelectOnboard={() => {
        leaveSecretsEditor()
        const settingsRequest: Parameters<typeof vault.openSettings>[0] = {
          section: SettingsSection.Onboard,
          accordion: SettingsAccordionSection.Devices,
        }
        vault.openSettings(settingsRequest)
      }}
      onSelectAdmin={() => {
        leaveSecretsEditor()
        vault.openAdmin()
      }}
      onSelectSettings={() => {
        leaveSecretsEditor()
        const settingsRequest: Parameters<typeof vault.openSettings>[0] = {
          section: SettingsSection.Storage,
          accordion: SettingsAccordionSection.Devices,
        }
        vault.openSettings(settingsRequest)
      }}
    />
  </div>
</div>
