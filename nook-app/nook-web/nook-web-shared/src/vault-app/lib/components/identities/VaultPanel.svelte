<!--
One vault, opened beside its identity's card from the vault's row. Locked,
it unlocks with this device's passkey or PIN, or with the vault's own
passphrase. Open, it offers to go in. Below, what belongs to this vault
alone (its name, passphrases, imports), usable once it is open.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import {
    ChevronRight,
    Download,
    Fingerprint,
    FolderKey,
    FolderOpen,
    Lock,
    PencilLine,
    RefreshCw,
    ShieldCheck,
    UserRoundCheck,
    X,
  } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import { StatusTag, StatusTone } from '$lib/components/ui/status-tag'
  import type { VaultState } from '$lib/vault.svelte'
  import { WorkspaceSection } from '$lib/vault/state/ui.svelte'
  import {
    IdentityVaultRowState,
    type IdentityVaultRow,
  } from './identity-card-model'

  let {
    vault,
    row,
    identityName,
    unlockLabel,
    busy = false,
    passphrase,
    passphraseOffered = false,
    onOpen,
    onUnlock,
    onUseIdentity,
    onManage,
    onClose,
  }: {
    vault: VaultState
    row: IdentityVaultRow
    identityName: string
    /** "Unlock with passkey" or "Unlock with PIN", as this device signs in. */
    unlockLabel: string
    busy?: boolean
    /** The vault's passphrase unlock, once its passphrases are read. */
    passphrase?: Snippet
    /** Unlocking with a passphrase applies here (a locked browser). */
    passphraseOffered?: boolean
    /** Go into the open vault. */
    onOpen: () => void
    /** Unlock with this device's key and stay here: the panel then offers
     * Open vault and the vault's own pages. */
    onUnlock: () => void
    /** The vault belongs to an identity not in use here. */
    onUseIdentity: () => void
    /** One of this open vault's pages. */
    onManage: (section: WorkspaceSection) => void
    onClose: () => void
  } = $props()

  const label = $derived(row.label || vault.t(I18N_KEYS.WorkspaceVaultFallback))
  const open = $derived(row.state === IdentityVaultRowState.Open)
  const dormant = $derived(row.state === IdentityVaultRowState.Dormant)
  const reachable = $derived(row.state !== IdentityVaultRowState.Unavailable)

  /** Renaming an open vault, in place of its name. */
  let renaming = $state(false)
  let draft = $state('')
  let saving = $state(false)

  function beginRename(): void {
    draft = row.label
    renaming = true
  }

  async function saveRename(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    const label = draft.trim()
    if (!label || label === row.label) {
      renaming = false
      return
    }
    saving = true
    const request: Parameters<typeof vault.renameLocalVault>[0] = {
      storeId: row.storeId,
      label,
    }
    await vault.renameLocalVault(request)
    saving = false
    if (!vault.errorMsg) renaming = false
  }

  const dormantHint = $derived.by(() => {
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.WorkspaceVaultPanelKeyDormant,
      replacements: { identity: identityName },
    }
    return vault.t(request)
  })

  type ManageItem = {
    readonly section: WorkspaceSection
    readonly testId: string
    readonly title: string
    readonly hint: string
  }
  const manageItems = $derived.by((): ManageItem[] => [
    {
      section: WorkspaceSection.Passwords,
      testId: 'vault-panel-passphrases',
      title: vault.t(I18N_KEYS.WorkspaceSectionPasswords),
      hint: vault.t(I18N_KEYS.WorkspaceVaultPanelPassphrasesHint),
    },
    {
      section: WorkspaceSection.Import,
      testId: 'vault-panel-import',
      title: vault.t(I18N_KEYS.WorkspaceSectionImport),
      hint: vault.t(I18N_KEYS.WorkspaceVaultPanelImportHint),
    },
  ])
</script>

<div
  class="grid min-w-0 content-start gap-7"
  data-testid="vault-panel-beside"
  data-store-id={row.storeId}
  data-state={row.state}
>
  <header class="flex items-start justify-between gap-3">
    <span class="flex min-w-0 items-center gap-3">
      <span
        class="nk-vault-icon size-10"
        class:nk-vault-icon-open={open}
        aria-hidden="true"
      >
        {#if open}
          <FolderOpen class="size-4" />
        {:else}
          <FolderKey class="size-4" />
        {/if}
      </span>
      <span class="grid min-w-0 flex-1 gap-0.5">
        {#if renaming}
          <form class="flex min-w-0 items-center gap-2" onsubmit={saveRename}>
            <!-- svelte-ignore a11y_autofocus -->
            <input
              class="h-8 min-w-0 flex-1 border border-border bg-background px-2 text-base font-semibold text-foreground outline-none focus:border-foreground/50"
              aria-label={vault.t(I18N_KEYS.VaultManagerNameLabel)}
              data-testid="vault-panel-name-input"
              autofocus
              disabled={saving}
              bind:value={draft}
              onkeydown={(event) => {
                if (event.key === 'Escape') renaming = false
              }}
            />
            <Button
              type="submit"
              size="sm"
              data-testid="vault-panel-name-save"
              disabled={saving || !draft.trim()}
            >
              {vault.t(I18N_KEYS.CommonSave)}
            </Button>
          </form>
        {:else}
          <span class="flex min-w-0 items-center gap-1.5">
            <h2
              class="truncate text-lg font-semibold tracking-tight text-foreground"
            >
              {label}
            </h2>
            {#if open}
              <button
                type="button"
                class="grid size-7 flex-none place-items-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label={vault.t(I18N_KEYS.CommonRename)}
                title={vault.t(I18N_KEYS.CommonRename)}
                data-testid="vault-panel-rename"
                disabled={busy}
                onclick={beginRename}
              >
                <PencilLine class="size-3.5" aria-hidden="true" />
              </button>
            {/if}
          </span>
        {/if}
        <span class="truncate font-mono text-[11px] text-muted-foreground">
          {row.storeId}
        </span>
      </span>
    </span>
    <span class="flex flex-none items-center gap-2">
      <StatusTag
        tone={open ? StatusTone.Success : StatusTone.Neutral}
        label={open
          ? vault.t(I18N_KEYS.WorkspaceVaultOpen)
          : vault.t(I18N_KEYS.WorkspaceStatusLocked)}
      />
      <button
        type="button"
        class="grid size-8 place-items-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label={vault.t(I18N_KEYS.IdentityOverviewClosePanel)}
        title={vault.t(I18N_KEYS.IdentityOverviewClosePanel)}
        data-testid="vault-panel-close"
        onclick={onClose}
      >
        <X class="size-4" aria-hidden="true" />
      </button>
    </span>
  </header>

  {#if open}
    <Button
      type="button"
      class="h-11 w-full max-w-md"
      data-testid="vault-panel-open"
      disabled={busy}
      onclick={onOpen}
    >
      <FolderOpen class="size-4" />
      {vault.t(I18N_KEYS.WorkspaceVaultPanelOpen)}
    </Button>
  {:else if reachable}
    <section class="grid w-full max-w-md gap-4" data-testid="vault-panel-key">
      {#if dormant}
        <p class="text-sm text-pretty text-muted-foreground">{dormantHint}</p>
        <Button
          type="button"
          variant="outline"
          class="h-11 w-full"
          data-testid="vault-panel-use-identity"
          disabled={busy}
          onclick={onUseIdentity}
        >
          <UserRoundCheck class="size-4" />
          {vault.t(I18N_KEYS.WorkspaceUseIdentity)}
        </Button>
      {:else}
        <Button
          type="button"
          class="h-11 w-full"
          data-testid="vault-panel-unlock"
          disabled={busy}
          onclick={onUnlock}
        >
          <Fingerprint class="size-4" />
          {unlockLabel}
        </Button>
      {/if}
      {#if passphraseOffered}
        <div
          class="flex items-center gap-3 text-xs text-muted-foreground"
          aria-hidden="true"
        >
          <span class="h-px flex-1 bg-border"></span>
          {vault.t(I18N_KEYS.WorkspaceVaultPanelOrPassphrase)}
          <span class="h-px flex-1 bg-border"></span>
        </div>
        <div data-testid="vault-panel-passphrase">
          {#if passphrase}
            {@render passphrase()}
          {:else}
            <p
              class="flex items-center gap-2 text-sm text-muted-foreground"
              role="status"
            >
              <RefreshCw class="size-3.5 animate-spin" aria-hidden="true" />
              {vault.t(I18N_KEYS.WorkspaceVaultPanelReading)}
            </p>
          {/if}
        </div>
      {/if}
    </section>
  {/if}

  {#if reachable}
    <section class="grid gap-3 border-t border-border pt-5">
      <header class="flex items-baseline justify-between gap-3">
        <h3
          class="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground"
        >
          {vault.t(I18N_KEYS.WorkspaceVaultPanelManage)}
        </h3>
        {#if !open}
          <span class="text-xs text-muted-foreground">
            {vault.t(I18N_KEYS.WorkspaceVaultPanelManageLocked)}
          </span>
        {/if}
      </header>
      <div class="grid gap-2 sm:grid-cols-2" data-testid="vault-panel-manage">
        {#each manageItems as item (item.section)}
          <button
            type="button"
            class="nk-identity-menu-item border border-border disabled:cursor-default disabled:opacity-45"
            data-testid={item.testId}
            disabled={busy || !open}
            onclick={() => onManage(item.section)}
          >
            <span class="nk-vault-icon" aria-hidden="true">
              {#if item.section === WorkspaceSection.Passwords}
                <ShieldCheck class="size-4" />
              {:else}
                <Download class="size-4" />
              {/if}
            </span>
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-sm font-medium text-foreground"
                >{item.title}</span
              >
              <span class="truncate text-xs text-muted-foreground"
                >{item.hint}</span
              >
            </span>
            {#if open}
              <ChevronRight
                class="size-4 flex-none text-muted-foreground opacity-60"
                aria-hidden="true"
              />
            {:else}
              <Lock
                class="size-3.5 flex-none text-muted-foreground"
                aria-hidden="true"
              />
            {/if}
          </button>
        {/each}
      </div>
    </section>
  {/if}
</div>
