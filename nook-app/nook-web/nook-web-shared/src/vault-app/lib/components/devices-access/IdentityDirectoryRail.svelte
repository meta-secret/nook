<!--
Reading this as: Operate-mode identity navigation for a person who owns several
authorization contexts, preserving Nook's quiet list rhythm, with selection and
creation as the primary interactions.
-->
<script lang="ts">
  import { Fingerprint, Plus } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'
  import type { IdentityDirectoryEntry } from './identity-directory-view'

  type IdentityDirectoryRailProps = {
    vault: VaultState
    identities: readonly IdentityDirectoryEntry[]
    selectedIdentityId: string
    onSelectIdentity: (identityId: string) => void
    onAddIdentity: () => void
    /** An identity is being created: the add action would repeat it. */
    adding?: boolean
  }

  let {
    vault,
    identities,
    selectedIdentityId,
    onSelectIdentity,
    onAddIdentity,
    adding = false,
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
    const keyCountArgs: CountLabelRequest = {
      count: identity.members.length,
      singularKey: I18N_KEYS.DevicesAccessIdentityKeyCountSingular,
      pluralKey: I18N_KEYS.DevicesAccessIdentityKeyCountPlural,
    }
    const vaultCountArgs: CountLabelRequest = {
      count: identity.vaults.length,
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
  class="min-w-0"
  aria-label={vault.t(I18N_KEYS.DevicesAccessIdentitiesSection)}
  data-testid="devices-access-identity-rail"
>
  <p class="nk-label">
    {vault.t(I18N_KEYS.DevicesAccessIdentitiesSection)}
  </p>

  <ul class="mt-3 flex flex-wrap gap-2">
    {#each identities as identity (identity.identityId)}
      <li class="min-w-0">
        <button
          type="button"
          class="nk-frame-nick nk-frame-interactive group flex min-h-14 max-w-full items-center gap-3 py-2 pl-2.5 pr-5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          class:nk-slot-open={identity.identityId === selectedIdentityId}
          aria-current={identity.identityId === selectedIdentityId}
          data-testid="devices-access-identity-option"
          data-selected={identity.identityId === selectedIdentityId}
          onclick={() => onSelectIdentity(identity.identityId)}
        >
          <span
            class="grid size-9 shrink-0 place-items-center border border-border text-foreground"
            aria-hidden="true"
          >
            <Fingerprint class="size-4" />
          </span>
          <span class="min-w-0">
            <span class="block truncate text-sm font-semibold text-foreground">
              {identity.label}
            </span>
            <span class="mt-0.5 block font-mono text-[0.6875rem] text-muted-foreground">
              {summary(identity)}
            </span>
          </span>
        </button>
      </li>
    {/each}
    {#if !adding}
      <li>
        <Button
          type="button"
          variant="outline"
          class="min-h-14 border-dashed"
          data-testid="devices-access-add-identity"
          onclick={onAddIdentity}
        >
          <Plus class="size-4" />
          {vault.t(I18N_KEYS.DevicesAccessAddIdentity)}
        </Button>
      </li>
    {/if}
  </ul>
</aside>
