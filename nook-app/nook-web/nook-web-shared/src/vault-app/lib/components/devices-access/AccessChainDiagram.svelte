<!--
The subject of the page: one hairline schematic of what unlocks what. Each node
is also the selector for its own evidence, so the relationship and the detail
never drift apart.
-->
<script lang="ts">
  import { tick } from 'svelte'
  import {
    type AccessChainNode,
    AccessChainLinkKind,
    AccessChainStage,
    accessChainTab,
    accessChainTabId,
    AccessChainTabKind,
    AccessNodeDetailKind,
  } from './access-chain'

  let {
    nodes,
    selected,
    label,
    panelId,
    onSelect,
  }: {
    nodes: AccessChainNode[]
    selected: AccessChainStage
    label: string
    panelId: string
    onSelect: (stage: AccessChainStage) => void
  } = $props()

  async function moveSelection(offset: number): Promise<void> {
    const order = nodes.map((node) => node.stage)
    const current = order.indexOf(selected)
    const next = order[(current + offset + order.length) % order.length]
    onSelect(next)
    await tick()
    const tab = accessChainTab(next)
    if (tab.kind === AccessChainTabKind.Missing) return
    tab.element.focus()
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      void moveSelection(1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      void moveSelection(-1)
    }
  }
</script>

<div
  class="flex flex-col sm:flex-row sm:items-stretch"
  role="tablist"
  aria-label={label}
  data-testid="devices-access-chain"
>
  {#each nodes as node (node.stage)}
    {@const isSelected = node.stage === selected}
    {#if node.incoming.kind === AccessChainLinkKind.Relation}
      <div
        class="flex flex-col items-center gap-1.5 py-1.5 sm:w-24 sm:shrink-0 sm:flex-row sm:gap-2 sm:self-center sm:py-0"
        aria-hidden="true"
      >
        <span class="h-4 w-px bg-border sm:h-px sm:w-auto sm:flex-1"></span>
        <span
          class="access-micro-label whitespace-nowrap text-muted-foreground"
        >
          {node.incoming.label}
        </span>
        <span class="h-4 w-px bg-border sm:h-px sm:w-auto sm:flex-1"></span>
      </div>
    {/if}
    <button
      type="button"
      role="tab"
      id={accessChainTabId(node.stage)}
      aria-selected={isSelected}
      aria-controls={panelId}
      tabindex={isSelected ? 0 : -1}
      class="min-w-0 rounded-xl border px-4 py-3 text-left transition-colors duration-150 sm:min-h-[5.25rem] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none sm:flex-1 sm:basis-0
        {isSelected
        ? 'border-foreground bg-foreground text-background'
        : 'border-border bg-card text-foreground hover:border-foreground/40 hover:bg-accent/50'}
        {node.detail.kind === AccessNodeDetailKind.Absent
        ? 'border-dashed'
        : ''}"
      data-testid={`devices-access-node-${node.stage}`}
      onclick={() => onSelect(node.stage)}
      onkeydown={handleKeydown}
    >
      <span
        class="access-micro-label block {isSelected
          ? 'text-background/70'
          : 'text-muted-foreground'}"
      >
        {node.caption}
      </span>
      <span class="mt-2 block truncate text-sm font-medium">{node.title}</span>
      {#if node.detail.kind === AccessNodeDetailKind.Identifier}
        <span
          class="mt-1 block truncate font-mono text-[0.7rem] {isSelected
            ? 'text-background/80'
            : 'text-muted-foreground'}"
        >
          {node.detail.value}
        </span>
      {:else if node.detail.kind === AccessNodeDetailKind.Summary}
        <span
          class="mt-1 block truncate text-xs {isSelected
            ? 'text-background/80'
            : 'text-muted-foreground'}"
        >
          {node.detail.value}
        </span>
      {/if}
    </button>
  {/each}
</div>
