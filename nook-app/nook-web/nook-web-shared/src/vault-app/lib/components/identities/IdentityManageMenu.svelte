<!--
Actions on the identity this browser uses, adding a device first. Manage on
the card opens them beside it; Overview there shows what the identity has.
A vault's own actions (its passphrases) sit in that vault's panel.
-->
<script lang="ts">
  import {
    ChevronRight,
    Cloud,
    Plus,
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
  ]);
</script>

{#snippet icon(section: WorkspaceSection)}
  {#if section === WorkspaceSection.AddDevice}
    <Plus class="size-4" />
  {:else}
    <Cloud class="size-4" />
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
      class="nk-identity-menu-item border border-border"
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
