<!-- Prototype controls, kept out of the app: history, every step by branch
to jump to, and the simulator's switches. -->
<script lang="ts">
  import { ArrowLeft, ArrowRight, RotateCcw, Send } from '@lucide/svelte'
  import type { IdentityFlow } from './flow.svelte'
  import { Branch, ProviderHolds, steps } from './model'

  let { flow }: { flow: IdentityFlow } = $props()

  const branches = Object.values(Branch)
  const holds: readonly { id: ProviderHolds; label: string }[] = [
    { id: ProviderHolds.Yours, label: 'has yours' },
    { id: ProviderHolds.Locked, label: 'only locked ones' },
    { id: ProviderHolds.Nothing, label: 'empty' },
  ]
  const head = 'mb-2 tracking-[0.18em] text-[#5d6268] uppercase'
  const item = 'flex w-full items-center gap-2 py-0.5 text-left transition hover:text-[#e9e8e4]'
</script>

<aside class="w-[200px] shrink-0 space-y-7 font-mono text-[11px] text-[#80858c]" aria-label="Prototype">
  <div class="flex items-center gap-3">
    <button type="button" class="grid size-7 place-items-center bg-[#16191c] transition hover:text-[#e9e8e4] disabled:opacity-30" aria-label="Back" disabled={!flow.canBack()} onclick={() => flow.back()}>
      <ArrowLeft class="size-3.5" aria-hidden="true" />
    </button>
    <button type="button" class="grid size-7 place-items-center bg-[#16191c] transition hover:text-[#e9e8e4] disabled:opacity-30" aria-label="Forward" disabled={!flow.canForward()} onclick={() => flow.forward()}>
      <ArrowRight class="size-3.5" aria-hidden="true" />
    </button>
    <span class="text-[#5d6268]">{flow.cursor + 1} / {flow.history.length}</span>
  </div>

  {#each branches as branch (branch)}
    <section>
      <p class={head}>{branch}</p>
      <ol>
        {#each steps.filter((node) => node.branch === branch) as node (node.step)}
          {@const current = flow.step === node.step}
          <li>
            <button
              type="button"
              class="{item} {current ? 'text-[#e9e8e4]' : flow.visited.includes(node.step) ? 'text-[#a4a8ae]' : ''}"
              aria-current={current ? 'step' : 'false'}
              onclick={() => flow.jump(node.step)}
            >
              <span class="size-1.5 shrink-0 {current ? 'bg-[#8fa3c0]' : 'bg-[#2c3035]'}" aria-hidden="true"></span>
              {node.title}
            </button>
          </li>
        {/each}
      </ol>
    </section>
  {/each}

  <section>
    <p class={head}>Sync provider</p>
    {#each holds as entry (entry.id)}
      <button type="button" class="{item} {flow.holds === entry.id ? 'text-[#e9e8e4]' : ''}" onclick={() => (flow.holds = entry.id)}>
        <span class="size-1.5 shrink-0 {flow.holds === entry.id ? 'bg-[#d2b07a]' : 'bg-[#2c3035]'}" aria-hidden="true"></span>
        {entry.label}
      </button>
    {/each}
  </section>

  <section class="space-y-1">
    {#if flow.ready}
      <button type="button" class={item} onclick={() => flow.deviceAsks()}>
        <Send class="size-3" aria-hidden="true" /> device asks to join
      </button>
    {/if}
    <button type="button" class={item} onclick={() => flow.reset()}>
      <RotateCcw class="size-3" aria-hidden="true" /> reset
    </button>
  </section>
</aside>
