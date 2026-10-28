<!-- The ring's states at a glance: onboarding and the key ring, the current
state lit, visited ones marked, and the current state's exits spelled out. -->
<script lang="ts">
  import { ArrowRight } from '@lucide/svelte'
  import type { RingFlow } from './ring-flow.svelte'
  import { RingGroup, ring } from './ring'
  import { ui } from '../identity-first/ui'

  let { flow }: { flow: RingFlow } = $props()

  const groups = Object.values(RingGroup)
  function titleOf(state: string): string {
    for (const node of ring) if (node.state === state) return node.title
    return state
  }
</script>

<nav class="space-y-6" aria-label="State machine">
  {#each groups as group (group)}
    <section class="space-y-2">
      <p class={ui.label}>{group}</p>
      <ol class="space-y-1">
        {#each ring.filter((node) => node.group === group) as node (node.state)}
          {@const current = flow.current === node.state}
          {@const seen = flow.visited.includes(node.state)}
          <li>
            <button
              type="button"
              class="flex w-full items-center gap-2.5 py-0.5 text-left text-[13px] transition hover:text-[#e9e8e4] {current ? 'text-[#e9e8e4]' : seen ? 'text-[#a4a8ae]' : 'text-[#5d6268]'}"
              aria-current={current ? 'step' : 'false'}
              onclick={() => flow.jump(node.state)}
            >
              <span
                class="size-2 shrink-0 {current ? 'bg-[#8fa3c0]' : seen ? 'border border-[#8fa3c0]' : 'border border-[#3a3f45]'}"
                aria-hidden="true"
              ></span>
              <span class={current ? 'font-medium' : ''}>{node.title}</span>
            </button>
            {#if current && node.next.length > 0}
              <ul class="mt-1.5 mb-2 space-y-1 border-l border-[#2c3035] pl-4">
                {#each node.next as edge (edge.label)}
                  <li>
                    <button
                      type="button"
                      class="flex flex-wrap items-center gap-1.5 text-left font-mono text-[11px] text-[#80858c] hover:text-[#e9e8e4]"
                      onclick={() => flow.go(edge.to)}
                    >
                      <span>{edge.label}</span>
                      <ArrowRight class="size-3" aria-hidden="true" />
                      <span class="text-[#a4a8ae]">{titleOf(edge.to)}</span>
                    </button>
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
