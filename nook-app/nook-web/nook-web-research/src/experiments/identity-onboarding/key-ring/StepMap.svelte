<!-- Every step by branch: the current one lit, visited ones marked, and the
current step's exits spelled out. Any step can be jumped to. -->
<script lang="ts">
  import { ArrowRight } from '@lucide/svelte'
  import type { KeyRingFlow } from './flow.svelte'
  import { Branch, steps } from './model'
  import { ui } from './ui'

  let { flow }: { flow: KeyRingFlow } = $props()

  const branches = Object.values(Branch)
  function titleOf(step: string): string {
    for (const node of steps) if (node.step === step) return node.title
    return step
  }
</script>

<nav class="space-y-6" aria-label="Steps">
  {#each branches as branch (branch)}
    <section class="space-y-2">
      <p class={ui.label}>{branch}</p>
      <ol class="space-y-1">
        {#each steps.filter((node) => node.branch === branch) as node (node.step)}
          {@const current = flow.step === node.step}
          {@const seen = flow.visited.includes(node.step)}
          <li>
            <button
              type="button"
              class="flex w-full items-center gap-2.5 py-0.5 text-left text-[13px] transition hover:text-[#e9e8e4] {current ? 'text-[#e9e8e4]' : seen ? 'text-[#a4a8ae]' : 'text-[#5d6268]'}"
              aria-current={current ? 'step' : 'false'}
              onclick={() => flow.jump(node.step)}
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
                      onclick={() => flow.jump(edge.to)}
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
