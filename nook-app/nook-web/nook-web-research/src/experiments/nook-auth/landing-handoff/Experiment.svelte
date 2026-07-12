<script lang="ts">
  import { ArrowUpRight, Fingerprint, Shield } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'
  import ScenarioBar, { type Presence } from '../_shared/ScenarioBar.svelte'

  let { navigate }: ExperimentProps = $props()
  let presence = $state<Presence>('empty')
  let picked = $state<'none' | 'simple' | 'sentinel' | 'unlock'>('none')

  function setPresence(next: Presence) {
    presence = next
    picked = 'none'
  }
</script>

<main class="min-h-screen bg-white text-black">
  <ExperimentBack {navigate} light />
  <ScenarioBar {presence} onPresence={setPresence} light />

  <section
    class="mx-auto grid min-h-screen max-w-6xl items-center gap-12 px-6 py-24 lg:grid-cols-[1.05fr_0.95fr]"
  >
    <div>
      <p
        class="font-mono text-[11px] tracking-[0.2em] text-[#7a7a7a] uppercase"
      >
        Vault 01 / personal secret system
      </p>
      <h1
        class="mt-5 text-5xl leading-[0.95] font-semibold tracking-[-0.05em] sm:text-6xl"
      >
        {presence === 'existing'
          ? 'Keys you already keep.'
          : 'Keys, not accounts.'}
      </h1>
      <p class="mt-6 max-w-md text-base leading-7 text-[#555]">
        {presence === 'existing'
          ? 'Open Nook found a sealed vault on this device. Unlock continues the landing promise — no create theater.'
          : 'Same voice as the landing page. First choice is what to build, not how to authenticate.'}
      </p>

      {#if presence === 'existing'}
        <button
          class="mt-10 inline-flex items-center gap-2 rounded-md bg-black px-5 py-3 text-sm font-medium text-white"
          onclick={() => (picked = 'unlock')}
        >
          Unlock vault <ArrowUpRight class="size-4" />
        </button>
      {:else}
        <div class="mt-10 flex flex-wrap gap-3">
          <button
            class="rounded-md bg-black px-5 py-3 text-sm font-medium text-white"
            onclick={() => (picked = 'simple')}
          >
            Create simple vault
          </button>
          <button
            class="rounded-md border border-black px-5 py-3 text-sm font-medium"
            onclick={() => (picked = 'sentinel')}
          >
            Build Sentinel vault
          </button>
        </div>
      {/if}

      {#if picked !== 'none'}
        <div class="mt-8 rounded-xl border border-black/10 bg-[#f7f7f5] p-5">
          <p
            class="font-mono text-[11px] tracking-[0.16em] uppercase text-[#777]"
          >
            Next step
          </p>
          {#if picked === 'unlock'}
            <p class="mt-2 text-lg font-medium">
              Passkey unlocks the existing vault.
            </p>
            <button
              class="mt-4 inline-flex items-center gap-2 text-sm font-medium"
            >
              <Fingerprint class="size-4" /> Authenticate
            </button>
          {:else if picked === 'simple'}
            <p class="mt-2 text-lg font-medium">
              Name the vault and create locally.
            </p>
            <input
              class="mt-4 w-full border-b border-black/20 bg-transparent py-2 outline-none"
              placeholder="Vault name"
            />
          {:else}
            <p class="mt-2 text-lg font-medium">
              Sentinel policy first — passkey only at device init.
            </p>
            <button
              class="mt-4 inline-flex items-center gap-2 text-sm font-medium"
            >
              <Shield class="size-4" /> Continue to Sentinel setup
            </button>
          {/if}
        </div>
      {/if}
    </div>

    <div class="relative grid min-h-[28rem] place-items-center">
      <div class="absolute size-80 rounded-full border border-black/8"></div>
      <div class="absolute size-56 rounded-full border border-black/12"></div>
      <div
        class="relative grid size-40 place-items-center rounded-full bg-[radial-gradient(circle_at_30%_25%,#fff,#c9ced4_60%,#8b929a)] shadow-[0_30px_80px_rgb(0_0_0/0.18)]"
      >
        <div
          class="grid size-16 place-items-center rounded-full bg-black text-[#8dffcf]"
        >
          <Shield class="size-7" />
        </div>
      </div>
      <p
        class="absolute bottom-6 font-mono text-[11px] tracking-[0.18em] text-[#888] uppercase"
      >
        {presence === 'existing'
          ? 'Presence · vault sealed'
          : 'Presence · empty mesh'}
      </p>
    </div>
  </section>
</main>
