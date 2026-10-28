<!-- The machine at a glance: every state by group, the current one lit,
visited ones marked, and the current state's exits spelled out. -->
<script lang="ts">
  import { ArrowRight } from '@lucide/svelte'
  import type { KeyFlow } from './key-flow.svelte'
  import { StateGroup, machine } from './machine'
  import { ui } from '../identity-first/ui'

  let { flow }: { flow: KeyFlow } = $props()

  const groups = Object.values(StateGroup)
  const titleOf = (state: string) =>
    machine.find((node) => node.state === state)?.title ?? state
</script>

<nav class="space-y-6" aria-label="State machine">
  {#each groups as group (group)}
    <section class="space-y-2">
      <p class={ui.label}>{group}</p>
      <ol class="space-y-1">
        {#each machine.filter((node) => node.group === group) as node (node.state)}
          {@const current = flow.current === node.state}
          {@const seen = flow.visited.includes(node.state)}
          <li>
            <div class="flex items-center gap-2.5 text-[13px] {current ? 'text-[#e9e8e4]' : seen ? 'text-[#a4a8ae]' : 'text-[#5d6268]'}">
              <span
                class="size-2 shrink-0 {current ? 'bg-[#8fa3c0]' : seen ? 'border border-[#8fa3c0]' : 'border border-[#3a3f45]'}"
                aria-hidden="true"
              ></span>
              <span class={current ? 'font-medium' : ''}>{node.title}</span>
            </div>
            {#if current && node.next.length > 0}
              <ul class="mt-1.5 mb-2 space-y-1 border-l border-[#2c3035] pl-4">
                {#each node.next as edge (edge.to)}
                  <li class="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-[#80858c]">
                    <span>{edge.label}</span>
                    <ArrowRight class="size-3" aria-hidden="true" />
                    <span class="text-[#a4a8ae]">{titleOf(edge.to)}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ol>
    </section>
  {/each}
</nav>
