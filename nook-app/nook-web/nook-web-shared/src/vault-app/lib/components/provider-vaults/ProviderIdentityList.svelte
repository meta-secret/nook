<!--
The identities a provider holds, one card each. Passkeys and devices belong
to identities, so the identity is the only thing the user decides about:
its card says whether it opens here and offers what Rust allows doing with
it. Rust lists the most direct way first. In Drive's compact card, the
other ways appear in a menu. Picking an action runs it immediately.
-->
<script lang="ts">
  import {
    Ellipsis,
    Fingerprint,
    MonitorSmartphone,
    RefreshCw,
    ScrollText,
  } from '@lucide/svelte'
  import { DropdownMenu } from 'bits-ui'
  import type { IdentityDecision, ProviderIdentityChoice } from '$app-wasm'
  import { Button, buttonVariants } from '$lib/components/ui/button'
  import IdentityCardHeader from '$lib/components/provider-vaults/IdentityCardHeader.svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    IdentityDecisionText,
    IdentityRunKind,
    type CompactIdentityCard,
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
    compact,
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
    onFindPasskey: (choice: ProviderIdentityChoice) => void | Promise<void>
    compact?: CompactIdentityCard
  } = $props()

  const text = $derived(new IdentityDecisionText(vault))
  const overflowButton: Parameters<typeof buttonVariants>[0] = {
    variant: 'outline',
    size: 'icon',
    class: 'shrink-0',
  }

  function decisionsLabel(choice: ProviderIdentityChoice): string {
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.ProviderIdentitiesDecisionsLabel,
      replacements: { identity: text.name(choice) },
    }
    return vault.t(request)
  }

  function moreActionsLabel(choice: ProviderIdentityChoice): string {
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.ProviderVaultsMoreActions,
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
      {#if compact}
        <IdentityCardHeader {vault} {choice} {compact} />
      {:else}
        <IdentityCardHeader {vault} {choice} />
      {/if}
      {#if choice.decisions.length > 0}
        <div
          class={compact
            ? 'flex items-center gap-2'
            : 'flex flex-wrap items-center gap-2'}
          role="group"
          aria-label={decisionsLabel(choice)}
          data-testid="provider-identity-decisions"
        >
          {#each compact ? choice.decisions.slice(0, 1) : choice.decisions as decision, index (decision)}
            {@const pick: IdentityPick = {
              identityId: choice.identity.identityId,
              decision,
            }}
            {@const entry: PlannedDecision = { choice, decision }}
            <Button
              type="button"
              size={compact ? 'default' : 'sm'}
              variant={index === 0 ? 'default' : 'outline'}
              class={compact
                ? 'h-auto min-h-10 min-w-0 flex-1 whitespace-normal'
                : ''}
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
              {#if compact && decision === 'addToBrowser'}
                {vault.t(I18N_KEYS.ProviderVaultsOpenWithPasskey)}
              {:else}
                {text.decision(decision)}
              {/if}
            </Button>
          {/each}
          {#if compact && choice.decisions.length > 1}
            {@const moreRunning =
              run.kind === IdentityRunKind.Running &&
              run.pick.identityId === choice.identity.identityId &&
              run.pick.decision !== choice.decisions[0]}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger
                type="button"
                class={buttonVariants(overflowButton)}
                aria-label={moreActionsLabel(choice)}
                data-testid="provider-identity-more-actions"
                {disabled}
              >
                {#if moreRunning}
                  <RefreshCw class="animate-spin" aria-hidden="true" />
                {:else}
                  <Ellipsis aria-hidden="true" />
                {/if}
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={4}
                  class="z-50 max-w-[calc(100vw-2rem)] min-w-48 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
                  data-testid="provider-identity-action-menu"
                >
                  {#each choice.decisions.slice(1) as decision (decision)}
                    {@const entry: PlannedDecision = { choice, decision }}
                    <DropdownMenu.Item
                      class="flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                      title={text.detail(decision)}
                      data-testid="provider-identity-decision"
                      data-decision={decision}
                      data-lead="false"
                      {disabled}
                      onSelect={() => void onDecide(entry)}
                    >
                      {@render decisionIcon(decision)}
                      {text.decision(decision)}
                    </DropdownMenu.Item>
                  {/each}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          {/if}
        </div>
      {/if}
      {#if !compact && choice.passkey_check === 'Available'}
        <button
          type="button"
          class="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-60"
          data-testid="provider-identity-find-passkey"
          disabled={disabled || checking}
          onclick={() => void onFindPasskey(choice)}
        >
          {checking
            ? vault.t(I18N_KEYS.AccessCheckChecking)
            : vault.t(I18N_KEYS.AccessCheckWhichPasskey)}
        </button>
      {/if}
    </section>
  {/each}
</div>
