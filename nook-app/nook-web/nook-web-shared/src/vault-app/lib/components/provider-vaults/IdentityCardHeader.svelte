<!--
The head of one identity a provider holds: a tile that shows whether it opens
here, its name or three words, one standing tag, and what its public log
tells. The plan list and setup's list both open their cards with it; setup's
tag says what this browser's passkey is to the identity instead.
-->
<script lang="ts">
  import { Lock, UserRound } from '@lucide/svelte'
  import type {
    IdentitySetup,
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
  }: {
    vault: VaultState
    choice: ProviderIdentityChoice
    tag?: IdentityCardTag
  } = $props()

  const text = $derived(new IdentityDecisionText(vault))
  const standing = $derived(choice.standing)

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
      case 'notOpened':
        return vault.t(I18N_KEYS.AccessCheckIdentityNotOpened)
      case 'unchecked':
        return vault.t(I18N_KEYS.AccessCheckIdentityUnchecked)
    }
  }

  /** What this browser's passkey is to the identity, as setup says it. A
   * setup with no words of its own keeps the standing line. */
  function setupLine(setup: IdentitySetup): string {
    switch (setup.kind) {
      case 'continue':
        return vault.t(I18N_KEYS.FirstRunIdentityMember)
      case 'inUse':
        return vault.t(I18N_KEYS.FirstRunIdentityInUse)
      case 'requestToJoin':
        return standing.kind === 'joinDenied'
          ? standingLine(standing)
          : vault.t(I18N_KEYS.FirstRunIdentityNotMember)
      case 'waiting':
      case 'unavailable':
        return standingLine(standing)
    }
  }

  function tagLine(): string {
    switch (tag) {
      case IdentityCardTag.Standing:
        return standingLine(standing)
      case IdentityCardTag.Setup:
        return setupLine(choice.setup)
    }
  }

  /** Whether the identity opens here, so its card reads as settled. */
  function opens(standing: IdentityStanding): boolean {
    switch (standing.kind) {
      case 'thisBrowser':
      case 'otherIdentityHere':
      case 'openedByPasskey':
      case 'joinApproved':
        return true
      case 'joinRequested':
      case 'joinDenied':
      case 'passkeyInUse':
      case 'notOpened':
      case 'unchecked':
        return false
    }
  }

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
    {#if opens(standing)}
      <UserRound class="size-4" />
    {:else}
      <Lock class="size-4" />
    {/if}
  </span>
  <div class="min-w-0 flex-1 space-y-1">
    <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <p
        class="min-w-0 truncate text-sm font-semibold text-foreground"
        data-testid="provider-vault-identity"
        title={choice.identity.identityId}
      >
        {text.name(choice)}
      </p>
      <span
        class={opens(standing) ? 'nk-tag nk-tag-success' : 'nk-tag'}
        data-testid="provider-identity-standing"
      >
        {tagLine()}
      </span>
    </div>
    <p class="nk-spec" data-testid="provider-identity-facts">
      {#each facts(choice.identity.log) as line (line)}
        <span data-testid="provider-vault-identity-log">{line}</span>
      {/each}
    </p>
  </div>
</header>
