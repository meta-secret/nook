<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import { type SecretOperationResult } from '$lib/vault/secret-operation-failure'
  type BitwardenVaultImport = {
    readonly json: string
    readonly password: string
  }
  type AuthenticatorMigrationUriCollection = string[]

  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import SettingsAccordionSection from '$lib/components/settings/SettingsAccordionSection.svelte'
  import ManageSection from '$lib/components/settings/ManageSection.svelte'
  import AuthStorage from '$lib/components/AuthStorage.svelte'
  import VaultAdminVaults from '$lib/components/VaultAdminVaults.svelte'
  import IdentityMountsPanel from '$lib/components/identity-control/IdentityMountsPanel.svelte'
  import BitwardenImportPanel from '$lib/components/BitwardenImportPanel.svelte'
  import KeePassXcImportPanel from '$lib/components/KeePassXcImportPanel.svelte'
  import LastPassImportPanel from '$lib/components/LastPassImportPanel.svelte'
  import KeeperImportPanel from '$lib/components/KeeperImportPanel.svelte'
  import OnePasswordImportPanel from '$lib/components/OnePasswordImportPanel.svelte'
  import ApplePasswordsImportPanel from '$lib/components/ApplePasswordsImportPanel.svelte'
  import ChromePasswordsImportPanel from '$lib/components/ChromePasswordsImportPanel.svelte'
  import DashlaneImportPanel from '$lib/components/DashlaneImportPanel.svelte'
  import GoogleAuthenticatorImportPanel from '$lib/components/GoogleAuthenticatorImportPanel.svelte'
  import ProtonPassImportPanel from '$lib/components/ProtonPassImportPanel.svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import type { NookImportResult } from '$lib/nook'
  import type {
    ProviderKind,
    StorageProvider,
  } from '$lib/auth/providers'
  import {
    LoginSetupKind,
    type LoginSetup,
  } from '$lib/vault/state/provider.svelte'
  import { WorkspaceSection } from '$lib/vault/state/ui.svelte'
  import type { NookManualProviderSync } from '$app-wasm'
  import {
    ImportProviderSectionKind,
    type ImportProviderSection,
  } from './vault-admin-state'

  let {
    vault,
    isVerifying,
    isInitializing,
    syncProviders,
    manualProviderSync,
    isAuthenticated,
    isSaving,
    addProviderOpen = false,
    loginSetup,
    onReconnect,
    onSyncProvider,
    onBeginAddProvider,
    onCancelAddProvider,
    onBeginSetup,
    onCancelSetup,
    onRemoveProvider,
    onImportBitwarden,
    onImportKeePassXc,
    onImportLastPass,
    onImportKeeper,
    onImportOnePassword,
    onImportApplePasswords,
    onImportChromePasswords,
    onImportDashlane,
    onImportGoogleAuthenticator,
    onImportProtonPass,
    onCreateVault,
    section,
  }: {
    vault: VaultState
    isVerifying: boolean
    isInitializing: boolean
    syncProviders: StorageProvider[]
    manualProviderSync: NookManualProviderSync
    isAuthenticated: boolean
    isSaving: boolean
    addProviderOpen?: boolean
    loginSetup: LoginSetup
    onReconnect: () => void | Promise<void>
    onSyncProvider?: (id: string) => void | Promise<void>
    onBeginAddProvider?: () => void
    onCancelAddProvider?: () => void
    onBeginSetup: (kind: ProviderKind) => void
    onCancelSetup: () => void
    onRemoveProvider?: (id: string) => void | Promise<void>
    onImportBitwarden: (
      args: BitwardenVaultImport,
    ) => Promise<SecretOperationResult<NookImportResult>>
    onImportKeePassXc: (
      csv: string,
    ) => Promise<SecretOperationResult<NookImportResult>>
    onImportLastPass: (
      csv: string,
    ) => Promise<SecretOperationResult<NookImportResult>>
    onImportKeeper: (
      csv: string,
    ) => Promise<SecretOperationResult<NookImportResult>>
    onImportOnePassword: (
      archive: Uint8Array,
    ) => Promise<SecretOperationResult<NookImportResult>>
    onImportApplePasswords: (
      exportBytes: Uint8Array,
    ) => Promise<SecretOperationResult<NookImportResult>>
    onImportChromePasswords: (
      csv: string,
    ) => Promise<SecretOperationResult<NookImportResult>>
    onImportDashlane: (
      exportBytes: Uint8Array,
    ) => Promise<SecretOperationResult<NookImportResult>>
    onImportGoogleAuthenticator: (
      migrationUris: AuthenticatorMigrationUriCollection,
    ) => Promise<SecretOperationResult<NookImportResult>>
    onImportProtonPass: (
      exportBytes: Uint8Array,
    ) => Promise<SecretOperationResult<NookImportResult>>
    /** Create a vault for this identity; it opens once created. */
    onCreateVault: (label: string) => Promise<void>
    section: WorkspaceSection
  } = $props()

  type AuthStorageOptionalProps = Partial<
    Pick<
      ComponentProps<typeof AuthStorage>,
      | 'onSyncProvider'
      | 'onBeginAddProvider'
      | 'onCancelAddProvider'
      | 'onRemoveProvider'
    >
  >
  const authStorageOptionalProps = $derived.by(() => {
    const props: AuthStorageOptionalProps = {}
    if (onSyncProvider) props.onSyncProvider = onSyncProvider
    if (onBeginAddProvider) props.onBeginAddProvider = onBeginAddProvider
    if (onCancelAddProvider) props.onCancelAddProvider = onCancelAddProvider
    if (onRemoveProvider) props.onRemoveProvider = onRemoveProvider
    return props
  })

  let activeImportProvider = $state<ImportProviderSection>({
    kind: ImportProviderSectionKind.Closed,
  })
  function importProviderOpen(providerId: string): boolean {
    return (
      activeImportProvider.kind === ImportProviderSectionKind.Open &&
      activeImportProvider.providerId === providerId
    )
  }

  function toggleImportProvider(providerId: string): void {
    activeImportProvider = importProviderOpen(providerId)
      ? { kind: ImportProviderSectionKind.Closed }
      : { kind: ImportProviderSectionKind.Open, providerId }
  }
</script>

<div
  class="grid min-w-0 grid-cols-1 gap-6"
  data-testid="vault-admin-panel"
  data-section={section}
>
  {#if section === WorkspaceSection.Vaults}
    <VaultAdminVaults {vault} {isVerifying} {isInitializing} {onCreateVault} />
  {/if}

  {#if section === WorkspaceSection.Sync}
    <ManageSection
      compact
      title={vault.t(I18N_KEYS.WorkspaceSectionSync)}
      subtitle={addProviderOpen || loginSetup.kind === LoginSetupKind.Active
        ? ''
        : vault.t(I18N_KEYS.WorkspaceSectionSyncDescription)}
      testId="storage-providers-section"
    >
      <AuthStorage
        {vault}
        embedded
        hostBack
        {syncProviders}
        {manualProviderSync}
        {isVerifying}
        {isInitializing}
        {addProviderOpen}
        {loginSetup}
        {onReconnect}
        {...authStorageOptionalProps}
        {onBeginSetup}
        {onCancelSetup}
      />
      {#if isAuthenticated}
        <IdentityMountsPanel {vault} />
      {/if}
    </ManageSection>
  {/if}

  {#if section === WorkspaceSection.Import}
    <ManageSection
      compact
      title={vault.t(I18N_KEYS.SettingsImportExport)}
      subtitle={vault.t(I18N_KEYS.WorkspaceSectionImportDescription)}
      testId="vault-import-export-section"
    >
      <div class="space-y-2">
        <SettingsAccordionSection
          title={vault.t(I18N_KEYS.ApplePasswordsImportSource)}
          subtitle={vault.t(I18N_KEYS.ApplePasswordsImportDescription)}
          open={importProviderOpen('apple-passwords')}
          onToggle={() => toggleImportProvider('apple-passwords')}
          testId="apple-passwords-import-section"
        >
          <ApplePasswordsImportPanel
            {vault}
            {isSaving}
            embedded
            onImport={onImportApplePasswords}
          />
        </SettingsAccordionSection>

        <SettingsAccordionSection
          title={vault.t(I18N_KEYS.ChromePasswordsImportSource)}
          subtitle={vault.t(I18N_KEYS.ChromePasswordsImportDescription)}
          open={importProviderOpen('chrome-passwords')}
          onToggle={() => toggleImportProvider('chrome-passwords')}
          testId="chrome-passwords-import-section"
        >
          <ChromePasswordsImportPanel
            {vault}
            {isSaving}
            embedded
            onImport={onImportChromePasswords}
          />
        </SettingsAccordionSection>

        <SettingsAccordionSection
          title={vault.t(I18N_KEYS.DashlaneImportSource)}
          subtitle={vault.t(I18N_KEYS.DashlaneImportDescription)}
          open={importProviderOpen('dashlane')}
          onToggle={() => toggleImportProvider('dashlane')}
          testId="dashlane-import-section"
        >
          <DashlaneImportPanel
            {vault}
            {isSaving}
            embedded
            onImport={onImportDashlane}
          />
        </SettingsAccordionSection>

        <SettingsAccordionSection
          title={vault.t(I18N_KEYS.GoogleAuthenticatorImportSource)}
          subtitle={vault.t(I18N_KEYS.GoogleAuthenticatorImportDescription)}
          open={importProviderOpen('google-authenticator')}
          onToggle={() => toggleImportProvider('google-authenticator')}
          testId="google-authenticator-import-section"
        >
          <GoogleAuthenticatorImportPanel
            {vault}
            {isSaving}
            embedded
            onImport={onImportGoogleAuthenticator}
          />
        </SettingsAccordionSection>

        <SettingsAccordionSection
          title={vault.t(I18N_KEYS.BitwardenImportSource)}
          subtitle={vault.t(I18N_KEYS.BitwardenImportDescription)}
          open={importProviderOpen('bitwarden')}
          onToggle={() => toggleImportProvider('bitwarden')}
          testId="bitwarden-import-section"
        >
          <BitwardenImportPanel
            {vault}
            {isSaving}
            embedded
            onImport={onImportBitwarden}
          />
        </SettingsAccordionSection>

        <SettingsAccordionSection
          title={vault.t(I18N_KEYS.KeepassxcImportSource)}
          subtitle={vault.t(I18N_KEYS.KeepassxcImportDescription)}
          open={importProviderOpen('keepassxc')}
          onToggle={() => toggleImportProvider('keepassxc')}
          testId="keepassxc-import-section"
        >
          <KeePassXcImportPanel
            {vault}
            {isSaving}
            embedded
            onImport={onImportKeePassXc}
          />
        </SettingsAccordionSection>

        <SettingsAccordionSection
          title={vault.t(I18N_KEYS.LastpassImportSource)}
          subtitle={vault.t(I18N_KEYS.LastpassImportDescription)}
          open={importProviderOpen('lastpass')}
          onToggle={() => toggleImportProvider('lastpass')}
          testId="lastpass-import-section"
        >
          <LastPassImportPanel
            {vault}
            {isSaving}
            embedded
            onImport={onImportLastPass}
          />
        </SettingsAccordionSection>

        <SettingsAccordionSection
          title={vault.t(I18N_KEYS.KeeperImportSource)}
          subtitle={vault.t(I18N_KEYS.KeeperImportDescription)}
          open={importProviderOpen('keeper')}
          onToggle={() => toggleImportProvider('keeper')}
          testId="keeper-import-section"
        >
          <KeeperImportPanel
            {vault}
            {isSaving}
            embedded
            onImport={onImportKeeper}
          />
        </SettingsAccordionSection>

        <SettingsAccordionSection
          title={vault.t(I18N_KEYS.OnepasswordImportSource)}
          subtitle={vault.t(I18N_KEYS.OnepasswordImportDescription)}
          open={importProviderOpen('onepassword')}
          onToggle={() => toggleImportProvider('onepassword')}
          testId="onepassword-import-section"
        >
          <OnePasswordImportPanel
            {vault}
            {isSaving}
            embedded
            onImport={onImportOnePassword}
          />
        </SettingsAccordionSection>

        <SettingsAccordionSection
          title={vault.t(I18N_KEYS.ProtonPassImportSource)}
          subtitle={vault.t(I18N_KEYS.ProtonPassImportDescription)}
          open={importProviderOpen('proton-pass')}
          onToggle={() => toggleImportProvider('proton-pass')}
          testId="proton-pass-import-section"
        >
          <ProtonPassImportPanel
            {vault}
            {isSaving}
            embedded
            onImport={onImportProtonPass}
          />
        </SettingsAccordionSection>
      </div>
    </ManageSection>
  {/if}
</div>
