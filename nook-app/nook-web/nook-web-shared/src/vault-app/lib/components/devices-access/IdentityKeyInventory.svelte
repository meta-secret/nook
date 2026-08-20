<!--
Reading this as: Operate-mode key inventory for one selected identity,
preserving Nook's evidence-aware copy, with a flat table as the primary scan
surface and technical inspection as a secondary action.
-->
<script lang="ts">
  import { Fingerprint, KeyRound, Plus, Settings } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'
  import type { DashboardView } from '../devices-access-dashboard-state'
  import { AccessChainStage } from './access-chain'
  import type { IdentityDirectoryEntry } from './identity-directory-view'
  import {
    buildIdentityKeyInventory,
    IdentityKeyInventoryActionKind,
    IdentityKeyInventoryRowKind,
  } from './identity-key-inventory'

  type IdentityKeyInventoryProps = {
    vault: VaultState
    identity: IdentityDirectoryEntry
    view: DashboardView
    selectedStage: AccessChainStage
    onSelectStage: (stage: AccessChainStage) => void
  }

  let { vault, identity, view, selectedStage, onSelectStage }:
    IdentityKeyInventoryProps = $props()

  const rows = $derived.by(() => {
    const inventoryArgs: Parameters<typeof buildIdentityKeyInventory>[0] = {
      vault,
      identity,
      view,
    }
    return buildIdentityKeyInventory(inventoryArgs)
  })

  function keysHeading(): string {
    const headingArgs: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.DevicesAccessKeysForIdentity,
      replacements: { identity: identity.label },
    }
    return vault.t(headingArgs)
  }
</script>

<section class="min-w-0" data-testid="devices-access-key-inventory">
  <header
    class="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between"
  >
    <div class="min-w-0">
      <h2 class="truncate text-xl font-semibold tracking-tight text-foreground">
        {identity.label}
      </h2>
      <p class="mt-1 text-sm text-muted-foreground">
        {vault.t(I18N_KEYS.DevicesAccessSelectedIdentity)}
      </p>
    </div>
    <Button
      type="button"
      variant="ghost"
      class="self-start sm:self-auto"
      data-testid="devices-access-identity-details"
      onclick={() => onSelectStage(AccessChainStage.DeviceKey)}
    >
      <Settings class="size-4" />
      {vault.t(I18N_KEYS.DevicesAccessIdentityDetails)}
    </Button>
  </header>

  <div class="mt-6">
    <p class="access-micro-label text-muted-foreground">{keysHeading()}</p>
    <div
      class="mt-4 hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(7rem,0.6fr)] gap-5 border-y border-border px-3 py-3 sm:grid"
      aria-hidden="true"
    >
      <span class="access-micro-label text-muted-foreground">
        {vault.t(I18N_KEYS.DevicesAccessKeyColumn)}
      </span>
      <span class="access-micro-label text-muted-foreground">
        {vault.t(I18N_KEYS.DevicesAccessProtectorColumn)}
      </span>
      <span class="access-micro-label text-muted-foreground">
        {vault.t(I18N_KEYS.DevicesAccessLastUsedColumn)}
      </span>
    </div>

    <ul class="divide-y divide-border border-b border-border">
      {#each rows as row (row.key)}
        {@const Icon =
          row.kind === IdentityKeyInventoryRowKind.Protector
            ? Fingerprint
            : KeyRound}
        <li>
          <button
            type="button"
            class="grid min-h-20 w-full gap-3 px-3 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(7rem,0.6fr)] sm:items-center sm:gap-5"
            class:bg-muted={selectedStage === row.stage &&
              row.action ===
                IdentityKeyInventoryActionKind.InspectCurrentBrowser}
            disabled={row.action === IdentityKeyInventoryActionKind.Unavailable}
            data-testid="devices-access-key-row"
            data-kind={row.kind}
            data-action={row.action}
            onclick={() => onSelectStage(row.stage)}
          >
            <span class="flex min-w-0 items-center gap-3">
              <span
                class="grid size-10 shrink-0 place-items-center rounded-full border border-border text-foreground"
                aria-hidden="true"
              >
                <Icon class="size-4" />
              </span>
              <span class="min-w-0">
                <span class="block truncate text-sm font-semibold text-foreground">
                  {row.title}
                </span>
                <span class="mt-0.5 block text-xs text-muted-foreground sm:hidden">
                  {row.typeLabel}
                </span>
              </span>
            </span>
            <span class="min-w-0">
              <span class="access-micro-label text-muted-foreground sm:hidden">
                {vault.t(I18N_KEYS.DevicesAccessProtectorColumn)}
              </span>
              <span class="mt-1 block truncate text-sm text-foreground sm:mt-0">
                {row.protector}
              </span>
            </span>
            <span class="min-w-0">
              <span class="access-micro-label text-muted-foreground sm:hidden">
                {vault.t(I18N_KEYS.DevicesAccessLastUsedColumn)}
              </span>
              <span class="mt-1 block text-sm text-foreground sm:mt-0">
                {row.lastUsed}
              </span>
            </span>
          </button>
        </li>
      {/each}
    </ul>

    <div class="mt-4">
      <Button type="button" variant="ghost" disabled>
        <Plus class="size-4" />
        {vault.t(I18N_KEYS.DevicesAccessAddKey)}
      </Button>
      <p class="mt-1 max-w-[60ch] text-xs leading-relaxed text-muted-foreground">
        {vault.t(I18N_KEYS.DevicesAccessAddKeyUnavailable)}
      </p>
    </div>
  </div>
</section>
