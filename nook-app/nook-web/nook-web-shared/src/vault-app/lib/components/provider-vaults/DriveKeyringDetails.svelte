<script lang="ts">
  import type { ProviderKeyringDetails } from '$app-wasm'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    details,
  }: { vault: VaultState; details: ProviderKeyringDetails } = $props()
</script>

<div class="grid gap-3 sm:grid-cols-2">
  <section
    class="min-w-0 space-y-2"
    aria-label={vault.t(I18N_KEYS.ProviderVaultsLinkedDevices)}
    data-testid="provider-keyring-devices"
  >
    <p class="nk-subpanel-head">
      {vault.t(I18N_KEYS.ProviderVaultsLinkedDevices)}
    </p>
    {#if details.devices.state === 'Unavailable'}
      <p class="text-xs text-muted-foreground">
        {vault.t(I18N_KEYS.ProviderVaultsDevicesUnavailable)}
      </p>
    {:else if details.devices.devices.length === 0}
      <p class="text-xs text-muted-foreground">
        {vault.t(I18N_KEYS.ProviderVaultsNoLinkedDevices)}
      </p>
    {:else}
      <ul class="divide-y divide-border/60">
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
  </section>
  <section
    class="min-w-0 space-y-2"
    aria-label={vault.t(I18N_KEYS.ProviderVaultsLinkedVaults)}
    data-testid="provider-keyring-vaults"
  >
    <p class="nk-subpanel-head">
      {vault.t(I18N_KEYS.ProviderVaultsLinkedVaults)}
    </p>
    {#if details.vaults.length === 0}
      <p class="text-xs text-muted-foreground">
        {vault.t(I18N_KEYS.ProviderVaultsNoLinkedVaults)}
      </p>
    {:else}
      <ul class="divide-y divide-border/60">
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
  </section>
</div>
