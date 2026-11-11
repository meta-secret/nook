<!--
The identities a provider holds, one card each. Passkeys and devices belong
to identities, so the identity is the only thing the user decides about:
its card says whether it opens here and offers what Rust allows doing with
it, one button per way in. Rust lists the most direct way first, and that
one leads; the others stay quieter beside it. A button runs its way in at
once: there is nothing to pick and no second button to apply it. Vaults are
never acted on here: the card names the identity and what its public log
tells, nothing more.
-->
<script lang="ts">
  import {
    Fingerprint,
    MonitorSmartphone,
    RefreshCw,
    ScrollText,
  } from '@lucide/svelte'
  import type {
    IdentityDecision,
    IdentityStanding,
    ProviderIdentityChoice,
  } from '$app-wasm'
  import { Button } from '$lib/components/ui/button'
  import IdentityCardHeader from '$lib/components/provider-vaults/IdentityCardHeader.svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    IdentityDecisionText,
    IdentityRunKind,
    type IdentityPick,
    type IdentityRun,
    type PlannedDecision,
  } from '$lib/components/provider-vaults/identity-plan.svelte'

  let {
    vault,
    choices,
    run,
    disabled,
    checking,
    onDecide,
    onFindPasskey,
  }: {
    vault: VaultState
    choices: readonly ProviderIdentityChoice[]
    /** The decision that runs now, if one does. */
    run: IdentityRun
    /** True while a decision or another action runs. */
    disabled: boolean
    /** True while a passkey check runs. */
    checking: boolean
    /** Run one way in for its identity, at once. */
    onDecide: (entry: PlannedDecision) => void | Promise<void>
    /** Check which listed identity a passkey opens; changes nothing. */
    onFindPasskey: () => void | Promise<void>
  } = $props()

  const text = $derived(new IdentityDecisionText(vault))

  /** Whether a passkey check could still open the identity. */
  function findable(standing: IdentityStanding): boolean {
    switch (standing.kind) {
      case 'notOpened':
      case 'unchecked':
      case 'joinDenied':
        return true
      case 'thisBrowser':
      case 'otherIdentityHere':
      case 'openedByPasskey':
      case 'joinRequested':
      case 'joinApproved':
      case 'passkeyInUse':
        return false
    }
  }

  function decisionsLabel(choice: ProviderIdentityChoice): string {
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.ProviderIdentitiesDecisionsLabel,
      replacements: { identity: text.name(choice) },
    }
    return vault.t(request)
  }

  function running(pick: IdentityPick): boolean {
    switch (run.kind) {
      case IdentityRunKind.Idle:
        return false
      case IdentityRunKind.Running:
        return (
          run.pick.identityId === pick.identityId &&
          run.pick.decision === pick.decision
        )
    }
  }
</script>

<!-- What a way in uses: a passkey, written-down words, or a device. -->
{#snippet decisionIcon(decision: IdentityDecision)}
  {#if decision === 'recoverWithPassphrase'}
    <ScrollText class="size-4" />
  {:else if decision === 'askToJoin' || decision === 'finishJoining'}
    <MonitorSmartphone class="size-4" />
  {:else}
    <Fingerprint class="size-4" />
  {/if}
{/snippet}

<div class="space-y-3" data-testid="provider-identity-list">
  {#each choices as choice (choice.identity.identityId)}
    {@const standing = choice.standing}
    <section
      class="nk-frame space-y-3 px-4 py-3"
      data-testid="provider-identity"
      data-identity-id={choice.identity.identityId}
      data-store-ids={choice.vaults.map((summary) => summary.storeId).join(' ')}
      data-standing={standing.kind}
    >
      <IdentityCardHeader {vault} {choice} />
      {#if choice.decisions.length > 0}
        <div
          class="flex flex-wrap items-center gap-2"
          role="group"
          aria-label={decisionsLabel(choice)}
          data-testid="provider-identity-decisions"
        >
          {#each choice.decisions as decision, index (decision)}
            {@const pick: IdentityPick = {
              identityId: choice.identity.identityId,
              decision,
            }}
            {@const entry: PlannedDecision = { choice, decision }}
            <Button
              type="button"
              size="sm"
              variant={index === 0 ? 'default' : 'outline'}
              title={text.detail(decision)}
              data-testid="provider-identity-decision"
              data-decision={decision}
              data-lead={index === 0}
              {disabled}
              onclick={() => void onDecide(entry)}
            >
              {#if running(pick)}
                <RefreshCw class="size-4 animate-spin" aria-hidden="true" />
              {:else}
                {@render decisionIcon(decision)}
              {/if}
              {text.decision(decision)}
            </Button>
          {/each}
        </div>
      {/if}
      {#if findable(standing)}
        <button
          type="button"
          class="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-60"
          data-testid="provider-identity-find-passkey"
          disabled={disabled || checking}
          onclick={() => void onFindPasskey()}
        >
          {checking
            ? vault.t(I18N_KEYS.AccessCheckChecking)
            : vault.t(I18N_KEYS.AccessCheckWhichPasskey)}
        </button>
      {/if}
    </section>
  {/each}
</div>
