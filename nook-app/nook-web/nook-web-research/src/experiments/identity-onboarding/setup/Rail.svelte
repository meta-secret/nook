<!-- Prototype controls, kept out of the panel: history, every step to jump
to, and the simulator's answers. -->
<script lang="ts">
  import { ArrowLeft, ArrowRight, RotateCcw } from '@lucide/svelte'
  import type { SetupFlow } from './flow.svelte'
  import { FolderHolds, MemberOf, steps } from './model'

  let { flow }: { flow: SetupFlow } = $props()

  const memberships: readonly { id: MemberOf; label: string }[] = [
    { id: MemberOf.Work, label: 'Work' },
    { id: MemberOf.Nothing, label: 'nothing' },
  ]
  const folders: readonly { id: FolderHolds; label: string }[] = [
    { id: FolderHolds.Identities, label: 'two identities' },
    { id: FolderHolds.Nothing, label: 'nothing' },
  ]
  const head = 'mb-2 tracking-[0.18em] text-[#5d6268] uppercase'
  const item = 'flex w-full items-center gap-2 py-0.5 text-left transition hover:text-[#e9e8e4]'
  const square = 'grid size-7 place-items-center bg-[#16191c] transition hover:text-[#e9e8e4] disabled:opacity-30'
</script>

<aside class="w-[200px] shrink-0 space-y-7 font-mono text-[11px] text-[#80858c]" aria-label="Prototype">
  <div class="flex items-center gap-3">
    <button type="button" class={square} aria-label="Back" disabled={!flow.canBack()} onclick={() => flow.back()}>
      <ArrowLeft class="size-3.5" aria-hidden="true" />
    </button>
    <button type="button" class={square} aria-label="Forward" disabled={!flow.canForward()} onclick={() => flow.forward()}>
      <ArrowRight class="size-3.5" aria-hidden="true" />
    </button>
    <span class="text-[#5d6268]">{flow.cursor + 1} / {flow.history.length}</span>
  </div>

  <section>
    <p class={head}>Steps</p>
    <ol>
      {#each steps as node (node.step)}
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

  <section>
    <p class={head}>Existing passkey is in</p>
    {#each memberships as entry (entry.id)}
      <button type="button" class="{item} {flow.memberOf === entry.id ? 'text-[#e9e8e4]' : ''}" onclick={() => (flow.memberOf = entry.id)}>
        <span class="size-1.5 shrink-0 {flow.memberOf === entry.id ? 'bg-[#d2b07a]' : 'bg-[#2c3035]'}" aria-hidden="true"></span>
        {entry.label}
      </button>
    {/each}
    <p class="mt-1 text-[#4a5058]">a new passkey is in nothing</p>
  </section>

  <section>
    <p class={head}>Drive folder holds</p>
    {#each folders as entry (entry.id)}
      <button type="button" class="{item} {flow.holds === entry.id ? 'text-[#e9e8e4]' : ''}" onclick={() => (flow.holds = entry.id)}>
        <span class="size-1.5 shrink-0 {flow.holds === entry.id ? 'bg-[#d2b07a]' : 'bg-[#2c3035]'}" aria-hidden="true"></span>
        {entry.label}
      </button>
    {/each}
  </section>

  <button type="button" class={item} onclick={() => flow.reset()}>
    <RotateCcw class="size-3" aria-hidden="true" /> reset
  </button>
</aside>
