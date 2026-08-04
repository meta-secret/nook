<script lang="ts">
  import '@xyflow/svelte/dist/style.css'
  import {
    Background,
    BackgroundVariant,
    Controls,
    SvelteFlow,
    type AriaLabelConfig,
    type NodeTypes,
  } from '@xyflow/svelte'
  import {
    buildIdentityBridge,
    IdentityBridgeControlPosition,
    IdentityBridgeNodeType,
    IdentityBridgeVaultSelectionKind,
    type IdentityBridgeCopy,
    type IdentityBridgePerspective,
    type IdentityBridgeVaultSelection,
  } from './identity-bridge-model'
  import type { VaultAccessView } from './access-chain'
  import IdentityBridgeNode from './IdentityBridgeNode.svelte'

  let {
    perspective,
    selectedVault,
    vaults,
    copy,
    graphLabel,
    controlsLabel,
    ariaLabelConfig,
  }: {
    perspective: IdentityBridgePerspective
    selectedVault: IdentityBridgeVaultSelection
    vaults: readonly VaultAccessView[]
    copy: IdentityBridgeCopy
    graphLabel: string
    controlsLabel: string
    ariaLabelConfig: Partial<AriaLabelConfig>
  } = $props()

  const nodeTypes: NodeTypes = {
    [IdentityBridgeNodeType.Bridge]: IdentityBridgeNode,
  }
  let compact = $state(false)
  let canvasWidth = $state(0)
  const graph = $derived(
    buildIdentityBridge({
      perspective,
      selectedVault,
      compact,
      vaults,
      copy,
    }),
  )
  const selectedVaultKey = $derived(
    selectedVault.kind === IdentityBridgeVaultSelectionKind.Selected
      ? selectedVault.storeId
      : selectedVault.kind,
  )

  $effect(() => {
    const media = window.matchMedia('(width < 48rem)')
    const update = () => (compact = media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  })
</script>

<div
  bind:clientWidth={canvasWidth}
  class:compact
  class="bridge-canvas"
  data-testid="devices-access-chain"
  style={`--bridge-height: ${graph.compactHeight}px`}
  aria-label={graphLabel}
>
  {#key `${perspective}:${selectedVaultKey}:${compact}:${canvasWidth}:${vaults.length}`}
    <SvelteFlow
      nodes={graph.nodes}
      edges={graph.edges}
      {nodeTypes}
      fitView
      fitViewOptions={{
        padding: compact ? 0.04 : 0.08,
        minZoom: compact ? 0.42 : 0.05,
        maxZoom: 1.05,
      }}
      minZoom={compact ? 0.4 : 0.05}
      maxZoom={compact ? 1.08 : 1.3}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      nodesFocusable
      edgesFocusable={false}
      zoomOnScroll={false}
      zoomOnDoubleClick={false}
      panOnScroll={false}
      preventScrolling={false}
      proOptions={{ hideAttribution: true }}
      {ariaLabelConfig}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={24}
        size={1}
        patternColor="var(--border)"
      />
      {#if !compact}
        <Controls
          position={IdentityBridgeControlPosition.TopRight}
          showZoom
          showFitView
          showLock={false}
          orientation="horizontal"
          aria-label={controlsLabel}
        />
      {/if}
    </SvelteFlow>
  {/key}
</div>

<style>
  .bridge-canvas {
    position: relative;
    height: min(22rem, calc(100svh - 10rem));
    min-height: 20rem;
    overflow: hidden;
    border: 1px solid color-mix(in oklab, var(--foreground) 14%, transparent);
    border-radius: calc(var(--radius) + 0.125rem);
    background: linear-gradient(
      145deg,
      var(--background),
      color-mix(in oklab, var(--muted) 22%, transparent)
    );
    box-shadow: inset 0 1px
      color-mix(in oklab, var(--foreground) 2.5%, transparent);
  }
  :global(.svelte-flow) {
    --xy-background-color: var(--background);
    --xy-edge-stroke-default: var(--muted-foreground);
    --xy-edge-stroke-width-default: 1.2;
    --xy-node-border-radius-default: var(--radius);
    background: transparent;
  }
  :global(.svelte-flow__node-identity-bridge) {
    border: 0;
    background: transparent;
    box-shadow: none;
  }
  :global(.svelte-flow__edge-path) {
    transition:
      stroke 160ms ease,
      stroke-width 160ms ease;
  }
  :global(.svelte-flow__controls) {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--card);
    box-shadow: 0 0.75rem 2rem
      color-mix(in oklab, var(--foreground) 8%, transparent);
  }
  :global(.svelte-flow__controls-button) {
    width: 2.25rem;
    height: 2.25rem;
    border: 0;
    border-right: 1px solid var(--border);
    background: var(--card) !important;
    color: var(--muted-foreground) !important;
  }
  :global(.svelte-flow__controls-button:hover) {
    background: var(--muted) !important;
    color: var(--foreground) !important;
  }
  :global(.svelte-flow__controls-button svg) {
    fill: currentColor;
  }
  :global(.svelte-flow__controls-button:last-child) {
    border-right: 0;
  }
  @media (width < 48rem) {
    .bridge-canvas {
      height: var(--bridge-height);
      min-height: var(--bridge-height);
      margin-inline: -1rem;
      border-right: 0;
      border-left: 0;
      border-radius: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.svelte-flow__edge-path) {
      transition: none;
    }
  }
</style>
