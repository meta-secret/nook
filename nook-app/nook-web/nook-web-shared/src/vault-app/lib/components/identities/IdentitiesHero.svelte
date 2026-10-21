<!--
The one big header in the product, as a terminal decrypting the identities
file: a prompt with a blinking caret, the title decrypting into place, the
totals as the command's key=value output, and beside them the age-armored
ciphertext, its BEGIN line and 64-column rows re-encrypting with a lit run.
Inner pages use quiet page bars instead.
-->
<script lang="ts">
  import {
    I18N_KEYS,
    type I18nKey,
  } from '../../../../generated/i18n-keys'
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

  type OutputPair = {
    readonly label: I18nKey
    readonly value: number
    /** Lit, with a pulsing lamp, while the count is above zero. */
    readonly live: boolean
  }

  const output = $derived<OutputPair[]>([
    {
      label: I18N_KEYS.WorkspaceStatsIdentities,
      value: totals.identities,
      live: false,
    },
    { label: I18N_KEYS.WorkspaceStatsKeys, value: totals.keys, live: false },
    { label: I18N_KEYS.WorkspaceStatsVaults, value: totals.vaults, live: false },
    {
      label: I18N_KEYS.WorkspaceStatsUnlocked,
      value: totals.unlocked,
      live: totals.unlocked > 0,
    },
  ])

  /** Output digits, zero-padded as a terminal prints them: 01, 02, 12. */
  function digits(value: number): string {
    return String(value).padStart(2, '0')
  }
</script>

<section
  class="nk-frame-tab nk-terminal-hero"
  aria-labelledby="identities-hero-title"
  data-testid="identities-hero"
>
  <div class="nk-terminal-main">
    <p class="nk-terminal-prompt">
      <span class="nk-terminal-path"
        >{vault.t(I18N_KEYS.WorkspaceIdentitiesPromptPath)}</span
      >
      <span class="nk-terminal-sigil" aria-hidden="true">$</span>
      <span class="nk-terminal-command"
        >{vault.t(I18N_KEYS.WorkspaceIdentitiesPromptCommand)}</span
      ><span class="nk-caret" aria-hidden="true"></span>
    </p>
    {#key vault.locale}
      <h1
        id="identities-hero-title"
        class="font-sans text-[clamp(1.75rem,4.5vw,2.75rem)] leading-[1.05] font-semibold tracking-[-0.03em] text-foreground"
        use:scramble
      >
        {vault.t(I18N_KEYS.WorkspaceIdentitiesTitle)}
      </h1>
    {/key}
    {#if showStats}
      <dl class="nk-terminal-output" data-testid="identities-stats">
        {#each output as pair (pair.label)}
          <div class="nk-terminal-pair" class:nk-terminal-live={pair.live}>
            <dt>{vault.t(pair.label)}</dt>
            <dd>{digits(pair.value)}</dd>
          </div>
        {/each}
      </dl>
    {/if}
  </div>
  <!-- age wraps armored output at 64 columns: the BEGIN line and four rows.
       The lit run crawls one character at a time, never flashing around. -->
  <CipherField
    class="nk-terminal-armor"
    rows={5}
    columns={64}
    crawl
    intervalMs={450}
  />
</section>
