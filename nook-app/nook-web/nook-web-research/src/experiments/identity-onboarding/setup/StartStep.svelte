<!-- Step one: what setup will do, as the three things it sets up, and the
one button that begins it. -->
<script lang="ts">
  import { HardDrive, KeyRound, UserRound } from '@lucide/svelte'
  import Heading from './Heading.svelte'
  import type { SetupFlow } from './flow.svelte'
  import { Step } from './model'
  import { ui } from './ui'

  let { flow }: { flow: SetupFlow } = $props()

  const path = [
    { icon: KeyRound, label: 'Passkey' },
    { icon: HardDrive, label: 'Google Drive' },
    { icon: UserRound, label: 'Identity' },
  ]
</script>

<Heading eyebrow="Setup" title="Create your identity" sub="A passkey on this browser, synced through Google Drive." />
<ol class="flex flex-col gap-px">
  {#each path as stage, index (stage.label)}
    <li class="flex items-center gap-4 bg-[#16191c] px-5 py-4">
      <span class="font-mono text-[11px] text-[#5d6268]">0{index + 1}</span>
      <stage.icon class="size-4 text-[#a4a8ae]" aria-hidden="true" />
      <span class="text-[15px] text-[#d6d5d1]">{stage.label}</span>
    </li>
  {/each}
</ol>
<div class="mt-auto pt-10">
  <button type="button" class={ui.primary} onclick={() => flow.go(Step.Passkey)}>Create identity</button>
</div>
