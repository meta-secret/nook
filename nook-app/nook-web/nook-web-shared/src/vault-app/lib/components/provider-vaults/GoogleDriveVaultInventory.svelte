<!--
What the signed-in Google account's Nook folder already holds, shown in
Connect & sync before anything is written, grouped by identity. Passkeys
belong to identities, so recovering and joining are choices on the identity:
recovering one of its vaults with its passkey opens the identity and its
other vaults sync through it; an identity nothing here opens offers to find
its passkey or to ask to join. Only what opens a single vault (a backup
password, a granted key, merging into or replacing the open vault) is a
choice on that vault. Connect & sync itself only adds this identity's vaults
beside these. The step has one action button that runs the chosen choice,
so two actions are never live at once.
-->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte'
  import { KeyRound, RefreshCw, UserPlus } from '@lucide/svelte'
  import type {
    CredentialCheckReport,
    EmptyVaultReplacement,
    ProviderVaultAction,
    ProviderVaultSummary,
  } from '$app-wasm'
  import { I18N_KEYS, type I18nKey } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import ProviderVaultList from '$lib/components/provider-vaults/ProviderVaultList.svelte'
  import {
    identityLocked,
    IdentityStandingKind,
    IdentityStandings,
    type IdentityStanding,
    type ProviderIdentityGroup,
  } from '$lib/components/provider-vaults/provider-identity-groups'
  import type { VaultState } from '$lib/vault.svelte'
  import { VaultOAuthActions } from '$lib/vault/oauth'
  import {
    AccessCheckActions,
    AccessCheckTargetKind,
    type AccessCheckTarget,
    type BackupPasswordCheckRequest,
  } from '$lib/vault/access-check'
  import {
    ProviderVaultAccessActions,
    ProviderVaultActions,
    ProviderVaultOpeningKind,
    type EmptyVaultSwap,
    type GoogleDriveVaultTarget,
    type ProviderVaultMerge,
    type ProviderVaultOpening,
  } from '$lib/vault/provider-vaults'
  import {
    DriveVaultChoiceKind,
    DriveVaultInventoryKind,
    EmptyVaultConfirmationKind,
    MergeConfirmationKind,
    type DriveVaultChoice,
    type DriveVaultInventory,
    type EmptyVaultConfirmation,
    type EmptyVaultConfirmationRequest,
    type MergeConfirmation,
  } from '$lib/components/provider-vaults/drive-vault-inventory'

  let {
    vault,
    accessToken,
    busy,
    onImport,
    onReplace,
    connectButton,
  }: {
    vault: VaultState
    /** The signed-in account's token; a new sign-in lists again. */
    accessToken: string
    busy: boolean
    onImport: (storeId: string) => void | Promise<void>
    onReplace: (swap: EmptyVaultSwap) => void | Promise<void>
    /** The step's Connect & sync button, shown while that is the choice;
     * true holds it disabled while the listing loads or an action runs. */
    connectButton: Snippet<[boolean]>
  } = $props()

  let choice = $state<DriveVaultChoice>({ kind: DriveVaultChoiceKind.Connect })

  let inventory = $state<DriveVaultInventory>({
    kind: DriveVaultInventoryKind.Loading,
  })
  let replacement = $state<EmptyVaultConfirmation>({
    kind: EmptyVaultConfirmationKind.Closed,
  })
  let merge = $state<MergeConfirmation>({ kind: MergeConfirmationKind.Closed })
  let mergePassword = $state('')
  // Passkey checks of this listing, newest last; they live with the page.
  let checks = $state<CredentialCheckReport[]>([])
  let checking = $state(false)
  // The backup password form is open; it holds the step's other buttons.
  let passwordCheckOpen = $state(false)
  let checkedPassword = $state('')
  // Identities whose join needs a code from one of their devices.
  let joinHelp = $state<string[]>([])
  let working = $state(false)
  const disabled = $derived(busy || working)
  /** A replace or merge confirmation, or the backup password form, carries
   * its own confirm button. */
  const confirming = $derived(
    replacement.kind === EmptyVaultConfirmationKind.Confirming ||
      merge.kind === MergeConfirmationKind.Confirming ||
      passwordCheckOpen,
  )

  const standings = $derived(new IdentityStandings(checks))

  /** The chosen row action as `<store id>/<action>`; empty for Connect & sync. */
  const chosenOption = $derived(
    choice.kind === DriveVaultChoiceKind.VaultAction
      ? `${choice.summary.storeId}/${choice.action}`
      : '',
  )

  async function load(token: string): Promise<void> {
    inventory = { kind: DriveVaultInventoryKind.Loading }
    choice = { kind: DriveVaultChoiceKind.Connect }
    replacement = { kind: EmptyVaultConfirmationKind.Closed }
    merge = { kind: MergeConfirmationKind.Closed }
    checks = []
    const listed = await new VaultOAuthActions(vault).listGoogleDriveVaults(
      new ProviderVaultActions(vault).localVaultOccupancy(),
    )
    if (token !== accessToken) return
    if (listed.isErr()) {
      inventory = { kind: DriveVaultInventoryKind.Failed }
      vault.errorMsg = vault.t(listed.error.translationKey)
      return
    }
    inventory = { kind: DriveVaultInventoryKind.Loaded, listing: listed.value }
  }

  $effect(() => {
    const token = accessToken
    // Only a new sign-in lists again, not the state the listing reads.
    untrack(() => void load(token))
  })

  /** One passkey tap checks which listed vaults it opens, by decrypting
   * them; the names it opens show for this page only. */
  async function checkPasskey(): Promise<void> {
    checking = true
    try {
      const checked = await new AccessCheckActions(vault).checkPasskey(
        driveTarget(),
      )
      if (checked.isErr()) {
        vault.errorMsg = vault.t(checked.error.translationKey)
        return
      }
      checks = [...checks, checked.value]
    } finally {
      checking = false
    }
  }

  function driveTarget(): AccessCheckTarget {
    return {
      kind: AccessCheckTargetKind.Source,
      source: { kind: 'googleDrive', accessToken },
    }
  }

  /** Check which listed vaults a typed backup password opens. */
  async function checkBackupPassword(): Promise<void> {
    checking = true
    try {
      const request: BackupPasswordCheckRequest = {
        target: driveTarget(),
        password: checkedPassword,
      }
      const checked = await new AccessCheckActions(vault).checkBackupPassword(
        request,
      )
      checkedPassword = ''
      if (checked.isErr()) {
        vault.errorMsg = vault.t(checked.error.translationKey)
        return
      }
      checks = [...checks, checked.value]
      passwordCheckOpen = false
    } finally {
      checking = false
    }
  }

  /** Ask an identity this browser cannot open to let it in: a browser
   * already in another identity sends each vault's join request to its
   * devices; a browser with no identity needs a join code from one of them. */
  async function askToJoin(group: ProviderIdentityGroup): Promise<void> {
    const requestable = group.vaults.filter((summary) =>
      summary.actions.includes('requestAccess'),
    )
    if (requestable.length === 0) {
      joinHelp = [...joinHelp, group.identity.identityId]
      return
    }
    for (const summary of requestable) await requestAccess(summary.storeId)
    vault.successMsg = vault.t(I18N_KEYS.AccessCheckJoinRequested)
  }

  /** One action offered on one vault's row. */
  type RowAction = {
    action: ProviderVaultAction
    summary: ProviderVaultSummary
  }

  /** A row's action label; importing a vault a checked passkey or backup
   * password opens is recovering it with that check. */
  function rowActionLabel({ action, summary }: RowAction): string {
    switch (action) {
      case 'importSeparately': {
        if (standings.opensWithBackupPassword(summary.storeId))
          return vault.t(I18N_KEYS.AccessCheckRecoverWithPassword)
        if (standings.vaultActions(summary).includes(action))
          return actionLabel(action)
        const group: ProviderIdentityGroup = {
          identity: summary.identity,
          vaults: [summary],
        }
        return identityOpenLabel(standings.of(group))
      }
      case 'useInstead':
      case 'mergeIntoOpen':
      case 'requestAccess':
        return actionLabel(action)
    }
  }

  /** Choose recovering the identity through one of its vaults. */
  function chooseOpening(opening: ProviderVaultSummary): void {
    for (const action of opening.actions)
      switch (action) {
        case 'importSeparately':
          choice = {
            kind: DriveVaultChoiceKind.VaultAction,
            action,
            summary: opening,
          }
          return
        case 'useInstead':
        case 'mergeIntoOpen':
        case 'requestAccess':
          continue
      }
  }

  /** Opening an identity: with the passkey a check found, or by trying
   * the user's passkey when the recovery runs. */
  function identityOpenLabel(standing: IdentityStanding): string {
    return standing.kind === IdentityStandingKind.OpenedByPasskey
      ? vault.t(I18N_KEYS.AccessCheckRecoverWithPasskey)
      : vault.t(I18N_KEYS.ProviderVaultsRecoverIdentity)
  }

  function confirmReplacement(request: EmptyVaultConfirmationRequest): void {
    merge = { kind: MergeConfirmationKind.Closed }
    replacement = { kind: EmptyVaultConfirmationKind.Confirming, ...request }
  }

  function confirmMerge(summary: ProviderVaultSummary): void {
    replacement = { kind: EmptyVaultConfirmationKind.Closed }
    mergePassword = ''
    merge = {
      kind: MergeConfirmationKind.Confirming,
      storeId: summary.storeId,
      shortId: summary.shortId,
      needsPassword: summary.access.state === 'backupPassword',
    }
  }

  /** Translate the lines that name one vault by its short id. */
  function idText(shortId: string): (key: I18nKey) => string {
    return (key) => {
      const request: Parameters<typeof vault.t>[0] = {
        key,
        replacements: { id: shortId },
      }
      return vault.t(request)
    }
  }

  async function runMerge(): Promise<void> {
    if (merge.kind !== MergeConfirmationKind.Confirming) return
    const { storeId, shortId, needsPassword } = merge
    const opening: ProviderVaultOpening = needsPassword
      ? {
          kind: ProviderVaultOpeningKind.BackupPassword,
          password: mergePassword,
        }
      : { kind: ProviderVaultOpeningKind.GrantedKey }
    working = true
    try {
      const request: ProviderVaultMerge = { accessToken, storeId, opening }
      const merged = await new ProviderVaultAccessActions(vault).mergeIntoOpen(
        request,
      )
      if (merged.isErr()) {
        vault.errorMsg = idText(shortId)(I18N_KEYS.ProviderVaultsMergeFailed)
        return
      }
      merge = { kind: MergeConfirmationKind.Closed }
      mergePassword = ''
    } finally {
      working = false
    }
  }

  async function requestAccess(storeId: string): Promise<void> {
    working = true
    try {
      const target: GoogleDriveVaultTarget = { accessToken, storeId }
      const requested = await new ProviderVaultAccessActions(
        vault,
      ).requestAccess(target)
      if (requested.isErr()) {
        vault.errorMsg = vault.t(I18N_KEYS.ProviderVaultsRequestFailed)
        return
      }
      await load(accessToken)
    } finally {
      working = false
    }
  }

  /** One action button pressed on one vault's row. */
  type VaultActionPress = {
    action: ProviderVaultAction
    summary: ProviderVaultSummary
    offer: EmptyVaultReplacement
  }

  function runAction({ action, summary, offer }: VaultActionPress): void {
    switch (action) {
      case 'useInstead': {
        if (offer.state !== 'offered') return
        const request: EmptyVaultConfirmationRequest = {
          swap: {
            emptyStoreId: offer.emptyStoreId,
            replacementStoreId: summary.storeId,
          },
          shortId: summary.shortId,
        }
        confirmReplacement(request)
        return
      }
      case 'mergeIntoOpen':
        confirmMerge(summary)
        return
      case 'importSeparately':
        void onImport(summary.storeId)
        return
      case 'requestAccess':
        void requestAccess(summary.storeId)
        return
    }
  }

  function actionTestId(action: ProviderVaultAction): string {
    switch (action) {
      case 'useInstead':
        return 'provider-vault-use-instead'
      case 'mergeIntoOpen':
        return 'provider-vault-merge'
      case 'importSeparately':
        return 'provider-vault-import'
      case 'requestAccess':
        return 'provider-vault-request-access'
    }
  }

  function actionLabel(action: ProviderVaultAction): string {
    switch (action) {
      case 'useInstead':
        return vault.t(I18N_KEYS.ProviderVaultsUseInstead)
      case 'mergeIntoOpen':
        return vault.t(I18N_KEYS.ProviderVaultsMergeIntoOpen)
      case 'importSeparately':
        return vault.t(I18N_KEYS.ProviderVaultsImportSeparately)
      case 'requestAccess':
        return vault.t(I18N_KEYS.ProviderVaultsRequestAccess)
    }
  }
</script>

{#if inventory.kind === DriveVaultInventoryKind.Loading}
  <p
    class="flex items-center gap-2 text-[11px] text-muted-foreground"
    role="status"
    data-testid="google-drive-vaults-loading"
  >
    <RefreshCw class="size-3.5 animate-spin" aria-hidden="true" />
    {vault.t(I18N_KEYS.ProviderVaultsLoading)}
  </p>
{:else if inventory.kind === DriveVaultInventoryKind.Loaded && inventory.listing.root === 'absent'}
  <p
    class="text-[11px] text-pretty text-muted-foreground"
    data-testid="google-folder-on-connect"
  >
    {vault.t(I18N_KEYS.ProviderVaultsRootAbsent)}
  </p>
{:else if inventory.kind === DriveVaultInventoryKind.Loaded && inventory.listing.root === 'found'}
  {@const listing = inventory.listing.listing}
  {#if listing.vaults.length === 0}
    <p
      class="text-[11px] text-pretty text-muted-foreground"
      data-testid="google-drive-vaults-empty"
    >
      {vault.t(I18N_KEYS.ProviderVaultsRootEmpty)}
    </p>
  {:else}
    <div class="space-y-2" data-testid="google-drive-vaults">
      <p class="nk-subpanel-head">
        {vault.t(I18N_KEYS.ProviderVaultsListTitle)}
      </p>
      <!-- A backup password opens single vaults, not an identity; checking
           one commits nothing. -->
      <div class="flex flex-wrap gap-x-4 gap-y-1">
        <button
          type="button"
          class="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-60"
          data-testid="provider-vault-check-password"
          disabled={disabled || checking || passwordCheckOpen}
          onclick={() => (passwordCheckOpen = true)}
        >
          {vault.t(I18N_KEYS.AccessCheckCheckBackupPassword)}
        </button>
      </div>
      {#if passwordCheckOpen}
        <form
          class="nk-banner space-y-2 px-4 py-3"
          data-testid="provider-vault-password-check"
          onsubmit={(event) => {
            event.preventDefault()
            void checkBackupPassword()
          }}
        >
          <label class="grid gap-1 text-xs text-muted-foreground">
            {vault.t(I18N_KEYS.AccessCheckPasswordLabel)}
            <input
              type="password"
              autocomplete="off"
              class="h-9 border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-foreground/50"
              data-testid="provider-vault-password-check-input"
              bind:value={checkedPassword}
              disabled={checking}
            />
          </label>
          <div class="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="provider-vault-password-check-cancel"
              disabled={checking}
              onclick={() => {
                passwordCheckOpen = false
                checkedPassword = ''
              }}
            >
              {vault.t(I18N_KEYS.CommonCancel)}
            </Button>
            <Button
              type="submit"
              size="sm"
              data-testid="provider-vault-password-check-btn"
              disabled={checking || !checkedPassword}
            >
              {checking
                ? vault.t(I18N_KEYS.AccessCheckChecking)
                : vault.t(I18N_KEYS.AccessCheckCheck)}
            </Button>
          </div>
        </form>
      {/if}
      {#if checks.length > 0}
        <p
          class="text-[11px] text-pretty text-muted-foreground"
          role="status"
          data-testid="provider-vault-checks-note"
        >
          {vault.t(I18N_KEYS.AccessCheckResultsNote)}
        </p>
      {/if}
      <ProviderVaultList {vault} vaults={listing.vaults} {checks}>
        {#snippet identityActions(
          group: ProviderIdentityGroup,
          standing: IdentityStanding,
        )}
          {#each standings.openingVaults(group) as opening (opening.storeId)}
            <!-- Recovering one vault with the identity's passkey opens the
                 identity; its other vaults then sync through it. -->
            <label
              class="flex min-h-9 cursor-pointer items-center gap-2 text-sm text-foreground"
            >
              <input
                class="size-4"
                type="radio"
                name="provider-vault-choice"
                data-testid="provider-identity-open"
                data-store-id={opening.storeId}
                {disabled}
                checked={chosenOption === `${opening.storeId}/importSeparately`}
                onchange={() => chooseOpening(opening)}
              />
              {identityOpenLabel(standing)}
            </label>
          {:else}
            {#if identityLocked(standing)}
              <div class="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="provider-identity-find-passkey"
                  disabled={disabled || checking || passwordCheckOpen}
                  onclick={() => void checkPasskey()}
                >
                  {#if checking}
                    <RefreshCw class="size-4 animate-spin" aria-hidden="true" />
                    {vault.t(I18N_KEYS.AccessCheckChecking)}
                  {:else}
                    <KeyRound class="size-4" aria-hidden="true" />
                    {vault.t(I18N_KEYS.AccessCheckFindPasskey)}
                  {/if}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="provider-identity-ask-to-join"
                  disabled={disabled || checking || passwordCheckOpen}
                  onclick={() => void askToJoin(group)}
                >
                  <UserPlus class="size-4" aria-hidden="true" />
                  {vault.t(I18N_KEYS.AccessCheckAskToJoin)}
                </Button>
              </div>
            {/if}
          {/each}
          {#if standing.kind === IdentityStandingKind.Unchecked && standings.openingVaults(group).length > 0}
            <!-- Recovering tries the passkey; checking first tells which
                 passkey opens the identity, without changing anything. -->
            <button
              type="button"
              class="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-60"
              data-testid="provider-identity-find-passkey"
              disabled={disabled || checking || passwordCheckOpen}
              onclick={() => void checkPasskey()}
            >
              {checking
                ? vault.t(I18N_KEYS.AccessCheckChecking)
                : vault.t(I18N_KEYS.AccessCheckWhichPasskey)}
            </button>
          {/if}
          {#if joinHelp.includes(group.identity.identityId)}
            <p
              class="text-xs text-pretty text-muted-foreground"
              role="status"
              data-testid="provider-identity-join-help"
            >
              {vault.t(I18N_KEYS.AccessCheckJoinWithCode)}
            </p>
          {/if}
        {/snippet}
        {#snippet action(summary: ProviderVaultSummary)}
          {#each standings.vaultActions(summary) as action (action)}
            {@const rowAction: RowAction = { action, summary }}
            <label
              class="flex min-h-8 cursor-pointer items-center gap-2 text-xs text-foreground"
            >
              <input
                class="size-3.5"
                type="radio"
                name="provider-vault-choice"
                data-testid={actionTestId(action)}
                data-store-id={summary.storeId}
                {disabled}
                checked={chosenOption === `${summary.storeId}/${action}`}
                onchange={() =>
                  (choice = {
                    kind: DriveVaultChoiceKind.VaultAction,
                    action,
                    summary,
                  })}
              />
              {rowActionLabel(rowAction)}
            </label>
          {/each}
        {/snippet}
      </ProviderVaultList>
      <label
        class="flex min-h-9 cursor-pointer items-center gap-2 text-sm text-foreground"
      >
        <input
          class="size-4"
          type="radio"
          name="provider-vault-choice"
          data-testid="provider-vault-choice-connect"
          {disabled}
          checked={choice.kind === DriveVaultChoiceKind.Connect}
          onchange={() => (choice = { kind: DriveVaultChoiceKind.Connect })}
        />
        {vault.t(I18N_KEYS.ProviderVaultsChoiceConnect)}
      </label>
      {#if replacement.kind === EmptyVaultConfirmationKind.Confirming}
        {@const swap = replacement.swap}
        <div
          class="nk-banner nk-banner-warning space-y-2 px-4 py-3"
          role="group"
          aria-labelledby="provider-vault-replace-title"
          data-testid="provider-vault-replace-confirm"
        >
          <p
            id="provider-vault-replace-title"
            class="text-sm font-medium text-foreground"
          >
            {vault.t(I18N_KEYS.ProviderVaultsReplaceConfirmTitle)}
          </p>
          <p class="text-xs text-pretty text-muted-foreground">
            {idText(replacement.shortId)(
              I18N_KEYS.ProviderVaultsReplaceConfirmBody,
            )}
          </p>
          <div class="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="provider-vault-replace-cancel"
              onclick={() =>
                (replacement = { kind: EmptyVaultConfirmationKind.Closed })}
            >
              {vault.t(I18N_KEYS.CommonCancel)}
            </Button>
            <Button
              type="button"
              size="sm"
              data-testid="provider-vault-replace-confirm-btn"
              {disabled}
              onclick={() => void onReplace(swap)}
            >
              {vault.t(I18N_KEYS.ProviderVaultsReplaceConfirm)}
            </Button>
          </div>
        </div>
      {/if}
      {#if merge.kind === MergeConfirmationKind.Confirming}
        {@const confirming = merge}
        <form
          class="nk-banner space-y-2 px-4 py-3"
          aria-labelledby="provider-vault-merge-title"
          data-testid="provider-vault-merge-confirm"
          onsubmit={(event) => {
            event.preventDefault()
            void runMerge()
          }}
        >
          <p
            id="provider-vault-merge-title"
            class="text-sm font-medium text-foreground"
          >
            {idText(confirming.shortId)(I18N_KEYS.ProviderVaultsMergeTitle)}
          </p>
          <p class="text-xs text-pretty text-muted-foreground">
            {idText(confirming.shortId)(I18N_KEYS.ProviderVaultsMergeBody)}
          </p>
          {#if confirming.needsPassword}
            <label class="grid gap-1 text-xs text-muted-foreground">
              {idText(confirming.shortId)(
                I18N_KEYS.ProviderVaultsMergePasswordLabel,
              )}
              <input
                type="password"
                autocomplete="off"
                class="h-9 border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-foreground/50"
                data-testid="provider-vault-merge-password"
                bind:value={mergePassword}
                {disabled}
              />
            </label>
          {/if}
          <div class="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="provider-vault-merge-cancel"
              onclick={() => (merge = { kind: MergeConfirmationKind.Closed })}
            >
              {vault.t(I18N_KEYS.CommonCancel)}
            </Button>
            <Button
              type="submit"
              size="sm"
              data-testid="provider-vault-merge-confirm-btn"
              disabled={disabled ||
                (confirming.needsPassword && !mergePassword)}
            >
              {#if working}
                <RefreshCw class="size-4 animate-spin" aria-hidden="true" />
              {/if}
              {vault.t(I18N_KEYS.ProviderVaultsMergeConfirm)}
            </Button>
          </div>
        </form>
      {/if}
      <p
        class="text-[11px] text-pretty text-muted-foreground"
        data-testid="google-drive-vaults-connect-explainer"
      >
        {vault.t(I18N_KEYS.ProviderVaultsConnectExplainer)}
      </p>
    </div>
  {/if}
{/if}
{#if choice.kind === DriveVaultChoiceKind.VaultAction}
  {@const chosen = choice}
  <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
    <Button
      type="button"
      class="sm:min-w-[180px]"
      data-testid="provider-vault-action-btn"
      data-store-id={chosen.summary.storeId}
      disabled={disabled || confirming}
      onclick={() => {
        if (inventory.kind !== DriveVaultInventoryKind.Loaded) return
        if (inventory.listing.root !== 'found') return
        const press: VaultActionPress = {
          action: chosen.action,
          summary: chosen.summary,
          offer: inventory.listing.listing.replacement,
        }
        runAction(press)
      }}
    >
      {rowActionLabel(chosen)}
    </Button>
  </div>
{:else}
  {@render connectButton(
    inventory.kind === DriveVaultInventoryKind.Loading ||
      working ||
      checking ||
      passwordCheckOpen,
  )}
{/if}
