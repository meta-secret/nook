<!--
The one big header in the product: live ciphertext, a blinking caret and a
title that decrypts into place. Inner pages use quiet page bars instead.
-->
<script lang="ts">
  import { ShieldCheck } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { CipherField, scramble } from '$lib/components/ui/cipher'
  import type { VaultState } from '$lib/vault.svelte'
  import type { IdentityTotals } from './identity-card-model'

  let {
    vault,
    totals,
    showStats = true,
  }: {
    vault: VaultState
    totals: IdentityTotals
    showStats?: boolean
  } = $props()
</script>

<section
  class="nk-frame-tab nk-hero relative"
  aria-labelledby="identities-hero-title"
  data-testid="identities-hero"
>
  <CipherField class="nk-hero-cipher" />
  <div class="relative max-w-[40rem]">
    <p class="nk-eyebrow">
      <ShieldCheck class="size-3.5 text-success" aria-hidden="true" />
      {vault.t(I18N_KEYS.WorkspaceIdentitiesEyebrow)}<span
        class="nk-caret"
        aria-hidden="true"
      ></span>
    </p>
    {#key vault.locale}
      <h1
        id="identities-hero-title"
        class="mt-2.5 text-[clamp(1.75rem,4.5vw,2.5rem)] leading-[1.05] font-semibold tracking-[-0.03em] text-foreground"
        use:scramble
      >
        {vault.t(I18N_KEYS.WorkspaceIdentitiesTitle)}
      </h1>
    {/key}
    <p
      class="mt-3 max-w-[52ch] text-sm text-pretty text-muted-foreground sm:text-base"
    >
      {vault.t(I18N_KEYS.WorkspaceIdentitiesDescription)}
    </p>
    {#if showStats}
      <dl class="nk-stats mt-4" data-testid="identities-stats">
        <div class="flex gap-2">
          <dt>{vault.t(I18N_KEYS.WorkspaceStatsIdentities)}</dt>
          <dd><b>{totals.identities}</b></dd>
        </div>
        <div class="flex gap-2">
          <dt>{vault.t(I18N_KEYS.WorkspaceStatsKeys)}</dt>
          <dd><b>{totals.keys}</b></dd>
        </div>
        <div class="flex gap-2">
          <dt>{vault.t(I18N_KEYS.WorkspaceStatsVaults)}</dt>
          <dd><b>{totals.vaults}</b></dd>
        </div>
        <div class="flex gap-2" class:nk-stats-live={totals.unlocked > 0}>
          <dt>{vault.t(I18N_KEYS.WorkspaceStatsUnlocked)}</dt>
          <dd><b>{totals.unlocked}</b></dd>
        </div>
      </dl>
    {/if}
  </div>
</section>
