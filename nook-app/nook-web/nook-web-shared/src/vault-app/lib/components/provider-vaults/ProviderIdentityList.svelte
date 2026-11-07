<!--
The identities a provider holds, one card each. Passkeys and devices belong
to identities, so the identity is the only thing the user decides about:
its card says whether it opens here and lists what Rust allows doing
with it, one row per way in, each saying what it needs. Nothing starts
picked: an identity left unpicked stays as it is, and pressing the picked
row again unpicks it. Vaults are never acted on here: the card names the identity and what
its public log tells, nothing more. Picking a decision runs nothing; the
page's one button applies the plan.
-->
<script lang="ts">
  import {
    Check,
    Fingerprint,
    MonitorSmartphone,
    ScrollText,
  } from '@lucide/svelte'
  import type {
    IdentityDecision,
    IdentityStanding,
    ProviderIdentityChoice,
  } from '$app-wasm'
  import IdentityCardHeader from '$lib/components/provider-vaults/IdentityCardHeader.svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    IdentityDecisionText,
    type IdentityPick,
    type IdentityPlan,
  } from '$lib/components/provider-vaults/identity-plan.svelte'

  let {
    vault,
    choices,
    plan,
    disabled,
    checking,
    onFindPasskey,
  }: {
    vault: VaultState
    choices: readonly ProviderIdentityChoice[]
    plan: IdentityPlan
    /** True while the plan or another action runs. */
    disabled: boolean
    /** True while a passkey check runs. */
    checking: boolean
    /** Check which listed identity a passkey opens; changes nothing. */
    onFindPasskey: () => void | Promise<void>
  } = $props()

  const text = $derived(new IdentityDecisionText(vault))
  const planned = $derived(plan.planned(choices))

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
          class="grid"
          role="group"
          aria-label={decisionsLabel(choice)}
          data-testid="provider-identity-decisions"
        >
          {#each choice.decisions as decision (decision)}
            {@const pick: IdentityPick = {
              identityId: choice.identity.identityId,
              decision,
            }}
            {@const picked = plan.isPicked(pick)}
            <button
              type="button"
              aria-pressed={picked}
              class="nk-vault-row disabled:opacity-60"
              data-testid="provider-identity-decision"
              data-decision={decision}
              {disabled}
              onclick={() => plan.decide(pick)}
            >
              <span class="nk-vault-icon" aria-hidden="true">
                {@render decisionIcon(decision)}
              </span>
              <span class="flex-none text-sm font-medium">
                {text.decision(decision)}
              </span>
              <span class="nk-lead" aria-hidden="true"></span>
              <span class="min-w-0 truncate text-xs text-muted-foreground">
                {text.detail(decision)}
              </span>
              {#if picked}
                <Check class="size-4 flex-none" aria-hidden="true" />
              {/if}
            </button>
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
  {#if planned.length > 0}
    <div class="space-y-1" role="status" data-testid="provider-identity-plan">
      <p class="nk-subpanel-head">
        {vault.t(I18N_KEYS.ProviderIdentitiesPlanTitle)}
      </p>
      <ul class="space-y-0.5 text-xs text-foreground">
        {#each planned as entry (entry.choice.identity.identityId)}
          {@const row: Parameters<typeof vault.t>[0] = {
            key: I18N_KEYS.ProviderIdentitiesPlanRow,
            replacements: {
              identity: text.name(entry.choice),
              decision: text.decision(entry.decision),
            },
          }}
          <li data-testid="provider-identity-plan-row">{vault.t(row)}</li>
        {/each}
      </ul>
    </div>
  {/if}
</div>
