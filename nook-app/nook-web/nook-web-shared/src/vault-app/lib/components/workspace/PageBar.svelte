<!--
Quiet page bar for inner pages: where you are (identity / page), session
state, and the page's own actions. Only the identities hub gets a hero.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import BackButton from './BackButton.svelte'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    eyebrow = '',
    title,
    testId = 'page-bar',
    backLabel = '',
    onBack,
    tags,
    actions,
    visual,
    band = false,
    backOnPhonesOnly = false,
  }: {
    vault: VaultState
    eyebrow?: string
    title: string
    testId?: string
    backLabel?: string
    onBack?: () => void
    tags?: Snippet
    actions?: Snippet
    visual?: Snippet
    /** A flat band at the top of the workspace shell instead of a framed tab. */
    band?: boolean
    /** The workspace rail already leads back on wide screens. */
    backOnPhonesOnly?: boolean
  } = $props()
</script>

<header
  class="{band
    ? 'nk-page-band'
    : 'nk-frame-tab nk-page-bar'} grid min-w-0 grid-cols-1 gap-3"
  data-testid={testId}
>
  <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
    {#if onBack}
      <span class="contents {backOnPhonesOnly ? 'md:hidden' : ''}">
        <BackButton
          label={backLabel || vault.t(I18N_KEYS.WorkspaceBackToIdentities)}
          testId="page-bar-back"
          {onBack}
        />
      </span>
    {/if}
    <div class="min-w-0 flex-1">
      {#if eyebrow}
        <p
          class="nk-eyebrow truncate {band ? 'md:hidden' : ''}"
          data-testid="page-bar-eyebrow"
        >
          {eyebrow}
        </p>
      {/if}
      <div class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1
          class="min-w-0 truncate text-[1.375rem] leading-tight font-semibold tracking-[-0.02em] text-foreground"
          data-testid="page-bar-title"
        >
          {title}
        </h1>
        {@render tags?.()}
      </div>
    </div>
    {#if actions}
      <div class="flex flex-wrap items-center gap-2">
        {@render actions()}
      </div>
    {/if}
  </div>
  {@render visual?.()}
</header>
