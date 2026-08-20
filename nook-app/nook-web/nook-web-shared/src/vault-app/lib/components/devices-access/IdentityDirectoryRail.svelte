<!--
Reading this as: Operate-mode identity navigation for a person who owns several
authorization contexts, preserving Nook's quiet list rhythm, with selection and
creation as the primary interactions.
-->
<script lang="ts">
  import { ChevronRight, Fingerprint, Plus } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'
  import type { DashboardView } from '../devices-access-dashboard-state'
  import type { IdentityDirectoryEntry } from './identity-directory-view'
  import { buildIdentityKeyInventory } from './identity-key-inventory'

  type IdentityDirectoryRailProps = {
    vault: VaultState
    view: DashboardView
    identities: readonly IdentityDirectoryEntry[]
    selectedIdentityId: string
    onSelectIdentity: (identityId: string) => void
  }

  let {
    vault,
    view,
    identities,
    selectedIdentityId,
    onSelectIdentity,
  }: IdentityDirectoryRailProps = $props()

  type CountLabelRequest = {
    count: number
    singularKey: string
    pluralKey: string
  }

  function countLabel({
    count,
    singularKey,
    pluralKey,
  }: CountLabelRequest): string {
    const countArgs: Parameters<typeof vault.t>[0] = {
      key: count === 1 ? singularKey : pluralKey,
      replacements: { count: String(count) },
    }
    return vault.t(countArgs)
  }

  function summary(identity: IdentityDirectoryEntry): string {
    const inventoryArgs: Parameters<typeof buildIdentityKeyInventory>[0] = {
      vault,
      identity,
      view,
    }
    const keyCountArgs: CountLabelRequest = {
      count: buildIdentityKeyInventory(inventoryArgs).length,
      singularKey: I18N_KEYS.DevicesAccessIdentityKeyCountSingular,
      pluralKey: I18N_KEYS.DevicesAccessIdentityKeyCountPlural,
    }
    const vaultCountArgs: CountLabelRequest = {
      count: identity.vaultStoreIds.length,
      singularKey: I18N_KEYS.DevicesAccessIdentityVaultCountSingular,
      pluralKey: I18N_KEYS.DevicesAccessIdentityVaultCountPlural,
    }
    const summaryArgs: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.DevicesAccessIdentitySummary,
      replacements: {
        keys: countLabel(keyCountArgs),
        vaults: countLabel(vaultCountArgs),
      },
    }
    return vault.t(summaryArgs)
  }

</script>

<aside
  class="min-w-0 border-border md:border-r md:pr-6"
  aria-label={vault.t(I18N_KEYS.DevicesAccessIdentitiesSection)}
  data-testid="devices-access-identity-rail"
>
  <p class="access-micro-label text-muted-foreground">
    {vault.t(I18N_KEYS.DevicesAccessIdentitiesSection)}
  </p>

  <ul class="mt-4 space-y-1">
    {#each identities as identity (identity.identityId)}
      <li>
        <button
          type="button"
          class="group flex min-h-16 w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          class:border-border={identity.identityId === selectedIdentityId}
          class:bg-muted={identity.identityId === selectedIdentityId}
          class:shadow-sm={identity.identityId === selectedIdentityId}
          aria-current={identity.identityId === selectedIdentityId
            ? 'true'
            : undefined}
          data-testid="devices-access-identity-option"
          data-selected={identity.identityId === selectedIdentityId}
          onclick={() => onSelectIdentity(identity.identityId)}
        >
          <span
            class="grid size-10 shrink-0 place-items-center rounded-full border border-border text-foreground"
            aria-hidden="true"
          >
            <Fingerprint class="size-4" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-semibold text-foreground">
              {identity.label}
            </span>
            <span class="mt-0.5 block text-xs text-muted-foreground">
              {summary(identity)}
            </span>
          </span>
          <ChevronRight
            class="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          />
        </button>
      </li>
    {/each}
  </ul>

  <Button
    type="button"
    variant="outline"
    class="mt-4 w-full"
    disabled
    data-testid="devices-access-add-identity"
  >
    <Plus class="size-4" />
    {vault.t(I18N_KEYS.DevicesAccessAddIdentity)}
  </Button>
  <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
    {vault.t(I18N_KEYS.DevicesAccessAddIdentityUnavailable)}
  </p>
</aside>
