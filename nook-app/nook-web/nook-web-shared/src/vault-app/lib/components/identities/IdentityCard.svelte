<!--
Key-tag card for one identity: who it is (label, keys, session), what it
opens (its vaults), and what you can do (lock, manage). Opening a vault is
the unlock: while locked, the selected vault's unlock panel sits inside the
card, which then spans the full row.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import IdentityManageMenu from './IdentityManageMenu.svelte'
  import VaultPanel from './VaultPanel.svelte'
  import { WorkspaceSection } from '$lib/vault/state/ui.svelte'
  import {
    Asterisk,
    ChevronRight,
    Fingerprint,
    FolderKey,
    Lock,
    LayoutDashboard,
    LockOpen,
    MonitorSmartphone,
    Plus,
    Puzzle,
    Settings2,
    TriangleAlert,
    UserRoundCheck,
    X,
  } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { CipherStrip } from '$lib/components/ui/cipher'
  import {
    StatusMark,
    StatusTag,
    StatusTone,
  } from '$lib/components/ui/status-tag'
  import type { VaultState } from '$lib/vault.svelte'
  import LoginVaultPairingStatus from '$lib/components/login/LoginVaultPairingStatus.svelte'
  import {
    LoginVaultExtensionPairingStatusKind,
    type LoginVaultExtensionPairingStatus,
  } from '$lib/components/login/login-vault-extension-pairing-status'
  import {
    IdentityCardStatus,
    IdentityKeyKind,
    IdentityVaultRowState,
    type IdentityCardView,
    type IdentitySectionTarget,
    type IdentityVaultRow,
  } from './identity-card-model'

  let {
    vault,
    card,
    selectedStoreId = '',
    extensionStoreIds = [],
    busy = false,
    canAddVault = false,
    onOpenVault,
    onNewVault = () => {},
    onSelectVault,
    onManageVault,
    onLock = () => {},
    onUnlock = () => {},
    onUseIdentity = () => {},
    healthNote = '',
    onHealth = () => {},
    onAddDevice,
    addDevicePrompt = false,
    onManageSection,
    pairingStatusFor = () => ({
      kind: LoginVaultExtensionPairingStatusKind.NotShown,
    }),
    unlockPanel,
    overviewPanel,
    overviewOpen = false,
    passwordFallback,
    preview = false,
  }: {
    vault: VaultState
    card: IdentityCardView
    selectedStoreId?: string
    /** Vaults the paired browser extension holds a grant for. */
    extensionStoreIds?: readonly string[]
    busy?: boolean
    canAddVault?: boolean
    onOpenVault: (storeId: string) => void
    onNewVault?: () => void
    /** A vault row was opened beside the card: a locked browser selects
     * that vault, which reads its passphrases. */
    onSelectVault?: (storeId: string) => void
    /** One of a vault's own pages (its passphrases, imports); a locked
     * vault unlocks first. */
    onManageVault?: (target: IdentitySectionTarget) => void
    onLock?: () => void
    /** Unlock the identity with this device's passkey. */
    onUnlock?: (identityId: string) => void
    onUseIdentity?: (identityId: string) => void
    /** What the unlocked identity lacks (no cloud copy, one device); its
     * chip opens the identity's control page at that step. */
    healthNote?: string
    onHealth?: () => void
    /** Open the add-device flow. Offered on the identity this browser
     * uses, locked or not: a locked one unlocks first. */
    onAddDevice?: () => void
    /** The identity opens on one device only: offer a second on the card
     * itself, not just in Manage. */
    addDevicePrompt?: boolean
    /** Open one of the identity's pages from Manage. Given, Manage on the
     * identity this browser uses opens a menu of them. */
    onManageSection?: (section: WorkspaceSection) => void
    /** Extension pairing status for a vault row, while pairing is offered. */
    pairingStatusFor?: (storeId: string) => LoginVaultExtensionPairingStatus
    /** Setup panel (a new vault), shown beside the card's rows. */
    unlockPanel?: Snippet
    /** The identity's overview, opened beside the card. */
    overviewPanel?: Snippet
    /** The overview is open; Overview on the footer closes it. */
    overviewOpen?: boolean
    /** Passphrase unlock for the selected vault, while locked. */
    passwordFallback?: Snippet
    /** A preview of a card that does not exist yet: no actions. */
    preview?: boolean
  } = $props()

  const live = $derived(card.status === IdentityCardStatus.Unlocked)
  const managesHere = $derived(
    Boolean(onManageSection) && !preview && (live || card.current),
  )
  let menuOpen = $state(false)

  function selectFromMenu(section: WorkspaceSection): void {
    menuOpen = false
    onManageSection?.(section)
  }

  /** Overview and Manage share the space beside the card: one at a time. */
  function toggleOverview(): void {
    menuOpen = false
    vaultOpenId = ''
    onManageSection?.(
      overviewOpen ? WorkspaceSection.Identities : WorkspaceSection.Overview,
    )
  }

  function toggleManage(): void {
    if (!menuOpen && overviewOpen)
      onManageSection?.(WorkspaceSection.Identities)
    vaultOpenId = ''
    menuOpen = !menuOpen
  }

  /** A vault opened beside the card from its row: how to get in, and
   * what belongs to that vault alone. */
  let vaultOpenId = $state('')
  const vaultOpenRow = $derived(
    card.vaults.find((row) => row.storeId === vaultOpenId),
  )

  function toggleVault(storeId: string): void {
    if (vaultOpenId === storeId) {
      vaultOpenId = ''
      return
    }
    menuOpen = false
    if (overviewOpen) onManageSection?.(WorkspaceSection.Identities)
    vaultOpenId = storeId
    onSelectVault?.(storeId)
  }

  function closeMenuOnEscape(event: KeyboardEvent): void {
    if (menuOpen && event.key === 'Escape') menuOpen = false
  }

  const kindKey = $derived(
    card.keyKind === IdentityKeyKind.Passkey
      ? I18N_KEYS.WorkspaceKeyKindPasskey
      : card.keyKind === IdentityKeyKind.Pin
        ? I18N_KEYS.WorkspaceKeyKindPin
        : card.keyKind === IdentityKeyKind.Mixed
          ? I18N_KEYS.WorkspaceKeyKindMixed
          : I18N_KEYS.WorkspaceKeyKindNone,
  )
  const keysLine = $derived.by(() => {
    const countRequest: Parameters<typeof vault.t>[0] = {
      key:
        card.keyCount === 1
          ? I18N_KEYS.WorkspaceCardKeyCountSingular
          : I18N_KEYS.WorkspaceCardKeyCountPlural,
      replacements: { count: String(card.keyCount) },
    }
    return `${vault.t(kindKey)} · ${vault.t(countRequest)}`
  })

  const statusLabel = $derived.by(() => {
    switch (card.status) {
      case IdentityCardStatus.Unlocked:
        return vault.t(I18N_KEYS.WorkspaceStatusUnlocked)
      case IdentityCardStatus.Locked:
        return vault.t(I18N_KEYS.WorkspaceStatusLocked)
      case IdentityCardStatus.Inactive:
        return vault.t(I18N_KEYS.WorkspaceStatusInactive)
      case IdentityCardStatus.Elsewhere:
        return vault.t(I18N_KEYS.WorkspaceStatusElsewhere)
    }
  })

  function rowDisabled(row: IdentityVaultRow): boolean {
    return busy || row.state === IdentityVaultRowState.Unavailable
  }
</script>

<svelte:window onkeydown={closeMenuOnEscape} />

{#snippet panelRow(
  testId: string,
  title: string,
  hint: string,
  open: boolean,
  icon: Snippet,
  onclick: () => void,
)}
  <button
    type="button"
    class="nk-vault-row"
    data-testid={testId}
    aria-expanded={open}
    {...open ? { 'aria-current': 'true' } : {}}
    disabled={busy}
    {onclick}
  >
    <span class="nk-vault-icon" aria-hidden="true">{@render icon()}</span>
    <span class="flex min-w-0 flex-1 flex-col">
      <span class="truncate text-[0.9375rem] font-medium">{title}</span>
      <span class="truncate text-xs text-muted-foreground">{hint}</span>
    </span>
    <ChevronRight
      class="size-4 flex-none text-muted-foreground opacity-60"
      aria-hidden="true"
    />
  </button>
{/snippet}

{#snippet overviewIcon()}<LayoutDashboard class="size-4" />{/snippet}
{#snippet manageIcon()}<Settings2 class="size-4" />{/snippet}

<article
  class="nk-frame-keytag nk-frame-interactive min-w-0 {unlockPanel ||
  overviewPanel ||
  (managesHere && menuOpen) ||
  vaultOpenRow
    ? 'col-span-full grid grid-cols-1 lg:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]'
    : 'flex flex-col'}"
  class:nk-frame-live={live}
  aria-label={card.label}
  data-testid="identity-card"
  data-identity-id={card.identityId}
  data-status={card.status}
  data-unlocking={unlockPanel ? 'true' : 'false'}
>
  <span class="nk-eyelet" aria-hidden="true"></span>
  <div class="relative flex min-w-0 flex-1 flex-col">
    <header class="flex items-start gap-3.5 px-4 pb-4 pt-5 sm:px-5">
      <span class="relative inline-flex flex-none">
        <span class="nk-monogram" style:--nk-hue={card.hue} aria-hidden="true">
          {card.monogram}
        </span>
        <span class="nk-key-badge" aria-hidden="true">
          {#if card.keyKind === IdentityKeyKind.Pin}
            <Asterisk class="size-3" />
          {:else}
            <Fingerprint class="size-3" />
          {/if}
        </span>
      </span>
      <div class="min-w-0 flex-1 pr-4">
        <h3
          class="truncate text-lg font-semibold tracking-tight text-foreground"
          data-testid="identity-card-label"
        >
          {card.label || vault.t(I18N_KEYS.WorkspaceIdentityFallback)}
        </h3>
        <p
          class="mt-0.5 truncate text-[0.8125rem] text-muted-foreground"
          data-testid="identity-card-keys"
        >
          {keysLine}
        </p>
        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {#if live}
            <StatusTag
              tone={StatusTone.Success}
              label={statusLabel}
              title={vault.t(I18N_KEYS.WorkspaceStatusUnlockedTitle)}
              testId="identity-card-status"
            />
          {:else}
            <StatusTag
              mark={StatusMark.Icon}
              label={statusLabel}
              testId="identity-card-status"
            >
              {#snippet icon()}
                <Lock class="size-3" aria-hidden="true" />
              {/snippet}
            </StatusTag>
          {/if}
          {#if live && healthNote && !preview}
            <button
              type="button"
              class="nk-tag nk-tag-warning"
              data-testid="identity-card-health"
              disabled={busy}
              onclick={onHealth}
            >
              <TriangleAlert class="size-3" aria-hidden="true" />
              {healthNote}
            </button>
          {/if}
          {#if card.fingerprint.length > 0}
            <span
              class="nk-fingerprint"
              title={vault.t(I18N_KEYS.WorkspaceFingerprintTitle)}
            >
              {card.fingerprint.slice(0, 2).join(' ')}<span
                class="hidden sm:inline"
                >{card.fingerprint.length > 2 ? ' ' : ''}{card.fingerprint
                  .slice(2)
                  .join(' ')}</span
              >
            </span>
          {/if}
        </div>
      </div>
    </header>

    <section
      class="flex-1 border-t border-border px-2 pb-2 pt-1"
      aria-label={card.label}
    >
      <div class="flex items-center justify-between px-2.5 pb-1 pt-2">
        <span class="nk-label">{vault.t(I18N_KEYS.WorkspaceCardVaults)}</span>
        <span class="nk-label">{card.vaults.length}</span>
      </div>
      <ul>
        {#each card.vaults as row (row.storeId)}
          {@const selected =
            row.state !== IdentityVaultRowState.Open &&
            row.storeId === selectedStoreId}
          <li class="flex min-w-0 items-center">
            <button
              type="button"
              class="nk-vault-row min-w-0 flex-1"
              data-testid="identity-vault-row"
              data-store-id={row.storeId}
              data-state={row.state}
              data-extension-connected={extensionStoreIds.includes(row.storeId)
                ? 'true'
                : 'false'}
              {...row.state === IdentityVaultRowState.Open
                ? { 'aria-current': 'true' }
                : {}}
              {...selected ? { 'aria-pressed': 'true' } : {}}
              aria-expanded={vaultOpenId === row.storeId}
              {...row.state === IdentityVaultRowState.Available
                ? { title: vault.t(I18N_KEYS.WorkspaceVaultLockedHint) }
                : {}}
              disabled={rowDisabled(row)}
              onclick={() =>
                preview ? onOpenVault(row.storeId) : toggleVault(row.storeId)}
            >
              <span class="nk-vault-icon" aria-hidden="true">
                <FolderKey class="size-4" />
              </span>
              <span class="flex min-w-0 flex-col gap-1">
                <span class="truncate text-[0.9375rem] font-medium">
                  {row.label || vault.t(I18N_KEYS.WorkspaceVaultFallback)}
                </span>
                <LoginVaultPairingStatus
                  {vault}
                  status={pairingStatusFor(row.storeId)}
                />
              </span>
              {#if extensionStoreIds.includes(row.storeId)}
                <span
                  class="nk-tag flex-none text-foreground"
                  title={vault.t(I18N_KEYS.VaultSwitcherExtensionBadge)}
                  data-testid="identity-vault-extension-badge"
                >
                  <Puzzle class="size-3" aria-hidden="true" />
                  <span class="hidden sm:inline"
                    >{vault.t(I18N_KEYS.VaultSwitcherExtensionBadge)}</span
                  >
                </span>
              {/if}
              {#if row.state === IdentityVaultRowState.Open}
                <span class="nk-lead" aria-hidden="true"></span>
                <StatusTag
                  tone={StatusTone.Success}
                  label={vault.t(I18N_KEYS.WorkspaceVaultOpen)}
                />
              {:else if row.state === IdentityVaultRowState.Available}
                <CipherStrip class="min-w-4 flex-1 px-2" length={48} />
                {#if selected}
                  <StatusTag
                    label={vault.t(I18N_KEYS.WorkspaceVaultSelected)}
                  />
                {:else}
                  <Lock
                    class="size-3.5 flex-none text-muted-foreground opacity-70"
                    aria-hidden="true"
                  />
                {/if}
              {:else if row.state === IdentityVaultRowState.Dormant}
                <span class="min-w-4 flex-1" aria-hidden="true"></span>
                <span class="nk-tag">{vault.t(I18N_KEYS.WorkspaceVaultDormant)}</span>
              {:else}
                <span class="min-w-4 flex-1" aria-hidden="true"></span>
                <span class="nk-tag"
                  >{vault.t(I18N_KEYS.WorkspaceVaultUnavailable)}</span
                >
              {/if}
              {#if row.state === IdentityVaultRowState.Open || row.state === IdentityVaultRowState.Available}
                <ChevronRight
                  class="size-4 flex-none text-muted-foreground opacity-60"
                  aria-hidden="true"
                />
              {/if}
            </button>
          </li>
        {/each}
        {#if card.vaults.length === 0 && !canAddVault}
          <li
            class="px-2.5 py-2.5 text-sm text-muted-foreground"
            data-testid="identity-card-no-vaults"
          >
            {vault.t(I18N_KEYS.WorkspaceCardNoVaults)}
          </li>
        {/if}
        {#if canAddVault}
          <li>
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
          </li>
        {/if}
      </ul>
    </section>

    {#if onAddDevice && addDevicePrompt && !preview && (live || card.current)}
      <section class="border-t border-border px-2 py-2">
        <button
          type="button"
          class="nk-vault-row"
          data-testid="identity-add-device"
          disabled={busy}
          onclick={onAddDevice}
        >
          <span class="nk-vault-icon" aria-hidden="true">
            <MonitorSmartphone class="size-4" />
          </span>
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate text-[0.9375rem] font-medium"
              >{vault.t(I18N_KEYS.AddDeviceCardAction)}</span
            >
            <span class="truncate text-xs text-muted-foreground"
              >{vault.t(I18N_KEYS.AddDeviceCardHint)}</span
            >
          </span>
          <Plus
            class="size-4 flex-none text-muted-foreground"
            aria-hidden="true"
          />
        </button>
      </section>
    {/if}

    {#if managesHere}
      <section
        class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5 border-t border-border px-2 py-2"
      >
        {@render panelRow(
          'identity-overview-toggle',
          vault.t(I18N_KEYS.WorkspaceSectionOverview),
          vault.t(I18N_KEYS.IdentityMenuDetailsHint),
          overviewOpen,
          overviewIcon,
          toggleOverview,
        )}
        {@render panelRow(
          'identity-manage',
          vault.t(I18N_KEYS.WorkspaceManage),
          vault.t(I18N_KEYS.IdentityMenuManageHint),
          menuOpen,
          manageIcon,
          toggleManage,
        )}
      </section>
    {/if}

    {#if !preview}
      <div class="nk-card-actions">
        {#if card.status === IdentityCardStatus.Locked}
          <button
            type="button"
            data-testid="identity-unlock"
            title={vault.t(I18N_KEYS.WorkspaceUnlockIdentityTitle)}
            disabled={busy}
            onclick={() => onUnlock(card.identityId)}
          >
            <LockOpen class="size-4 text-muted-foreground" aria-hidden="true" />
            {vault.t(I18N_KEYS.WorkspaceUnlock)}
          </button>
        {:else if live}
          <button
            type="button"
            data-testid="identity-lock"
            title={vault.t(I18N_KEYS.WorkspaceLockIdentityTitle)}
            disabled={busy}
            onclick={onLock}
          >
            <Lock class="size-4 text-muted-foreground" aria-hidden="true" />
            {vault.t(I18N_KEYS.WorkspaceLock)}
          </button>
        {:else if card.status === IdentityCardStatus.Inactive}
          <button
            type="button"
            data-testid="identity-use"
            disabled={busy}
            onclick={() => onUseIdentity(card.identityId)}
          >
            <UserRoundCheck
              class="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            {vault.t(I18N_KEYS.WorkspaceUseIdentity)}
          </button>
        {/if}
      </div>
    {/if}
  </div>
  {#if unlockPanel}
    <div
      class="min-w-0 border-t border-border p-5 sm:p-6 lg:border-l lg:border-t-0 lg:px-7"
      data-testid="identity-card-unlock"
    >
      {@render unlockPanel()}
    </div>
  {:else if vaultOpenRow}
    <div
      class="min-w-0 border-t border-border p-5 sm:p-6 lg:border-l lg:border-t-0 lg:px-7"
      data-testid="identity-card-vault"
    >
      <VaultPanel
        {vault}
        row={vaultOpenRow}
        identityName={card.label}
        unlockLabel={card.keyKind === IdentityKeyKind.Pin
          ? vault.t(I18N_KEYS.WorkspaceVaultPanelUnlockPin)
          : vault.t(I18N_KEYS.WorkspaceVaultPanelUnlockPasskey)}
        {busy}
        passphraseOffered={!live && Boolean(onSelectVault)}
        {...passwordFallback && vaultOpenRow.storeId === selectedStoreId
          ? { passphrase: passwordFallback }
          : {}}
        onOpen={() => onOpenVault(vaultOpenRow.storeId)}
        onUseIdentity={() => onUseIdentity(card.identityId)}
        onManage={(section: WorkspaceSection) => {
          const target: IdentitySectionTarget = {
            identityId: card.identityId,
            storeId: vaultOpenRow.storeId,
            section,
          }
          onManageVault?.(target)
        }}
        onClose={() => (vaultOpenId = '')}
      />
    </div>
  {:else if managesHere && menuOpen}
    <div
      class="grid min-w-0 content-start gap-4 border-t border-border p-5 sm:p-6 lg:border-l lg:border-t-0 lg:px-7"
      data-testid="identity-card-manage"
    >
      <header class="flex items-center justify-between gap-3">
        <h2 class="text-lg font-semibold tracking-tight text-foreground">
          {vault.t(I18N_KEYS.WorkspaceManage)}
        </h2>
        <button
          type="button"
          class="grid size-8 place-items-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={vault.t(I18N_KEYS.IdentityOverviewClosePanel)}
          title={vault.t(I18N_KEYS.IdentityOverviewClosePanel)}
          data-testid="identity-manage-close"
          onclick={() => (menuOpen = false)}
        >
          <X class="size-4" aria-hidden="true" />
        </button>
      </header>
      <IdentityManageMenu {vault} onSelect={selectFromMenu} />
    </div>
  {:else if overviewPanel}
    <div
      class="min-w-0 border-t border-border p-5 sm:p-6 lg:border-l lg:border-t-0 lg:px-7"
      data-testid="identity-card-overview"
    >
      {@render overviewPanel()}
    </div>
  {/if}
</article>
