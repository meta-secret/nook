<!--
Manage on the identity this browser uses: the things to do with it, adding
a device first, then the way to its details (devices, vaults, cloud copies,
sign-in). It drops over the card above its footer.
-->
<script lang="ts">
  import {
    ChevronRight,
    Cloud,
    IdCard,
    Plus,
    ShieldCheck,
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
      label: vault.t(I18N_KEYS.AddDeviceCloudAction),
      hint: vault.t(I18N_KEYS.IdentityMenuSyncHint),
    },
    {
      section: WorkspaceSection.Passwords,
      testId: "identity-menu-passwords",
      label: vault.t(I18N_KEYS.IdentityMenuPassword),
      hint: vault.t(I18N_KEYS.IdentityMenuPasswordHint),
    },
    {
      section: WorkspaceSection.Overview,
      testId: "identity-menu-details",
      label: vault.t(I18N_KEYS.IdentityMenuDetails),
      hint: vault.t(I18N_KEYS.IdentityMenuDetailsHint),
    },
  ]);
</script>

{#snippet icon(section: WorkspaceSection)}
  {#if section === WorkspaceSection.AddDevice}
    <Plus class="size-4" />
  {:else if section === WorkspaceSection.Sync}
    <Cloud class="size-4" />
  {:else if section === WorkspaceSection.Passwords}
    <ShieldCheck class="size-4" />
  {:else}
    <IdCard class="size-4" />
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
      class:nk-identity-menu-split={item.section === WorkspaceSection.Overview}
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
