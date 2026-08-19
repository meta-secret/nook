<!--
Reading this as: Operate-mode Access surface for an authenticated person
scanning which keys unlock the current identity, preserving Identity Bridge
evidence language, with a card list beside the graph, interaction priority
scan-and-act.
-->
<script lang="ts">
  import { Fingerprint, KeyRound, Shield, Smartphone } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'
  import type { DashboardView } from '../devices-access-dashboard-state'
  import { AccessChainStage } from './access-chain'
  import {
    buildIdentityAccessCards,
    IdentityAccessKeyKind,
  } from './identity-access-list'

  type IdentityAccessListProps = {
    vault: VaultState
    view: DashboardView
    selectedStage: AccessChainStage
    onSelectStage: (stage: AccessChainStage) => void
  }

  let { vault, view, selectedStage, onSelectStage }: IdentityAccessListProps =
    $props()

  const cards = $derived.by(() => {
    const buildIdentityAccessCardsArgs: Parameters<
      typeof buildIdentityAccessCards
    >[0] = { vault, view }
    return buildIdentityAccessCards(buildIdentityAccessCardsArgs)
  })

  function cardIcon(kind: IdentityAccessKeyKind) {
    if (kind === IdentityAccessKeyKind.Passkey) return Fingerprint
    if (kind === IdentityAccessKeyKind.AppKey) return KeyRound
    if (kind === IdentityAccessKeyKind.CompanionSession) return Smartphone
    return Shield
  }
</script>

<section
  class="min-w-0"
  data-testid="devices-access-identity-keys"
  aria-label={vault.t(I18N_KEYS.DevicesAccessIdentityKeysHeading)}
>
  <p class="access-micro-label text-muted-foreground">
    {vault.t(I18N_KEYS.DevicesAccessIdentityKeysHeading)}
  </p>
  <p class="mt-2 max-w-[70ch] text-sm leading-relaxed text-pretty text-muted-foreground">
    {vault.t(I18N_KEYS.DevicesAccessIdentityKeysLede)}
  </p>
  <ul class="mt-5 grid gap-3 sm:grid-cols-2">
    {#each cards as card (card.key)}
      {@const Icon = cardIcon(card.kind)}
      <li>
        <button
          type="button"
          class="flex min-h-44 w-full flex-col items-start rounded-2xl border border-border/80 bg-card p-4 text-left shadow-sm transition-colors hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          class:selected={selectedStage === card.stage}
          data-testid="devices-access-key-card"
          data-kind={card.kind}
          aria-pressed={selectedStage === card.stage}
          onclick={() => onSelectStage(card.stage)}
        >
          <span class="flex w-full items-start justify-between gap-3">
            <span
              class="grid size-10 place-items-center rounded-full border border-border text-foreground"
              aria-hidden="true"
            >
              <Icon class="size-4" />
            </span>
            <span class="access-micro-label text-muted-foreground">
              {card.typeLabel}
            </span>
          </span>
          <span class="mt-4 text-base font-semibold text-foreground">
            {card.title}
          </span>
          <span class="mt-1 text-xs text-muted-foreground">
            {vault.t(I18N_KEYS.DevicesAccessLastSuccessfulUse)}
            <span class="text-foreground"> {card.lastUsedLabel}</span>
          </span>
          <span class="mt-3 text-xs leading-relaxed text-pretty text-muted-foreground">
            {card.description}
          </span>
        </button>
      </li>
    {/each}
  </ul>
</section>

<style>
  button.selected {
    border-color: color-mix(in oklab, var(--foreground) 40%, transparent);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--foreground) 18%, transparent);
  }
</style>
