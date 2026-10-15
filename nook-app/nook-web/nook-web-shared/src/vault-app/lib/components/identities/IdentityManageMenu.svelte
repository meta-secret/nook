<!--
Manage on the identity this browser uses: every action on the identity in
one list, adding a device first. It opens over the card above its footer
and each item opens its own focused page.
-->
<script lang="ts">
  import {
    ChevronRight,
    Cloud,
    FolderKey,
    KeyRound,
    MonitorSmartphone,
    Plus,
    ShieldCheck,
    SlidersHorizontal,
  } from "@lucide/svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import type { VaultState } from "$lib/vault.svelte";
  import { WorkspaceSection } from "$lib/vault/state/ui.svelte";

  let {
    vault,
    onSelect,
  }: {
    vault: VaultState;
    onSelect: (section: WorkspaceSection) => void;
  } = $props();

  type MenuItem = {
    readonly section: WorkspaceSection;
    readonly testId: string;
    readonly label: string;
    readonly hint: string;
  };

  const items = $derived.by((): MenuItem[] => [
    {
      section: WorkspaceSection.AddDevice,
      testId: "identity-menu-add-device",
      label: vault.t(I18N_KEYS.AddDeviceTitle),
      hint: vault.t(I18N_KEYS.IdentityMenuAddDeviceHint),
    },
    {
      section: WorkspaceSection.Sync,
      testId: "identity-menu-sync",
      label: vault.t(I18N_KEYS.WorkspaceSectionSync),
      hint: vault.t(I18N_KEYS.IdentityOverviewSyncCaption),
    },
    {
      section: WorkspaceSection.Devices,
      testId: "identity-menu-devices",
      label: vault.t(I18N_KEYS.WorkspaceSectionDevices),
      hint: vault.t(I18N_KEYS.IdentityOverviewDevicesCaption),
    },
    {
      section: WorkspaceSection.Vaults,
      testId: "identity-menu-vaults",
      label: vault.t(I18N_KEYS.WorkspaceSectionVaults),
      hint: vault.t(I18N_KEYS.IdentityOverviewVaultsCaption),
    },
    {
      section: WorkspaceSection.Keys,
      testId: "identity-menu-keys",
      label: vault.t(I18N_KEYS.IdentityOverviewKeysLink),
      hint: vault.t(I18N_KEYS.WorkspaceSectionKeysDescription),
    },
    {
      section: WorkspaceSection.Passwords,
      testId: "identity-menu-passwords",
      label: vault.t(I18N_KEYS.IdentityOverviewPasswordsLink),
      hint: vault.t(I18N_KEYS.WorkspaceSectionPasswordsDescription),
    },
    {
      section: WorkspaceSection.Settings,
      testId: "identity-menu-settings",
      label: vault.t(I18N_KEYS.IdentityMenuBrowser),
      hint: vault.t(I18N_KEYS.IdentityMenuBrowserHint),
    },
  ]);
</script>

{#snippet icon(section: WorkspaceSection)}
  {#if section === WorkspaceSection.AddDevice}
    <Plus class="size-4" />
  {:else if section === WorkspaceSection.Sync}
    <Cloud class="size-4" />
  {:else if section === WorkspaceSection.Devices}
    <MonitorSmartphone class="size-4" />
  {:else if section === WorkspaceSection.Vaults}
    <FolderKey class="size-4" />
  {:else if section === WorkspaceSection.Keys}
    <KeyRound class="size-4" />
  {:else if section === WorkspaceSection.Passwords}
    <ShieldCheck class="size-4" />
  {:else}
    <SlidersHorizontal class="size-4" />
  {/if}
{/snippet}

<div
  class="nk-identity-menu"
  role="menu"
  aria-label={vault.t(I18N_KEYS.IdentityMenuLabel)}
  data-testid="identity-menu"
>
  {#each items as item, index (item.section)}
    <button
      type="button"
      role="menuitem"
      class="nk-identity-menu-item"
      class:nk-identity-menu-lead={index === 0}
      data-testid={item.testId}
      onclick={() => onSelect(item.section)}
    >
      <span class="nk-vault-icon" aria-hidden="true">
        {@render icon(item.section)}
      </span>
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="truncate text-sm font-medium text-foreground"
          >{item.label}</span
        >
        <span class="truncate text-xs text-muted-foreground">{item.hint}</span>
      </span>
      <ChevronRight
        class="size-4 flex-none text-muted-foreground opacity-60"
        aria-hidden="true"
      />
    </button>
  {/each}
</div>
