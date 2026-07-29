<script lang="ts">
  import { Fingerprint } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'
  import ScenarioBar from '../_shared/ScenarioBar.svelte'
  import {
    DemoVaultPresence as Presence,
    NookAuthChoice,
  } from '../_shared/nook-auth-state'

  let { navigate }: ExperimentProps = $props()
  let presence = $state<Presence>(Presence.Empty)
  let answer = $state<NookAuthChoice>(NookAuthChoice.None)

  function setPresence(next: Presence) {
    presence = next
    answer = NookAuthChoice.None
  }
</script>

<main class="min-h-screen bg-[#fafafa] text-black">
  <ExperimentBack {navigate} light />
  <ScenarioBar {presence} onPresence={setPresence} light />

  <section
    class="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-24"
  >
    <p class="font-mono text-[11px] tracking-[0.2em] text-[#888] uppercase">
      Auth 09 · One question
    </p>
    <h1 class="mt-6 text-4xl font-medium tracking-[-0.05em] sm:text-5xl">
      {presence === Presence.Existing
        ? 'Unlock your vault?'
        : 'What do you want to build?'}
    </h1>

    {#if presence === Presence.Existing}
      <button
        class="mt-10 w-full rounded-2xl bg-black py-4 text-sm font-medium text-white"
        onclick={() => (answer = NookAuthChoice.Unlock)}
      >
        Yes — unlock with passkey
      </button>
    {:else}
      <div class="mt-10 space-y-3">
        <button
          class="w-full rounded-2xl border border-black/10 bg-white py-4 text-left px-5 text-sm font-medium hover:border-black/30"
          onclick={() => (answer = NookAuthChoice.Simple)}
        >
          A simple vault
        </button>
        <button
          class="w-full rounded-2xl border border-black/10 bg-white py-4 text-left px-5 text-sm font-medium hover:border-black/30"
          onclick={() => (answer = NookAuthChoice.Sentinel)}
        >
          A Sentinel vault
        </button>
      </div>
    {/if}

    {#if answer !== NookAuthChoice.None}
      <div class="mt-8 border-t border-black/10 pt-6 text-sm text-[#555]">
        {#if answer === NookAuthChoice.Unlock}
          <p>Passkey is appropriate: something already exists.</p>
          <button
            class="mt-4 inline-flex items-center gap-2 font-medium text-black"
          >
            <Fingerprint class="size-4" /> Continue
          </button>
        {:else if answer === NookAuthChoice.Simple}
          <p>Next: name → create. No passkey prologue.</p>
        {:else}
          <p>Next: Sentinel policy. Passkey only at device init.</p>
        {/if}
      </div>
    {/if}
  </section>
</main>
