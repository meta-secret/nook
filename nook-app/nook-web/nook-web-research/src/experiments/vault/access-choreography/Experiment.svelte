<script lang="ts">
  import { Circle, Play, RotateCcw } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'

  interface ParticipantDevice {
    name: string
    publicKey: string
  }

  let { navigate }: ExperimentProps = $props()
  let cue = $state(0)
  let name = $state('')
  let total = $state(3)
  let threshold = $state(2)
  let participants = $state<ParticipantDevice[]>([])
  let deviceName = $state('')
  let publicKey = $state('')
  let addError = $state('')
  const keys = $derived(1 + participants.length)

  const actors = [
    { name: 'Name', x: '16%', y: '58%', color: '#f46f8a' },
    { name: 'N / K', x: '37%', y: '28%', color: '#6b9cff' },
    { name: 'Public keys', x: '64%', y: '30%', color: '#f2c557' },
    { name: 'Genesis', x: '84%', y: '61%', color: '#6ed6a1' },
  ]

  function advance() {
    if (cue === 0 && name.trim()) cue = 1
    else if (cue === 1 && threshold >= 2 && threshold <= total) cue = 2
    else if (cue === 2 && keys === total) cue = 3
  }

  function addKey() {
    const nextName = deviceName.trim()
    const nextKey = publicKey.trim()
    if (!nextName || !nextKey) {
      addError = 'Name and public key are required.'
      return
    }
    if (
      participants.some(
        (participant) =>
          participant.name.toLocaleLowerCase() === nextName.toLocaleLowerCase(),
      ) ||
      participants.some((participant) => participant.publicKey === nextKey)
    ) {
      addError = 'Each actor must be distinct.'
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

<main class="min-h-screen bg-[#f7f1ea] text-[#251d24]">
  <ExperimentBack {navigate} light />
  <section class="mx-auto max-w-7xl px-6 py-24">
    <header class="text-center">
      <p class="font-mono text-xs tracking-[0.2em] uppercase">
        Nexus genesis performance / four movements
      </p>
      <h1
        class="mt-4 font-serif text-6xl italic tracking-[-0.04em] sm:text-8xl"
      >
        Genesis Choreography
      </h1>
      <p class="mx-auto mt-5 max-w-xl text-[#796b76]">
        The owner performs four precise movements. Participant devices remain
        offstage and contribute only signed public keys.
      </p>
    </header>
    <div
      class="relative mt-12 min-h-[48rem] overflow-hidden rounded-t-[50%] border border-[#a793a1] bg-[#fffaf5]"
    >
      <svg class="absolute inset-0 h-full w-full" aria-hidden="true"
        ><path
          d="M18 370 Q260 50 430 180 T760 190 Q910 80 1080 390"
          stroke="#bca9b7"
          stroke-width="2"
          fill="none"
          stroke-dasharray="8 8"
        /></svg
      >{#each actors as actor, index (actor.name)}<button
          class="absolute -translate-1/2 text-center transition duration-500"
          class:scale-125={index === cue}
          style={`left:${actor.x};top:${actor.y}`}
          disabled={index > cue}
          onclick={() => (cue = index)}
          ><span
            class="mx-auto grid size-24 place-items-center rounded-full border-4 border-white shadow-xl"
            style={`background:${actor.color}`}
            ><Circle class="size-10 text-white" /></span
          ><strong class="mt-3 block font-serif text-xl">{actor.name}</strong
          ><span class="font-mono text-[9px]">MOVEMENT 0{index + 1}</span
          ></button
        >{/each}
      <div
        class="absolute top-[42%] left-1/2 z-20 w-[min(90%,34rem)] -translate-x-1/2 rounded-3xl border border-[#c8b6c2] bg-[#fffaf5]/95 p-6 text-center shadow-xl"
      >
        {#if cue === 0}<p class="font-serif text-2xl italic">
            First, name what does not yet exist.
          </p>
          <input
            class="mt-4 w-full border-b border-[#998590] bg-transparent py-2 text-center text-2xl outline-none"
            placeholder="Nexus vault name"
            bind:value={name}
          />{:else if cue === 1}<p class="font-serif text-2xl italic">
            Set the ensemble and the quorum.
          </p>
          <div class="mx-auto mt-4 flex max-w-xs gap-4">
            <label class="flex-1 text-xs"
              >N TOTAL<input
                type="number"
                min="2"
                max="16"
                value={total}
                onchange={changeTotal}
                class="mt-1 w-full border-b border-[#998590] bg-transparent text-center text-4xl outline-none"
              /></label
            ><label class="flex-1 text-xs"
              >K NEEDED<input
                type="number"
                min="2"
                max={total}
                bind:value={threshold}
                class="mt-1 w-full border-b border-[#998590] bg-transparent text-center text-4xl outline-none"
              /></label
            >
          </div>{:else if cue === 2}<p class="font-serif text-2xl italic">
            Cue each participant’s public key.
          </p>
          <p class="mt-2 font-mono text-xs">
            {keys}/{total} VERIFIED · DEVICES OFFSTAGE
          </p>
          <div class="mt-3 space-y-1 font-mono text-[9px]">
            <p>01 · This device · pk_local_a9f2…91cc</p>
            {#each participants as participant, index (participant.publicKey)}<p
              >
                {String(index + 2).padStart(2, '0')} · {participant.name} · {participant.publicKey}
              </p>{/each}
          </div>
          {#if keys < total}<div
              class="mt-4 grid gap-2 sm:grid-cols-[0.7fr_1.3fr_auto]"
            >
              <input
                class="min-w-0 border-b border-[#998590] bg-transparent py-2 text-center text-xs outline-none"
                placeholder="Device name"
                bind:value={deviceName}
              /><input
                class="min-w-0 border-b border-[#998590] bg-transparent py-2 text-center text-xs outline-none"
                placeholder="Public key"
                bind:value={publicKey}
              /><button onclick={addKey} class="px-3 font-bold">ADD</button>
            </div>
            {#if addError}<p class="mt-2 text-xs text-[#b14f65]">
                {addError}
              </p>{/if}{:else}<p class="font-serif text-2xl italic">
              The vault is sealed atomically.
            </p>
            <p class="mt-3">
              {name} · {threshold}-of-{total} · all {total} keys verified
            </p>
            <div
              class="mx-auto mt-5 grid size-14 place-items-center rounded-full bg-[#6ed6a1] text-white"
            >
              ✓
            </div>{/if}{/if}
      </div>
      <div
        class="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3"
      >
        <button
          disabled={(cue === 0 && !name.trim()) ||
            (cue === 1 && (threshold < 2 || threshold > total)) ||
            (cue === 2 && keys !== total) ||
            cue === 3}
          class="grid size-12 place-items-center rounded-full bg-[#251d24] text-white disabled:opacity-30"
          aria-label={cue === 2 ? 'Seal Nexus vault' : 'Advance workflow'}
          onclick={advance}><Play /></button
        ><button
          class="grid size-12 place-items-center rounded-full border border-[#998590]"
          onclick={() => (cue = 0)}><RotateCcw /></button
        ><span class="ml-3 font-mono text-xs"
          >{cue === 2 ? 'SEAL VAULT' : `SEQUENCE ${cue + 1}/4`}</span
        >
      </div>
    </div>
  </section>
</main>
