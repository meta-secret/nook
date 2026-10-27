<!--
What the signed-in Google account's Nook folder already holds, shown in
Connect & sync before anything is written. Rust lists every vault, decides
how this device can open it and which actions it allows, recommended action
first: a vault this device can open replaces an empty open vault, merges
into one with records, or comes in beside it; a vault nothing here opens
can only be requested from a device that can. Connect & sync itself only
adds this identity's vaults beside these.
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import { RefreshCw } from '@lucide/svelte'
  import type {
    EmptyVaultReplacement,
    ProviderVaultAction,
    ProviderVaultSummary,
  } from '$app-wasm'
  import { I18N_KEYS, type I18nKey } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import ProviderVaultList from '$lib/components/provider-vaults/ProviderVaultList.svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import { VaultOAuthActions } from '$lib/vault/oauth'
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
    DriveVaultInventoryKind,
    EmptyVaultConfirmationKind,
    MergeConfirmationKind,
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
  }: {
    vault: VaultState
    /** The signed-in account's token; a new sign-in lists again. */
    accessToken: string
    busy: boolean
    onImport: (storeId: string) => void | Promise<void>
    onReplace: (swap: EmptyVaultSwap) => void | Promise<void>
  } = $props()

  let inventory = $state<DriveVaultInventory>({
    kind: DriveVaultInventoryKind.Loading,
  })
  let replacement = $state<EmptyVaultConfirmation>({
    kind: EmptyVaultConfirmationKind.Closed,
  })
  let merge = $state<MergeConfirmation>({ kind: MergeConfirmationKind.Closed })
  let mergePassword = $state('')
  let working = $state(false)
  const disabled = $derived(busy || working)

  async function load(token: string): Promise<void> {
    inventory = { kind: DriveVaultInventoryKind.Loading }
    replacement = { kind: EmptyVaultConfirmationKind.Closed }
    merge = { kind: MergeConfirmationKind.Closed }
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
      <ProviderVaultList {vault} vaults={listing.vaults}>
        {#snippet action(summary: ProviderVaultSummary)}
          {#each summary.actions as action (action)}
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid={actionTestId(action)}
              data-store-id={summary.storeId}
              {disabled}
              onclick={() => {
                const press: VaultActionPress = {
                  action,
                  summary,
                  offer: listing.replacement,
                }
                runAction(press)
              }}
            >
              {actionLabel(action)}
            </Button>
          {/each}
        {/snippet}
      </ProviderVaultList>
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
