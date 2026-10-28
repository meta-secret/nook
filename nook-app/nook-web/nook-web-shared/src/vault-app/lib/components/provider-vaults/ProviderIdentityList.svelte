<!--
The identities a provider holds, one card each. Passkeys and devices belong
to identities, so the identity is the only thing the user decides about:
its card says whether it opens here and offers the decisions Rust allows as
one segmented choice, Leave as is first. Its vaults are a quiet list of
names. Picking a decision runs nothing; the page's one button applies the
plan.
-->
<script lang="ts">
  import { Lock, UserRound } from '@lucide/svelte'
  import type {
    IdentityStanding,
    ProviderIdentityChoice,
    ProviderIdentityLog,
    ProviderVaultSummary,
  } from '$app-wasm'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    IdentityDecisionText,
    type IdentityPick,
    type IdentityPlan,
    type PlannedDecisionText,
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
      case 'notOpened':
        return vault.t(I18N_KEYS.AccessCheckIdentityNotOpened)
      case 'unchecked':
        return vault.t(I18N_KEYS.AccessCheckIdentityUnchecked)
    }
  }

  /** Whether the identity opens here, so its card reads as settled. */
  function opens(standing: IdentityStanding): boolean {
    switch (standing.kind) {
      case 'thisBrowser':
      case 'otherIdentityHere':
      case 'openedByPasskey':
        return true
      case 'joinRequested':
      case 'notOpened':
      case 'unchecked':
        return false
    }
  }

  /** Whether a passkey check could still open the identity. */
  function findable(standing: IdentityStanding): boolean {
    switch (standing.kind) {
      case 'notOpened':
      case 'unchecked':
        return true
      case 'thisBrowser':
      case 'otherIdentityHere':
      case 'openedByPasskey':
      case 'joinRequested':
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

  function vaultName(summary: ProviderVaultSummary): string {
    switch (summary.name.state) {
      case 'named':
        return summary.name.name
      case 'unknown': {
        const request: Parameters<typeof vault.t>[0] = {
          key: I18N_KEYS.FirstRunRestoreVaultItem,
          replacements: { id: summary.shortId },
        }
        return vault.t(request)
      }
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

<div class="space-y-3" data-testid="provider-identity-list">
  {#each choices as choice (choice.identity.identityId)}
    {@const standing = choice.standing}
    <section
      class="nk-frame space-y-3 px-4 py-3"
      data-testid="provider-identity"
      data-identity-id={choice.identity.identityId}
      data-standing={standing.kind}
    >
      <header class="flex items-start gap-3">
        <span class="nk-tile nk-tile-sm" aria-hidden="true">
          {#if opens(standing)}
            <UserRound class="size-4" />
          {:else}
            <Lock class="size-4" />
          {/if}
        </span>
        <div class="min-w-0 flex-1 space-y-1">
          <div
            class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
          >
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
              {standingLine(standing)}
            </span>
          </div>
          <p class="nk-spec" data-testid="provider-identity-facts">
            {#each facts(choice.identity.log) as line (line)}
              <span data-testid="provider-vault-identity-log">{line}</span>
            {/each}
          </p>
          <p
            class="flex flex-wrap gap-x-3 font-mono text-xs text-muted-foreground"
            data-testid="provider-identity-vaults"
          >
            {#each choice.vaults as summary (summary.storeId)}
              <span
                data-testid="provider-vault-row"
                data-store-id={summary.storeId}
                data-access={summary.access.state}
                title={summary.storeId}>{vaultName(summary)}</span
              >
            {/each}
          </p>
        </div>
      </header>
      {#if choice.decisions.length > 0}
        <div
          class="grid border border-border/70"
          style:grid-template-columns={`repeat(${choice.decisions.length}, minmax(0, 1fr))`}
          role="radiogroup"
          aria-label={decisionsLabel(choice)}
          data-testid="provider-identity-decisions"
        >
          {#each choice.decisions as decision (decision)}
            {@const pick: IdentityPick = {
              identityId: choice.identity.identityId,
              decision,
            }}
            {@const words: PlannedDecisionText = { decision, choices }}
            {@const picked = plan.decisionOf(choice) === decision}
            <button
              type="button"
              role="radio"
              aria-checked={picked}
              class={picked
                ? 'min-h-9 bg-foreground px-2 text-xs font-medium text-background'
                : 'min-h-9 px-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60'}
              data-testid="provider-identity-decision"
              data-decision={decision}
              {disabled}
              onclick={() => plan.decide(pick)}
            >
              {text.decision(words)}
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
          {@const words: PlannedDecisionText = {
            decision: entry.decision,
            choices,
          }}
          {@const row: Parameters<typeof vault.t>[0] = {
            key: I18N_KEYS.ProviderIdentitiesPlanRow,
            replacements: {
              identity: text.name(entry.choice),
              decision: text.decision(words),
            },
          }}
          <li data-testid="provider-identity-plan-row">{vault.t(row)}</li>
        {/each}
      </ul>
    </div>
  {/if}
</div>
