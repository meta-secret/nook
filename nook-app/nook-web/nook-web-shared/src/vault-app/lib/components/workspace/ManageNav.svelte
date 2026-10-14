<!--
Identity management navigation. The identity sits on top and leads back to
the identities hub. Its overview comes first and stands apart, then the
identity's parts (vaults, sync, devices), then security and settings. Vault
pages never show it: a vault has only its items and imports. One element: a
rail inside the shell on wide screens and a bottom bar on phones, where the
identity's parts stay in the bar and security and settings open from More.
-->
<script lang="ts">
  import {
    ChevronsUpDown,
    Download,
    Ellipsis,
    Fingerprint,
    FolderKey,
    KeyRound,
    LayoutGrid,
    MonitorSmartphone,
    RefreshCw,
    ShieldCheck,
    SlidersHorizontal,
  } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    ManageSectionScope,
    WorkspaceSection,
  } from '$lib/vault/state/ui.svelte'
  import {
    MANAGE_NAV_ITEMS,
    ManageNavTier,
    type ManageNavItem,
  } from './manage-nav'

  let {
    vault,
    active,
    identityLabel,
    pendingJoinCount = 0,
    syncMissing = false,
    deviceMissing = false,
    onSelect,
  }: {
    vault: VaultState
    active: WorkspaceSection
    identityLabel: string
    /** Join requests waiting for this identity's approval. */
    pendingJoinCount?: number
    /** The identity has no sync provider, so it lives only here. */
    syncMissing?: boolean
    /** The identity's next step is a second app. */
    deviceMissing?: boolean
    onSelect: (section: WorkspaceSection) => void
  } = $props()

  const identityItems = MANAGE_NAV_ITEMS.filter(
    (item) => item.scope === ManageSectionScope.Identity,
  )
  const homeItems = identityItems.filter(
    (item) => item.tier === ManageNavTier.Home,
  )
  const partItems = identityItems.filter(
    (item) => item.tier === ManageNavTier.Parts,
  )
  const securityItems = identityItems.filter(
    (item) => item.tier === ManageNavTier.Security,
  )
  const generalItems = identityItems.filter(
    (item) => item.tier === ManageNavTier.General,
  )
  const sheetSections = [...securityItems, ...generalItems].map(
    (item) => item.section,
  )
  const sheetActive = $derived(sheetSections.includes(active))

  let moreOpen = $state(false)
  let navElement = $state<HTMLElement>()

  function select(section: WorkspaceSection): void {
    moreOpen = false
    onSelect(section)
  }

  function closeOnOutsidePointer(event: PointerEvent): void {
    if (!moreOpen || !navElement) return
    if (event.target instanceof Node && navElement.contains(event.target))
      return
    moreOpen = false
  }

  function closeOnEscape(event: KeyboardEvent): void {
    if (moreOpen && event.key === 'Escape') moreOpen = false
  }
</script>

<svelte:window
  onpointerdown={closeOnOutsidePointer}
  onkeydown={closeOnEscape}
/>

{#snippet itemIcon(section: WorkspaceSection)}
  {#if section === WorkspaceSection.Overview}
    <LayoutGrid class="size-[1.125rem] shrink-0" aria-hidden="true" />
  {:else if section === WorkspaceSection.Sync}
    <RefreshCw class="size-[1.125rem] shrink-0" aria-hidden="true" />
  {:else if section === WorkspaceSection.Devices}
    <MonitorSmartphone class="size-[1.125rem] shrink-0" aria-hidden="true" />
  {:else if section === WorkspaceSection.Keys}
    <KeyRound class="size-[1.125rem] shrink-0" aria-hidden="true" />
  {:else if section === WorkspaceSection.Vaults}
    <FolderKey class="size-[1.125rem] shrink-0" aria-hidden="true" />
  {:else if section === WorkspaceSection.Settings}
    <SlidersHorizontal class="size-[1.125rem] shrink-0" aria-hidden="true" />
  {:else if section === WorkspaceSection.Passwords}
    <ShieldCheck class="size-[1.125rem] shrink-0" aria-hidden="true" />
  {:else}
    <Download class="size-[1.125rem] shrink-0" aria-hidden="true" />
  {/if}
{/snippet}

{#snippet status(section: WorkspaceSection)}
  {#if section === WorkspaceSection.Devices && pendingJoinCount > 0}
    <span class="nk-manage-badge" data-testid="manage-nav-pending-joins">
      {pendingJoinCount}
    </span>
  {:else if section === WorkspaceSection.Sync && syncMissing}
    <span
      class="nk-manage-dot"
      title={vault.t(I18N_KEYS.WorkspaceNavSyncMissing)}
      data-testid="manage-nav-sync-missing"
    ></span>
  {:else if section === WorkspaceSection.Devices && deviceMissing}
    <span
      class="nk-manage-dot"
      title={vault.t(I18N_KEYS.IdentityHealthDeviceTitle)}
      data-testid="manage-nav-device-missing"
    ></span>
  {/if}
{/snippet}

{#snippet listed(item: ManageNavItem)}
  <li class="contents md:block">
    <button
      type="button"
      class="nk-manage-item"
      class:nk-manage-item-home={item.section === WorkspaceSection.Overview}
      data-testid={item.testId}
      {...active === item.section ? { 'aria-current': 'page' } : {}}
      onclick={() => select(item.section)}
    >
      {@render itemIcon(item.section)}
      {#if sheetSections.includes(item.section)}
        <span class="min-w-0 truncate">{vault.t(item.labelKey)}</span>
      {:else}
        <span class="hidden min-w-0 truncate md:inline"
          >{vault.t(item.labelKey)}</span
        >
        <span class="truncate md:hidden">{vault.t(item.shortLabelKey)}</span>
      {/if}
      {@render status(item.section)}
    </button>
  </li>
{/snippet}

<nav
  bind:this={navElement}
  class="nk-manage-nav"
  aria-label={vault.t(I18N_KEYS.WorkspaceNavLabel)}
  data-testid="manage-nav"
>
  <button
    type="button"
    class="nk-manage-identity"
    title={vault.t(I18N_KEYS.WorkspaceNavAllIdentities)}
    data-testid="manage-nav-identities"
    onclick={() => onSelect(WorkspaceSection.Identities)}
  >
    <span class="nk-monogram nk-monogram-sm grid shrink-0 place-items-center">
      <Fingerprint class="size-4" aria-hidden="true" />
    </span>
    <span class="min-w-0 flex-1">
      <span class="block truncate text-sm font-semibold text-foreground">
        {identityLabel}
      </span>
      <span class="block truncate text-xs text-muted-foreground">
        {vault.t(I18N_KEYS.WorkspaceNavAllIdentities)}
      </span>
    </span>
    <ChevronsUpDown
      class="size-4 shrink-0 text-muted-foreground"
      aria-hidden="true"
    />
  </button>

  <ul class="contents md:grid md:gap-0.5">
    {#each homeItems as item (item.section)}
      {@render listed(item)}
    {/each}
  </ul>

  <div class="nk-manage-group">
    <p class="nk-label hidden truncate px-2.5 pb-1 md:block">
      {vault.t(I18N_KEYS.WorkspaceNavGroupParts)}
    </p>
    <ul class="contents md:grid md:gap-0.5">
      {#each partItems as item (item.section)}
        {@render listed(item)}
      {/each}
    </ul>
  </div>

  <div
    id="manage-nav-more-sheet"
    class="nk-manage-more"
    class:nk-manage-more-open={moreOpen}
    data-testid="manage-nav-more-sheet"
  >
    <div class="nk-manage-group">
      <p class="nk-label truncate px-2.5 pb-1">
        {vault.t(I18N_KEYS.WorkspaceNavGroupSecurity)}
      </p>
      <ul class="grid gap-0.5">
        {#each securityItems as item (item.section)}
          {@render listed(item)}
        {/each}
      </ul>
    </div>

    <ul class="nk-manage-group grid gap-0.5 md:mt-auto">
      {#each generalItems as item (item.section)}
        {@render listed(item)}
      {/each}
    </ul>
  </div>

  <button
    type="button"
    class="nk-manage-item md:hidden"
    title={vault.t(I18N_KEYS.WorkspaceNavMoreTitle)}
    aria-expanded={moreOpen}
    aria-controls="manage-nav-more-sheet"
    data-testid="manage-nav-more"
    {...sheetActive ? { 'aria-current': 'page' } : {}}
    onclick={() => (moreOpen = !moreOpen)}
  >
    <Ellipsis class="size-[1.125rem] shrink-0" aria-hidden="true" />
    <span class="truncate">{vault.t(I18N_KEYS.WorkspaceNavMore)}</span>
  </button>
</nav>
