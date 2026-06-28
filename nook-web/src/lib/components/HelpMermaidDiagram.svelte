<script lang="ts">
  import { renderMermaidDiagram, type MermaidTheme } from '$lib/mermaid-diagram'

  let {
    source,
    sectionId,
    theme = 'dark',
  }: {
    source: string
    sectionId: string
    theme?: MermaidTheme
  } = $props()

  let container = $state<HTMLDivElement | undefined>()
  let renderError = $state('')

  async function paintDiagram() {
    if (!container) return
    renderError = ''
    try {
      container.innerHTML = await renderMermaidDiagram(source, theme)
    } catch (error: unknown) {
      container.innerHTML = ''
      renderError =
        error instanceof Error ? error.message : 'Failed to render diagram'
    }
  }

  $effect(() => {
    source
    theme
    void paintDiagram()
  })
</script>

<div
  bind:this={container}
  class="help-mermaid mt-2 overflow-x-auto rounded-md border border-border/60 bg-background/80 p-2"
  data-testid="help-diagram-{sectionId}"
  role="img"
  aria-label="Architecture diagram"
></div>
{#if renderError}
  <p class="mt-1 text-xs text-destructive" data-testid="help-diagram-error">
    {renderError}
  </p>
{/if}

<style>
  :global(.help-mermaid svg) {
    display: block;
    margin: 0 auto;
    max-width: 100%;
    height: auto;
  }
</style>
