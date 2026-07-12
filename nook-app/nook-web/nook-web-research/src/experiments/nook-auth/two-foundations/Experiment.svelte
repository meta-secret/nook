<script lang="ts">
  import { Fingerprint, Layers, ShieldCheck } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'
  import ScenarioBar, {
    type Presence,
  } from '../_shared/ScenarioBar.svelte'

  let { navigate }: ExperimentProps = $props()
  let presence = $state<Presence>('empty')
  let selected = $state<'simple' | 'sentinel' | null>(null)

  function setPresence(next: Presence) {
    presence = next
    selected = null
  }
</script>

<main class="min-h-screen bg-[#0e1110] text-[#e8ece7]">
  <ExperimentBack {navigate} />
  <ScenarioBar {presence} onPresence={setPresence} />

  <section class="mx-auto max-w-5xl px-6 py-24">
    <p class="font-mono text-xs tracking-[0.2em] text-[#7d8a7c] uppercase">
      Auth 03 · Two foundations
    </p>
    <h1 class="mt-4 max-w-2xl text-4xl font-light tracking-[-0.04em] sm:text-5xl">
      {presence === 'existing'
        ? 'Foundation already poured.'
        : 'Pick the foundation before the key.'}
    </h1>

    {#if presence === 'existing'}
      <div class="mt-12 max-w-xl rounded-3xl border border-white/10 bg-white/5 p-8">
        <p class="font-mono text-xs text-[#8fa08c]">LOCAL · SIMPLE</p>
        <p class="mt-3 text-3xl font-light">Household vault</p>
        <p class="mt-3 text-[#9aa89a]">Sealed on this browser. Unlock with passkey.</p>
        <button
          class="mt-8 inline-flex items-center gap-2 rounded-full bg-[#c8f5b8] px-5 py-3 text-sm font-semibold text-black"
        >
          <Fingerprint class="size-4" /> Unlock
        </button>
      </div>
    {:else}
      <div class="mt-12 grid gap-4 md:grid-cols-2">
        <button
          class={`rounded-3xl border p-8 text-left transition ${selected === 'simple' ? 'border-[#c8f5b8] bg-[#c8f5b8]/10' : 'border-white/10 bg-white/[0.03] hover:border-white/25'}`}
          onclick={() => (selected = 'simple')}
        >
          <Layers class="size-6 text-[#c8f5b8]" />
          <p class="mt-6 text-2xl font-light">Simple vault</p>
          <p class="mt-3 text-sm leading-6 text-[#9aa89a]">
            One enrolled device unlocks alone. Built for daily credential work.
          </p>
        </button>
        <button
          class={`rounded-3xl border p-8 text-left transition ${selected === 'sentinel' ? 'border-[#c8f5b8] bg-[#c8f5b8]/10' : 'border-white/10 bg-white/[0.03] hover:border-white/25'}`}
          onclick={() => (selected = 'sentinel')}
        >
          <ShieldCheck class="size-6 text-[#c8f5b8]" />
          <p class="mt-6 text-2xl font-light">Sentinel vault</p>
          <p class="mt-3 text-sm leading-6 text-[#9aa89a]">
            Threshold custody. Passkey binds this device only when you start
            participant init.
          </p>
        </button>
      </div>

      {#if selected}
        <div class="mt-8 rounded-2xl border border-white/10 bg-black/40 p-6">
          {#if selected === 'simple'}
            <p class="text-lg">Continue to name → create. No passkey prologue.</p>
          {:else}
            <p class="text-lg">
              Continue to Sentinel policy. Passkey deferred until “Initialize
              this device”.
            </p>
          {/if}
          <button class="mt-5 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black">
            Continue
          </button>
        </div>
      {/if}
    {/if}
  </section>
</main>
