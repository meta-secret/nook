<script lang="ts">
  import { Fingerprint, KeyRound, Shield, Sparkles } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'
  import ScenarioBar from '../_shared/ScenarioBar.svelte'
  import {
    DemoVaultPresence as Presence,
    NookAuthStage,
  } from '../_shared/nook-auth-state'

  let { navigate }: ExperimentProps = $props()
  let presence = $state<Presence>(Presence.Empty)
  let stage = $state<NookAuthStage>(NookAuthStage.Home)

  function setPresence(next: Presence) {
    presence = next
    stage = NookAuthStage.Home
  }
</script>

<main class="min-h-screen bg-[#f4f5f3] text-[#12140f]">
  <ExperimentBack {navigate} light />
  <ScenarioBar {presence} onPresence={setPresence} light />

  <section
    class="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-24"
  >
    <p class="font-mono text-xs tracking-[0.22em] text-[#6f7668] uppercase">
      Auth 01 · What's there?
    </p>

    {#if stage === NookAuthStage.Home && presence === Presence.Empty}
      <h1
        class="mt-5 font-serif text-5xl leading-[0.95] tracking-[-0.04em] sm:text-6xl"
      >
        Nothing here yet.
      </h1>
      <p class="mt-5 max-w-xl text-lg leading-8 text-[#5d6458]">
        This browser has no vault. Choose what to build — passkey comes later,
        only when a Sentinel device needs to be born.
      </p>
      <div class="mt-10 grid gap-3 sm:grid-cols-2">
        <button
          class="rounded-2xl border border-black/10 bg-white p-6 text-left transition hover:border-black/30"
          onclick={() => (stage = NookAuthStage.Simple)}
        >
          <Sparkles class="size-5" />
          <p class="mt-4 text-xl font-semibold">Create a simple vault</p>
          <p class="mt-2 text-sm leading-6 text-[#6a7164]">
            One device unlocks alone. Fast start for everyday secrets.
          </p>
        </button>
        <button
          class="rounded-2xl border border-black/10 bg-white p-6 text-left transition hover:border-black/30"
          onclick={() => (stage = NookAuthStage.Sentinel)}
        >
          <Shield class="size-5" />
          <p class="mt-4 text-xl font-semibold">Build a Sentinel vault</p>
          <p class="mt-2 text-sm leading-6 text-[#6a7164]">
            Threshold custody. Passkey appears only when this device is
            initialized.
          </p>
        </button>
      </div>
    {:else if stage === NookAuthStage.Home && presence === Presence.Existing}
      <h1
        class="mt-5 font-serif text-5xl leading-[0.95] tracking-[-0.04em] sm:text-6xl"
      >
        Your vault is here.
      </h1>
      <p class="mt-5 max-w-xl text-lg leading-8 text-[#5d6458]">
        Local presence detected. Unlock opens something that already exists —
        not a blank authentication ritual.
      </p>
      <div class="mt-10 rounded-2xl border border-black/10 bg-white p-6">
        <p class="font-mono text-xs tracking-[0.18em] text-[#7a8174] uppercase">
          Local vault
        </p>
        <p class="mt-3 text-2xl font-semibold">Personal · sealed</p>
        <p class="mt-2 text-sm text-[#6a7164]">Last opened on this device</p>
        <button
          class="mt-6 inline-flex items-center gap-2 rounded-full bg-black px-5 py-3 text-sm font-medium text-white"
          onclick={() => (stage = NookAuthStage.Unlock)}
        >
          <KeyRound class="size-4" /> Unlock with passkey
        </button>
      </div>
    {:else if stage === NookAuthStage.Simple}
      <h1 class="mt-5 font-serif text-5xl tracking-[-0.04em]">
        Name it. Open it.
      </h1>
      <p class="mt-4 text-[#5d6458]">Simple vault — no passkey wall first.</p>
      <input
        class="mt-8 w-full border-b border-black/20 bg-transparent py-3 text-2xl outline-none"
        placeholder="Vault name"
      />
      <button
        class="mt-8 w-fit rounded-full bg-black px-5 py-3 text-sm text-white"
        >Create simple vault</button
      >
      <button
        class="mt-4 text-sm text-[#6a7164]"
        onclick={() => (stage = NookAuthStage.Home)}>Back</button
      >
    {:else if stage === NookAuthStage.Sentinel}
      <h1 class="mt-5 font-serif text-5xl tracking-[-0.04em]">
        Sentinel setup
      </h1>
      <p class="mt-4 max-w-lg text-[#5d6458]">
        Policy first. Device identity (passkey) only when you initialize this
        participant.
      </p>
      <div class="mt-8 flex gap-6 font-mono text-sm">
        <label
          >N <input
            type="number"
            value="3"
            class="ml-2 w-16 border-b bg-transparent"
          /></label
        >
        <label
          >T <input
            type="number"
            value="2"
            class="ml-2 w-16 border-b bg-transparent"
          /></label
        >
      </div>
      <button
        class="mt-8 w-fit rounded-full bg-black px-5 py-3 text-sm text-white"
        onclick={() => (stage = NookAuthStage.Passkey)}
      >
        Initialize this device
      </button>
      <button
        class="mt-4 text-sm text-[#6a7164]"
        onclick={() => (stage = NookAuthStage.Home)}>Back</button
      >
    {:else if stage === NookAuthStage.Passkey || stage === NookAuthStage.Unlock}
      <h1 class="mt-5 font-serif text-5xl tracking-[-0.04em]">
        {stage === NookAuthStage.Unlock ? 'Unlock vault' : 'Initialize device'}
      </h1>
      <p class="mt-4 max-w-lg text-[#5d6458]">
        Passkey now has a reason: {stage === NookAuthStage.Unlock
          ? 'open a vault that already exists.'
          : 'bind this browser as a Sentinel participant.'}
      </p>
      <button
        class="mt-8 inline-flex items-center gap-2 rounded-full bg-black px-5 py-3 text-sm text-white"
      >
        <Fingerprint class="size-4" /> Continue with passkey
      </button>
      <button
        class="mt-4 text-sm text-[#6a7164]"
        onclick={() => (stage = NookAuthStage.Home)}>Back</button
      >
    {/if}
  </section>
</main>
