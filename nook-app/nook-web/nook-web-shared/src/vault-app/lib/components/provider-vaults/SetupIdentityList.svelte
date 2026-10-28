<!--
The identities a sync provider holds, as setup shows them: one card each,
with the one action Rust decided from this browser's key. A member
continues; anyone else asks to join; a join already asked can be checked
again. The identity this browser already holds has no action: the step's
own button saves it there. Picking runs at once: there is no plan to apply.
-->
<script lang="ts">
  import { ArrowRight, RefreshCw, Send } from '@lucide/svelte'
  import type { ProviderIdentityChoice } from '$app-wasm'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import IdentityCardHeader from '$lib/components/provider-vaults/IdentityCardHeader.svelte'
  import { IdentityCardTag } from '$lib/components/provider-vaults/identity-card-tag'
  import { SetupIdentityOffer } from '$lib/components/provider-vaults/setup-identity-offer'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    choices,
    working,
    disabled = false,
    onContinue,
    onAskToJoin,
    onCheck,
  }: {
    vault: VaultState
    choices: readonly ProviderIdentityChoice[]
    /** The identity an action runs for; empty while none runs. */
    working: string
    /** Another action on the page runs. */
    disabled?: boolean
    onContinue: (choice: ProviderIdentityChoice) => void | Promise<void>
    onAskToJoin: (choice: ProviderIdentityChoice) => void | Promise<void>
    /** Read a join this browser already asked for again. */
    onCheck: (choice: ProviderIdentityChoice) => void | Promise<void>
  } = $props()

  const busy = $derived(disabled || working !== '' || vault.isVerifying)

  /** The one button Rust's setup action gives a card. */
  function offer(choice: ProviderIdentityChoice): SetupIdentityOffer {
    switch (choice.setup.kind) {
      case 'continue':
        return choice.setup.decision === 'leave'
          ? SetupIdentityOffer.NoAction
          : SetupIdentityOffer.Continue
      case 'requestToJoin':
        return SetupIdentityOffer.Join
      case 'waiting':
        return SetupIdentityOffer.Check
      case 'unavailable':
        return SetupIdentityOffer.NoAction
    }
  }
</script>

<div class="space-y-3" data-testid="setup-identity-list">
  {#each choices as choice (choice.identity.identityId)}
    {@const running = working === choice.identity.identityId}
    {@const offered = offer(choice)}
    <section
      class="nk-frame space-y-3 px-4 py-3"
      data-testid="setup-identity"
      data-identity-id={choice.identity.identityId}
      data-setup={choice.setup.kind}
    >
      <IdentityCardHeader {vault} {choice} tag={IdentityCardTag.Setup} />
      {#if offered === SetupIdentityOffer.Continue}
        <Button
          type="button"
          size="sm"
          data-testid="setup-identity-continue"
          disabled={busy}
          onclick={() => void onContinue(choice)}
        >
          {#if running}
            <RefreshCw class="size-4 animate-spin" />
          {:else}
            <ArrowRight class="size-4" />
          {/if}
          {vault.t(I18N_KEYS.FirstRunIdentityContinue)}
        </Button>
      {:else if offered === SetupIdentityOffer.Join}
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="setup-identity-join"
          disabled={busy}
          onclick={() => void onAskToJoin(choice)}
        >
          {#if running}
            <RefreshCw class="size-4 animate-spin" />
          {:else}
            <Send class="size-4" />
          {/if}
          {vault.t(I18N_KEYS.FirstRunIdentityJoin)}
        </Button>
      {:else if offered === SetupIdentityOffer.Check}
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="setup-identity-check"
          disabled={busy}
          onclick={() => void onCheck(choice)}
        >
          {#if running}
            <RefreshCw class="size-4 animate-spin" />
          {/if}
          {vault.t(I18N_KEYS.FirstRunJoinCheck)}
        </Button>
      {/if}
    </section>
  {/each}
</div>
