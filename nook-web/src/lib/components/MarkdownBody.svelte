<script lang="ts">
  let {
    html,
    testId,
    class: className = '',
  }: {
    html: string
    testId?: string
    class?: string
  } = $props()
</script>

<div class="markdown-body nook-markdown {className}" data-testid={testId}>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html html}
</div>

<style>
  :global(.nook-markdown.markdown-body) {
    background-color: transparent;
    font-size: 0.875rem;
    line-height: 1.625;
    max-width: none;
    margin: 0;
    padding: 0;
  }

  /* Tailwind preflight sets `ol, ul { list-style: none }` — restore GitHub list markers. */
  :global(.nook-markdown.markdown-body ul) {
    list-style-type: disc;
  }

  :global(.nook-markdown.markdown-body ol) {
    list-style-type: decimal;
  }

  :global(.nook-markdown.markdown-body ul ul) {
    list-style-type: circle;
  }

  :global(.nook-markdown.markdown-body li) {
    display: list-item;
  }

  :global(.nook-markdown.markdown-body strong) {
    font-weight: 600;
  }
</style>
