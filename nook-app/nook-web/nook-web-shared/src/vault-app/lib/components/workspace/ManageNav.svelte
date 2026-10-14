<!--
Workspace navigation, always present while unlocked. The identity sits on
top and leads back to the identities hub; the open vault's pages come next,
then the identity's own pages. One element: a rail inside the shell on wide
screens and a scrolling bottom bar on phones.
-->
<script lang="ts">
  import {
    ChevronsUpDown,
    Download,
    Fingerprint,
    FolderKey,
    KeyRound,
    MonitorSmartphone,
    RefreshCw,
    ShieldCheck,
    SlidersHorizontal,
    Vault,
  } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    ManageSectionScope,
    WorkspaceSection,
  } from '$lib/vault/state/ui.svelte'
  import { MANAGE_NAV_ITEMS, type ManageNavItem } from './manage-nav'

  let {
    vault,
    active,
    vaultLabel,
    identityLabel,
    pendingJoinCount = 0,
    syncMissing = false,
    onSelect,
  }: {
    vault: VaultState
    active: WorkspaceSection
    vaultLabel: string
    identityLabel: string
    /** Join requests waiting for this identity's approval. */
    pendingJoinCount?: number
    /** The identity has no sync provider, so it lives only here. */
    syncMissing?: boolean
    onSelect: (section: WorkspaceSection) => void
  } = $props()

  const vaultItems = $derived(
    MANAGE_NAV_ITEMS.filter((item) => item.scope === ManageSectionScope.Vault),
  )
  const identityItems = $derived(
    MANAGE_NAV_ITEMS.filter(
      (item) => item.scope === ManageSectionScope.Identity,
    ),
  )
</script>

{#snippet itemIcon(section: WorkspaceSection)}
  {#if section === WorkspaceSection.Vault}
    <Vault class="size-[1.125rem] shrink-0" aria-hidden="true" />
  {:else if section === WorkspaceSection.Keys}
    <KeyRound class="size-[1.125rem] shrink-0" aria-hidden="true" />
  {:else if section === WorkspaceSection.Vaults}
    <FolderKey class="size-[1.125rem] shrink-0" aria-hidden="true" />
  {:else if section === WorkspaceSection.Settings}
    <SlidersHorizontal class="size-[1.125rem] shrink-0" aria-hidden="true" />
  {:else if section === WorkspaceSection.Devices}
    <MonitorSmartphone class="size-[1.125rem] shrink-0" aria-hidden="true" />
  {:else if section === WorkspaceSection.Sync}
    <RefreshCw class="size-[1.125rem] shrink-0" aria-hidden="true" />
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
  {/if}
{/snippet}

{#snippet entry(section: WorkspaceSection, testId: string, label: string, shortLabel: string)}
  <li class="contents md:block">
    <button
      type="button"
      class="nk-manage-item"
      data-testid={testId}
      {...active === section ? { 'aria-current': 'page' } : {}}
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

  <div class="nk-manage-group">
    <p class="nk-label hidden truncate px-2.5 pb-1 md:block" title={vaultLabel}>
      {vault.t(I18N_KEYS.WorkspaceNavGroupVault)} · {vaultLabel}
    </p>
    <ul class="contents md:grid md:gap-0.5">
      {@render entry(
        WorkspaceSection.Vault,
        'manage-nav-items',
        vault.t(I18N_KEYS.WorkspaceNavItems),
        vault.t(I18N_KEYS.WorkspaceNavItems),
      )}
      {#each vaultItems as item (item.section)}
        {@render listed(item)}
      {/each}
    </ul>
  </div>

  <div class="nk-manage-group">
    <p class="nk-label hidden truncate px-2.5 pb-1 md:block">
      {vault.t(I18N_KEYS.WorkspaceNavGroupIdentity)}
    </p>
    <ul class="contents md:grid md:gap-0.5">
      {#each identityItems as item (item.section)}
        {@render listed(item)}
      {/each}
    </ul>
  </div>
</nav>
