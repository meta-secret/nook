<!--
Management navigation. One element: a grouped rail on wide screens and a
bottom bar on phones, so every destination has exactly one control.
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
    vaultLabel = '',
    onSelect,
  }: {
    vault: VaultState
    active: WorkspaceSection
    vaultLabel?: string
    onSelect: (section: WorkspaceSection) => void
  } = $props()

  const identityItems = MANAGE_NAV_ITEMS.filter(
    (item) => item.scope === ManageSectionScope.Identity,
  )
  const vaultItems = MANAGE_NAV_ITEMS.filter(
    (item) => item.scope === ManageSectionScope.Vault,
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
  <li class={item.placement === ManageNavPlacement.RailOnly ? 'hidden md:block' : 'min-w-0 flex-1 md:flex-none'}>
    <button
      type="button"
      class="nk-manage-item"
      data-testid={item.testId}
      aria-current={active === item.section ? 'page' : undefined}
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
  <p class="nk-label hidden px-2.5 pb-1 md:block">
    {vault.t(I18N_KEYS.WorkspaceNavGroupIdentity)}
  </p>
  <ul class="contents md:grid md:gap-0.5">
    {#each identityItems as item (item.section)}
      {@render entry(item)}
    {/each}
  </ul>
  <p
    class="nk-label hidden truncate px-2.5 pb-1 pt-4 md:block"
    title={vaultLabel}
  >
    {vault.t(I18N_KEYS.WorkspaceNavGroupVault)}{vaultLabel
      ? ` · ${vaultLabel}`
      : ''}
  </p>
  <ul class="contents md:grid md:gap-0.5">
    {#each vaultItems as item (item.section)}
      {@render entry(item)}
    {/each}
  </ul>
</nav>
