<script lang="ts">
  import { renderMarkdown } from '$lib/markdown'
  import MarkdownBody from './MarkdownBody.svelte'

  let {
    value = $bindable(''),
    rows = 12,
    placeholder = '',
    testId = 'secret-value',
  }: {
    value?: string
    rows?: number
    placeholder?: string
    testId?: string
  } = $props()

  let tab = $state<'write' | 'preview'>('write')

  const previewHtml = $derived(renderMarkdown(value))
</script>

<div
  class="overflow-hidden rounded-md border border-border bg-background"
  data-testid="markdown-editor"
>
  <div
    class="flex items-center gap-1 border-b border-border bg-muted/25 px-2 py-1.5"
    role="tablist"
    aria-label="Markdown editor"
  >
    <button
      type="button"
      role="tab"
      aria-selected={tab === 'write'}
      data-testid="markdown-tab-write"
      class="rounded-md px-3 py-1 text-xs font-medium transition-colors {tab ===
      'write'
        ? 'bg-background text-foreground shadow-xs ring-1 ring-border/60'
        : 'text-muted-foreground hover:text-foreground'}"
      onclick={() => (tab = 'write')}
    >
      Edit
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={tab === 'preview'}
      data-testid="markdown-tab-preview"
      class="rounded-md px-3 py-1 text-xs font-medium transition-colors {tab ===
      'preview'
        ? 'bg-background text-foreground shadow-xs ring-1 ring-border/60'
        : 'text-muted-foreground hover:text-foreground'}"
      onclick={() => (tab = 'preview')}
    >
      Preview
    </button>
  </div>

  <div class="relative min-h-[12rem]">
    <textarea
      id="secure-note-body"
      data-testid={testId}
      bind:value
      {rows}
      {placeholder}
      aria-hidden={tab !== 'write'}
      class="absolute inset-0 block w-full resize-y border-0 bg-transparent px-3 py-2 font-mono text-sm leading-relaxed focus:outline-hidden focus:ring-0 {tab !==
      'write'
        ? 'pointer-events-none opacity-0'
        : ''}"
    ></textarea>
    <div
      role="tabpanel"
      aria-hidden={tab !== 'preview'}
      class="absolute inset-0 overflow-y-auto px-3 py-2 {tab !== 'preview'
        ? 'pointer-events-none opacity-0'
        : ''}"
    >
      {#if value.trim()}
        <MarkdownBody html={previewHtml} testId="markdown-preview" />
      {:else}
        <p class="text-sm text-muted-foreground">Nothing to preview</p>
      {/if}
    </div>
  </div>
</div>
