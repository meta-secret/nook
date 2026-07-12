<script lang="ts">
  import { Fingerprint, Plus, Shield } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'
  import ScenarioBar, {
    type Presence,
  } from '../_shared/ScenarioBar.svelte'

  let { navigate }: ExperimentProps = $props()
  let presence = $state<Presence>('existing')
  let createMode = $state<'none' | 'chooser'>('none')

  function setPresence(next: Presence) {
    presence = next
    createMode = 'none'
  }
</script>

<main
  class="min-h-screen bg-[radial-gradient(circle_at_20%_0%,#1a2430,#090b0e_55%)] text-[#eef2f6]"
>
  <ExperimentBack {navigate} />
  <ScenarioBar {presence} onPresence={setPresence} />

  <section class="mx-auto grid min-h-screen max-w-4xl place-items-center px-6 py-24">
    {#if presence === 'existing'}
      <div class="w-full max-w-md text-center">
        <div
          class="mx-auto grid size-44 place-items-center rounded-[2rem] border border-white/15 bg-gradient-to-br from-white/15 to-white/5 shadow-[0_40px_100px_rgb(0_0_0/0.45)]"
        >
          <Shield class="size-14 text-[#9dffc8]" />
        </div>
        <p class="mt-10 font-mono text-xs tracking-[0.22em] text-[#8a97a6] uppercase">
          Sealed presence
        </p>
        <h1 class="mt-3 text-4xl font-light tracking-[-0.04em]">Vault waiting</h1>
        <p class="mt-4 text-[#9aa7b5]">
          A local capsule is already on this device. Passkey opens it — it does
          not invent an account.
        </p>
        <button
          class="mt-8 inline-flex items-center gap-2 rounded-full bg-[#9dffc8] px-6 py-3 text-sm font-semibold text-black"
        >
          <Fingerprint class="size-4" /> Unlock sealed vault
        </button>
      </div>
    {:else}
      <div class="w-full max-w-lg text-center">
        <div
          class="mx-auto grid size-44 place-items-center rounded-[2rem] border border-dashed border-white/20 bg-white/[0.03]"
        >
          <Plus class="size-12 text-white/40" />
        </div>
        <p class="mt-10 font-mono text-xs tracking-[0.22em] text-[#8a97a6] uppercase">
          No capsule yet
        </p>
        <h1 class="mt-3 text-4xl font-light tracking-[-0.04em]">Empty chamber</h1>
        <p class="mt-4 text-[#9aa7b5]">
          Create the thing first. Authentication waits until the thing needs a
          key.
        </p>
        {#if createMode === 'none'}
          <button
            class="mt-8 rounded-full border border-white/20 px-6 py-3 text-sm"
            onclick={() => (createMode = 'chooser')}
          >
            Create a vault
          </button>
        {:else}
          <div class="mt-8 grid gap-3 text-left">
            <button class="rounded-2xl border border-white/15 bg-white/5 p-5">
              <p class="font-medium">Simple vault</p>
              <p class="mt-1 text-sm text-[#9aa7b5]">Single-device unlock</p>
            </button>
            <button class="rounded-2xl border border-white/15 bg-white/5 p-5">
              <p class="font-medium">Sentinel vault</p>
              <p class="mt-1 text-sm text-[#9aa7b5]">
                Threshold · passkey at device init
              </p>
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </section>
</main>
