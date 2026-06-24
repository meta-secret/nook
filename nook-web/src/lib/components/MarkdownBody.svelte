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

<div
  class="markdown-body nook-markdown {className}"
  data-testid={testId}
>
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

  :global(:root:not(.dark) .nook-markdown.markdown-body) {
    color: var(--foreground);
  }

  :global(:root:not(.dark) .nook-markdown.markdown-body h1),
  :global(:root:not(.dark) .nook-markdown.markdown-body h2),
  :global(:root:not(.dark) .nook-markdown.markdown-body h3),
  :global(:root:not(.dark) .nook-markdown.markdown-body h4),
  :global(:root:not(.dark) .nook-markdown.markdown-body h5),
  :global(:root:not(.dark) .nook-markdown.markdown-body h6) {
    color: var(--foreground);
  }
</style>
