<!--
Management navigation for one subject: the identity (keys, vaults, devices,
sync, settings) or the open vault (backup passwords, import). One element:
a rail on wide screens and a bottom bar on phones.
-->
<script lang="ts">
  import {
    Download,
    FolderKey,
    KeyRound,
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
    ManageNavPlacement,
    type ManageNavItem,
  } from './manage-nav'

  let {
    vault,
    active,
    scope,
    vaultLabel = '',
    identityLabel = '',
    onSelect,
  }: {
    vault: VaultState
    active: WorkspaceSection
    /** Which subject is being managed; only its pages are listed. */
    scope: ManageSectionScope
    vaultLabel?: string
    identityLabel?: string
    onSelect: (section: WorkspaceSection) => void
  } = $props()

  const items = $derived(
    MANAGE_NAV_ITEMS.filter((item) => item.scope === scope),
  )
  const groupLabel = $derived(
    scope === ManageSectionScope.Identity
      ? `${vault.t(I18N_KEYS.WorkspaceNavGroupIdentity)}${identityLabel ? ` · ${identityLabel}` : ''}`
      : `${vault.t(I18N_KEYS.WorkspaceNavGroupVault)}${vaultLabel ? ` · ${vaultLabel}` : ''}`,
  )
</script>

{#snippet itemIcon(section: WorkspaceSection)}
  {#if section === WorkspaceSection.Keys}
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

{#snippet entry(item: ManageNavItem)}
  <li
    class={item.placement === ManageNavPlacement.RailOnly
      ? 'hidden md:block'
      : 'min-w-0 flex-1 md:flex-none'}
  >
    <button
      type="button"
      class="nk-manage-item"
      data-testid={item.testId}
      {...active === item.section ? { 'aria-current': 'page' } : {}}
      onclick={() => onSelect(item.section)}
    >
      {@render itemIcon(item.section)}
      <span class="hidden truncate md:inline">{vault.t(item.labelKey)}</span>
      <span class="truncate md:hidden">{vault.t(item.shortLabelKey)}</span>
    </button>
  </li>
{/snippet}

<nav
  class="nk-manage-nav"
  aria-label={vault.t(I18N_KEYS.WorkspaceNavLabel)}
  data-testid="manage-nav"
>
  <p class="nk-label hidden truncate px-2.5 pb-1 md:block" title={groupLabel}>
    {groupLabel}
  </p>
  <ul class="contents md:grid md:gap-0.5">
    {#each items as item (item.section)}
      {@render entry(item)}
    {/each}
  </ul>
</nav>
