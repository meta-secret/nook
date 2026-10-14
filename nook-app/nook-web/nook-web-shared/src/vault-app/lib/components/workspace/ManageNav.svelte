<!--
Identity management navigation. The identity sits on top and leads back to
the identities hub. Its home (vaults, sync, devices) comes first and stands apart;
security pages and settings follow. Vault pages never show it: a vault has
only its items and imports. One element: a rail inside the shell on wide
screens and a scrolling bottom bar on phones.
-->
<script lang="ts">
  import {
    ChevronsUpDown,
    Download,
    Fingerprint,
    FolderKey,
    KeyRound,
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
    ManageNavLookup,
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
  const securityItems = identityItems.filter(
    (item) => item.tier === ManageNavTier.Security,
  )
  const generalItems = identityItems.filter(
    (item) => item.tier === ManageNavTier.General,
  )
  const activeNavSection = $derived(new ManageNavLookup(active).navSection)
</script>

{#snippet itemIcon(section: WorkspaceSection)}
  {#if section === WorkspaceSection.Keys}
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
  {#if section === WorkspaceSection.Vaults && pendingJoinCount > 0}
    <span class="nk-manage-badge" data-testid="manage-nav-pending-joins">
      {pendingJoinCount}
    </span>
  {:else if section === WorkspaceSection.Vaults && syncMissing}
    <span
      class="nk-manage-dot"
      title={vault.t(I18N_KEYS.WorkspaceNavSyncMissing)}
      data-testid="manage-nav-sync-missing"
    ></span>
  {:else if section === WorkspaceSection.Vaults && deviceMissing}
    <span
      class="nk-manage-dot"
      title={vault.t(I18N_KEYS.IdentityHealthDeviceTitle)}
      data-testid="manage-nav-device-missing"
    ></span>
  {/if}
{/snippet}

{#snippet entry(section: WorkspaceSection, testId: string, label: string, shortLabel: string)}
  <li class="contents md:block">
    <button
      type="button"
      class="nk-manage-item"
      class:nk-manage-item-home={section === WorkspaceSection.Vaults}
      data-testid={testId}
      {...activeNavSection === section ? { 'aria-current': 'page' } : {}}
      onclick={() => onSelect(section)}
    >
      {@render itemIcon(section)}
      <span class="hidden min-w-0 truncate md:inline">{label}</span>
      <span class="truncate md:hidden">{shortLabel}</span>
      {@render status(section)}
    </button>
  </li>
{/snippet}

{#snippet listed(item: ManageNavItem)}
  {@render entry(
    item.section,
    item.testId,
    vault.t(item.labelKey),
    vault.t(item.shortLabelKey),
  )}
{/snippet}

<nav
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
      {vault.t(I18N_KEYS.WorkspaceNavGroupSecurity)}
    </p>
    <ul class="contents md:grid md:gap-0.5">
      {#each securityItems as item (item.section)}
        {@render listed(item)}
      {/each}
    </ul>
  </div>

  <ul class="nk-manage-group contents md:mt-auto md:grid md:gap-0.5">
    {#each generalItems as item (item.section)}
      {@render listed(item)}
    {/each}
  </ul>
</nav>
