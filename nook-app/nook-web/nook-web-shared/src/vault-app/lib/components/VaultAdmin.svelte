<script lang="ts">
  import {
    Check,
    CheckCircle2,
    FolderKey,
    Lock,
    PencilLine,
    Plus,
    RefreshCw,
    ShieldCheck,
    X,
  } from '@lucide/svelte'
  import SettingsAccordionSection from '$lib/components/settings/SettingsAccordionSection.svelte'
  import AuthStorage from '$lib/components/AuthStorage.svelte'
  import VaultPasswordCard from '$lib/components/VaultPasswordCard.svelte'
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
  import { Button } from '$lib/components/ui/button'
  import type {
    NookLocalVaultEntry,
    NookPasswordEntrySummary,
    PasswordEntryId,
  } from '$app-wasm'
  import type { VaultState } from '$lib/vault.svelte'
  import type { NookImportResult } from '$lib/nook'
  import type {
    OAuthFilePreset,
    StorageProvider,
    StorageProviderType,
  } from '$lib/auth/providers'
  import {
    ActiveVaultKind,
    type LoginSetup,
  } from '$lib/vault/state/provider.svelte'
  import { AdminAccordionSection } from '$lib/vault/state/ui.svelte'
  import type { NookManualProviderSync } from '$app-wasm'
  import {
    ImportProviderSectionKind,
    VaultLabelEditorKind,
    VaultRenameOperationKind,
    VaultSwitchOperationKind,
    type ImportProviderSection,
    type VaultLabelEditor,
    type VaultRenameOperation,
    type VaultSwitchOperation,
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
    githubPat = $bindable(''),
    githubRepo = $bindable(''),
    passwordEntries,
    isPasswordBusy,
    passwordError,
    enrollmentCode,
    onReconnect,
    onSyncProvider,
    onBeginAddProvider,
    onCancelAddProvider,
    onBeginSetup,
    onCancelSetup,
    onRemoveProvider,
    onAddPassword,
    onUpdatePassword,
    onRemovePassword,
    onIssueCode,
    onClearCode,
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
    activeSection = $bindable(AdminAccordionSection.Vaults),
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
    githubPat: string
    githubRepo: string
    passwordEntries: NookPasswordEntrySummary[]
    isPasswordBusy: boolean
    passwordError: string
    enrollmentCode: string
    onReconnect: () => void | Promise<void>
    onSyncProvider?: (id: string) => void | Promise<void>
    onBeginAddProvider?: () => void
    onCancelAddProvider?: () => void
    onBeginSetup: (
      type: StorageProviderType,
      oauthPreset?: OAuthFilePreset,
    ) => void
    onCancelSetup: () => void
    onRemoveProvider?: (id: string) => void | Promise<void>
    onAddPassword: (label: string, password: string) => void | Promise<void>
    onUpdatePassword: (
      entryId: PasswordEntryId,
      password: string,
    ) => void | Promise<void>
    onRemovePassword: (entryId: PasswordEntryId) => void | Promise<void>
    onIssueCode: (entryId: PasswordEntryId, password: string) => Promise<string>
    onClearCode: () => void
    onImportBitwarden: (
      json: string,
      password: string,
    ) => Promise<NookImportResult>
    onImportKeePassXc: (csv: string) => Promise<NookImportResult>
    onImportLastPass: (csv: string) => Promise<NookImportResult>
    onImportKeeper: (csv: string) => Promise<NookImportResult>
    onImportOnePassword: (archive: Uint8Array) => Promise<NookImportResult>
    onImportApplePasswords: (
      exportBytes: Uint8Array,
    ) => Promise<NookImportResult>
    onImportChromePasswords: (csv: string) => Promise<NookImportResult>
    onImportDashlane: (exportBytes: Uint8Array) => Promise<NookImportResult>
    onImportGoogleAuthenticator: (
      migrationUris: string[],
    ) => Promise<NookImportResult>
    onImportProtonPass: (exportBytes: Uint8Array) => Promise<NookImportResult>
    activeSection?: AdminAccordionSection
  } = $props()

  let newVaultName = $state('')
  let drafts = $state<Record<string, string>>({})
  let draftSeed = $state('')
  let creating = $state(false)
  let editingStoreId = $state<VaultLabelEditor>({
    kind: VaultLabelEditorKind.Closed,
  })
  let renamingStoreId = $state<VaultRenameOperation>({
    kind: VaultRenameOperationKind.Idle,
  })
  let switchingTo = $state<VaultSwitchOperation>({
    kind: VaultSwitchOperationKind.Idle,
  })
  let activeImportProvider = $state<ImportProviderSection>({
    kind: ImportProviderSectionKind.Closed,
  })
  function toggleAdminSection(section: AdminAccordionSection): void {
    activeSection =
      activeSection === section ? AdminAccordionSection.Closed : section
  }

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

  const activeStoreId = $derived(
    vault.activeVault.kind === ActiveVaultKind.Open
      ? vault.activeVault.storeId.trim()
      : '',
  )
  const vaults = $derived(vault.localVaults)
  const hasPasswords = $derived(passwordEntries.length > 0)
  const isBusy = $derived(
    isVerifying ||
      isInitializing ||
      vault.isVerifying ||
      creating ||
      renamingStoreId.kind === VaultRenameOperationKind.Renaming ||
      switchingTo.kind === VaultSwitchOperationKind.Switching,
  )

  function buildDrafts() {
    const next: Record<string, string> = {}
    for (const entry of vaults) {
      next[entry.storeId] = entry.displayLabel(
        vault.t('login.vault_picker_unnamed'),
      )
    }
    drafts = next
  }

  $effect(() => {
    const seed = vaults
      .map((entry) => `${entry.storeId}:${entry.label ?? ''}`)
      .join('|')
    if (seed !== draftSeed) {
      draftSeed = seed
      buildDrafts()
    }
  })

  function draftFor(entry: NookLocalVaultEntry) {
    return (
      drafts[entry.storeId] ??
      entry.displayLabel(vault.t('login.vault_picker_unnamed'))
    )
  }

  function setDraft(entry: NookLocalVaultEntry, value: string) {
    drafts = { ...drafts, [entry.storeId]: value }
  }

  function canSave(entry: NookLocalVaultEntry) {
    const draft = draftFor(entry).trim()
    return (
      !isBusy &&
      draft.length > 0 &&
      draft !== entry.displayLabel(vault.t('login.vault_picker_unnamed'))
    )
  }

  function beginRename(entry: NookLocalVaultEntry) {
    if (isBusy) return
    setDraft(entry, entry.displayLabel(vault.t('login.vault_picker_unnamed')))
    editingStoreId = {
      kind: VaultLabelEditorKind.Editing,
      storeId: entry.storeId,
    }
  }

  function cancelRename(entry: NookLocalVaultEntry) {
    setDraft(entry, entry.displayLabel(vault.t('login.vault_picker_unnamed')))
    if (
      editingStoreId.kind === VaultLabelEditorKind.Editing &&
      editingStoreId.storeId === entry.storeId
    ) {
      editingStoreId = { kind: VaultLabelEditorKind.Closed }
    }
  }

  async function createVault() {
    const label = newVaultName.trim()
    if (!label || isBusy) return
    creating = true
    try {
      await vault.createLocalVaultWithDeviceKeys(label)
      if (!vault.errorMsg) {
        newVaultName = ''
      }
    } finally {
      creating = false
    }
  }

  async function renameVault(entry: NookLocalVaultEntry) {
    if (!canSave(entry)) return
    renamingStoreId = {
      kind: VaultRenameOperationKind.Renaming,
      storeId: entry.storeId,
    }
    try {
      await vault.renameLocalVault(entry.storeId, draftFor(entry))
      if (!vault.errorMsg) {
        editingStoreId = { kind: VaultLabelEditorKind.Closed }
      }
    } finally {
      renamingStoreId = { kind: VaultRenameOperationKind.Idle }
    }
  }

  async function switchTo(entry: NookLocalVaultEntry) {
    if (entry.storeId === activeStoreId || isBusy) return
    switchingTo = {
      kind: VaultSwitchOperationKind.Switching,
      storeId: entry.storeId,
    }
    try {
      await vault.switchToVault(entry.storeId)
    } finally {
      switchingTo = { kind: VaultSwitchOperationKind.Idle }
    }
  }
</script>

<div class="space-y-2" data-testid="vault-admin-panel">
  <SettingsAccordionSection
    title={vault.t('vault.admin_vaults_title')}
    subtitle={vault.t('vault.admin_vaults_desc')}
    open={activeSection === AdminAccordionSection.Vaults}
    onToggle={() => toggleAdminSection(AdminAccordionSection.Vaults)}
    testId="vault-admin-vaults-section"
  >
    {#snippet badge()}
      <span
        class="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"
        data-testid="vault-admin-vault-count"
      >
        <CheckCircle2 class="size-3" />
        {vault.t('vault.admin_vault_count', { count: String(vaults.length) })}
      </span>
    {/snippet}

    <div class="space-y-4" data-testid="vault-admin-vaults-panel">
      <div
        class="flex flex-col gap-3 rounded-lg border border-dashed border-border/50 bg-muted/10 p-3 sm:flex-row sm:items-end"
      >
        <div class="min-w-0 flex-1 space-y-1">
          <label
            for="vault-admin-create-input"
            class="text-xs font-medium text-muted-foreground"
          >
            {vault.t('vault.admin_new_vault_label')}
          </label>
          <input
            id="vault-admin-create-input"
            class="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
            placeholder={vault.t('login.vault_name_placeholder')}
            data-testid="vault-admin-create-input"
            value={newVaultName}
            disabled={isBusy}
            oninput={(event) => {
              newVaultName = (event.currentTarget as HTMLInputElement).value
            }}
            onkeydown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void createVault()
              }
            }}
          />
        </div>
        <Button
          type="button"
          class="sm:min-w-[11rem]"
          data-testid="vault-admin-create-btn"
          disabled={isBusy || newVaultName.trim().length === 0}
          onclick={() => void createVault()}
        >
          {#if creating}
            <RefreshCw class="size-4 animate-spin" />
          {:else}
            <Plus class="size-4" />
          {/if}
          {vault.t('vault.switcher_create_new')}
        </Button>
      </div>

      <ul
        class="overflow-hidden rounded-lg border border-border/60 bg-background/35"
      >
        {#each vaults as entry (entry.storeId)}
          {@const isActive = entry.storeId === activeStoreId}
          {@const isEditing =
            editingStoreId.kind === VaultLabelEditorKind.Editing &&
            editingStoreId.storeId === entry.storeId}
          <li
            class="grid gap-3 border-b border-border/60 p-3 last:border-b-0 md:grid-cols-[2.5rem_minmax(0,1fr)_auto] md:items-start"
            data-testid="vault-admin-entry"
            data-store-id={entry.storeId}
          >
            <div
              class="flex size-10 items-center justify-center rounded-md border border-border/50 bg-muted/20 text-muted-foreground md:mt-0.5"
              aria-hidden="true"
            >
              <FolderKey
                class="size-4 {isActive
                  ? 'text-primary'
                  : 'text-muted-foreground'}"
              />
            </div>

            <div class="min-w-0 space-y-2">
              {#if isEditing}
                <input
                  class="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
                  aria-label={vault.t('vault.manager_name_label')}
                  data-testid="vault-admin-name-input"
                  data-store-id={entry.storeId}
                  value={draftFor(entry)}
                  disabled={isBusy}
                  oninput={(event) =>
                    setDraft(
                      entry,
                      (event.currentTarget as HTMLInputElement).value,
                    )}
                  onkeydown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void renameVault(entry)
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      cancelRename(entry)
                    }
                  }}
                />
              {:else}
                <div
                  class="flex h-10 min-w-0 items-center"
                  data-testid="vault-admin-name"
                  data-store-id={entry.storeId}
                >
                  <span class="truncate text-sm font-medium text-foreground">
                    {entry.displayLabel(vault.t('login.vault_picker_unnamed'))}
                  </span>
                </div>
              {/if}
              <div
                class="truncate font-mono text-[10px] leading-none text-muted-foreground"
              >
                {entry.storeId}
              </div>
            </div>

            <div
              class="grid grid-cols-2 gap-2 md:w-[14.5rem] md:grid-cols-[7rem_6.5rem]"
            >
              {#if isEditing}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  class="h-10 w-full"
                  data-testid="vault-admin-cancel-rename-btn"
                  data-store-id={entry.storeId}
                  disabled={renamingStoreId.kind ===
                    VaultRenameOperationKind.Renaming &&
                    renamingStoreId.storeId === entry.storeId}
                  onclick={() => cancelRename(entry)}
                >
                  <X class="size-4" />
                  {vault.t('common.cancel')}
                </Button>
              {:else if !isActive}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  class="h-10 w-full"
                  data-testid="vault-admin-switch-btn"
                  data-store-id={entry.storeId}
                  disabled={isBusy}
                  onclick={() => void switchTo(entry)}
                >
                  {#if switchingTo.kind === VaultSwitchOperationKind.Switching && switchingTo.storeId === entry.storeId}
                    <RefreshCw class="size-4 animate-spin" />
                  {/if}
                  {vault.t('common.switch')}
                </Button>
              {:else}
                <span
                  class="inline-flex h-10 w-full items-center justify-center gap-1 rounded-md border border-primary/20 bg-primary/10 px-3 text-sm font-medium text-primary"
                  data-testid="vault-admin-active-badge"
                >
                  <Check class="size-4" />
                  {vault.t('vault.switcher_open_badge')}
                </span>
              {/if}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                class="h-10 w-full"
                data-testid="vault-admin-rename-btn"
                data-store-id={entry.storeId}
                disabled={isEditing ? !canSave(entry) : isBusy}
                onclick={() =>
                  isEditing ? void renameVault(entry) : beginRename(entry)}
              >
                {#if isEditing && renamingStoreId.kind === VaultRenameOperationKind.Renaming && renamingStoreId.storeId === entry.storeId}
                  <RefreshCw class="size-4 animate-spin" />
                {:else if !isEditing}
                  <PencilLine class="size-4" />
                {/if}
                {vault.t('common.rename')}
              </Button>
            </div>
          </li>
        {/each}
      </ul>
    </div>
  </SettingsAccordionSection>

  <SettingsAccordionSection
    title={vault.t('settings.storage')}
    subtitle={vault.t('settings.storage_desc')}
    open={activeSection === AdminAccordionSection.Storage}
    onToggle={() => toggleAdminSection(AdminAccordionSection.Storage)}
    testId="storage-providers-section"
  >
    {#snippet badge()}
      {#if isAuthenticated}
        <span
          class="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-500"
          data-testid="connected-badge"
        >
          <CheckCircle2 class="size-3" />
          {vault.t('settings.vault_unlocked')}
        </span>
      {/if}
    {/snippet}
    <AuthStorage
      {vault}
      embedded
      {syncProviders}
      {manualProviderSync}
      {isVerifying}
      {isInitializing}
      {addProviderOpen}
      {loginSetup}
      bind:githubPat
      bind:githubRepo
      {onReconnect}
      {onSyncProvider}
      {onBeginAddProvider}
      {onCancelAddProvider}
      {onBeginSetup}
      {onCancelSetup}
      {onRemoveProvider}
    />
  </SettingsAccordionSection>

  <SettingsAccordionSection
    title={vault.t('settings.passwords')}
    subtitle={vault.t('settings.passwords_desc')}
    open={activeSection === AdminAccordionSection.Passwords}
    onToggle={() => toggleAdminSection(AdminAccordionSection.Passwords)}
    testId="vault-unlock-section"
  >
    {#snippet badge()}
      <span
        class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium {hasPasswords
          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'border-border bg-muted/40 text-muted-foreground'}"
        data-testid="vault-password-status"
      >
        {#if hasPasswords}
          <ShieldCheck class="size-3" />
          {passwordEntries.length === 1
            ? vault.t('settings.password_count_singular')
            : vault.t('settings.password_count_plural', {
                count: String(passwordEntries.length),
              })}
        {:else}
          <Lock class="size-3" />
          {vault.t('settings.no_passwords')}
        {/if}
      </span>
    {/snippet}
    <VaultPasswordCard
      {vault}
      embedded
      {passwordEntries}
      isBusy={isPasswordBusy}
      {passwordError}
      {enrollmentCode}
      {onAddPassword}
      {onUpdatePassword}
      {onRemovePassword}
      {onIssueCode}
      {onClearCode}
      allowIssueCode={false}
    />
  </SettingsAccordionSection>

  <SettingsAccordionSection
    title={vault.t('settings.import_export')}
    subtitle={vault.t('settings.import_export_desc')}
    open={activeSection === AdminAccordionSection.ImportExport}
    onToggle={() => toggleAdminSection(AdminAccordionSection.ImportExport)}
    testId="vault-import-export-section"
  >
    <div class="space-y-2">
      <SettingsAccordionSection
        title={vault.t('apple_passwords_import.source')}
        subtitle={vault.t('apple_passwords_import.description')}
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
        title={vault.t('chrome_passwords_import.source')}
        subtitle={vault.t('chrome_passwords_import.description')}
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
        title={vault.t('dashlane_import.source')}
        subtitle={vault.t('dashlane_import.description')}
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
        title={vault.t('google_authenticator_import.source')}
        subtitle={vault.t('google_authenticator_import.description')}
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
        title={vault.t('bitwarden_import.source')}
        subtitle={vault.t('bitwarden_import.description')}
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
        title={vault.t('keepassxc_import.source')}
        subtitle={vault.t('keepassxc_import.description')}
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
        title={vault.t('lastpass_import.source')}
        subtitle={vault.t('lastpass_import.description')}
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
        title={vault.t('keeper_import.source')}
        subtitle={vault.t('keeper_import.description')}
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
        title={vault.t('onepassword_import.source')}
        subtitle={vault.t('onepassword_import.description')}
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
        title={vault.t('proton_pass_import.source')}
        subtitle={vault.t('proton_pass_import.description')}
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
  </SettingsAccordionSection>
</div>
