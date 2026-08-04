<script lang="ts">
  import { BaseEdge, type EdgeProps } from '@xyflow/svelte'
  import type { BridgeGraphEdge } from './bridge-graph'

  let {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    markerEnd,
    style,
  }: EdgeProps<BridgeGraphEdge> = $props()

  const trunkX = $derived(targetX - 16)
  const exitY = $derived(sourceY + 64)
  const path = $derived(
    `M ${sourceX} ${sourceY} L ${sourceX} ${exitY - 6} Q ${sourceX} ${exitY} ${sourceX - 6} ${exitY} L ${trunkX + 6} ${exitY} Q ${trunkX} ${exitY} ${trunkX} ${exitY + 6} L ${trunkX} ${targetY - 6} Q ${trunkX} ${targetY} ${trunkX + 6} ${targetY} L ${targetX} ${targetY}`,
  )
</script>

<BaseEdge {id} {path} {markerEnd} {style} />
