<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import type { PasswordOperationResult } from '$lib/vault/password-unlock'
  import { type SecretOperationResult } from '$lib/vault/secret-operation-failure'
  type VaultNameDraftChange = {
    readonly entry: NookLocalVaultEntry
    readonly value: string
  }
  type VaultPasswordCreation = {
    readonly label: string
    readonly password: string
  }
  type VaultPasswordEntryUpdate = {
    readonly entryId: PasswordEntryId
    readonly password: string
  }
  type BitwardenVaultImport = {
    readonly json: string
    readonly password: string
  }
  type AuthenticatorMigrationUriCollection = string[]

  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import type { ExtensionSetupOffer } from '$lib/app/extension-setup'
  import {
    VaultGrantPresentation,
    VaultExtensionPresentation,
    type ExtensionConnectedEntryRequest,
    type VaultExtensionLinkRequest,
    type VaultSwitcherEntryLabel,
  } from './vault-switcher-extension'
  import {
    Check,
    FolderKey,
    Lock,
    PencilLine,
    Plus,
    RefreshCw,
    ShieldCheck,
    Trash2,
    X,
  } from '@lucide/svelte'
  import SettingsAccordionSection from '$lib/components/settings/SettingsAccordionSection.svelte'
  import ManageSection from '$lib/components/settings/ManageSection.svelte'
  import AuthStorage from '$lib/components/AuthStorage.svelte'
  import LoginNewVaultPanel from '$lib/components/login/LoginNewVaultPanel.svelte'
  import VaultPasswordCard from '$lib/components/VaultPasswordCard.svelte'
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
  import { Button } from '$lib/components/ui/button'
  import type {
    NookLocalVaultEntry,
    NookPasswordEntrySummary,
    PasswordEntryId,
  } from '$app-wasm'
  import type { VaultState } from '$lib/vault.svelte'
  import type { NookImportResult } from '$lib/nook'
  import type {
    ProviderSetupRequest,
    StorageProvider,
  } from '$lib/auth/providers'
  import {
    ActiveVaultKind,
    type LoginSetup,
  } from '$lib/vault/state/provider.svelte'
  import { WorkspaceSection } from '$lib/vault/state/ui.svelte'
  import type { NookManualProviderSync } from '$app-wasm'
  import {
    ImportProviderSectionKind,
    VaultLabelEditorKind,
    VaultRenameOperationKind,
    type ImportProviderSection,
    type VaultLabelEditor,
    type VaultRenameOperation,
  } from './vault-admin-state'

  let {
    vault,
    extensionSetupState,
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
    canManageExistingPasswords,
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
    extensionSetupState: ExtensionSetupOffer
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
    canManageExistingPasswords: boolean
    onReconnect: () => void | Promise<void>
    onSyncProvider?: (id: string) => void | Promise<void>
    onBeginAddProvider?: () => void
    onCancelAddProvider?: () => void
    onBeginSetup: (request: ProviderSetupRequest) => void
    onCancelSetup: () => void
    onRemoveProvider?: (id: string) => void | Promise<void>
    onAddPassword: (
      args: VaultPasswordCreation,
    ) => Promise<PasswordOperationResult>
    onUpdatePassword: (
      args: VaultPasswordEntryUpdate,
    ) => Promise<PasswordOperationResult>
    onRemovePassword: (
      entryId: PasswordEntryId,
    ) => Promise<PasswordOperationResult>
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

  let newVaultOpen = $state(false)

  async function createVault(label: string): Promise<void> {
    await onCreateVault(label)
    if (!vault.errorMsg) newVaultOpen = false
  }

  /** The vault whose removal from this browser awaits confirmation. */
  let removingStoreId = $state('')

  async function removeVault(entry: NookLocalVaultEntry): Promise<void> {
    await vault.removeLocalVault(entry.storeId)
    if (!vault.errorMsg) removingStoreId = ''
  }

  /** The vault whose deletion everywhere awaits its typed name. */
  let deletingStoreId = $state('')
  let deleteName = $state('')

  async function deleteVault(entry: NookLocalVaultEntry): Promise<void> {
    const deleted = await vault.identityControl.deleteVaultEverywhere(
      entry.storeId,
    )
    if (deleted.isOk()) deletingStoreId = ''
  }

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

  let drafts = $state<Record<string, string>>({})
  let draftSeed = $state('')
  let editingStoreId = $state<VaultLabelEditor>({
    kind: VaultLabelEditorKind.Closed,
  })
  let renamingStoreId = $state<VaultRenameOperation>({
    kind: VaultRenameOperationKind.Idle,
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

  const activeStoreId = $derived(
    vault.activeVault.kind === ActiveVaultKind.Open
      ? vault.activeVault.storeId.trim()
      : '',
  )
  const vaults = $derived(vault.localVaults)
  const unnamedVaultLabel = $derived(vault.t(I18N_KEYS.LoginVaultPickerUnnamed))
  const extensionEntryLabels = $derived.by((): VaultSwitcherEntryLabel[] => {
    const labels: VaultSwitcherEntryLabel[] = []
    for (const entry of vaults) {
      const label: VaultSwitcherEntryLabel = {
        storeId: entry.storeId,
        displayName: entry.display_label(unnamedVaultLabel),
      }
      labels.push(label)
    }
    return labels
  })
  const extensionLink = $derived.by(() => {
    const request: VaultExtensionLinkRequest = {
      offer: extensionSetupState,
      activeStoreId,
      entries: extensionEntryLabels,
    }
    return new VaultExtensionPresentation(request).link
  })
  const hasPasswords = $derived(passwordEntries.length > 0)
  const isBusy = $derived(
    isVerifying ||
      isInitializing ||
      vault.isVerifying ||
      renamingStoreId.kind === VaultRenameOperationKind.Renaming,
  )

  function buildDrafts() {
    const next: Record<string, string> = {}
    for (const entry of vaults) {
      next[entry.storeId] = entry.display_label(
        vault.t(I18N_KEYS.LoginVaultPickerUnnamed),
      )
    }
    drafts = next
  }

  $effect(() => {
    const seed = vaults
      .map((entry) => `${entry.storeId}:${((v) => (v ? v : ''))(entry.label)}`)
      .join('|')
    if (seed !== draftSeed) {
      draftSeed = seed
      buildDrafts()
    }
  })

  function draftFor(entry: NookLocalVaultEntry) {
    return ((
      ...[v = entry.display_label(vault.t(I18N_KEYS.LoginVaultPickerUnnamed))]
    ) => v)(drafts[entry.storeId])
  }

  function setDraft({ entry, value }: VaultNameDraftChange) {
    drafts = { ...drafts, [entry.storeId]: value }
  }

  function canSave(entry: NookLocalVaultEntry) {
    const draft = draftFor(entry).trim()
    return (
      !isBusy &&
      draft.length > 0 &&
      draft !== entry.display_label(vault.t(I18N_KEYS.LoginVaultPickerUnnamed))
    )
  }

  function beginRename(entry: NookLocalVaultEntry) {
    if (isBusy) return
    const setDraftArgs: Parameters<typeof setDraft>[0] = {
      entry,
      value: entry.display_label(vault.t(I18N_KEYS.LoginVaultPickerUnnamed)),
    }
    setDraft(setDraftArgs)
    editingStoreId = {
      kind: VaultLabelEditorKind.Editing,
      storeId: entry.storeId,
    }
  }

  function cancelRename(entry: NookLocalVaultEntry) {
    const setDraftArgs2: Parameters<typeof setDraft>[0] = {
      entry,
      value: entry.display_label(vault.t(I18N_KEYS.LoginVaultPickerUnnamed)),
    }
    setDraft(setDraftArgs2)
    if (
      editingStoreId.kind === VaultLabelEditorKind.Editing &&
      editingStoreId.storeId === entry.storeId
    ) {
      editingStoreId = { kind: VaultLabelEditorKind.Closed }
    }
  }

  async function renameVault(entry: NookLocalVaultEntry) {
    if (!canSave(entry)) return
    renamingStoreId = {
      kind: VaultRenameOperationKind.Renaming,
      storeId: entry.storeId,
    }
    try {
      const renameLocalVaultArgs: Parameters<typeof vault.renameLocalVault>[0] =
        {
          storeId: entry.storeId,
          label: draftFor(entry),
        }
      await vault.renameLocalVault(renameLocalVaultArgs)
      if (!vault.errorMsg) {
        editingStoreId = { kind: VaultLabelEditorKind.Closed }
      }
    } finally {
      renamingStoreId = { kind: VaultRenameOperationKind.Idle }
    }
  }
</script>

<div
  class="grid min-w-0 grid-cols-1 gap-6"
  data-testid="vault-admin-panel"
  data-section={section}
>
  {#if section === WorkspaceSection.Vaults}
    <ManageSection
      compact
      title={vault.t(I18N_KEYS.VaultAdminVaultsTitle)}
      subtitle={vault.t(I18N_KEYS.WorkspaceSectionVaultsDescription)}
      testId="vault-admin-vaults-section"
    >
      {#snippet badge()}
        {#if !newVaultOpen}
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="vault-admin-new-vault"
            disabled={isBusy}
            onclick={() => (newVaultOpen = true)}
          >
            <Plus class="size-4" />
            {vault.t(I18N_KEYS.WorkspaceNewVault)}
          </Button>
        {/if}
      {/snippet}

      <div class="space-y-4" data-testid="vault-admin-vaults-panel">
        {#if newVaultOpen}
          <div class="border border-border p-4 sm:p-5">
            <LoginNewVaultPanel
              {vault}
              {isVerifying}
              {isInitializing}
              importable={false}
              onCreateVault={createVault}
              onClose={() => (newVaultOpen = false)}
            />
          </div>
        {/if}

        <ul class="nk-list overflow-hidden">
          {#each vaults as entry (entry.storeId)}
            {@const isActive = entry.storeId === activeStoreId}
            {@const isEditing =
              editingStoreId.kind === VaultLabelEditorKind.Editing &&
              editingStoreId.storeId === entry.storeId}
            <li
              class="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3 border-b border-border/60 p-3 last:border-b-0 md:grid-cols-[2.5rem_minmax(0,1fr)_auto] md:items-start"
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
                    aria-label={vault.t(I18N_KEYS.VaultManagerNameLabel)}
                    data-testid="vault-admin-name-input"
                    data-store-id={entry.storeId}
                    value={draftFor(entry)}
                    disabled={isBusy}
                    oninput={(event) =>
                      (() => {
                        const setDraftArgs3: Parameters<typeof setDraft>[0] = {
                          entry,
                          value: (event.currentTarget as HTMLInputElement)
                            .value,
                        }
                        return setDraft(setDraftArgs3)
                      })()}
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
                  {@const grantRequest: ExtensionConnectedEntryRequest = {
                  link: extensionLink,
                  storeId: entry.storeId,
                }}
                  <div
                    class="flex h-10 min-w-0 items-center"
                    data-testid="vault-admin-name"
                    data-store-id={entry.storeId}
                  >
                    <span class="flex min-w-0 items-center gap-2">
                      <span
                        class="truncate text-sm font-medium text-foreground"
                      >
                        {entry.display_label(unnamedVaultLabel)}
                      </span>
                      {#if new VaultGrantPresentation(grantRequest).connected}
                        <span
                          class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary"
                          data-testid="vault-admin-extension-badge"
                        >
                          {vault.t(I18N_KEYS.VaultSwitcherExtensionBadge)}
                        </span>
                      {/if}
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
                class="col-span-2 flex flex-wrap items-center justify-end gap-2 md:col-span-1"
              >
                {#if isEditing}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    class="h-10"
                    data-testid="vault-admin-cancel-rename-btn"
                    data-store-id={entry.storeId}
                    disabled={renamingStoreId.kind ===
                      VaultRenameOperationKind.Renaming &&
                      renamingStoreId.storeId === entry.storeId}
                    onclick={() => cancelRename(entry)}
                  >
                    <X class="size-4" />
                    {vault.t(I18N_KEYS.CommonCancel)}
                  </Button>
                {:else if isActive}
                  <span
                    class="nk-tag nk-tag-success h-10 justify-center px-3"
                    data-testid="vault-admin-active-badge"
                  >
                    <Check class="size-4" />
                    {vault.t(I18N_KEYS.VaultSwitcherOpenBadge)}
                  </span>
                {/if}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  class="h-10"
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
                  {vault.t(I18N_KEYS.CommonRename)}
                </Button>
                {#if !isEditing}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    class="h-10 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    data-testid="vault-admin-remove-btn"
                    data-store-id={entry.storeId}
                    title={isActive
                      ? vault.t(I18N_KEYS.VaultAdminRemoveActiveHint)
                      : vault.t(I18N_KEYS.VaultAdminRemoveConfirmButton)}
                    disabled={isBusy || isActive}
                    onclick={() => {
                      deletingStoreId = ''
                      removingStoreId = entry.storeId
                    }}
                  >
                    <Trash2 class="size-4" />
                    {vault.t(I18N_KEYS.VaultAdminRemove)}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    class="h-10"
                    data-testid="vault-admin-delete-btn"
                    data-store-id={entry.storeId}
                    title={isActive
                      ? vault.t(I18N_KEYS.VaultAdminRemoveActiveHint)
                      : vault.t(I18N_KEYS.VaultAdminDelete)}
                    disabled={isBusy || isActive}
                    onclick={() => {
                      removingStoreId = ''
                      deleteName = ''
                      deletingStoreId = entry.storeId
                    }}
                  >
                    {vault.t(I18N_KEYS.VaultAdminDelete)}
                  </Button>
                {/if}
              </div>
              {#if deletingStoreId === entry.storeId && !isActive}
                <div
                  class="nk-banner col-span-full grid gap-3 border-l-destructive bg-destructive/5 p-4 md:col-span-3"
                  data-testid="vault-admin-delete-confirmation"
                  data-store-id={entry.storeId}
                >
                  <p class="text-sm text-pretty text-foreground">
                    {(() => {
                      const confirmRequest: Parameters<typeof vault.t>[0] = {
                        key: I18N_KEYS.VaultAdminDeleteConfirm,
                        replacements: {
                          vault: entry.display_label(unnamedVaultLabel),
                        },
                      }
                      return vault.t(confirmRequest)
                    })()}
                  </p>
                  <input
                    class="h-10 w-full max-w-sm border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-foreground/50"
                    aria-label={vault.t(I18N_KEYS.VaultAdminDeleteName)}
                    placeholder={entry.display_label(unnamedVaultLabel)}
                    data-testid="vault-admin-delete-name"
                    bind:value={deleteName}
                  />
                  <div class="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      data-testid="vault-admin-delete-confirm"
                      disabled={isBusy ||
                        deleteName.trim() !==
                          entry.display_label(unnamedVaultLabel)}
                      onclick={() => void deleteVault(entry)}
                    >
                      <Trash2 class="size-3.5" />
                      {vault.t(I18N_KEYS.VaultAdminDeleteConfirmButton)}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="vault-admin-delete-cancel"
                      disabled={isBusy}
                      onclick={() => (deletingStoreId = '')}
                    >
                      {vault.t(I18N_KEYS.CommonCancel)}
                    </Button>
                  </div>
                </div>
              {/if}
              {#if removingStoreId === entry.storeId && !isActive}
                <div
                  class="nk-banner col-span-full grid gap-3 border-l-destructive bg-destructive/5 p-4 md:col-span-3"
                  data-testid="vault-admin-remove-confirmation"
                  data-store-id={entry.storeId}
                >
                  <p class="text-sm text-pretty text-foreground">
                    {(() => {
                      const confirmRequest: Parameters<typeof vault.t>[0] = {
                        key: I18N_KEYS.VaultAdminRemoveConfirm,
                        replacements: {
                          vault: entry.display_label(unnamedVaultLabel),
                        },
                      }
                      return vault.t(confirmRequest)
                    })()}
                  </p>
                  <div class="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      data-testid="vault-admin-remove-confirm"
                      disabled={isBusy}
                      onclick={() => void removeVault(entry)}
                    >
                      <Trash2 class="size-3.5" />
                      {vault.t(I18N_KEYS.VaultAdminRemoveConfirmButton)}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="vault-admin-remove-cancel"
                      disabled={isBusy}
                      onclick={() => (removingStoreId = '')}
                    >
                      {vault.t(I18N_KEYS.CommonCancel)}
                    </Button>
                  </div>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    </ManageSection>
  {/if}

  {#if section === WorkspaceSection.Sync}
    <ManageSection
      compact
      title={vault.t(I18N_KEYS.WorkspaceSectionSync)}
      subtitle={vault.t(I18N_KEYS.WorkspaceSectionSyncDescription)}
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
        bind:githubPat
        bind:githubRepo
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

  {#if section === WorkspaceSection.Passwords}
    <ManageSection
      compact
      title={vault.t(I18N_KEYS.SettingsPasswords)}
      subtitle={vault.t(I18N_KEYS.WorkspaceSectionPasswordsDescription)}
      testId="vault-unlock-section"
    >
      {#snippet badge()}
        <span
          class="nk-tag {hasPasswords ? 'nk-tag-success' : ''}"
          data-testid="vault-password-status"
        >
          {#if hasPasswords}
            <ShieldCheck class="size-3" />
            {passwordEntries.length === 1
              ? vault.t(I18N_KEYS.SettingsPasswordCountSingular)
              : (() => {
                  const tArgs2: Parameters<typeof vault.t>[0] = {
                    key: I18N_KEYS.SettingsPasswordCountPlural,
                    replacements: {
                      count: String(passwordEntries.length),
                    },
                  }
                  return vault.t(tArgs2)
                })()}
          {:else}
            <Lock class="size-3" />
            {vault.t(I18N_KEYS.SettingsNoPasswords)}
          {/if}
        </span>
      {/snippet}
      <VaultPasswordCard
        {vault}
        embedded
        {passwordEntries}
        isBusy={isPasswordBusy}
        {passwordError}
        {canManageExistingPasswords}
        {onAddPassword}
        {onUpdatePassword}
        {onRemovePassword}
      />
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
