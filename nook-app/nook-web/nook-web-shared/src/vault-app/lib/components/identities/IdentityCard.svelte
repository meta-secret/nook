<!--
Key-tag card for one identity: who it is (label, keys, session), what it
opens (its vaults), what still protects it from loss (a checklist row while
the unlocked identity is at risk), and what you can do (lock, manage).
Opening a vault is the unlock: while locked, the selected vault's unlock
panel sits inside the card, which then spans the full row.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import {
    PairedIdentityUnlockScope,
    type PairedIdentityUnlockTarget,
  } from '$lib/app/extension-identity-adoption'
  import IdentityManageMenu from './IdentityManageMenu.svelte'
  import IdentityProtectionPanel from './IdentityProtectionPanel.svelte'
  import VaultPanel from './VaultPanel.svelte'
  import {
    NookIdentityNudge,
    NookIdentityProtectionTaskState,
    type NookIdentityHealth,
    type NookIdentityNextStep,
  } from '$app-wasm'
  import { WorkspaceSection } from '$lib/vault/state/ui.svelte'
  import {
    Asterisk,
    ChevronRight,
    Fingerprint,
    FolderKey,
    Lock,
    LayoutDashboard,
    LockOpen,
    Plus,
    Puzzle,
    Settings2,
    ShieldAlert,
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
    onClosePanels = () => {},
    onUnlockVault,
    onUnlockElsewhere,
    onManageVault,
    onLock = () => {},
    onUnlock = () => {},
    onUseIdentity = () => {},
    health,
    onProtect,
    onManageSection,
    pairingStatusFor = () => ({
      kind: LoginVaultExtensionPairingStatusKind.NotShown,
    }),
    unlockPanel,
    overviewPanel,
    overviewOpen = false,
    passwordFallback,
    vaultExtension,
    requestPanel,
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
    /** Close what the page opened beside the card (New vault, an import)
     * when another panel opens here. */
    onClosePanels?: () => void
    /** Unlock a vault from its panel and stay on the card; Open vault in
     * the panel then goes in. */
    onUnlockVault?: (storeId: string) => void
    /** Unlock an identity whose key the paired extension holds. */
    onUnlockElsewhere?: (
      target: PairedIdentityUnlockTarget,
    ) => void | Promise<void>
    /** One of a vault's own pages (its passphrases, imports); a locked
     * vault unlocks first. */
    onManageVault?: (target: IdentitySectionTarget) => void
    onLock?: () => void
    /** Unlock the identity with this device's passkey. */
    onUnlock?: (identityId: string) => void | Promise<void>
    onUseIdentity?: (identityId: string) => void
    /** How the unlocked identity is protected against loss; until both
     * protections are done, the card offers its checklist. */
    health?: NookIdentityHealth
    /** Take the step that finishes an open protection task. */
    onProtect?: (action: NookIdentityNextStep) => void
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
    /** The browser extension for the open vault, in its panel. */
    vaultExtension?: Snippet
    /** A request waiting on this identity (a browser extension asking to
     * connect), beside the card when nothing else is open there. */
    requestPanel?: Snippet<[IdentityCardView]>
    /** A preview of a card that does not exist yet: no actions. */
    preview?: boolean
  } = $props()

  const live = $derived(card.status === IdentityCardStatus.Unlocked)
  /** An identity whose key another installation holds has no key on this
   * browser: the paired extension hands it over for one of its vaults
   * stored here, the one this page has selected when the card holds it. */
  const elsewhereStoreId = $derived.by((): string => {
    if (card.status !== IdentityCardStatus.Elsewhere) return ''
    const stored = card.vaults
      .filter(
        (row) =>
          row.state === IdentityVaultRowState.Available ||
          row.state === IdentityVaultRowState.Dormant,
      )
      .map((row) => row.storeId)
    if (stored.includes(selectedStoreId)) return selectedStoreId
    const [first = ''] = stored
    return first
  })
  const unlocksElsewhere = $derived(
    Boolean(onUnlockElsewhere) && elsewhereStoreId !== '',
  )
  /** While another identity is in use, this one's vaults are dormant: using
   * it leaves that identity first, so it reads Use identity, as their panels
   * say, rather than Unlock. */
  const usesElsewhere = $derived(
    unlocksElsewhere &&
      card.vaults.some(
        (row) =>
          row.storeId === elsewhereStoreId &&
          row.state === IdentityVaultRowState.Dormant,
      ),
  )

  function unlockElsewhere(storeId: string): void | Promise<void> {
    if (!onUnlockElsewhere) return
    const target: PairedIdentityUnlockTarget = {
      scope: PairedIdentityUnlockScope.CardVault,
      storeId,
      leavesCurrentIdentity: card.vaults.some(
        (row) =>
          row.storeId === storeId &&
          row.state === IdentityVaultRowState.Dormant,
      ),
    }
    return onUnlockElsewhere(target)
  }

  /** Unlock at the foot of a locked card: the identity unlocks alone. With a
   * vault's panel open beside the card, that vault then opens in place, as a
   * click on its row would, so the panel offers its actions. The call runs
   * within the click, before any wait: a paired extension needs the gesture. */
  async function unlockIdentity(): Promise<void> {
    await (unlocksElsewhere
      ? unlockElsewhere(elsewhereStoreId)
      : onUnlock(card.identityId))
    const row = vaultOpenRow
    if (live && row?.state === IdentityVaultRowState.Available)
      onUnlockVault?.(row.storeId)
  }
  // Overview, Manage and New vault need the unlocked identity: a locked
  // card keeps only its header and vaults.
  const managesHere = $derived(Boolean(onManageSection) && !preview && live)
  const addsVault = $derived(canAddVault && live)
  let menuOpen = $state(false)
  let protectionOpen = $state(false)
  /** The checklist row shows while the unlocked identity is at risk, and
   * leaves once both protections are done. */
  const protection = $derived(
    live && !preview && health && onProtect && !health.isProtected
      ? health
      : false,
  )
  const protectionDone = $derived(
    protection === false
      ? 0
      : protection.checklist.filter(
          (step) => step.state === NookIdentityProtectionTaskState.Done,
        ).length,
  )
  const protectionProgress = $derived.by(() => {
    if (protection === false) return ''
    const progressRequest: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.IdentityProtectionRowProgress,
      replacements: {
        done: String(protectionDone),
        total: String(protection.checklist.length),
      },
    }
    return vault.t(progressRequest)
  })

  function selectFromMenu(section: WorkspaceSection): void {
    menuOpen = false
    onManageSection?.(section)
  }

  /** One panel beside the card at a time: opening one closes the rest,
   * including what the page opened there (New vault, an import). */
  function closeOthers(): void {
    menuOpen = false
    protectionOpen = false
    vault.vaultPanelStoreId = ''
    if (overviewOpen) onManageSection?.(WorkspaceSection.Identities)
    onClosePanels()
  }

  function toggleOverview(): void {
    const opening = !overviewOpen
    closeOthers()
    if (opening) onManageSection?.(WorkspaceSection.Overview)
  }

  function toggleManage(): void {
    const opening = !menuOpen
    closeOthers()
    menuOpen = opening
  }

  function toggleProtection(): void {
    const opening = !protectionOpen
    closeOthers()
    protectionOpen = opening
  }

  function protect(action: NookIdentityNextStep): void {
    protectionOpen = false
    onProtect?.(action)
  }

  function openNewVault(): void {
    closeOthers()
    onNewVault()
  }

  /** A vault opened beside the card from its row: how to get in, and
   * what belongs to that vault alone. Kept on the vault state, so the
   * panel stays open while the vault unlocks. */
  const vaultOpenId = $derived(vault.vaultPanelStoreId)
  const vaultOpenRow = $derived(
    card.vaults.find((row) => row.storeId === vaultOpenId),
  )

  function toggleVault(storeId: string): void {
    if (vaultOpenId === storeId) {
      vault.vaultPanelStoreId = ''
      return
    }
    closeOthers()
    vault.vaultPanelStoreId = storeId
    const row = card.vaults.find((candidate) => candidate.storeId === storeId)
    if (row?.state === IdentityVaultRowState.Unavailable) return
    // An unlocked identity opens its vault in place with no prompt, so the
    // panel offers the vault's own actions straight away.
    if (live && row?.state === IdentityVaultRowState.Available && onUnlockVault)
      onUnlockVault(storeId)
    else onSelectVault?.(storeId)
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

  /** A vault this browser does not hold opens only on the unlocked
   * identity, which can delete it everywhere. */
  function rowDisabled(row: IdentityVaultRow): boolean {
    return busy || (row.state === IdentityVaultRowState.Unavailable && !live)
  }

  async function deleteAwayVault(storeId: string): Promise<void> {
    const deleted = await vault.identityControl.deleteVaultEverywhere(storeId)
    if (deleted.isOk()) vault.vaultPanelStoreId = ''
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
    class="nk-vault-row disabled:opacity-45"
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
  requestPanel ||
  (managesHere && menuOpen) ||
  (protection && protectionOpen) ||
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
  <span class="nk-edge-glint" aria-hidden="true"></span>
  {#if !preview && (card.status === IdentityCardStatus.Locked || card.status === IdentityCardStatus.Elsewhere)}
    <!-- Locking folds what only an unlocked identity offers back into the
         card: its header and vaults stay. -->
    <span class="nk-card-fold" aria-hidden="true" data-testid="identity-card-fold"
    ></span>
  {/if}
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

    {#if protection}
      <section class="border-t border-border px-2 py-2">
        <button
          type="button"
          class="nk-vault-row {protection.nudge === NookIdentityNudge.Urge
            ? 'bg-destructive/5'
            : 'bg-warning/5'}"
          data-testid="identity-protection-toggle"
          data-nudge={protection.nudge === NookIdentityNudge.Urge
            ? 'urge'
            : protection.nudge === NookIdentityNudge.Suggest
              ? 'suggest'
              : 'quiet'}
          aria-expanded={protectionOpen}
          {...protectionOpen ? { 'aria-current': 'true' } : {}}
          disabled={busy}
          onclick={toggleProtection}
        >
          <!-- Amber while a protection is missing; red once many items
               live only in this browser. -->
          <span
            class="nk-vault-icon {protection.nudge === NookIdentityNudge.Urge
              ? 'border-destructive/40 text-destructive'
              : 'border-warning/50 text-warning'}"
            aria-hidden="true"
          >
            <ShieldAlert class="size-4" />
          </span>
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate text-[0.9375rem] font-medium"
              >{vault.t(I18N_KEYS.IdentityProtectionRowTitle)}</span
            >
            <span
              class="truncate text-xs {protection.nudge === NookIdentityNudge.Urge
                ? 'text-destructive'
                : 'text-warning'}">{protectionProgress}</span
            >
          </span>
          <ChevronRight
            class="size-4 flex-none text-muted-foreground opacity-60"
            aria-hidden="true"
          />
        </button>
      </section>
    {/if}

    <section
      class="flex-1 border-t border-border px-2 pb-2 pt-1"
      aria-label={card.label}
    >
      <div class="flex items-center justify-between px-2.5 pb-1 pt-2">
        <span class="nk-label">{vault.t(I18N_KEYS.WorkspaceCardVaults)}</span>
        <span class="nk-label">{card.vaults.length}</span>
      </div>
      <!-- Rows size to the card, not the window: beside an open panel the
           card is narrow, so the extension badge keeps only its icon and
           a long state truncates rather than pushing the name out. -->
      <ul class="@container">
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
              <span class="flex min-w-10 flex-col gap-1">
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
                  <span class="hidden @sm:inline"
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
                <span class="nk-tag min-w-0"
                  ><span class="truncate"
                    >{vault.t(I18N_KEYS.WorkspaceVaultDormant)}</span
                  ></span
                >
              {:else}
                <span class="min-w-4 flex-1" aria-hidden="true"></span>
                <span class="nk-tag min-w-0"
                  ><span class="truncate"
                    >{vault.t(I18N_KEYS.WorkspaceVaultUnavailable)}</span
                  ></span
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
        {#if card.vaults.length === 0 && !addsVault}
          <li
            class="px-2.5 py-2.5 text-sm text-muted-foreground"
            data-testid="identity-card-no-vaults"
          >
            {vault.t(I18N_KEYS.WorkspaceCardNoVaults)}
          </li>
        {/if}
        {#if addsVault}
          <li>
            <button
              type="button"
              class="nk-vault-row nk-vault-row-add text-muted-foreground hover:text-foreground"
              data-testid="identity-new-vault"
              disabled={busy}
              onclick={openNewVault}
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
        {#if card.status === IdentityCardStatus.Locked || (unlocksElsewhere && !usesElsewhere)}
          <button
            type="button"
            data-testid="identity-unlock"
            title={vault.t(I18N_KEYS.WorkspaceUnlockIdentityTitle)}
            disabled={busy}
            onclick={() => void unlockIdentity()}
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
        {:else if card.status === IdentityCardStatus.Inactive || usesElsewhere}
          <!-- An identity not in use here makes it current, as its vaults'
               panels offer: one stored on this browser switches to its key,
               one the paired extension holds is handed over by it. -->
          <button
            type="button"
            data-testid="identity-use"
            disabled={busy}
            onclick={() =>
              usesElsewhere
                ? void unlockElsewhere(elsewhereStoreId)
                : onUseIdentity(card.identityId)}
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
        identityOpen={live}
        {busy}
        passphraseOffered={!live && Boolean(onSelectVault)}
        {...passwordFallback && vaultOpenRow.storeId === selectedStoreId
          ? { passphrase: passwordFallback }
          : {}}
        {...vaultExtension ? { extension: vaultExtension } : {}}
        onOpen={() => onOpenVault(vaultOpenRow.storeId)}
        onUnlock={() => onUnlockVault?.(vaultOpenRow.storeId)}
        onUseIdentity={() =>
          card.status === IdentityCardStatus.Elsewhere
            ? void unlockElsewhere(vaultOpenRow.storeId)
            : onUseIdentity(card.identityId)}
        onManage={(section: WorkspaceSection) => {
          const target: IdentitySectionTarget = {
            identityId: card.identityId,
            storeId: vaultOpenRow.storeId,
            section,
          }
          onManageVault?.(target)
        }}
        {...live && vaultOpenRow.state === IdentityVaultRowState.Unavailable
          ? { onDelete: () => deleteAwayVault(vaultOpenRow.storeId) }
          : {}}
        onClose={() => (vault.vaultPanelStoreId = '')}
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
  {:else if protection && protectionOpen}
    <div
      class="min-w-0 border-t border-border p-5 sm:p-6 lg:border-l lg:border-t-0 lg:px-7"
      data-testid="identity-card-protection"
    >
      <IdentityProtectionPanel
        {vault}
        health={protection}
        identityName={card.label || vault.t(I18N_KEYS.WorkspaceIdentityFallback)}
        {busy}
        onAction={protect}
        onClose={() => (protectionOpen = false)}
      />
    </div>
  {:else if overviewPanel}
    <div
      class="min-w-0 border-t border-border p-5 sm:p-6 lg:border-l lg:border-t-0 lg:px-7"
      data-testid="identity-card-overview"
    >
      {@render overviewPanel()}
    </div>
  {:else if requestPanel}
    <div
      class="min-w-0 border-t border-border p-5 sm:p-6 lg:border-l lg:border-t-0 lg:px-7"
      data-testid="identity-card-request"
    >
      {@render requestPanel(card)}
    </div>
  {/if}
</article>
