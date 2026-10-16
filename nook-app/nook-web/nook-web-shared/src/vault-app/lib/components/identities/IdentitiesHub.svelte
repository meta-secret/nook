<!--
Identities hub: the main page of the unified UI. It lists every identity on
this browser with the vaults it opens. While locked, the selected vault's
unlock panel opens inside its identity card; setup flows (create, connect,
join) sit between the hero and the cards.
-->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte'
  import { FolderKey, Plus, RefreshCw } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'
  import { ActiveVaultKind } from '$lib/vault/state/provider.svelte'
  import type { WorkspaceSection } from '$lib/vault/state/ui.svelte'
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
    type IdentitySectionTarget,
    type IdentityVaultTarget,
    type IdentityLocalVault,
    type IdentityCardView,
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
    onSelectVault,
    onUnlockVault,
    onManageVault,
    onNewIdentity,
    onUseIdentity,
    onCardsShown = () => {},
    onClosePanels = () => {},
    currentHealthNote = '',
    onHealth = () => {},
    onAddDevice,
    addDevicePrompt = false,
    onManageSection,
    overview,
    overviewOpen = false,
    onLock = () => {},
    onUnlock = () => {},
    pairingStatusFor = () => ({
      kind: LoginVaultExtensionPairingStatusKind.NotShown,
    }),
    unlockPanel,
    passwordFallback,
    vaultExtension,
    requestPanel,
    identityPrompt,
    vaultSetup,
    vaultSetupOpen = false,
    vaultPicker,
    accessPanel,
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
    /** A vault opened beside its card; a locked browser selects it. */
    onSelectVault?: (storeId: string) => void
    /** Unlock a vault from its panel without going into it. */
    onUnlockVault?: (storeId: string) => void
    /** One of a vault's own pages, from its panel beside the card. */
    onManageVault?: (target: IdentitySectionTarget) => void
    onNewIdentity: () => void
    onUseIdentity: (target: IdentityVaultTarget) => void
    /** Whether identity cards are on screen; the login screen then leaves
     * vault access to them instead of its own storage sheet. */
    onCardsShown?: (shown: boolean) => void
    /** Close what the page opened beside a card (New vault, an import)
     * when another panel opens there. */
    onClosePanels?: () => void
    /** What the unlocked identity lacks, shown as a chip on its card. */
    currentHealthNote?: string
    /** Open the unlocked identity's control page at its next step. */
    onHealth?: () => void
    /** Open the add-device flow from the current identity's card; a locked
     * identity unlocks on the way. */
    onAddDevice?: (target: IdentityVaultTarget) => void
    /** The current identity opens on one device only. */
    addDevicePrompt?: boolean
    /** Open one of the current identity's pages from Manage on its card. */
    onManageSection?: (target: IdentitySectionTarget) => void
    /** The current identity's overview, shown beside its card. */
    overview?: Snippet
    /** The current identity's overview is open. */
    overviewOpen?: boolean
    onLock?: () => void
    /** Unlock a locked identity with this device's passkey. */
    onUnlock?: (target: IdentityVaultTarget) => void
    pairingStatusFor?: (storeId: string) => LoginVaultExtensionPairingStatus
    /** A running Sentinel quorum ceremony for `selectedStoreId`: on the
     * card that lists that vault, or on its own when no card does. */
    unlockPanel?: Snippet
    /** Backup-password unlock, placed on the card that holds the selected
     * vault. */
    passwordFallback?: Snippet
    /** The browser extension for the open vault, in its panel. */
    vaultExtension?: Snippet
    /** A request waiting on the current identity (a browser extension
     * asking to connect), beside its card. */
    requestPanel?: Snippet<[IdentityCardView]>
    /** The current identity's own unlock prompt (its PIN), on its card. */
    identityPrompt?: Snippet
    /** First-vault setup. It belongs to the current identity, or to the
     * identity about to be created when this browser has none yet. */
    vaultSetup?: Snippet
    /** Open the setup at once (an invitation or a ceremony in progress). */
    vaultSetupOpen?: boolean
    /** Plain vault list, shown only when no identity card lists the vaults. */
    vaultPicker?: Snippet
    /** Storage setup or a restore from a sync provider, beside the current
     * card. */
    accessPanel?: Snippet
    children?: Snippet
  } = $props()

  const loader = new IdentityDirectoryLoader(untrack(() => vault))

  $effect(() => {
    void vault.hasManager
    void vault.isAuthenticated
    void vault.deviceProtectionStatus
    void vault.localVaults.length
    void vault.activeVault.kind
    // Each projection of the identity log (a vault deleted everywhere, a
    // device approved or revoked) changes the cards: read them again.
    void vault.identityControl.view
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
  /** Vaults the unlocked identity's log lists, stored here or not: read
   * again whenever this browser's vault catalog changes. */
  $effect(() => {
    if (!vault.isAuthenticated) return
    void vault.localVaults.length
    void untrack(() => vault.identityControl.loadSnapshot())
  })
  const currentLogVaults = $derived.by((): string[] => {
    const snapshot = vault.identityControl.snapshot
    return vault.isAuthenticated && snapshot !== false
      ? snapshot.vaults.map((entry) => entry.storeId)
      : []
  })

  const projection = $derived.by(() => {
    const source: IdentityCardSource = {
      identities:
        loader.state.kind === IdentityDirectoryLoadKind.Ready
          ? loader.state.view.identities
          : [],
      localVaults,
      currentLogVaults,
      openStoreId:
        vault.activeVault.kind === ActiveVaultKind.Open
          ? vault.activeVault.storeId
          : '',
      authenticated: vault.isAuthenticated,
      identityUnlocked: vault.isAuthenticated || vault.deviceProtectionReady,
    }
    return new IdentityCardProjection(source)
  })
  const cardsReady = $derived(
    loader.state.kind === IdentityDirectoryLoadKind.Ready,
  )

  /** The card that holds the vault being unlocked; it is shown first. */
  const unlockingIdentityId = $derived.by(() => {
    if (!selectedStoreId || !cardsReady) return ''
    for (const card of projection.cards) {
      const opensSelected = card.vaults.some(
        (row) =>
          row.storeId === selectedStoreId &&
          (row.state === IdentityVaultRowState.Open ||
            row.state === IdentityVaultRowState.Available),
      )
      if (opensSelected) return card.identityId
    }
    return ''
  })
  /** The card that offers the selected vault's backup password: the one
   * that unlocks it, else any card that lists it. A backup password opens
   * the vault even after this browser lost the identity's key. */
  const passwordIdentityId = $derived.by(() => {
    if (unlockingIdentityId) return unlockingIdentityId
    if (!selectedStoreId || !cardsReady) return ''
    for (const card of projection.cards) {
      if (card.vaults.some((row) => row.storeId === selectedStoreId)) {
        return card.identityId
      }
    }
    return ''
  })
  const directoryFailed = $derived(
    loader.state.kind === IdentityDirectoryLoadKind.Failed,
  )
  /** No card can carry the backup password, so it stands on its own. */
  const passwordStandalone = $derived(
    Boolean(passwordFallback) &&
      (directoryFailed || (cardsReady && !passwordIdentityId)),
  )
  /** Local vaults no card lists (all of them when the directory cannot be
   * read): each still opens from its own row. */
  const strayVaults = $derived(
    directoryFailed ? localVaults : cardsReady ? projection.unlistedVaults : [],
  )
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
      // Between switching identities no card is current yet; the setup
      // waits for the new current card rather than standing alone.
      if (cardsReady && projection.cards.length > 0) return
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
    (setupShown ? setupIdentityId : '') || passwordIdentityId,
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
  /** A browser with no identity: first-run screens (name, restore) stand
   * alone, without the hub's hero or cards. */
  const firstRun = $derived(
    (setupHost.kind === VaultSetupHostKind.Draft ||
      (cardsReady &&
        projection.cards.length === 0 &&
        localVaults.length === 0)) &&
      configured_vault_application() !== VaultApplication.Sentinel,
  )
  /** Unlock and Manage name a vault the identity can open (the selected
   * one first), so a locked identity can be unlocked on the way. */
  function targetFor(identityId: string): IdentityVaultTarget {
    const card = projection.cards.find((each) => each.identityId === identityId)
    const openable = (card ? card.vaults : []).filter(
      (each) =>
        each.state === IdentityVaultRowState.Open ||
        each.state === IdentityVaultRowState.Available,
    )
    const row = ((...[v = openable[0]]) => v)(
      openable.find((each) => each.storeId === selectedStoreId),
    )
    const target: IdentityVaultTarget = {
      identityId,
      storeId: row ? row.storeId : '',
    }
    return target
  }

  /** The current identity's card, which carries the "New vault" row. */
  const currentCardShown = $derived(
    cardsReady && showCards && projection.cards.some((card) => card.current),
  )
  /** Identity cards are on screen; they, not a flat vault list, carry
   * this browser's vaults. */
  const cardsShown = $derived(
    cardsReady && showCards && projection.cards.length > 0,
  )
  $effect(() => onCardsShown(cardsShown))
  const cardsListVaults = $derived(
    cardsReady &&
      projection.cards.some((card) =>
        card.vaults.some(
          (row) =>
            row.state === IdentityVaultRowState.Open ||
            row.state === IdentityVaultRowState.Available,
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
    {#if cardsShown}
      {#if cardsListVaults}
        <p
          class="nk-banner px-4 py-3 text-sm text-foreground"
          data-testid="login-choose-vault-hint"
          role="status"
        >
          {vault.t(I18N_KEYS.LoginChooseVaultHint)}
        </p>
      {/if}
    {:else}
      <div class="nk-frame-sheet min-w-0 p-5 sm:p-6">
        {@render vaultPicker()}
      </div>
    {/if}
  {/if}

  {#if showCards && !vaultPicker && (strayVaults.length > 0 || (passwordStandalone && passwordFallback))}
    <div class="nk-frame-sheet min-w-0" data-testid="identity-stray-vaults">
      {#if strayVaults.length > 0}
        <ul class="p-2">
          {#each strayVaults as stray (stray.storeId)}
            <li>
              <button
                type="button"
                class="nk-vault-row"
                data-testid="identity-vault-row"
                data-store-id={stray.storeId}
                data-state="available"
                {...stray.storeId === selectedStoreId
                  ? { 'aria-pressed': 'true' }
                  : {}}
                disabled={busy}
                onclick={() => onOpenVault(stray.storeId)}
              >
                <span class="nk-vault-icon" aria-hidden="true">
                  <FolderKey class="size-4" />
                </span>
                <span class="truncate text-[0.9375rem] font-medium">
                  {stray.label || vault.t(I18N_KEYS.WorkspaceVaultFallback)}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      {#if passwordStandalone && passwordFallback}
        {@render passwordFallback()}
      {/if}
    </div>
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
            onUnlock={(identityId: string) => onUnlock(targetFor(identityId))}
            {onLock}
            healthNote={card.current ? currentHealthNote : ''}
            {onHealth}
            {...onAddDevice
              ? { onAddDevice: () => onAddDevice(targetFor(card.identityId)) }
              : {}}
            addDevicePrompt={card.current && addDevicePrompt}
            overviewOpen={card.current && overviewOpen}
            {...overview && overviewOpen && card.current
              ? { overviewPanel: overview }
              : {}}
            {...onManageSection
              ? {
                  onManageSection: (section: WorkspaceSection) => {
                    const target: IdentitySectionTarget = {
                      ...targetFor(card.identityId),
                      section,
                    }
                    onManageSection(target)
                  },
                }
              : {}}
            onUseIdentity={(identityId: string) =>
              onUseIdentity(targetFor(identityId))}
            {pairingStatusFor}
            {...onSelectVault ? { onSelectVault } : {}}
            {...onUnlockVault ? { onUnlockVault } : {}}
            {...onManageVault ? { onManageVault } : {}}
            onClosePanels={() => {
              setupOpen = false
              onClosePanels()
            }}
            {...accessPanel && card.current
              ? { unlockPanel: accessPanel }
              : vaultSetup && setupShown && card.identityId === setupIdentityId
                ? { unlockPanel: vaultSetup }
                : identityPrompt && card.current
                  ? { unlockPanel: identityPrompt }
                  : unlockPanel && card.identityId === unlockingIdentityId
                    ? { unlockPanel }
                    : {}}
            {...passwordFallback &&
            card.identityId === passwordIdentityId &&
            !(setupShown && card.identityId === setupIdentityId)
              ? { passwordFallback }
              : {}}
            {...vaultExtension ? { vaultExtension } : {}}
            {...requestPanel && card.current ? { requestPanel } : {}}
          />
        {/each}
        <button
          type="button"
          class="nk-frame-keytag nk-new-tile sm:min-h-40 md:min-h-60"
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
