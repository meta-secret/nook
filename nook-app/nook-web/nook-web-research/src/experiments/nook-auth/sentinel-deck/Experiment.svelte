<script lang="ts">
  import { CreditCard, Fingerprint, Layers3 } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'
  import ScenarioBar, {
    type Presence,
  } from '../_shared/ScenarioBar.svelte'

  let { navigate }: ExperimentProps = $props()
  let presence = $state<Presence>('empty')
  let view = $state<'chooser' | 'deck' | 'passkey'>('chooser')

  function setPresence(next: Presence) {
    presence = next
    view = 'chooser'
  }
</script>

<main class="min-h-screen bg-[#101218] text-white">
  <ExperimentBack {navigate} />
  <ScenarioBar {presence} onPresence={setPresence} />

  <section class="mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-6 py-24 lg:grid-cols-2">
    <div>
      <p class="font-mono text-xs tracking-[0.2em] text-[#8b93a7] uppercase">
        Auth 08 · Sentinel deck entry
      </p>
      <h1 class="mt-4 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
        Cards for custody,<br />not for login.
      </h1>
      <p class="mt-5 max-w-md text-[#9aa3b5] leading-7">
        Hand-off into the card-stack Sentinel UI. Presence decides whether you
        unlock a card or start a new deck.
      </p>
    </div>

    <div class="relative min-h-[26rem]">
      {#if presence === 'existing' && view === 'chooser'}
        <div
          class="absolute inset-x-8 top-8 rounded-3xl border border-white/10 bg-gradient-to-br from-[#1c2330] to-[#0d1018] p-6 shadow-2xl"
        >
          <CreditCard class="size-6 text-[#9dffc8]" />
          <p class="mt-8 text-2xl font-medium">Personal vault</p>
          <p class="mt-2 text-sm text-[#9aa3b5]">Sealed card on this device</p>
          <button
            class="mt-8 inline-flex items-center gap-2 rounded-full bg-[#9dffc8] px-4 py-2 text-sm font-semibold text-black"
            onclick={() => (view = 'passkey')}
          >
            <Fingerprint class="size-4" /> Unlock card
          </button>
        </div>
      {:else if view === 'chooser'}
        <div class="space-y-3">
          <button
            class="w-full rounded-3xl border border-white/10 bg-white/5 p-6 text-left"
            onclick={() => (view = 'chooser')}
          >
            <Layers3 class="size-5 text-[#9dffc8]" />
            <p class="mt-4 text-xl">Simple vault</p>
            <p class="mt-2 text-sm text-[#9aa3b5]">Create a single local card</p>
          </button>
          <button
            class="w-full rounded-3xl border border-[#9dffc8]/30 bg-[#9dffc8]/5 p-6 text-left"
            onclick={() => (view = 'deck')}
          >
            <CreditCard class="size-5 text-[#9dffc8]" />
            <p class="mt-4 text-xl">Sentinel vault</p>
            <p class="mt-2 text-sm text-[#9aa3b5]">
              Open card-stack builder · passkey at device init
            </p>
          </button>
        </div>
      {:else if view === 'deck'}
        <div class="relative h-[22rem]">
          {#each [0, 1, 2] as i (i)}
            <div
              class="absolute inset-x-6 rounded-3xl border border-white/10 bg-[#171d28] p-5 shadow-xl"
              style={`top:${i * 28}px; transform: scale(${1 - i * 0.04}); opacity:${1 - i * 0.18}`}
            >
              <p class="font-mono text-[11px] tracking-[0.16em] text-[#8b93a7] uppercase">
                Participant {String(i + 1).padStart(2, '0')}
              </p>
              <p class="mt-4 text-lg">{i === 0 ? 'This device · unbound' : 'Awaiting key'}</p>
            </div>
          {/each}
          <button
            class="absolute right-8 bottom-4 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black"
            onclick={() => (view = 'passkey')}
          >
            <Fingerprint class="size-4" /> Init this device
          </button>
        </div>
      {:else}
        <div class="grid h-full place-items-center rounded-3xl border border-white/10 bg-white/5 p-8 text-center">
          <div>
            <Fingerprint class="mx-auto size-10 text-[#9dffc8]" />
            <p class="mt-4 text-2xl">Passkey now has a card to bind</p>
            <p class="mt-2 text-sm text-[#9aa3b5]">
              Deferred until unlock or Sentinel device init
            </p>
          </div>
        </div>
      {/if}
    </div>
  </section>
</main>
