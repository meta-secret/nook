<!--
The accounts authorized on a shared provider target: the Drive vault
folder's permissions or the iCloud share's participants. Drive accounts are
added and removed here; iCloud participants are managed in Apple's sharing
sheet. With `selectable`, one account with write access is picked for a
device invite.
-->
<script lang="ts" module>
  import type { AuthorizedAccountList as PanelAccountList } from '$app-wasm'
  import type { AuthorizedAccountsAccess as PanelAccess } from '$lib/vault/authorized-accounts'

  enum PanelStateKind {
    Loading = 'loading',
    Ready = 'ready',
    Failed = 'failed',
  }

  type PanelState =
    | { kind: PanelStateKind.Loading }
    | {
        kind: PanelStateKind.Ready
        access: PanelAccess
        accounts: PanelAccountList
      }
    | { kind: PanelStateKind.Failed; message: string }
</script>

<script lang="ts">
  import { untrack } from 'svelte'
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { RefreshCw, UserMinus, UserPlus, Users } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import type { AuthorizedAccount, AuthorizedAccountList } from '$app-wasm'
  import type { OAuthFileConfig } from '$lib/auth/providers'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    AuthorizedAccountsSource,
    authorizedAccountsClient,
    type AuthorizedAccountsAccess,
    type AuthorizedAccountsFailure,
  } from '$lib/vault/authorized-accounts'
  import type { Result } from 'neverthrow'

  let {
    vault,
    config,
    shareTitle,
    selectable = false,
    selectedEmail = $bindable(''),
    disabled = false,
  }: {
    vault: VaultState
    /** The saved provider whose shared target lists the accounts. */
    config: OAuthFileConfig
    /** Title Apple's sharing sheet shows for the iCloud share. */
    shareTitle: string
    /** Pick one account with write access for a device invite. */
    selectable?: boolean
    selectedEmail?: string
    disabled?: boolean
  } = $props()

  let panel = $state<PanelState>({ kind: PanelStateKind.Loading })
  let newEmail = $state('')
  let busy = $state(false)
  let actionError = $state('')

  const isICloud = $derived(config.preset === 'icloud')
  const accounts = $derived(
    panel.kind === PanelStateKind.Ready ? panel.accounts.accounts : [],
  )

  function invitable(account: AuthorizedAccount): boolean {
    if (panel.kind !== PanelStateKind.Ready) return false
    const choice: Parameters<typeof authorizedAccountsClient.inviteAccount>[0] =
      { accounts: panel.accounts, email: account.email }
    return authorizedAccountsClient.inviteAccount(choice).isOk()
  }

  function roleLabel(account: AuthorizedAccount): string {
    switch (account.role) {
      case 'owner':
        return vault.t(I18N_KEYS.AuthorizedAccountsRoleOwner)
      case 'writer':
        return vault.t(I18N_KEYS.AuthorizedAccountsRoleWriter)
      case 'reader':
        return vault.t(I18N_KEYS.AuthorizedAccountsRoleReader)
    }
  }

  function removeLabel(account: AuthorizedAccount): string {
    const removeArgs: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.AuthorizedAccountsRemove,
      replacements: { email: account.email },
    }
    return vault.t(removeArgs)
  }

  /** Keep the picked account only while the refreshed list still allows it. */
  function settle(
    result: Result<AuthorizedAccountList, AuthorizedAccountsFailure>,
    access: AuthorizedAccountsAccess,
  ) {
    if (result.isErr()) {
      actionError = vault.t(result.error.translationKey)
      return
    }
    panel = { kind: PanelStateKind.Ready, access, accounts: result.value }
    if (!selectable) return
    const choice: Parameters<typeof authorizedAccountsClient.inviteAccount>[0] =
      { accounts: result.value, email: selectedEmail }
    const kept = selectedEmail.trim()
      ? authorizedAccountsClient.inviteAccount(choice)
      : false
    selectedEmail = kept && kept.isOk() ? kept.value : ''
  }

  async function load() {
    panel = { kind: PanelStateKind.Loading }
    actionError = ''
    const access = await authorizedAccountsClient.access(config)
    if (access.isErr()) {
      panel = {
        kind: PanelStateKind.Failed,
        message: vault.t(access.error.translationKey),
      }
      return
    }
    const listed = await authorizedAccountsClient.list(access.value)
    if (listed.isErr()) {
      panel = {
        kind: PanelStateKind.Failed,
        message: vault.t(listed.error.translationKey),
      }
      return
    }
    settle(listed, access.value)
  }

  async function addAccount() {
    if (panel.kind !== PanelStateKind.Ready || busy) return
    const access = panel.access
    busy = true
    actionError = ''
    try {
      const change: Parameters<typeof authorizedAccountsClient.add>[0] = {
        access,
        email: newEmail,
      }
      const added = await authorizedAccountsClient.add(change)
      settle(added, access)
      if (added.isOk()) newEmail = ''
    } finally {
      busy = false
    }
  }

  async function removeAccount(account: AuthorizedAccount) {
    if (panel.kind !== PanelStateKind.Ready || busy) return
    const access = panel.access
    busy = true
    actionError = ''
    try {
      const change: Parameters<typeof authorizedAccountsClient.remove>[0] = {
        access,
        email: account.email,
      }
      settle(await authorizedAccountsClient.remove(change), access)
    } finally {
      busy = false
    }
  }

  async function manageICloud() {
    if (panel.kind !== PanelStateKind.Ready || busy) return
    const access = panel.access
    if (access.source !== AuthorizedAccountsSource.ICloud) return
    busy = true
    actionError = ''
    try {
      const request: Parameters<typeof authorizedAccountsClient.manageICloud>[0] =
        { target: access.target, title: shareTitle }
      settle(await authorizedAccountsClient.manageICloud(request), access)
    } finally {
      busy = false
    }
  }

  function pick(account: AuthorizedAccount) {
    if (panel.kind !== PanelStateKind.Ready) return
    const choice: Parameters<typeof authorizedAccountsClient.inviteAccount>[0] =
      { accounts: panel.accounts, email: account.email }
    const picked = authorizedAccountsClient.inviteAccount(choice)
    if (picked.isErr()) {
      actionError = vault.t(picked.error.translationKey)
      return
    }
    actionError = ''
    selectedEmail = picked.value
  }

  $effect(() => {
    void config
    untrack(() => void load())
  })
</script>

<section class="grid gap-3" data-testid="authorized-accounts">
  <header class="flex items-start gap-3">
    <Users class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
    <div class="min-w-0 flex-1">
      <p class="nk-label">{vault.t(I18N_KEYS.AuthorizedAccountsTitle)}</p>
      <p class="mt-1 text-xs text-pretty text-muted-foreground">
        {vault.t(
          selectable
            ? I18N_KEYS.AuthorizedAccountsPickDescription
            : isICloud
              ? I18N_KEYS.AuthorizedAccountsIcloudDescription
              : I18N_KEYS.AuthorizedAccountsDriveDescription,
        )}
      </p>
    </div>
    <button
      type="button"
      class="grid size-8 shrink-0 place-items-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
      disabled={busy || disabled || panel.kind === PanelStateKind.Loading}
      aria-label={vault.t(I18N_KEYS.AuthorizedAccountsRefresh)}
      title={vault.t(I18N_KEYS.AuthorizedAccountsRefresh)}
      data-testid="authorized-accounts-refresh"
      onclick={() => void load()}
    >
      <RefreshCw
        class="size-4 {panel.kind === PanelStateKind.Loading
          ? 'animate-spin'
          : ''}"
      />
    </button>
  </header>

  {#if panel.kind === PanelStateKind.Loading}
    <p class="text-xs text-muted-foreground" data-testid="authorized-accounts-loading">
      {vault.t(I18N_KEYS.AuthorizedAccountsLoading)}
    </p>
  {:else if panel.kind === PanelStateKind.Failed}
    <p class="text-xs text-destructive" data-testid="authorized-accounts-error">
      {panel.message}
    </p>
  {:else}
    {#if accounts.length === 0}
      <p class="text-xs text-muted-foreground" data-testid="authorized-accounts-empty">
        {vault.t(I18N_KEYS.AuthorizedAccountsEmpty)}
      </p>
    {:else}
      <ul
        class="grid divide-y divide-border border border-border"
        role={selectable ? 'radiogroup' : 'list'}
        aria-label={vault.t(I18N_KEYS.AuthorizedAccountsTitle)}
        data-testid="authorized-accounts-list"
      >
        {#each accounts as account (account.accessId)}
          {@const canPick = selectable && invitable(account)}
          {@const selected =
            canPick && selectedEmail.toLowerCase() === account.email.toLowerCase()}
          <li class="flex items-center gap-3 px-3 py-2.5 text-sm">
            {#if selectable}
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                class="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-50"
                disabled={!canPick || busy || disabled}
                data-testid="authorized-account-pick-{account.email}"
                onclick={() => pick(account)}
              >
                <span
                  class="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border-2 {selected
                    ? 'border-foreground'
                    : 'border-muted-foreground/35'}"
                  aria-hidden="true"
                >
                  {#if selected}
                    <span class="size-2 rounded-full bg-foreground"></span>
                  {/if}
                </span>
                <span class="min-w-0 flex-1 truncate text-foreground">{account.email}</span>
              </button>
            {:else}
              <span
                class="min-w-0 flex-1 truncate text-foreground"
                data-testid="authorized-account-{account.email}">{account.email}</span
              >
            {/if}
            <span class="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
              {account.status === 'invited'
                ? vault.t(I18N_KEYS.AuthorizedAccountsStatusInvited)
                : roleLabel(account)}
            </span>
            {#if !isICloud && account.role !== 'owner'}
              <button
                type="button"
                class="grid size-7 shrink-0 place-items-center text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                disabled={busy || disabled}
                aria-label={removeLabel(account)}
                title={removeLabel(account)}
                data-testid="authorized-account-remove-{account.email}"
                onclick={() => void removeAccount(account)}
              >
                <UserMinus class="size-4" />
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if isICloud}
      <Button
        type="button"
        size="sm"
        variant="outline"
        class="justify-self-start"
        disabled={busy || disabled}
        data-testid="authorized-accounts-manage-icloud"
        onclick={() => void manageICloud()}
      >
        <UserPlus class="size-4" />
        {vault.t(I18N_KEYS.AuthorizedAccountsManageIcloud)}
      </Button>
    {:else}
      <form
        class="grid gap-1.5"
        onsubmit={(event) => {
          event.preventDefault()
          void addAccount()
        }}
      >
        <label class="text-xs font-medium text-foreground" for="authorized-account-email">
          {vault.t(I18N_KEYS.AuthorizedAccountsAddLabel)}
        </label>
        <div class="flex gap-2">
          <input
            id="authorized-account-email"
            type="email"
            bind:value={newEmail}
            autocomplete="email"
            disabled={busy || disabled}
            placeholder={vault.t(I18N_KEYS.AuthorizedAccountsAddPlaceholder)}
            data-testid="authorized-account-email-input"
            class="flex h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-hidden focus:ring-2 focus:ring-ring"
          />
          <Button
            type="submit"
            size="sm"
            class="h-9"
            disabled={busy || disabled || !newEmail.trim()}
            data-testid="authorized-account-add-btn"
          >
            {#if busy}
              <RefreshCw class="size-4 animate-spin" />
              {vault.t(I18N_KEYS.AuthorizedAccountsAdding)}
            {:else}
              <UserPlus class="size-4" />
              {vault.t(I18N_KEYS.AuthorizedAccountsAdd)}
            {/if}
          </Button>
        </div>
      </form>
    {/if}

    {#if actionError}
      <p class="text-xs text-destructive" data-testid="authorized-accounts-action-error">
        {actionError}
      </p>
    {/if}
  {/if}
</section>
