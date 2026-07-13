<script lang="ts">
  import { Check, KeyRound, Plus } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'

  interface ParticipantDevice {
    name: string
    publicKey: string
  }

  let { navigate }: ExperimentProps = $props()
  let step = $state(1)
  let name = $state('')
  let total = $state(3)
  let threshold = $state(2)
  let participants = $state<ParticipantDevice[]>([])
  let deviceName = $state('')
  let publicKey = $state('')
  let addError = $state('')
  const keys = $derived(1 + participants.length)

  function next() {
    if (step === 1 && name.trim()) step = 2
    else if (step === 2 && threshold >= 2 && threshold <= total) step = 3
    else if (step === 3 && keys === total) step = 4
  }

  function addKey() {
    const nextName = deviceName.trim()
    const nextKey = publicKey.trim()
    if (!nextName || !nextKey) {
      addError = 'Name and public key required.'
      return
    }
    if (
      participants.some(
        (participant) =>
          participant.name.toLocaleLowerCase() === nextName.toLocaleLowerCase(),
      ) ||
      participants.some((participant) => participant.publicKey === nextKey)
    ) {
      addError = 'Device and key must be distinct.'
      return
    }
    participants = [...participants, { name: nextName, publicKey: nextKey }]
    deviceName = ''
    publicKey = ''
    addError = ''
  }

  function changeTotal(event: Event) {
    total = Number((event.currentTarget as HTMLInputElement).value)
    threshold = Math.min(threshold, total)
    participants = []
  }
</script>

<main class="min-h-screen overflow-hidden bg-[#e7e6e2] text-black">
  <ExperimentBack {navigate} light />
  <section
    class="mx-auto grid min-h-screen max-w-7xl items-center gap-12 px-6 py-24 lg:grid-cols-[0.8fr_1.2fr]"
  >
    <div>
      <p class="font-mono text-xs tracking-[0.22em] text-[#686865] uppercase">
        Sentinel genesis · {String(step).padStart(2, '0')} / 04
      </p>
      {#if step === 1}<h1
          class="mt-5 text-6xl font-light tracking-[-0.07em] sm:text-8xl"
        >
          Give it<br />a name.
        </h1>
        <p class="mt-8 max-w-md text-lg leading-8 text-[#777773]">
          Nothing else. The name begins a silent, in-memory draft. No vault
          exists yet.
        </p>
        <input
          class="mt-10 w-full max-w-md border-b border-black bg-transparent py-4 text-2xl font-light outline-none placeholder:text-[#999]"
          placeholder="Sentinel vault name"
          bind:value={name}
        />
      {:else if step === 2}<h1
          class="mt-5 text-6xl font-light tracking-[-0.07em] sm:text-8xl"
        >
          Choose the<br />threshold.
        </h1>
        <p class="mt-8 max-w-md text-lg leading-8 text-[#777773]">
          {name} will have N shares. Any K can unlock it.
        </p>
        <div class="mt-10 flex max-w-md gap-8">
          <label class="flex-1 border-b border-black pb-3 text-xs text-[#777]"
            >N · TOTAL<input
              type="number"
              min="2"
              max="16"
              value={total}
              onchange={changeTotal}
              class="mt-2 w-full bg-transparent text-6xl font-light text-black outline-none"
            /></label
          ><label class="flex-1 border-b border-black pb-3 text-xs text-[#777]"
            >K · NEEDED<input
              type="number"
              min="2"
              max={total}
              bind:value={threshold}
              class="mt-2 w-full bg-transparent text-6xl font-light text-black outline-none"
            /></label
          >
        </div>
      {:else if step === 3}<h1
          class="mt-5 text-6xl font-light tracking-[-0.07em] sm:text-8xl"
        >
          Collect<br />the keys.
        </h1>
        <p class="mt-8 max-w-md text-lg leading-8 text-[#777773]">
          {keys} of {total}. Devices remain elsewhere; their signed public-key
          announcements come to you.
        </p>
        <div class="mt-8 max-w-md space-y-2 font-mono text-xs">
          <p>01 · This device · pk_local_a9f2…91cc</p>
          {#each participants as participant, index (participant.publicKey)}<p>
              {String(index + 2).padStart(2, '0')} · {participant.name} · {participant.publicKey}
            </p>{/each}
        </div>
        {#if keys < total}<div class="mt-8 max-w-md border-b border-black pb-3">
            <input
              class="w-full bg-transparent py-2 outline-none placeholder:text-[#999]"
              placeholder="Device name"
              bind:value={deviceName}
            />
            <div class="flex">
              <input
                class="min-w-0 flex-1 bg-transparent py-2 outline-none placeholder:text-[#999]"
                placeholder="Public key"
                bind:value={publicKey}
              /><button
                onclick={addKey}
                class="px-3"
                aria-label="Add participant device"><Plus /></button
              >
            </div>
            {#if addError}<p class="mt-2 text-xs text-[#9f2f2f]">
                {addError}
              </p>{/if}
          </div>{/if}
        <div class="mt-5 flex gap-2">
          {#each Array(total) as _, index}<span
              class={`h-1 flex-1 ${index < keys ? 'bg-black' : 'bg-[#c8c7c3]'}`}
            ></span>{/each}
        </div>
      {:else}<h1
          class="mt-5 text-6xl font-light tracking-[-0.07em] sm:text-8xl"
        >
          It now<br />exists.
        </h1>
        <p class="mt-8 max-w-md text-lg leading-8 text-[#777773]">
          {name}. A {threshold}-of-{total} Sentinel vault, sealed atomically from
          {total}
          verified participant keys.
        </p>
        <div class="mt-10 flex items-center gap-3 text-sm">
          <Check class="size-5" /> Encrypted shares ready for delivery
        </div>{/if}
      {#if step < 4}<button
          disabled={(step === 1 && !name.trim()) ||
            (step === 2 && (threshold < 2 || threshold > total)) ||
            (step === 3 && keys !== total)}
          class="mt-10 flex items-center gap-3 rounded-full bg-black px-7 py-4 text-sm text-white disabled:opacity-25"
          onclick={next}
          ><KeyRound class="size-4" />{step === 3
            ? 'Seal vault'
            : 'Continue'}</button
        >{/if}
    </div>
    <div class="relative grid min-h-[40rem] place-items-center">
      <div
        class={`relative h-[36rem] w-52 rounded-sm bg-[#050505] shadow-[0_45px_90px_rgb(0_0_0/0.35)] transition duration-700 ${step === 4 ? 'scale-[1.03]' : ''}`}
      >
        <span
          class={`absolute inset-x-8 top-1/2 h-px transition ${step === 4 ? 'bg-[#c6ff3d] shadow-[0_0_30px_#c6ff3d]' : step === 3 ? 'bg-[#8fae51]' : 'bg-[#303030]'}`}
        ></span>{#if step === 4}<KeyRound
            class="absolute top-[44%] left-1/2 size-8 -translate-1/2 text-[#c6ff3d]"
          />{/if}
      </div>
      <div
        class="absolute bottom-0 h-10 w-80 rounded-[50%] bg-black/20 blur-xl"
      ></div>
      <div
        class="absolute right-5 bottom-14 font-mono text-[10px] tracking-wider text-[#777]"
      >
        {step === 4
          ? 'SENTINEL VAULT SEALED'
          : step === 3
            ? `${keys}/${total} KEYS PRESENT`
            : 'VOLATILE DRAFT'}
      </div>
    </div>
  </section>
</main>
