<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import {
    Check,
    ChevronDown,
    FolderKey,
    Puzzle,
    SlidersHorizontal,
  } from '@lucide/svelte'
  import type { NookLocalVaultEntry } from '$app-wasm'
  import type { VaultState } from '$lib/vault.svelte'
  import { ActiveVaultKind } from '$lib/vault/state/provider.svelte'
  import type { ExtensionSetupOffer } from '$lib/app/extension-setup'
  import {
    ConnectedVaultMenuNoteKind,
    connectedVaultMenuNote,
    currentVaultCanPairExtension,
    resolveVaultExtensionLink,
    vaultEntryHoldsExtensionGrant,
    type ConnectedVaultMenuNoteRequest,
    type CurrentVaultPairingAvailabilityRequest,
    type ExtensionConnectedEntryRequest,
    type VaultExtensionLinkRequest,
    type VaultSwitcherEntryLabel,
  } from './vault-switcher-extension'
  import {
    DisplayedVaultKind,
    VaultSwitchStateKind,
    VaultSwitcherLayerKind,
    VaultSwitcherMenuPlacementKind,
    VaultSwitcherRootKind,
    placeVaultSwitcherMenu,
    portalVaultSwitcherMenu,
    vaultSwitcherContainsNode,
    type DisplayedVault,
    type VaultSwitchState,
    type VaultSwitcherContainsNodeRequest,
    type VaultSwitcherLayer,
    type VaultSwitcherMenuPlacement,
    type VaultSwitcherRoot,
  } from './vault-switcher-state'

  let {
    vault,
    extensionSetupState,
    onPairExtension,
  }: {
    vault: VaultState
    extensionSetupState: ExtensionSetupOffer
    onPairExtension: () => void
  } = $props()

  let open = $state(false)
  let root = $state<VaultSwitcherRoot>({
    kind: VaultSwitcherRootKind.Unmounted,
  })
  let trigger = $state<VaultSwitcherLayer>({
    kind: VaultSwitcherLayerKind.Unmounted,
  })
  let menu = $state<VaultSwitcherLayer>({
    kind: VaultSwitcherLayerKind.Unmounted,
  })
  let placement = $state<VaultSwitcherMenuPlacement>({
    kind: VaultSwitcherMenuPlacementKind.Closed,
  })
  let switchState = $state<VaultSwitchState>({
    kind: VaultSwitchStateKind.Idle,
  })

  const activeStoreId = $derived(
    vault.activeVault.kind === ActiveVaultKind.Open
      ? vault.activeVault.storeId.trim()
      : '',
  )
  const vaults = $derived(vault.localVaults)
  const unnamedLabel = $derived(vault.t(I18N_KEYS.LoginVaultPickerUnnamed))
  const entryLabels = $derived.by((): VaultSwitcherEntryLabel[] => {
    const labels: VaultSwitcherEntryLabel[] = []
    for (const entry of vaults) {
      const label: VaultSwitcherEntryLabel = {
        storeId: entry.storeId,
        displayName: entry.display_label(unnamedLabel),
      }
      labels.push(label)
    }
    return labels
  })
  const extensionLink = $derived.by(() => {
    const request: VaultExtensionLinkRequest = {
      offer: extensionSetupState,
      activeStoreId,
      entries: entryLabels,
    }
    return resolveVaultExtensionLink(request)
  })
  const canPairCurrentVault = $derived.by(() => {
    const request: CurrentVaultPairingAvailabilityRequest = {
      link: extensionLink,
      activeStoreId,
    }
    return currentVaultCanPairExtension(request)
  })
  const connectedNote = $derived.by(() => {
    const request: ConnectedVaultMenuNoteRequest = {
      link: extensionLink,
      entries: entryLabels,
    }
    return connectedVaultMenuNote(request)
  })
  const triggerHoldsGrant = $derived.by(() => {
    const request: ExtensionConnectedEntryRequest = {
      link: extensionLink,
      storeId: activeStoreId,
    }
    return vaultEntryHoldsExtensionGrant(request)
  })
  const activeVault = $derived.by((): DisplayedVault => {
    for (const entry of vaults) {
      if (entry.storeId === activeStoreId) {
        return { kind: DisplayedVaultKind.Available, entry }
      }
    }
    for (const entry of vaults) {
      return { kind: DisplayedVaultKind.Available, entry }
    }
    return { kind: DisplayedVaultKind.Unavailable }
  })
  const activeLabel = $derived(
    activeVault.kind === DisplayedVaultKind.Available
      ? activeVault.entry.display_label(unnamedLabel)
      : vault.t(I18N_KEYS.NavVault),
  )
  const vaultCount = $derived(vaults.length)
  const isBusy = $derived(
    vault.isVerifying ||
      vault.isInitializing ||
      switchState.kind === VaultSwitchStateKind.Switching,
  )

  const triggerClass =
    'inline-flex h-10 min-w-0 max-w-full items-center gap-2 rounded-lg border border-border/40 bg-background/60 px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:bg-background/70'

  function closeMenu() {
    open = false
    placement = { kind: VaultSwitcherMenuPlacementKind.Closed }
  }

  function handleDocumentClick(event: MouseEvent) {
    if (!open) return
    const target = event.target
    if (!(target instanceof Node)) {
      closeMenu()
      return
    }
    const containsRequest: VaultSwitcherContainsNodeRequest = {
      root,
      menu,
      node: target,
    }
    if (!vaultSwitcherContainsNode(containsRequest)) closeMenu()
  }

  function handleDocumentKeydown(event: KeyboardEvent) {
    if (open && event.key === 'Escape') closeMenu()
  }

  function handleViewportChange() {
    if (open) closeMenu()
  }

  function captureRoot(element: HTMLDivElement) {
    root = { kind: VaultSwitcherRootKind.Mounted, element }
    return {
      destroy() {
        root = { kind: VaultSwitcherRootKind.Unmounted }
      },
    }
  }

  function captureTrigger(element: HTMLButtonElement) {
    trigger = { kind: VaultSwitcherLayerKind.Mounted, element }
    return {
      destroy() {
        trigger = { kind: VaultSwitcherLayerKind.Unmounted }
      },
    }
  }

  function bindMenu(element: HTMLDivElement) {
    const portal = portalVaultSwitcherMenu(element)
    menu = { kind: VaultSwitcherLayerKind.Mounted, element }
    return {
      destroy() {
        portal.destroy()
        menu = { kind: VaultSwitcherLayerKind.Unmounted }
      },
    }
  }

  $effect(() => {
    if (!vault.isAuthenticated || vault.isVerifying) {
      open = false
      placement = { kind: VaultSwitcherMenuPlacementKind.Closed }
      return
    }
    if (!open) return
    document.addEventListener('click', handleDocumentClick)
    document.addEventListener('keydown', handleDocumentKeydown)
    window.addEventListener('scroll', handleViewportChange, true)
    window.addEventListener('resize', handleViewportChange)
    return () => {
      document.removeEventListener('click', handleDocumentClick)
      document.removeEventListener('keydown', handleDocumentKeydown)
      window.removeEventListener('scroll', handleViewportChange, true)
      window.removeEventListener('resize', handleViewportChange)
    }
  })

  async function toggleOpen() {
    if (open) {
      closeMenu()
      return
    }
    try {
      await vault.refreshLocalVaultCatalog()
      if (trigger.kind !== VaultSwitcherLayerKind.Mounted) {
        closeMenu()
        return
      }
      const anchor = placeVaultSwitcherMenu(
        trigger.element.getBoundingClientRect(),
      )
      placement = {
        kind: VaultSwitcherMenuPlacementKind.Open,
        top: anchor.top,
        left: anchor.left,
        minWidth: anchor.minWidth,
      }
      open = true
    } catch {
      closeMenu()
    }
  }

  async function switchTo(entry: NookLocalVaultEntry) {
    if (entry.storeId === activeStoreId || isBusy) return
    closeMenu()
    switchState = {
      kind: VaultSwitchStateKind.Switching,
      storeId: entry.storeId,
    }
    try {
      await vault.switchToVault(entry.storeId)
    } finally {
      switchState = { kind: VaultSwitchStateKind.Idle }
    }
  }

  function openAdmin() {
    closeMenu()
    vault.openAdmin()
  }

  function pairCurrentVault() {
    closeMenu()
    onPairExtension()
  }

  function optionHoldsGrant(storeId: string): boolean {
    const request: ExtensionConnectedEntryRequest = {
      link: extensionLink,
      storeId,
    }
    return vaultEntryHoldsExtensionGrant(request)
  }
</script>

{#if vaultCount > 0}
  <div use:captureRoot class="relative min-w-0 max-w-[min(100%,14rem)]">
    <button
      type="button"
      use:captureTrigger
      class="{triggerClass} text-left"
      aria-haspopup="menu"
      aria-expanded={open}
      data-testid="vault-switcher-trigger"
      data-extension-connected={triggerHoldsGrant ? 'true' : 'false'}
      disabled={isBusy}
      onclick={() => void toggleOpen()}
    >
      <FolderKey class="size-4 shrink-0 text-primary" />
      <span class="min-w-0 truncate text-foreground">{activeLabel}</span>
      {#if triggerHoldsGrant}
        <Puzzle class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
      {/if}
      <ChevronDown
        class="size-4 shrink-0 transition-transform {open ? 'rotate-180' : ''}"
      />
    </button>
  </div>
{/if}

{#if open && placement.kind === VaultSwitcherMenuPlacementKind.Open}
  <div
    use:bindMenu
    role="menu"
    tabindex="-1"
    aria-label={vault.t(I18N_KEYS.VaultSwitcherChoose)}
    class="fixed z-[80] max-w-[min(100vw-1rem,20rem)] rounded-lg border border-border/60 bg-popover p-2 shadow-lg"
    style:top="{placement.top}px"
    style:left="{placement.left}px"
    style:min-width="{placement.minWidth}px"
    data-testid="vault-switcher-menu"
    data-vault-count={vaultCount}
  >
    <p
      class="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
    >
      {vault.t(I18N_KEYS.VaultSwitcherYourVaults)}
    </p>
    <p
      class="px-2 pb-2 text-xs text-muted-foreground"
      data-testid="vault-switcher-count"
    >
      {vaultCount === 1
        ? vault.t(I18N_KEYS.VaultSwitcherOneOnDevice)
        : (() => {
            const translationRequest: Parameters<typeof vault.t>[0] = {
              key: I18N_KEYS.VaultSwitcherCountOnDevice,
              replacements: {
                count: String(vaultCount),
              },
            }
            return vault.t(translationRequest)
          })()}
    </p>
    {#if connectedNote.kind === ConnectedVaultMenuNoteKind.MissingLocally}
      <p
        class="px-2 pb-2 text-xs text-muted-foreground"
        data-testid="vault-switcher-connected-note"
      >
        {(() => {
          const connectedRequest: Parameters<typeof vault.t>[0] = {
            key: I18N_KEYS.VaultSwitcherExtensionConnected,
            replacements: {
              vault: connectedNote.vaultName,
            },
          }
          return vault.t(connectedRequest)
        })()}
      </p>
    {/if}
    <ul class="max-h-64 space-y-0.5 overflow-y-auto">
      {#each vaults as entry (entry.storeId)}
        {@const isActive = entry.storeId === activeStoreId}
        {@const holdsGrant = optionHoldsGrant(entry.storeId)}
        <li role="presentation">
          <button
            type="button"
            role="menuitemradio"
            aria-checked={isActive}
            class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors {isActive
              ? 'bg-primary/10 text-foreground'
              : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'}"
            data-testid="vault-switcher-option"
            data-store-id={entry.storeId}
            data-extension-connected={holdsGrant ? 'true' : 'false'}
            disabled={isBusy || isActive}
            onclick={() => void switchTo(entry)}
          >
            <FolderKey
              class="size-4 shrink-0 {isActive
                ? 'text-primary'
                : 'text-muted-foreground'}"
            />
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium">
                {entry.display_label(unnamedLabel)}
              </span>
              <span class="block truncate font-mono text-[10px] opacity-70">
                {entry.storeId}
              </span>
            </span>
            {#if holdsGrant}
              <span
                class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary"
                data-testid="vault-switcher-extension-badge"
              >
                {vault.t(I18N_KEYS.VaultSwitcherExtensionBadge)}
              </span>
            {/if}
            {#if isActive}
              <Check class="size-4 shrink-0 text-primary" />
            {/if}
          </button>
        </li>
      {/each}
    </ul>
    <div class="mt-1.5 border-t border-border/50 pt-1.5">
      {#if canPairCurrentVault}
        <button
          type="button"
          role="menuitem"
          class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium text-primary transition-colors hover:bg-accent/60"
          data-testid="vault-switcher-pair-btn"
          disabled={isBusy}
          onclick={(event) => {
            event.stopPropagation()
            pairCurrentVault()
          }}
        >
          <Puzzle class="size-4" />
          {vault.t(I18N_KEYS.VaultSwitcherPairThisVault)}
        </button>
      {/if}
      <button
        type="button"
        role="menuitem"
        class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium text-primary transition-colors hover:bg-accent/60"
        data-testid="vault-switcher-admin-btn"
        disabled={isBusy}
        onclick={(event) => {
          event.stopPropagation()
          openAdmin()
        }}
      >
        <SlidersHorizontal class="size-4" />
        {vault.t(I18N_KEYS.VaultSwitcherAdmin)}
      </button>
    </div>
  </div>
{/if}
