<!-- The passkey is not a member, so this browser asked to join. A member
device approves after checking the same code; then setup finishes on the
joined identity. -->
<script lang="ts">
  import { LoaderCircle, Play } from '@lucide/svelte'
  import Avatar from './Avatar.svelte'
  import Heading from './Heading.svelte'
  import type { SetupFlow } from './flow.svelte'
  import { joinCode } from './model'
  import { ui } from './ui'

  let { flow }: { flow: SetupFlow } = $props()
</script>

<Heading
  eyebrow="Step 3 of 3 · Identity"
  title="Request sent"
  sub="Approve it on a device that is already a member."
/>

<div class="flex flex-col gap-px">
  <div class="{ui.plate} flex items-center gap-4">
    <Avatar words={flow.identity.words} />
    <div class="min-w-0 flex-1">
      <p class="truncate font-mono text-[14px] text-[#d6d5d1]">
        {flow.identity.words}
      </p>
      <p class="mt-0.5 text-[13px] text-[#80858c]">
        {flow.identity.devices} devices · name sealed
      </p>
    </div>
    <span
      class="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] text-[#d2b07a] uppercase"
    >
      <span class="size-1.5 bg-[#d2b07a]" aria-hidden="true"></span> pending
    </span>
  </div>
  <div class={ui.plate}>
    <p class="font-mono text-[11px] tracking-[0.18em] text-[#80858c] uppercase">
      Code
    </p>
    <p
      class="mt-2 font-mono text-[34px] leading-none tracking-[0.2em] text-[#e9e8e4]"
    >
      {joinCode}
    </p>
    <p class="mt-3 text-[13px] text-[#80858c]">
      The other device shows the same.
    </p>
  </div>
</div>

<p class="mt-6 inline-flex items-center gap-2 text-[13px] text-[#a4a8ae]">
  <LoaderCircle class="size-4 animate-spin text-[#8fa3c0]" aria-hidden="true" /> Waiting
  for approval
</p>

<div class="mt-auto pt-10">
  <button
    type="button"
    class={ui.sim}
    onclick={() => flow.finish(flow.identity)}
  >
    <Play class="size-3" aria-hidden="true" /> simulate: approved
  </button>
</div>
