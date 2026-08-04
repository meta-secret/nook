<script lang="ts">
  import '@xyflow/svelte/dist/style.css'
  import {
    Background,
    BackgroundVariant,
    Controls,
    SvelteFlow,
    type EdgeTypes,
    type NodeTypes,
  } from '@xyflow/svelte'
  import { BridgePerspective } from './bridge-perspective'
  import {
    BridgeControlPosition,
    BridgeGraphEdgeType,
    BridgeGraphNodeType,
    buildBridgeGraph,
  } from './bridge-graph'
  import BridgeGrantEdge from './BridgeGrantEdge.svelte'
  import BridgeGraphNode from './BridgeGraphNode.svelte'

  let {
    perspective,
    identityId,
    vaultId,
  }: { perspective: BridgePerspective; identityId: string; vaultId: string } = $props()

  const nodeTypes: NodeTypes = { [BridgeGraphNodeType.Graph]: BridgeGraphNode }
  const edgeTypes: EdgeTypes = { [BridgeGraphEdgeType.GrantLanes]: BridgeGrantEdge }
  let compact = $state(false)
  const graph = $derived(buildBridgeGraph(perspective, identityId, vaultId, compact))

  $effect(() => {
    const media = window.matchMedia('(width < 48rem)')
    const update = () => (compact = media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  })
</script>

<div
  class:identity-canvas={perspective === BridgePerspective.Identities}
  class:vault-canvas={perspective === BridgePerspective.Vaults}
  class:compact-canvas={compact}
  class="bridge-canvas"
  style={`--compact-height: ${graph.compactHeight}px`}
  aria-label="Identity, device, and vault relationship graph"
>
  {#key `${perspective}:${identityId}:${vaultId}:${compact}`}
    <SvelteFlow
      nodes={graph.nodes}
      edges={graph.edges}
      {edgeTypes}
      {nodeTypes}
      fitView
      fitViewOptions={{ padding: compact ? 0.04 : 0.07, minZoom: compact ? 0.92 : 0.28, maxZoom: 1.05 }}
      minZoom={compact ? 0.82 : 0.25}
      maxZoom={compact ? 1.1 : 1.35}
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
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} patternColor="#252629" />
      {#if !compact}
        <Controls
          position={BridgeControlPosition.TopRight}
          showZoom
          showFitView
          showLock={false}
          orientation="horizontal"
          buttonBgColor="#111214"
          buttonBgColorHover="#1a1b1d"
          buttonColor="#a5a5a1"
          buttonColorHover="#f4f3f0"
          buttonBorderColor="#343538"
          aria-label="Graph viewport controls"
        />
      {/if}
    </SvelteFlow>
  {/key}
</div>

<style>
  .bridge-canvas {
    position: relative;
    height: min(40rem, calc(100svh - 9rem));
    min-height: 36rem;
    overflow: hidden;
    border: 1px solid #252629;
    border-radius: 0.5rem;
    background: #0b0c0d;
    box-shadow: inset 0 1px rgb(255 255 255 / 2%);
  }

  :global(.svelte-flow) {
    --xy-background-color: #0b0c0d;
    --xy-edge-stroke-default: #555653;
    --xy-edge-stroke-width-default: 1.25;
    --xy-node-border-radius-default: 0.375rem;
    background: #0b0c0d;
  }

  :global(.svelte-flow__node-bridge) {
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
  }

  :global(.svelte-flow__edge-path) {
    transition: stroke 160ms ease, stroke-width 160ms ease;
  }

  :global(.svelte-flow__controls) {
    overflow: hidden;
    border: 1px solid #343538;
    border-radius: 0.375rem;
    box-shadow: 0 0.75rem 2rem rgb(0 0 0 / 30%);
  }

  :global(.svelte-flow__controls-button) {
    width: 2.25rem;
    height: 2.25rem;
    border: 0;
    border-right: 1px solid #343538;
    background: #111214 !important;
    color: #a5a5a1 !important;
  }

  :global(.svelte-flow__controls-button:hover) { background: #1a1b1d !important; color: #f4f3f0 !important; }
  :global(.svelte-flow__controls-button svg) { fill: currentColor; }

  :global(.svelte-flow__controls-button:last-child) { border-right: 0; }

  @media (width < 48rem) {
    .bridge-canvas {
      height: var(--compact-height);
      min-height: var(--compact-height);
      border-right: 0;
      border-left: 0;
      border-radius: 0;
    }
  }
</style>
