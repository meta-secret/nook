<!--
Identities hub: the main page of the unified UI. It lists every identity on
this browser with the vaults it opens. While locked, the access sheet (unlock,
create, connect, join) sits between the hero and the cards.
-->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte'
  import { Plus, RefreshCw } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'
  import { ActiveVaultKind } from '$lib/vault/state/provider.svelte'
  import { IdentityDirectoryLoadKind } from '$lib/components/devices-access/identity-directory-view'
  import IdentitiesHero from './IdentitiesHero.svelte'
  import IdentityCard from './IdentityCard.svelte'
  import { IdentityDirectoryLoader } from './identity-directory-loader.svelte'
  import {
    IdentityCardProjection,
    type IdentityCardSource,
    type IdentityLocalVault,
  } from './identity-card-model'

  let {
    vault,
    selectedStoreId = '',
    extensionStoreIds = [],
    extensionNote = '',
    canAddVault = false,
    showCards = true,
    busy = false,
    onOpenVault,
    onNewVault = () => {},
    onManage,
    onNewIdentity,
    onUseIdentity,
    onLock = () => {},
    children,
  }: {
    vault: VaultState
    selectedStoreId?: string
    extensionStoreIds?: readonly string[]
    /** Shown when the extension is paired with a vault not on this browser. */
    extensionNote?: string
    canAddVault?: boolean
    showCards?: boolean
    busy?: boolean
    onOpenVault: (storeId: string) => void
    onNewVault?: () => void
    onManage: (identityId: string) => void
    onNewIdentity: () => void
    onUseIdentity: (identityId: string) => void
    onLock?: () => void
    children?: Snippet
  } = $props()

  const loader = new IdentityDirectoryLoader(untrack(() => vault))

  $effect(() => {
    void vault.hasManager
    void vault.isAuthenticated
    void vault.deviceProtectionStatus
    void vault.localVaults.length
    void vault.activeVault.kind
    void loader.reload()
  })

  const unnamedLabel = $derived(vault.t(I18N_KEYS.LoginVaultPickerUnnamed))
  const localVaults = $derived.by((): IdentityLocalVault[] =>
    vault.localVaults.map((entry) => {
      const local: IdentityLocalVault = {
        storeId: entry.storeId,
        label: entry.display_label(unnamedLabel),
      }
      return local
    }),
  )
  const projection = $derived.by(() => {
    const source: IdentityCardSource = {
      identities:
        loader.state.kind === IdentityDirectoryLoadKind.Ready
          ? loader.state.view.identities
          : [],
      localVaults,
      openStoreId:
        vault.activeVault.kind === ActiveVaultKind.Open
          ? vault.activeVault.storeId
          : '',
      authenticated: vault.isAuthenticated,
    }
    return new IdentityCardProjection(source)
  })
  const cards = $derived(projection.cards)
</script>

<div class="grid min-w-0 grid-cols-1 gap-6" data-testid="identities-hub">
  <IdentitiesHero
    {vault}
    totals={projection.totals}
    showStats={cards.length > 0}
  />

  {@render children?.()}

  {#if showCards}
    {#if loader.state.kind === IdentityDirectoryLoadKind.Loading && vault.hasManager}
      <p
        class="flex items-center gap-2 text-sm text-muted-foreground"
        role="status"
      >
        <RefreshCw class="size-4 animate-spin" aria-hidden="true" />
        {vault.t(I18N_KEYS.DevicesAccessIdentityDirectoryLoading)}
      </p>
    {:else if loader.state.kind === IdentityDirectoryLoadKind.Failed}
      <p class="nk-banner px-4 py-3 text-sm text-muted-foreground" role="alert">
        {vault.t(I18N_KEYS.DevicesAccessIdentityDirectoryFailed)}
      </p>
    {:else if loader.state.kind === IdentityDirectoryLoadKind.Ready}
      <section
        class="grid min-w-0 grid-cols-1 items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3"
        aria-label={vault.t(I18N_KEYS.WorkspaceCardsLabel)}
        data-testid="identity-cards"
      >
        {#each cards as card (card.identityId)}
          <IdentityCard
            {vault}
            {card}
            {selectedStoreId}
            {extensionStoreIds}
            {busy}
            canAddVault={canAddVault && card.current}
            {onOpenVault}
            {onNewVault}
            {onManage}
            {onLock}
            {onUseIdentity}
          />
        {/each}
        <button
          type="button"
          class="nk-frame-keytag nk-new-tile min-h-40 md:min-h-60"
          data-testid="identity-new"
          disabled={busy}
          onclick={onNewIdentity}
        >
          <span
            class="grid size-11 place-items-center border border-border text-foreground"
            aria-hidden="true"
          >
            <Plus class="size-5" />
          </span>
          <span class="text-[0.9375rem] font-semibold text-foreground">
            {vault.t(I18N_KEYS.WorkspaceNewIdentityTitle)}
          </span>
          <span class="max-w-[24ch] text-[0.8125rem]">
            {vault.t(I18N_KEYS.WorkspaceNewIdentityDescription)}
          </span>
        </button>
      </section>
      {#if extensionNote}
        <p
          class="nk-tag whitespace-normal"
          data-testid="identities-extension-note"
        >
          {extensionNote}
        </p>
      {/if}
    {/if}
  {/if}
</div>
