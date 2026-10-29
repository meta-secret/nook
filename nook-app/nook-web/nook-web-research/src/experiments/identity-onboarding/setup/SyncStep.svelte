<!-- Setup finishes: this browser is on the identity, and Nook pulls its
events from Google Drive until it is up to date. -->
<script lang="ts">
  import { Check, Folder, Play } from '@lucide/svelte'
  import Avatar from './Avatar.svelte'
  import Heading from './Heading.svelte'
  import type { SetupFlow } from './flow.svelte'
  import { folder } from './model'
  import { ui } from './ui'

  let { flow }: { flow: SetupFlow } = $props()

  const total = $derived(flow.events())
  let synced = $state(0)

  $effect(() => {
    const goal = total
    synced = 0
    const step = Math.max(1, Math.ceil(goal / 20))
    const timer = setInterval(() => {
      synced = Math.min(goal, synced + step)
      if (synced >= goal) clearInterval(timer)
    }, 60)
    return () => clearInterval(timer)
  })

  const done = $derived(synced >= total)
</script>

<Heading
  eyebrow={done ? 'Done' : 'Finishing'}
  title={done ? 'You’re set' : 'Syncing'}
/>

<div class="flex flex-col gap-px">
  <div class="{ui.plate} flex items-center gap-4">
    <Avatar words={flow.identity.words} name={flow.identity.name} />
    <div class="min-w-0 flex-1">
      <p class="truncate text-[17px] font-semibold">{flow.identity.name}</p>
      <p class="mt-0.5 {ui.mono}">{flow.identity.words}</p>
    </div>
    {#if flow.created}
      <span
        class="font-mono text-[10px] tracking-[0.12em] text-[#8fa3c0] uppercase"
        >new</span
      >
    {/if}
  </div>
  <div class="{ui.plate} space-y-3">
    <div class="flex items-center justify-between gap-4">
      <span class="inline-flex items-center gap-2 text-[14px] text-[#d6d5d1]">
        <Folder class="size-4 text-[#80858c]" aria-hidden="true" />
        {folder.join(' › ')}
      </span>
      {#if done}
        <span
          class="inline-flex items-center gap-1.5 text-[13px] text-[#9cc3a4]"
          ><Check class="size-3.5" aria-hidden="true" /> Up to date</span
        >
      {:else}
        <span class="font-mono text-[12px] text-[#a4a8ae]"
          >{synced} / {total}</span
        >
      {/if}
    </div>
    <div class="h-[3px] bg-[#23272b]">
      <div
        class="h-full bg-[#8fa3c0] transition-[width] duration-75"
        style="width: {(synced / total) * 100}%"
      ></div>
    </div>
    <p class="font-mono text-[11px] text-[#5d6268]">{total} events</p>
  </div>
</div>

<div class="mt-auto space-y-4 pt-10">
  <button type="button" class={ui.primary} disabled={!done}>Open Nook</button>
  <button
    type="button"
    class="{ui.sim} w-full justify-center"
    onclick={() => flow.reset()}
  >
    <Play class="size-3" aria-hidden="true" /> simulate: start over
  </button>
</div>
