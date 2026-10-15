<!--
One of the identity's pages, opened from Manage on its card: Back, the
identity it belongs to, the page's name, and its content in one sheet.
No navigation of its own: the card's menu is the way between pages.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import FirstRunBackLink from "$lib/components/login/FirstRunBackLink.svelte";
  import type { VaultState } from "$lib/vault.svelte";

  let {
    vault,
    identityName,
    title,
    testId,
    onBack,
    children,
    footer,
  }: {
    vault: VaultState;
    identityName: string;
    title: string;
    testId: string;
    onBack: () => void;
    children: Snippet;
    /** The status line under the sheet. */
    footer: Snippet;
  } = $props();
</script>

<section
  class="mx-auto grid w-full max-w-3xl gap-6 py-6 sm:py-10"
  data-testid="identity-page"
  data-page={testId}
>
  <FirstRunBackLink {vault} testId="identity-page-back" {onBack} />

  <header class="grid gap-2">
    {#if identityName}
      <p class="nk-eyebrow">{identityName}</p>
    {/if}
    <h1
      class="text-[clamp(1.75rem,4vw,2.25rem)] leading-tight font-semibold tracking-[-0.02em] text-foreground"
    >
      {title}
    </h1>
  </header>

  <div class="nk-frame-sheet min-w-0 p-4 sm:p-7">
    {@render children()}
  </div>

  {@render footer()}
</section>
