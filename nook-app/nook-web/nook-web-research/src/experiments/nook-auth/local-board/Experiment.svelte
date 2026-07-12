<script lang="ts">
  import { Fingerprint, HardDrive, Radio, Shield } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'
  import ScenarioBar, {
    type Presence,
  } from '../_shared/ScenarioBar.svelte'

  let { navigate }: ExperimentProps = $props()
  let presence = $state<Presence>('empty')
  let action = $state<'none' | 'simple' | 'sentinel' | 'unlock'>('none')

  function setPresence(next: Presence) {
    presence = next
    action = 'none'
  }
</script>

<main class="min-h-screen bg-[#11140f] text-[#e7ecdf]">
  <ExperimentBack {navigate} />
  <ScenarioBar {presence} onPresence={setPresence} />

  <section class="mx-auto max-w-5xl px-6 py-24">
    <div class="flex items-end justify-between gap-6 border-b border-white/10 pb-6">
      <div>
        <p class="font-mono text-xs tracking-[0.2em] text-[#809078] uppercase">
          Auth 10 · Local board
        </p>
        <h1 class="mt-3 text-3xl font-light tracking-[-0.03em] sm:text-4xl">
          Local status before ceremony
        </h1>
      </div>
      <p class="font-mono text-xs text-[#809078]">SCAN · THIS BROWSER</p>
    </div>

    <div class="mt-8 grid gap-4 md:grid-cols-3">
      <div class="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <HardDrive class="size-5 text-[#b7f59a]" />
        <p class="mt-4 font-mono text-xs tracking-[0.16em] text-[#809078]">STORAGE</p>
        <p class="mt-2 text-xl">
          {presence === 'existing' ? '1 vault present' : '0 vaults'}
        </p>
      </div>
      <div class="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <Radio class="size-5 text-[#b7f59a]" />
        <p class="mt-4 font-mono text-xs tracking-[0.16em] text-[#809078]">DEVICE</p>
        <p class="mt-2 text-xl">
          {presence === 'existing' ? 'Bound · ready to unlock' : 'Unbound'}
        </p>
      </div>
      <div class="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <Shield class="size-5 text-[#b7f59a]" />
        <p class="mt-4 font-mono text-xs tracking-[0.16em] text-[#809078]">PASSKEY</p>
        <p class="mt-2 text-xl">
          {presence === 'existing' ? 'Needed for unlock' : 'Not required yet'}
        </p>
      </div>
    </div>

    <div class="mt-8 rounded-2xl border border-white/10 bg-black/30 p-6">
      {#if presence === 'existing'}
        <p class="text-lg">Recommended action: unlock sealed local vault.</p>
        <button
          class="mt-5 inline-flex items-center gap-2 rounded-full bg-[#b7f59a] px-5 py-2.5 text-sm font-semibold text-black"
          onclick={() => (action = 'unlock')}
        >
          <Fingerprint class="size-4" /> Unlock
        </button>
      {:else}
        <p class="text-lg">Recommended action: create presence before binding a key.</p>
        <div class="mt-5 flex flex-wrap gap-3">
          <button
            class="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black"
            onclick={() => (action = 'simple')}
          >
            Create simple vault
          </button>
          <button
            class="rounded-full border border-white/20 px-5 py-2.5 text-sm"
            onclick={() => (action = 'sentinel')}
          >
            Build Sentinel vault
          </button>
        </div>
      {/if}

      {#if action === 'sentinel'}
        <p class="mt-6 text-sm text-[#a3b39a]">
          Sentinel selected. Passkey arms only on “Initialize this device”.
        </p>
      {:else if action === 'simple'}
        <p class="mt-6 text-sm text-[#a3b39a]">Simple selected. Name → create.</p>
      {:else if action === 'unlock'}
        <p class="mt-6 text-sm text-[#a3b39a]">
          Passkey is contextual: open what already exists.
        </p>
      {/if}
    </div>
  </section>
</main>
