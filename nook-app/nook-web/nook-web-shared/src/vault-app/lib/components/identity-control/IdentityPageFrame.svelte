<!--
One of the identity's pages, opened from Manage on its card: one row with
Back, the identity it belongs to and the page's name, then its content in
one sheet.
No navigation of its own: the card's menu is the way between pages.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import BackButton from "$lib/components/workspace/BackButton.svelte";

  let {
    identityName,
    title,
    testId,
    backLabel,
    onBack,
    children,
    footer,
  }: {
    identityName: string;
    title: string;
    testId: string;
    /** Where Back goes. */
    backLabel: string;
    onBack: () => void;
    children: Snippet;
    /** The status line under the sheet. */
    footer: Snippet;
  } = $props();
</script>

<section
  class="mx-auto grid w-full max-w-3xl gap-5 py-4 sm:py-8"
  data-testid="identity-page"
  data-page={testId}
>
  <header class="flex min-w-0 items-center gap-4">
    <BackButton label={backLabel} testId="identity-page-back" {onBack} />
    <div class="grid min-w-0 gap-0.5">
      {#if identityName}
        <p class="nk-eyebrow truncate">{identityName}</p>
      {/if}
      <h1
        class="truncate text-[clamp(1.5rem,3.5vw,2rem)] leading-tight font-semibold tracking-[-0.02em] text-foreground"
      >
        {title}
      </h1>
    </div>
  </header>

  <div class="nk-frame-sheet min-w-0 p-4 sm:p-7">
    {@render children()}
  </div>

  {@render footer()}
</section>
