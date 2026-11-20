<script lang="ts">
  import { ChevronRight } from '@lucide/svelte'
  import type { ProviderKeyringDetails } from '$app-wasm'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    details,
  }: { vault: VaultState; details: ProviderKeyringDetails } = $props()

  const vaultsLabel: Parameters<typeof vault.t>[0] = $derived({
    key: I18N_KEYS.ProviderVaultsVaultsDisclosure,
    replacements: { count: String(details.vaults.length) },
  })

  const devicesLabel = $derived.by(() => {
    switch (details.devices.state) {
      case 'Unavailable':
        return vault.t(I18N_KEYS.WorkspaceSectionDevices)
      case 'Listed': {
        const label: Parameters<typeof vault.t>[0] = {
          key: I18N_KEYS.ProviderVaultsDevicesDisclosure,
          replacements: { count: String(details.devices.devices.length) },
        }
        return vault.t(label)
      }
    }
  })
</script>

{#snippet summary(label: string)}
  <summary
    class="flex w-full cursor-pointer list-none items-center justify-between gap-3 px-1 py-2.5 text-sm font-medium text-foreground hover:text-primary focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"
  >
    {label}
    <ChevronRight
      class="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
      aria-hidden="true"
    />
  </summary>
{/snippet}

<div class="divide-y divide-border/70 border-y border-border/70">
  <details class="group min-w-0" data-testid="provider-keyring-vaults">
    {@render summary(vault.t(vaultsLabel))}
    {#if details.vaults.length === 0}
      <p class="px-1 pb-2.5 text-xs text-muted-foreground">
        {vault.t(I18N_KEYS.ProviderVaultsNoLinkedVaults)}
      </p>
    {:else}
      <ul class="divide-y divide-border/60 px-1 pb-1">
        {#each details.vaults as entry (entry.store_id)}
          <li class="min-w-0 space-y-1 py-1.5 text-sm">
            {#if entry.name.state === 'named'}
              <p class="break-words">{entry.name.name}</p>
            {:else}
              <p class="text-muted-foreground">
                {vault.t(I18N_KEYS.ProviderVaultsVaultNameUnavailable)}
              </p>
            {/if}
            <p class="break-all font-mono text-xs text-muted-foreground">
              {entry.store_id}
            </p>
          </li>
        {/each}
      </ul>
    {/if}
  </details>
  <details class="group min-w-0" data-testid="provider-keyring-devices">
    {@render summary(devicesLabel)}
    {#if details.devices.state === 'Unavailable'}
      <p class="px-1 pb-2.5 text-xs text-muted-foreground">
        {vault.t(I18N_KEYS.ProviderVaultsDevicesUnavailable)}
      </p>
    {:else if details.devices.devices.length === 0}
      <p class="px-1 pb-2.5 text-xs text-muted-foreground">
        {vault.t(I18N_KEYS.ProviderVaultsNoLinkedDevices)}
      </p>
    {:else}
      <ul class="divide-y divide-border/60 px-1 pb-1">
        {#each details.devices.devices as device (device.app_id)}
          <li class="min-w-0 space-y-1 py-1.5 text-sm">
            <p class="break-words">
              {#if device.label === ''}
                {vault.t(I18N_KEYS.ProviderVaultsUnnamedDevice)}
              {:else}
                {device.label}
              {/if}
            </p>
            <details
              class="text-xs text-muted-foreground"
              data-testid="provider-keyring-device-advanced"
            >
              <summary class="w-fit cursor-pointer">
                {vault.t(I18N_KEYS.ProviderVaultsAdvanced)}
              </summary>
              <dl class="mt-1 space-y-0.5">
                <dt>{vault.t(I18N_KEYS.ProviderVaultsAppId)}</dt>
                <dd class="break-all font-mono">{device.app_id}</dd>
              </dl>
            </details>
          </li>
        {/each}
      </ul>
    {/if}
  </details>
</div>
