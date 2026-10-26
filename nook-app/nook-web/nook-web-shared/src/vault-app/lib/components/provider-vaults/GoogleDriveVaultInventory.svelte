<!--
What the signed-in Google account's Nook folder already holds, shown in
Connect & sync before anything is written. Rust lists and classifies the
vaults: this identity's vaults simply sync; another identity's vault can be
imported as a separate vault, or replace an empty open vault after an
explicit confirmation. Connect & sync stays available beside them, since
every vault keeps its own subfolder.
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import { RefreshCw } from '@lucide/svelte'
  import type { ProviderVaultSummary } from '$app-wasm'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import ProviderVaultList from '$lib/components/provider-vaults/ProviderVaultList.svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import { VaultOAuthActions } from '$lib/vault/oauth'
  import {
    ProviderVaultActions,
    type EmptyVaultSwap,
  } from '$lib/vault/provider-vaults'
  import {
    DriveVaultInventoryKind,
    EmptyVaultConfirmationKind,
    type DriveVaultInventory,
    type EmptyVaultConfirmation,
    type EmptyVaultConfirmationRequest,
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

  let inventory = $state<DriveVaultInventory>({ kind: DriveVaultInventoryKind.Loading })
  let replacement = $state<EmptyVaultConfirmation>({ kind: EmptyVaultConfirmationKind.Closed })

  async function load(token: string): Promise<void> {
    inventory = { kind: DriveVaultInventoryKind.Loading }
    replacement = { kind: EmptyVaultConfirmationKind.Closed }
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
    replacement = { kind: EmptyVaultConfirmationKind.Confirming, ...request }
  }

  function replaceBody(shortId: string): string {
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.ProviderVaultsReplaceConfirmBody,
      replacements: { id: shortId },
    }
    return vault.t(request)
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
      <p class="nk-subpanel-head">{vault.t(I18N_KEYS.ProviderVaultsListTitle)}</p>
      <ProviderVaultList {vault} vaults={listing.vaults}>
        {#snippet action(summary: ProviderVaultSummary)}
          {#if summary.relation === 'other'}
            {#if listing.replacement.state === 'offered'}
              {@const confirmation: EmptyVaultConfirmationRequest = {
                swap: {
                  emptyStoreId: listing.replacement.emptyStoreId,
                  replacementStoreId: summary.storeId,
                },
                shortId: summary.shortId,
              }}
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="provider-vault-use-instead"
                disabled={busy}
                onclick={() => confirmReplacement(confirmation)}
              >
                {vault.t(I18N_KEYS.ProviderVaultsUseInstead)}
              </Button>
            {/if}
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="provider-vault-import"
              disabled={busy}
              onclick={() => void onImport(summary.storeId)}
            >
              {vault.t(I18N_KEYS.ProviderVaultsImportSeparately)}
            </Button>
          {/if}
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
            {replaceBody(replacement.shortId)}
          </p>
          <div class="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="provider-vault-replace-cancel"
              onclick={() => (replacement = { kind: EmptyVaultConfirmationKind.Closed })}
            >
              {vault.t(I18N_KEYS.CommonCancel)}
            </Button>
            <Button
              type="button"
              size="sm"
              data-testid="provider-vault-replace-confirm-btn"
              disabled={busy}
              onclick={() => void onReplace(swap)}
            >
              {vault.t(I18N_KEYS.ProviderVaultsReplaceConfirm)}
            </Button>
          </div>
        </div>
      {/if}
      <p class="text-[11px] text-pretty text-muted-foreground">
        {vault.t(I18N_KEYS.ProviderVaultsCoexistNote)}
      </p>
    </div>
  {/if}
{/if}
