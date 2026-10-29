<!--
Manage → Vaults: the vaults the identity in use keeps on this browser, to
create, rename, remove from this browser, or delete everywhere. Vaults that
belong to another identity stored here stay on that identity's card.
-->
<script lang="ts">
  import { untrack } from 'svelte'
  type VaultNameDraftChange = {
    readonly entry: NookLocalVaultEntry
    readonly value: string
  }

  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import {
    Check,
    FolderKey,
    PencilLine,
    Plus,
    RefreshCw,
    Trash2,
    X,
  } from '@lucide/svelte'
  import ManageSection from '$lib/components/settings/ManageSection.svelte'
  import LoginNewVaultPanel from '$lib/components/login/LoginNewVaultPanel.svelte'
  import { Button } from '$lib/components/ui/button'
  import type { NookLocalVaultEntry } from '$app-wasm'
  import type { VaultState } from '$lib/vault.svelte'
  import { ActiveVaultKind } from '$lib/vault/state/provider.svelte'
  import { IdentityDirectoryLoadKind } from '$lib/components/devices-access/identity-directory-view'
  import { IdentityCards } from '$lib/components/identities/identity-cards.svelte'
  import {
    VaultLabelEditorKind,
    VaultRenameOperationKind,
    type VaultLabelEditor,
    type VaultRenameOperation,
  } from './vault-admin-state'

  let {
    vault,
    isVerifying,
    isInitializing,
    onCreateVault,
  }: {
    vault: VaultState
    isVerifying: boolean
    isInitializing: boolean
    /** Create a vault for this identity; it opens once created. */
    onCreateVault: (label: string) => Promise<void>
  } = $props()

  const identityCards = new IdentityCards(untrack(() => vault))
  const directory = $derived(identityCards.loader.state)
  /** Ownership follows the identity cards: vaults another identity owns
   * are not this identity's to rename or delete everywhere. */
  const ownedStoreIds = $derived(identityCards.projection.currentStoreIds)

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

  let drafts = $state<Record<string, string>>({})
  let draftSeed = $state('')
  let editingStoreId = $state<VaultLabelEditor>({
    kind: VaultLabelEditorKind.Closed,
  })
  let renamingStoreId = $state<VaultRenameOperation>({
    kind: VaultRenameOperationKind.Idle,
  })

  const activeStoreId = $derived(
    vault.activeVault.kind === ActiveVaultKind.Open
      ? vault.activeVault.storeId.trim()
      : '',
  )
  const vaults = $derived(
    vault.localVaults.filter((entry) => ownedStoreIds.has(entry.storeId)),
  )
  const unnamedVaultLabel = $derived(vault.t(I18N_KEYS.LoginVaultPickerUnnamed))
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

    {#if directory.kind === IdentityDirectoryLoadKind.Loading}
      <p
        class="flex items-center gap-2 text-sm text-muted-foreground"
        role="status"
      >
        <RefreshCw class="size-4 animate-spin" aria-hidden="true" />
        {vault.t(I18N_KEYS.DevicesAccessIdentityDirectoryLoading)}
      </p>
    {:else if directory.kind === IdentityDirectoryLoadKind.Failed}
      <p class="nk-banner px-4 py-3 text-sm text-muted-foreground" role="alert">
        {vault.t(I18N_KEYS.DevicesAccessIdentityDirectoryFailed)}
      </p>
    {:else if vaults.length === 0}
      <p
        class="text-sm text-muted-foreground"
        data-testid="vault-admin-vaults-empty"
      >
        {vault.t(I18N_KEYS.VaultAdminVaultsEmpty)}
      </p>
    {:else}
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
                        value: (event.currentTarget as HTMLInputElement).value,
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
                <div
                  class="flex h-10 min-w-0 items-center"
                  data-testid="vault-admin-name"
                  data-store-id={entry.storeId}
                >
                  <span class="truncate text-sm font-medium text-foreground">
                    {entry.display_label(unnamedVaultLabel)}
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
              <!-- The name is written to the vault's own event log under its key,
                   so only the open vault can be renamed. -->
              {#if isActive}
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
              {/if}
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
    {/if}
  </div>
</ManageSection>
