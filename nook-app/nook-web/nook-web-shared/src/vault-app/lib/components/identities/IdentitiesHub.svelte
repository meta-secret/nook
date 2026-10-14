<!--
Identities hub: the main page of the unified UI. It lists every identity on
this browser with the vaults it opens. While locked, the selected vault's
unlock panel opens inside its identity card; setup flows (create, connect,
join) sit between the hero and the cards.
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
  import IdentityDraftCard from './IdentityDraftCard.svelte'
  import IdentityJoinPanel from '$lib/components/identity-control/IdentityJoinPanel.svelte'
  import { IdentityDirectoryLoader } from './identity-directory-loader.svelte'
  import { configured_vault_application, VaultApplication } from '$app-wasm'
  import {
    IdentityCardProjection,
    IdentityVaultRowState,
    VaultSetupHostKind,
    type VaultSetupHost,
    type IdentityCardSource,
    type IdentityLocalVault,
  } from './identity-card-model'
  import {
    LoginVaultExtensionPairingStatusKind,
    type LoginVaultExtensionPairingStatus,
  } from '$lib/components/login/login-vault-extension-pairing-status'

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
    pairingStatusFor = () => ({
      kind: LoginVaultExtensionPairingStatusKind.NotShown,
    }),
    unlockPanel,
    vaultSetup,
    vaultSetupOpen = false,
    vaultPicker,
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
    pairingStatusFor?: (storeId: string) => LoginVaultExtensionPairingStatus
    /** Unlock panel for `selectedStoreId`, placed inside its identity card. */
    unlockPanel?: Snippet
    /** First-vault setup. It belongs to the current identity, or to the
     * identity about to be created when this browser has none yet. */
    vaultSetup?: Snippet
    /** Open the setup at once (an invitation or a ceremony in progress). */
    vaultSetupOpen?: boolean
    /** Plain vault list, shown only when no identity card lists the vaults. */
    vaultPicker?: Snippet
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
  const cardsReady = $derived(
    loader.state.kind === IdentityDirectoryLoadKind.Ready,
  )

  /** The card that holds the vault being unlocked; it is shown first. */
  const unlockingIdentityId = $derived.by(() => {
    if (!unlockPanel || !selectedStoreId || !cardsReady) return ''
    for (const card of projection.cards) {
      const opensSelected = card.vaults.some(
        (row) =>
          row.storeId === selectedStoreId &&
          row.state !== IdentityVaultRowState.Unavailable,
      )
      if (opensSelected) return card.identityId
    }
    return ''
  })
  let setupHost = $state<VaultSetupHost>({ kind: VaultSetupHostKind.Pending })
  /** With several identities, the current one opens its first-vault setup
   * from its New vault row; a lone identity opens it straight away. */
  let setupOpen = $state(false)

  function currentIdentityId(): string {
    if (!cardsReady) return ''
    for (const card of projection.cards) {
      if (card.current) return card.identityId
    }
    return ''
  }

  $effect(() => {
    if (!vaultSetup) {
      setupHost = { kind: VaultSetupHostKind.Pending }
      setupOpen = false
      return
    }
    if (untrack(() => setupHost.kind) !== VaultSetupHostKind.Pending) return
    if (loader.state.kind === IdentityDirectoryLoadKind.Loading) return
    const identityId = currentIdentityId()
    if (!identityId) {
      setupHost = { kind: VaultSetupHostKind.Draft }
      return
    }
    setupHost = { kind: VaultSetupHostKind.Card, identityId }
    setupOpen = untrack(() => vaultSetupOpen) || projection.cards.length === 1
  })

  $effect(() => {
    if (vaultSetupOpen) setupOpen = true
  })

  const setupIdentityId = $derived(
    setupHost.kind === VaultSetupHostKind.Card ? setupHost.identityId : '',
  )
  const setupShown = $derived(Boolean(setupIdentityId) && setupOpen)
  const featuredIdentityId = $derived(
    (setupShown ? setupIdentityId : '') || unlockingIdentityId,
  )
  const cards = $derived(
    featuredIdentityId
      ? [
          ...projection.cards.filter(
            (card) => card.identityId === featuredIdentityId,
          ),
          ...projection.cards.filter(
            (card) => card.identityId !== featuredIdentityId,
          ),
        ]
      : projection.cards,
  )
  /** A browser with no identity: the first-vault screen stands alone. */
  const firstRun = $derived(
    Boolean(vaultSetup) &&
      setupHost.kind === VaultSetupHostKind.Draft &&
      configured_vault_application() !== VaultApplication.Sentinel,
  )
  /** The current identity's card, which carries the "New vault" row. */
  const currentCardShown = $derived(
    cardsReady && showCards && projection.cards.some((card) => card.current),
  )
  const cardsListVaults = $derived(
    cardsReady &&
      projection.cards.some((card) =>
        card.vaults.some(
          (row) => row.state !== IdentityVaultRowState.Unavailable,
        ),
      ),
  )
</script>

<div class="grid min-w-0 grid-cols-1 gap-6" data-testid="identities-hub">
  {#if !firstRun}
    <IdentitiesHero
      {vault}
      totals={projection.totals}
      showStats={cards.length > 0}
    />
  {/if}

  <IdentityJoinPanel {vault} />

  {@render children?.()}

  {#if unlockPanel && !unlockingIdentityId}
    <div
      class="nk-frame-sheet min-w-0 p-5 sm:p-6"
      data-testid="identity-unlock-standalone"
    >
      {@render unlockPanel()}
      {#if canAddVault && !currentCardShown}
        <div class="mt-5 border-t border-border pt-3">
          <button
            type="button"
            class="nk-vault-row nk-vault-row-add text-muted-foreground hover:text-foreground"
            data-testid="identity-new-vault"
            disabled={busy}
            onclick={onNewVault}
          >
            <span class="nk-vault-icon" aria-hidden="true">
              <Plus class="size-4" />
            </span>
            <span class="text-sm font-medium"
              >{vault.t(I18N_KEYS.WorkspaceNewVault)}</span
            >
          </button>
        </div>
      {/if}
    </div>
  {/if}

  {#if vaultPicker}
    {#if cardsListVaults}
      <p
        class="nk-banner px-4 py-3 text-sm text-foreground"
        data-testid="login-choose-vault-hint"
        role="status"
      >
        {vault.t(I18N_KEYS.LoginChooseVaultHint)}
      </p>
    {:else}
      <div class="nk-frame-sheet min-w-0 p-5 sm:p-6">
        {@render vaultPicker()}
      </div>
    {/if}
  {/if}

  {#if firstRun && vaultSetup}
    {@render vaultSetup()}
  {:else if vaultSetup && setupHost.kind === VaultSetupHostKind.Draft}
    <div class="grid min-w-0 grid-cols-1">
      <IdentityDraftCard {vault}>
        {@render vaultSetup()}
      </IdentityDraftCard>
    </div>
  {/if}

  {#if showCards && !firstRun}
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
            canAddVault={(canAddVault ||
              (card.identityId === setupIdentityId && !setupShown)) &&
              card.current}
            {onOpenVault}
            onNewVault={card.identityId === setupIdentityId
              ? () => (setupOpen = true)
              : onNewVault}
            {onManage}
            {onLock}
            {onUseIdentity}
            {pairingStatusFor}
            {...vaultSetup && setupShown && card.identityId === setupIdentityId
              ? { unlockPanel: vaultSetup }
              : unlockPanel && card.identityId === unlockingIdentityId
                ? { unlockPanel }
                : {}}
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
