<script lang="ts">
  import { renderMarkdown } from '$lib/markdown'
  import MarkdownBody from './MarkdownBody.svelte'

  let {
    value = $bindable(''),
    placeholder = '',
    testId = 'secret-value',
    minHeight = 'min-h-[24rem]',
    fill = false,
  }: {
    value?: string
    placeholder?: string
    testId?: string
    minHeight?: string
    /** Grow to fill the parent flex container instead of using a fixed min-height. */
    fill?: boolean
  } = $props()

  let tab = $state<'write' | 'preview'>('write')

  const previewHtml = $derived(renderMarkdown(value))

  let textareaEl: HTMLTextAreaElement | undefined = $state()

  function adjustHeight() {
    if (fill || !textareaEl) return
    textareaEl.style.height = 'auto'
    textareaEl.style.height = `${textareaEl.scrollHeight}px`
  }

  $effect(() => {
    if (!fill && tab === 'write' && value !== undefined) {
      setTimeout(adjustHeight, 0)
    }
  })
</script>

<div
  class="min-w-0 max-w-full overflow-hidden rounded-md border border-border bg-background {fill
    ? 'flex min-h-0 flex-1 flex-col sm:h-full'
    : ''}"
  data-testid="markdown-editor"
>
  <div
    class="flex shrink-0 items-center gap-1 border-b border-border bg-muted/25 px-2 py-1.5"
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

  <div
    class={fill ? 'flex min-h-0 flex-1 flex-col' : `${minHeight} flex flex-col`}
  >
    {#if tab === 'write'}
      <textarea
        bind:this={textareaEl}
        id="secure-note-body"
        data-testid={testId}
        bind:value
        {placeholder}
        oninput={adjustHeight}
        class="block w-full border-0 bg-transparent px-3 py-2 font-sans text-sm leading-normal focus:outline-hidden focus:ring-0 {fill
          ? 'min-h-0 flex-1 resize-none'
          : `${minHeight} resize-none`}"></textarea>
    {:else}
      <div
        role="tabpanel"
        class="px-3 py-2 {fill
          ? 'min-h-0 flex-1 overflow-y-auto'
          : `${minHeight} overflow-y-auto`}"
      >
        {#if value.trim()}
          <MarkdownBody html={previewHtml} testId="markdown-preview" />
        {:else}
          <p class="text-sm text-muted-foreground">Nothing to preview</p>
        {/if}
      </div>
    {/if}
  </div>
</div>
