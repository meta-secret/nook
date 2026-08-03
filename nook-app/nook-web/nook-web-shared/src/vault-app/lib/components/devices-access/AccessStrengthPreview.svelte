<!-- The truthful three-link chain before this browser has chosen an identity. -->
<script lang="ts">
  import { Laptop, Link2, Vault as VaultIcon } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'
  import type { VaultAccessView } from './access-chain'

  let { vault, vaults }: { vault: VaultState; vaults: VaultAccessView[] } =
    $props()

</script>

<div class="space-y-8" data-testid="devices-access-chain-preview">
  <section>
    <h2 class="access-micro-label flex items-center gap-1.5 text-muted-foreground">
      <Link2 class="size-3.5" aria-hidden="true" />
      {vault.t(I18N_KEYS.DevicesAccessIdentitiesSection)}
    </h2>
    <div
      class="mt-3 flex min-h-14 max-w-sm items-center gap-3 rounded-r-md rounded-l-full border border-dashed border-border bg-card py-2 pr-3 pl-2"
    >
      <span
        class="grid size-9 shrink-0 place-items-center rounded-full border-2 border-dashed border-muted-foreground/45"
        aria-hidden="true"
      >
        <Link2 class="size-4 text-muted-foreground" />
      </span>
      <span class="text-sm text-muted-foreground">
        {vault.t(I18N_KEYS.DevicesAccessIdentityMissing)}
      </span>
    </div>
  </section>

  <p class="access-micro-label text-center text-muted-foreground">
    {vault.t(I18N_KEYS.DevicesAccessLinkUnlocks)}
  </p>

  <div class="border border-dashed border-border bg-card px-4 py-4 sm:px-5">
    <p class="access-micro-label text-muted-foreground">
      {vault.t(I18N_KEYS.DevicesAccessBrowserSection)}
    </p>
    <p class="mt-1.5 flex items-center gap-2 font-mono text-xl text-muted-foreground">
      <Laptop class="size-5" aria-hidden="true" />
      {vault.t(I18N_KEYS.DevicesAccessNotPrepared)}
    </p>
  </div>

  <p class="access-micro-label text-center text-muted-foreground">
    {vault.t(
      vaults.length === 0
        ? I18N_KEYS.DevicesAccessLinkOpens
        : I18N_KEYS.DevicesAccessLinkUnverified,
    )}
  </p>

  <section>
    <h2 class="access-micro-label flex items-center gap-1.5 text-muted-foreground">
      <VaultIcon class="size-3.5" aria-hidden="true" />
      {vault.t(I18N_KEYS.DevicesAccessVaultAccessSection)}
    </h2>
    {#if vaults.length === 0}
      <div class="mt-3 border border-dashed border-border px-4 py-5">
        <p class="text-sm text-muted-foreground">
          {vault.t(I18N_KEYS.DevicesAccessNoVaults)}
        </p>
      </div>
    {:else}
      <p class="mt-3 text-sm text-muted-foreground">
        {vault.t(I18N_KEYS.DevicesAccessKnownVaultsUnprepared)}
      </p>
      <ul class="mt-3 space-y-2" data-testid="devices-access-preview-vaults">
        {#each vaults as entry (entry.storeId)}
          <li class="flex items-center gap-3 border border-dashed border-border bg-card px-4 py-3">
            <VaultIcon class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-foreground">
                {entry.label}
              </span>
            </span>
            <span class="shrink-0 text-[0.65rem] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              {vault.t(I18N_KEYS.DevicesAccessAccessUnknown)}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>
