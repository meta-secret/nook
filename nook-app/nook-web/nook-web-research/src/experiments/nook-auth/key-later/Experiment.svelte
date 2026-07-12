<script lang="ts">
  import { Check, Fingerprint, Timer } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'
  import ScenarioBar, {
    type Presence,
  } from '../_shared/ScenarioBar.svelte'

  let { navigate }: ExperimentProps = $props()
  let presence = $state<Presence>('empty')
  let step = $state(0)

  const emptySteps = [
    'See empty presence',
    'Choose Sentinel',
    'Set threshold policy',
    'Initialize this device (passkey)',
  ]
  const existingSteps = [
    'See vault presence',
    'Confirm vault identity',
    'Unlock with passkey',
  ]

  const steps = $derived(presence === 'empty' ? emptySteps : existingSteps)

  function setPresence(next: Presence) {
    presence = next
    step = 0
  }
</script>

<main class="min-h-screen bg-[#f8f8f6] text-[#111]">
  <ExperimentBack {navigate} light />
  <ScenarioBar {presence} onPresence={setPresence} light />

  <section class="mx-auto grid min-h-screen max-w-5xl gap-12 px-6 py-24 lg:grid-cols-[1fr_1.1fr] lg:items-center">
    <div>
      <p class="inline-flex items-center gap-2 font-mono text-xs tracking-[0.18em] text-[#777] uppercase">
        <Timer class="size-3.5" /> Auth 06 · Key later
      </p>
      <h1 class="mt-4 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
        Passkey is a tool,<br />not the lobby.
      </h1>
      <p class="mt-5 max-w-md text-[#555] leading-7">
        This sketch dramatizes deferred authentication. The green checkmarks show
        what the user understands before any biometric prompt.
      </p>
    </div>

    <div class="rounded-3xl border border-black/10 bg-white p-8 shadow-sm">
      <ol class="space-y-4">
        {#each steps as label, index (label)}
          <li class="flex items-start gap-4">
            <span
              class={`mt-0.5 grid size-7 place-items-center rounded-full text-xs font-bold ${index < step ? 'bg-[#12805a] text-white' : index === step ? 'bg-black text-white' : 'bg-[#eee] text-[#888]'}`}
            >
              {#if index < step}<Check class="size-3.5" />{:else}{index + 1}{/if}
            </span>
            <div class="flex-1">
              <p class={`text-lg ${index === step ? 'font-semibold' : 'text-[#666]'}`}>
                {label}
              </p>
              {#if index === step && index === steps.length - 1}
                <button
                  class="mt-3 inline-flex items-center gap-2 rounded-full bg-black px-4 py-2 text-sm text-white"
                >
                  <Fingerprint class="size-4" /> Now use passkey
                </button>
              {/if}
            </div>
          </li>
        {/each}
      </ol>

      <div class="mt-8 flex gap-3">
        <button
          class="rounded-full border border-black/15 px-4 py-2 text-sm disabled:opacity-40"
          disabled={step === 0}
          onclick={() => (step -= 1)}
        >
          Back
        </button>
        <button
          class="rounded-full bg-black px-4 py-2 text-sm text-white disabled:opacity-40"
          disabled={step >= steps.length - 1}
          onclick={() => (step += 1)}
        >
          Next understanding
        </button>
      </div>
    </div>
  </section>
</main>
