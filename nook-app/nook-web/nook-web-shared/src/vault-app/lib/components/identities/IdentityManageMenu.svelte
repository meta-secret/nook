<!--
Managing the identity this browser uses: add a device, add a sync provider,
and its vaults (add or rename). Manage on the card opens it beside the
card; Overview there only reports. A vault's own actions (its passphrases,
imports) sit in that vault's panel. A device joins through a cloud sync
provider, so until the identity has one, adding a provider leads and adding
a device waits for it.
-->
<script lang="ts">
  import { ChevronRight, Cloud, FolderKey, Lock, Plus } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'
  import { WorkspaceSection } from '$lib/vault/state/ui.svelte'
  import {
    DeviceJoinAvailability,
    DeviceJoinReadiness,
  } from '$lib/components/add-device/device-join-mounts'

  let {
    vault,
    onSelect,
  }: {
    vault: VaultState
    onSelect: (section: WorkspaceSection) => void
  } = $props()

  type MenuItem = {
    readonly section: WorkspaceSection
    readonly testId: string
    readonly label: string
    readonly hint: string
    readonly disabled: boolean
  }

  /** Unknown until the providers load: nothing locks early. */
  const needsCloud = $derived.by(() => {
    const request: ConstructorParameters<typeof DeviceJoinReadiness>[0] = {
      providers: vault.syncProviders,
      providersLoaded: vault.providersLoaded,
      replication: vault.vaultArchitecture.replication_type,
    }
    return (
      new DeviceJoinReadiness(request).availability ===
      DeviceJoinAvailability.NeedsCloud
    )
  })

  const items = $derived.by((): MenuItem[] => {
    const addDevice: MenuItem = {
      section: WorkspaceSection.AddDevice,
      testId: 'identity-menu-add-device',
      label: vault.t(I18N_KEYS.AddDeviceTitle),
      hint: vault.t(
        needsCloud
          ? I18N_KEYS.IdentityMenuAddDeviceNeedsCloud
          : I18N_KEYS.IdentityMenuAddDeviceHint,
      ),
      disabled: needsCloud,
    }
    const sync: MenuItem = {
      section: WorkspaceSection.Sync,
      testId: 'identity-menu-sync',
      label: vault.t(I18N_KEYS.AddDeviceCloudAction),
      hint: vault.t(I18N_KEYS.IdentityMenuSyncHint),
      disabled: false,
    }
    const vaults: MenuItem = {
      section: WorkspaceSection.Vaults,
      testId: 'identity-menu-vaults',
      label: vault.t(I18N_KEYS.WorkspaceSectionVaults),
      hint: vault.t(I18N_KEYS.IdentityMenuVaultsHint),
      disabled: false,
    }
    return needsCloud ? [sync, addDevice, vaults] : [addDevice, sync, vaults]
  })
</script>

{#snippet icon(section: WorkspaceSection)}
  {#if section === WorkspaceSection.AddDevice}
    <Plus class="size-4" />
  {:else if section === WorkspaceSection.Sync}
    <Cloud class="size-4" />
  {:else}
    <FolderKey class="size-4" />
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
      class="nk-identity-menu-item nk-plate disabled:cursor-default disabled:opacity-50"
      class:nk-identity-menu-lead={index === 0 && !item.disabled}
      data-testid={item.testId}
      disabled={item.disabled}
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
      {#if item.disabled}
        <Lock
          class="size-3.5 flex-none text-muted-foreground"
          aria-hidden="true"
        />
      {:else}
        <ChevronRight
          class="size-4 flex-none text-muted-foreground opacity-60"
          aria-hidden="true"
        />
      {/if}
    </button>
  {/each}
</div>
