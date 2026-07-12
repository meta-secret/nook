<script lang="ts">
  import { Fingerprint, PenLine, Shield } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'
  import ScenarioBar, {
    type Presence,
  } from '../_shared/ScenarioBar.svelte'

  let { navigate }: ExperimentProps = $props()
  let presence = $state<Presence>('empty')
  let draft = $state<'idle' | 'simple' | 'sentinel'>('idle')

  function setPresence(next: Presence) {
    presence = next
    draft = 'idle'
  }
</script>

<main class="min-h-screen bg-[#efe8dc] text-[#1c1710]">
  <ExperimentBack {navigate} light />
  <ScenarioBar {presence} onPresence={setPresence} light />

  <section class="mx-auto grid min-h-screen max-w-6xl gap-10 px-6 py-24 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
    <div>
      <p class="font-mono text-xs tracking-[0.2em] text-[#8a7d68] uppercase">
        Auth 05 · Empty studio
      </p>
      <h1 class="mt-4 font-serif text-5xl leading-[0.95] sm:text-6xl">
        {presence === 'existing' ? 'Work already on the bench.' : 'A clean bench.'}
      </h1>
      <p class="mt-5 max-w-md text-lg leading-8 text-[#6d6254]">
        {presence === 'existing'
          ? 'Unlock the sealed piece before you make another.'
          : 'Treat first launch like a studio: choose the build, then reach for tools.'}
      </p>
    </div>

    <div class="rounded-[2rem] border border-[#d5c9b5] bg-[#f7f1e6] p-8 shadow-[0_30px_80px_rgb(80_60_30/0.12)]">
      {#if presence === 'existing'}
        <p class="font-mono text-xs tracking-[0.16em] text-[#8a7d68] uppercase">
          On the bench
        </p>
        <p class="mt-3 text-3xl font-serif">Travel vault</p>
        <p class="mt-2 text-[#6d6254]">Encrypted locally · ready to open</p>
        <button
          class="mt-8 inline-flex items-center gap-2 rounded-full bg-[#1c1710] px-5 py-3 text-sm text-[#efe8dc]"
        >
          <Fingerprint class="size-4" /> Unlock
        </button>
      {:else if draft === 'idle'}
        <p class="font-mono text-xs tracking-[0.16em] text-[#8a7d68] uppercase">
          Start a draft
        </p>
        <div class="mt-6 grid gap-3">
          <button
            class="flex items-start gap-4 rounded-2xl border border-[#d5c9b5] bg-white/50 p-5 text-left"
            onclick={() => (draft = 'simple')}
          >
            <PenLine class="mt-1 size-5" />
            <span>
              <span class="block text-lg font-medium">Simple vault</span>
              <span class="mt-1 block text-sm text-[#6d6254]"
                >Sketch fast. One device. No ceremony first.</span
              >
            </span>
          </button>
          <button
            class="flex items-start gap-4 rounded-2xl border border-[#d5c9b5] bg-white/50 p-5 text-left"
            onclick={() => (draft = 'sentinel')}
          >
            <Shield class="mt-1 size-5" />
            <span>
              <span class="block text-lg font-medium">Sentinel vault</span>
              <span class="mt-1 block text-sm text-[#6d6254]"
                >Architect a threshold. Passkey when this device joins.</span
              >
            </span>
          </button>
        </div>
      {:else if draft === 'simple'}
        <p class="text-2xl font-serif">Name the simple vault</p>
        <input
          class="mt-6 w-full border-b border-[#1c1710]/25 bg-transparent py-3 text-xl outline-none"
          placeholder="Studio vault"
        />
        <button class="mt-8 rounded-full bg-[#1c1710] px-5 py-3 text-sm text-[#efe8dc]"
          >Create</button
        >
        <button class="ml-3 text-sm text-[#6d6254]" onclick={() => (draft = 'idle')}
          >Back</button
        >
      {:else}
        <p class="text-2xl font-serif">Sentinel draft</p>
        <p class="mt-3 text-[#6d6254]">Set N/T, then initialize this device with passkey.</p>
        <div class="mt-6 flex gap-8 font-mono">
          <label>N <input class="ml-2 w-14 border-b bg-transparent" value="3" /></label>
          <label>T <input class="ml-2 w-14 border-b bg-transparent" value="2" /></label>
        </div>
        <button
          class="mt-8 inline-flex items-center gap-2 rounded-full bg-[#1c1710] px-5 py-3 text-sm text-[#efe8dc]"
        >
          <Fingerprint class="size-4" /> Initialize device
        </button>
        <button class="ml-3 text-sm text-[#6d6254]" onclick={() => (draft = 'idle')}
          >Back</button
        >
      {/if}
    </div>
  </section>
</main>
