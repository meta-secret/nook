<!-- The setup as it would ship: a panel with a three-stage progress bar, a
back arrow while there is a step to return to, and the current step sliding
in. -->
<script lang="ts">
  import { ChevronLeft } from '@lucide/svelte'
  import { fly } from 'svelte/transition'
  import IdentitiesStep from './IdentitiesStep.svelte'
  import JoinStep from './JoinStep.svelte'
  import NameStep from './NameStep.svelte'
  import PasskeyStep from './PasskeyStep.svelte'
  import ProviderStep from './ProviderStep.svelte'
  import StartStep from './StartStep.svelte'
  import SyncStep from './SyncStep.svelte'
  import type { SetupFlow } from './flow.svelte'
  import { Step, stages } from './model'
  import { ui } from './ui'

  let { flow }: { flow: SetupFlow } = $props()

  const reached = $derived(flow.stageOf(flow.step))
  const canReturn = $derived(flow.canBack() && flow.step !== Step.Sync)
</script>

<div class={ui.panel}>
  <header class="px-8 pt-6">
    <div class="flex h-8 items-center justify-between">
      {#if canReturn}
        <button
          type="button"
          class="-ml-2 grid size-8 place-items-center text-[#a4a8ae] transition hover:text-[#e9e8e4]"
          aria-label="Back"
          onclick={() => flow.back()}
        >
          <ChevronLeft class="size-5" aria-hidden="true" />
        </button>
      {:else}
        <span></span>
      {/if}
      <span class="font-mono text-[11px] tracking-[0.34em] text-[#5d6268]"
        >NOOK</span
      >
    </div>
    <div class="mt-4 grid grid-cols-3 gap-1.5" aria-label="Progress">
      {#each stages as stage, index (stage)}
        <span
          class="h-[3px] transition-colors duration-300 {index < reached
            ? 'bg-[#8fa3c0]'
            : 'bg-[#23272b]'}"
          title={stage}
        ></span>
      {/each}
    </div>
  </header>

  {#key flow.step}
    <div
      class="flex flex-1 flex-col px-8 pt-9 pb-8"
      in:fly={{ x: 18, duration: 220 }}
    >
      {#if flow.step === Step.Start}
        <StartStep {flow} />
      {:else if flow.step === Step.Passkey}
        <PasskeyStep {flow} />
      {:else if flow.step === Step.Provider}
        <ProviderStep {flow} />
      {:else if flow.step === Step.Identities}
        <IdentitiesStep {flow} />
      {:else if flow.step === Step.Join}
        <JoinStep {flow} />
      {:else if flow.step === Step.Name}
        <NameStep {flow} />
      {:else}
        <SyncStep {flow} />
      {/if}
    </div>
  {/key}
</div>
