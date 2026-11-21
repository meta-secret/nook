<!--
The head of one identity a provider holds: a tile that shows whether it opens
here, its three-word ID and any known name, one standing tag, and what its
public log tells. The plan list and setup's list both open their cards with
it; setup's tag says what this browser's passkey is to the identity instead.
-->
<script lang="ts">
  import { CircleCheck, KeyRound, Lock } from '@lucide/svelte'
  import type {
    IdentityStanding,
    ProviderIdentityChoice,
    ProviderIdentityLog,
  } from '$app-wasm'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'
  import { IdentityDecisionText } from '$lib/components/provider-vaults/identity-plan.svelte'
  import { IdentityCardTag } from '$lib/components/provider-vaults/identity-card-tag'

  let {
    vault,
    choice,
    tag = IdentityCardTag.Standing,
    compact = false,
  }: {
    vault: VaultState
    choice: ProviderIdentityChoice
    tag?: IdentityCardTag
    compact?: boolean
  } = $props()

  const text = $derived(new IdentityDecisionText(vault))
  const standing = $derived(choice.standing)
  const name = $derived(text.name(choice))
  const words = $derived(choice.identity.words.join('-'))

  function standingLine(standing: IdentityStanding): string {
    switch (standing.kind) {
      case 'thisBrowser':
        return vault.t(I18N_KEYS.AccessCheckIdentityThisBrowser)
      case 'otherIdentityHere': {
        const request: Parameters<typeof vault.t>[0] = {
          key: I18N_KEYS.AccessCheckIdentityOtherHere,
          replacements: { identity: standing.identityLabel },
        }
        return vault.t(request)
      }
      case 'openedByPasskey': {
        const request: Parameters<typeof vault.t>[0] = {
          key: I18N_KEYS.AccessCheckIdentityOpenedBy,
          replacements: { id: standing.passkey },
        }
        return vault.t(request)
      }
      case 'joinRequested':
        return vault.t(I18N_KEYS.AccessCheckIdentityRequested)
      case 'joinDenied':
        return vault.t(I18N_KEYS.AccessCheckIdentityJoinDenied)
      case 'joinApproved':
        return vault.t(I18N_KEYS.AccessCheckIdentityJoinApproved)
      case 'passkeyInUse':
        return vault.t(I18N_KEYS.AccessCheckIdentityPasskeyInUse)
      case 'deviceKeyNotMember':
        return vault.t(I18N_KEYS.FirstRunIdentityNotMember)
      case 'notOpened':
        return vault.t(I18N_KEYS.AccessCheckIdentityNotOpened)
      case 'unchecked':
        return vault.t(I18N_KEYS.AccessCheckIdentityUnchecked)
    }
  }

  const tagLine = $derived(
    tag === IdentityCardTag.Setup && choice.setup.kind === 'inUse'
      ? vault.t(I18N_KEYS.FirstRunIdentityInUse)
      : standingLine(standing),
  )

  const StatusIcon = $derived.by(() => {
    switch (standing.kind) {
      case 'thisBrowser':
      case 'otherIdentityHere':
      case 'openedByPasskey':
      case 'joinApproved':
      case 'passkeyInUse':
        return CircleCheck
      case 'joinRequested':
      case 'joinDenied':
      case 'deviceKeyNotMember':
      case 'notOpened':
        return Lock
      case 'unchecked':
        return KeyRound
    }
  })

  /** What the identity's public control log tells, where it was read. */
  function facts(log: ProviderIdentityLog): readonly string[] {
    switch (log.state) {
      case 'absent':
        return []
      case 'read': {
        const devices: Parameters<typeof vault.t>[0] = {
          key: I18N_KEYS.ProviderVaultsDevices,
          replacements: { count: String(log.devices) },
        }
        const vaults: Parameters<typeof vault.t>[0] = {
          key: I18N_KEYS.ProviderVaultsIdentityVaults,
          replacements: { count: String(log.vaults) },
        }
        return [vault.t(devices), vault.t(vaults)]
      }
    }
  }
</script>

<header class="flex items-start gap-3">
  <span class="nk-tile nk-tile-sm" aria-hidden="true">
    <StatusIcon class="size-4" />
  </span>
  <div class="min-w-0 flex-1 space-y-1">
    <div class="flex flex-col items-start gap-1">
      <p
        class="max-w-full truncate text-sm font-semibold text-foreground"
        data-testid="provider-vault-identity"
        title={choice.identity.identityId}
      >
        {name}
      </p>
      <span
        class={StatusIcon === CircleCheck
          ? 'text-sm text-success'
          : 'text-sm text-muted-foreground'}
        data-testid="provider-identity-standing"
      >
        {tagLine}
      </span>
    </div>
    {#if !compact || name !== words}
      <p class="nk-spec" data-testid="provider-identity-facts">
        {#if name !== words}
          <span>{words}</span>
        {/if}
        {#if !compact}
          {#each facts(choice.identity.log) as line (line)}
            <span data-testid="provider-vault-identity-log">{line}</span>
          {/each}
        {/if}
      </p>
    {/if}
  </div>
</header>
