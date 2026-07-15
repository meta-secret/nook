<script lang="ts">
  import { renderMermaidDiagram, type MermaidTheme } from '$lib/mermaid-diagram'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    source,
    sectionId,
    theme = 'dark',
  }: {
    vault: VaultState
    source: string
    sectionId: string
    theme?: MermaidTheme
  } = $props()

  let svgHtml = $state('')
  let renderError = $state('')

  async function paintDiagram(src: string, diagramTheme: MermaidTheme) {
    renderError = ''
    try {
      svgHtml = await renderMermaidDiagram(src, diagramTheme)
    } catch (error: unknown) {
      svgHtml = ''
      renderError =
        error instanceof Error ? error.message : 'Failed to render diagram'
    }
  }

  $effect(() => {
    void paintDiagram(source, theme)
  })
</script>

<div
  class="help-mermaid mt-2 overflow-x-auto rounded-md border border-border/60 bg-background/80 p-2"
  data-testid="help-diagram-{sectionId}"
  role="img"
  aria-label={vault.t('help.diagram.label')}
>
  {#if svgHtml}
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    {@html svgHtml}
  {/if}
</div>
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
