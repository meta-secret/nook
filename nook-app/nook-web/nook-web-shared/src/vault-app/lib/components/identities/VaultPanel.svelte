<!--
One vault, opened beside its identity's card from the vault's row. Locked,
it unlocks with this device's passkey or PIN, or with the vault's own
passphrase. Open, it offers to go in. Below, what belongs to this vault
alone (its name, passphrases, imports, the browser extension), usable
once it is open.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import {
    ArrowRight,
    ChevronRight,
    Download,
    Fingerprint,
    FolderKey,
    FolderOpen,
    Lock,
    PencilLine,
    RefreshCw,
    ShieldCheck,
    Trash2,
    UserRoundCheck,
    X,
  } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import { StatusTag, StatusTone } from '$lib/components/ui/status-tag'
  import type { VaultState } from '$lib/vault.svelte'
  import { WorkspaceSection } from '$lib/vault/state/ui.svelte'
  import DeviceRecoveryAction from '$lib/components/DeviceRecoveryAction.svelte'
  import {
    DeviceRecoveryKind,
    DeviceRecoveryOffer,
    type DeviceRecoveryRequest,
  } from '$lib/components/device-recovery'
  import {
    IdentityVaultRowState,
    type IdentityVaultRow,
  } from './identity-card-model'

  let {
    vault,
    row,
    identityName,
    unlockLabel,
    identityOpen = false,
    busy = false,
    passphrase,
    passphraseOffered = false,
    extension,
    onOpen,
    onUnlock,
    onUseIdentity,
    onManage,
    onDelete,
    onClose,
  }: {
    vault: VaultState
    row: IdentityVaultRow
    identityName: string
    /** "Unlock with passkey" or "Unlock with PIN", as this device signs in. */
    unlockLabel: string
    /** The identity is unlocked: its vault opens as the panel opens, with no
     * key asked for, so the panel offers the vault's own actions. */
    identityOpen?: boolean
    busy?: boolean
    /** The vault's passphrase unlock, once its passphrases are read. */
    passphrase?: Snippet
    /** Unlocking with a passphrase applies here (a locked browser). */
    passphraseOffered?: boolean
    /** The browser extension for this vault, offered while it is open. */
    extension?: Snippet
    /** Go into the open vault. */
    onOpen: () => void
    /** Unlock with this device's key and stay here: the panel then offers
     * Open vault and the vault's own pages. */
    onUnlock: () => void
    /** The vault belongs to an identity not in use here. */
    onUseIdentity: () => void
    /** One of this open vault's pages. */
    onManage: (section: WorkspaceSection) => void
    /** Delete a vault this browser does not hold from the identity everywhere;
     * offered only while the identity is unlocked. */
    onDelete?: () => Promise<void>
    onClose: () => void
  } = $props()

  const label = $derived(row.label || vault.t(I18N_KEYS.WorkspaceVaultFallback))
  const open = $derived(row.state === IdentityVaultRowState.Open)
  const dormant = $derived(row.state === IdentityVaultRowState.Dormant)
  const reachable = $derived(row.state !== IdentityVaultRowState.Unavailable)
  /** Access to the vault is being set up: its key is read and the vault
   * decrypted with it, which takes a few seconds for a large vault. */
  const gettingAccess = $derived(
    !open && reachable && !dormant && vault.isVerifying,
  )
  /** Why the last unlock did not finish (a cancelled passkey, a wrong PIN),
   * beside the button that retries it. */
  const unlockError = $derived(
    !open && reachable && !dormant ? vault.errorMsg : '',
  )
  /** When this browser's key cannot be unlocked, resetting it is offered
   * here, where the unlock failed. */
  const recovery = $derived.by(() => {
    if (open || !reachable || dormant) return DeviceRecoveryKind.None
    const request: DeviceRecoveryRequest = {
      status: vault.deviceProtectionStatus,
      unlockFailed: Boolean(unlockError),
    }
    return new DeviceRecoveryOffer(request).kind
  })

  /** Deleting a vault this browser does not hold, confirmed by its name. */
  let confirmingDelete = $state(false)
  let deleteName = $state('')
  let deleting = $state(false)

  async function deleteEverywhere(): Promise<void> {
    if (!onDelete) return
    deleting = true
    await onDelete()
    deleting = false
  }

  const deleteConfirmText = $derived.by(() => {
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.VaultAdminDeleteConfirm,
      replacements: { vault: label },
    }
    return vault.t(request)
  })

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

  /** Passphrases named before "+N more". */
  const PASSPHRASE_NAMES = 2

  /** The open vault is the session's vault, so its passphrases are the
   * ones the session holds; they change as the Passphrases page edits them. */
  const passphrasesHint = $derived.by(() => {
    if (!open) return vault.t(I18N_KEYS.WorkspaceVaultPanelPassphrasesHint)
    const names = vault.passwordEntries.map((entry) => entry.label)
    if (names.length === 0)
      return vault.t(I18N_KEYS.WorkspaceVaultPanelPassphrasesNone)
    const shown = names.slice(0, PASSPHRASE_NAMES).join(', ')
    if (names.length <= PASSPHRASE_NAMES) return shown
    const moreRequest: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.IdentityOverviewMore,
      replacements: { count: String(names.length - PASSPHRASE_NAMES) },
    }
    return `${shown} ${vault.t(moreRequest)}`
  })

  type ManageItem = {
    readonly section: WorkspaceSection
    readonly testId: string
    readonly title: string
    readonly hint: string
    /** How many the item holds, beside its title; empty shows none. */
    readonly count: string
  }
  const manageItems = $derived.by((): ManageItem[] => [
    {
      section: WorkspaceSection.Passwords,
      testId: 'vault-panel-passphrases',
      title: vault.t(I18N_KEYS.WorkspaceSectionPasswords),
      hint: passphrasesHint,
      count: open ? String(vault.passwordEntries.length) : '',
    },
    {
      section: WorkspaceSection.Import,
      testId: 'vault-panel-import',
      title: vault.t(I18N_KEYS.WorkspaceSectionImport),
      hint: vault.t(I18N_KEYS.WorkspaceVaultPanelImportHint),
      count: '',
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
        {#if label !== row.storeId}
          <span class="truncate font-mono text-[11px] text-muted-foreground">
            {row.storeId}
          </span>
        {/if}
      </span>
    </span>
    <span class="flex flex-none items-center gap-2">
      <StatusTag
        tone={open ? StatusTone.Success : StatusTone.Neutral}
        label={open
          ? vault.t(I18N_KEYS.WorkspaceVaultOpen)
          : gettingAccess
            ? vault.t(I18N_KEYS.WorkspaceVaultGettingAccess)
            : reachable
            ? vault.t(I18N_KEYS.WorkspaceStatusLocked)
            : vault.t(I18N_KEYS.WorkspaceVaultUnavailable)}
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
    <!-- Going in reads as the vault's lead row, in the same language as
         its pages below, rather than a bare button. -->
    <button
      type="button"
      class="nk-identity-menu-item nk-plate nk-identity-menu-lead group w-full max-w-md py-3"
      data-testid="vault-panel-open"
      disabled={busy}
      onclick={onOpen}
    >
      <span class="nk-vault-icon size-10" aria-hidden="true">
        <FolderOpen class="size-4" />
      </span>
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="truncate text-[0.9375rem] font-medium text-foreground"
          >{vault.t(I18N_KEYS.WorkspaceVaultPanelOpen)}</span
        >
        <span class="truncate text-xs text-muted-foreground"
          >{vault.t(I18N_KEYS.WorkspaceVaultPanelOpenHint)}</span
        >
      </span>
      <ArrowRight
        class="size-4 flex-none text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </button>
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
        <!-- An unlocked identity opens its vault as the panel opens, with no
             prompt; only a locked one asks for its key here. -->
        {#if !identityOpen}
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
        {#if gettingAccess}
          <div
            class="grid gap-2"
            role="status"
            aria-live="polite"
            data-testid="vault-panel-getting-access"
          >
            <p class="flex items-center gap-2 text-sm text-foreground">
              <RefreshCw
                class="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none"
                aria-hidden="true"
              />
              {vault.t(I18N_KEYS.WorkspaceVaultPanelGettingAccess)}
            </p>
            <span class="nk-progress-sweep" aria-hidden="true"></span>
            <p class="text-xs text-pretty text-muted-foreground">
              {vault.t(I18N_KEYS.WorkspaceVaultPanelGettingAccessHint)}
            </p>
          </div>
        {/if}
        {#if unlockError}
          <p
            class="text-sm text-pretty text-destructive"
            role="alert"
            data-testid="vault-panel-unlock-error"
          >
            {unlockError}
          </p>
        {/if}
        {#if recovery !== DeviceRecoveryKind.None}
          <DeviceRecoveryAction
            {vault}
            kind={recovery}
            recoveryAppId={vault.deviceId}
          />
        {/if}
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
  {:else}
    <section class="grid w-full max-w-md gap-4" data-testid="vault-panel-away">
      <p class="text-sm text-pretty text-muted-foreground">
        {vault.t(I18N_KEYS.WorkspaceVaultPanelAway)}
      </p>
      {#if onDelete}
        {#if confirmingDelete}
          <div
            class="nk-banner grid gap-3 border-l-destructive bg-destructive/5 p-4"
            data-testid="vault-panel-delete-confirmation"
          >
            <p class="text-sm text-pretty text-foreground">
              {deleteConfirmText}
            </p>
            <input
              class="h-10 w-full border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-foreground/50"
              aria-label={vault.t(I18N_KEYS.VaultAdminDeleteName)}
              placeholder={label}
              data-testid="vault-panel-delete-name"
              disabled={deleting}
              bind:value={deleteName}
            />
            <div class="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                data-testid="vault-panel-delete-confirm"
                disabled={busy || deleting || deleteName.trim() !== label}
                onclick={() => void deleteEverywhere()}
              >
                <Trash2 class="size-3.5" />
                {vault.t(I18N_KEYS.VaultAdminDeleteConfirmButton)}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="vault-panel-delete-cancel"
                disabled={deleting}
                onclick={() => {
                  confirmingDelete = false
                  deleteName = ''
                }}
              >
                {vault.t(I18N_KEYS.CommonCancel)}
              </Button>
            </div>
          </div>
        {:else}
          <Button
            type="button"
            variant="outline"
            class="h-11 w-full text-destructive hover:text-destructive"
            data-testid="vault-panel-delete"
            disabled={busy}
            onclick={() => (confirmingDelete = true)}
          >
            <Trash2 class="size-4" />
            {vault.t(I18N_KEYS.VaultAdminDelete)}
          </Button>
        {/if}
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
            {gettingAccess
              ? vault.t(I18N_KEYS.WorkspaceVaultPanelManageSoon)
              : vault.t(I18N_KEYS.WorkspaceVaultPanelManageLocked)}
          </span>
        {/if}
      </header>
      <div class="grid gap-2 sm:grid-cols-2" data-testid="vault-panel-manage">
        {#each manageItems as item (item.section)}
          <button
            type="button"
            class="nk-identity-menu-item nk-plate disabled:cursor-default disabled:opacity-45"
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
              <span class="flex min-w-0 items-baseline gap-2">
                <span class="truncate text-sm font-medium text-foreground"
                  >{item.title}</span
                >
                {#if item.count}
                  <span
                    class="font-mono text-[11px] text-muted-foreground"
                    data-testid="{item.testId}-count">{item.count}</span
                  >
                {/if}
              </span>
              <span
                class="truncate text-xs text-muted-foreground"
                data-testid="{item.testId}-hint">{item.hint}</span
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
        {#if open && extension}
          {@render extension()}
        {/if}
      </div>
    </section>
  {/if}
</div>
