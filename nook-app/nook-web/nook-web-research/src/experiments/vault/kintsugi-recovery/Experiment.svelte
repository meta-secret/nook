<script lang="ts">
  import { Gem, HeartHandshake, KeyRound } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'
  import type { SentinelParticipantDevice } from '../sentinel-genesis'

  let { navigate }: ExperimentProps = $props()
  let deviceName = $state('')
  let publicKey = $state('')
  let name = $state('')
  let participants = $state<SentinelParticipantDevice[]>([])
  let threshold = $state(2)
  let total = $state(3)
  let addError = $state('')
  let created = $state(false)
  const keys = $derived(1 + participants.length)

  function join() {
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
      addError = 'Each fragment needs a distinct device and key.'
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
    created = false
  }
</script>

<main class="min-h-screen bg-[#171512] text-[#eee8dc]">
  <ExperimentBack {navigate} />
  <section class="mx-auto max-w-7xl px-6 py-24">
    <header class="text-center">
      <p class="font-serif italic text-[#c9a859]">
        Independent keys make one whole.
      </p>
      <h1 class="mt-4 font-serif text-6xl tracking-[-0.05em] sm:text-8xl">
        Kintsugi Genesis
      </h1>
      <p class="mx-auto mt-5 max-w-xl text-[#918879]">
        Each participant’s public key defines one boundary of the future vault.
        No device enters the owner’s workflow.
      </p>
    </header>
    <div class="mx-auto mt-9 grid max-w-3xl gap-3 sm:grid-cols-[1fr_auto_auto]">
      <input
        class="border-b border-[#9d8244] bg-transparent px-3 py-3 font-serif text-2xl outline-none placeholder:text-[#746b5e]"
        placeholder="Name the Sentinel"
        bind:value={name}
      /><label class="border border-[#9d8244] px-4 py-2 text-[10px]"
        >N PIECES<input
          type="number"
          min="2"
          max="16"
          value={total}
          onchange={changeTotal}
          class="ml-2 w-9 bg-transparent text-xl outline-none"
        /></label
      ><label class="border border-[#9d8244] px-4 py-2 text-[10px]"
        >K NEEDED<input
          type="number"
          min="2"
          max={total}
          bind:value={threshold}
          class="ml-2 w-9 bg-transparent text-xl outline-none"
        /></label
      >
    </div>
    <div
      class="relative mx-auto mt-8 grid min-h-[34rem] max-w-4xl place-items-center"
    >
      <div class="relative size-[30rem] max-w-full">
        <span
          class={`absolute inset-[8%] bg-[#34302b] [clip-path:polygon(0_0,48%_0,40%_48%,0_65%)] transition duration-700 ${keys >= 1 ? 'translate-x-0' : '-translate-x-12'}`}
        ></span><span
          class={`absolute inset-[8%] bg-[#403a32] [clip-path:polygon(52%_0,100%_0,100%_62%,58%_48%)] transition duration-700 ${keys >= 2 ? 'translate-x-0' : 'translate-x-12'}`}
        ></span><span
          class={`absolute inset-[8%] bg-[#2a2824] [clip-path:polygon(0_68%,42%_52%,56%_51%,100%_65%,100%_100%,0_100%)] transition duration-700 ${keys >= total ? 'translate-y-0' : 'translate-y-12'}`}
        ></span><svg
          class="absolute inset-0 h-full w-full"
          viewBox="0 0 500 500"
          ><path
            d="M245 40L210 240L40 330M210 240L285 245L455 320"
            stroke="#d9b85f"
            stroke-width="8"
            fill="none"
            filter="drop-shadow(0 0 8px #d9b85f)"
          /></svg
        >
        <div
          class="absolute top-1/2 left-1/2 grid size-28 -translate-1/2 place-items-center rounded-full bg-[#171512] text-[#d9b85f]"
        >
          {#if created}<KeyRound class="size-12" />{:else}<Gem
              class="size-12"
            />{/if}
        </div>
      </div>
      <p
        class="absolute bottom-2 font-mono text-xs tracking-[0.18em] text-[#b69a55]"
      >
        {keys}/{total} PARTICIPANT PUBLIC KEYS JOINED
      </p>
    </div>
    <div
      class="mx-auto mt-4 max-w-2xl space-y-2 font-mono text-xs text-[#b69a55]"
    >
      <p>01 · This device · pk_local_a9f2…91cc</p>
      {#each participants as participant, index (participant.publicKey)}<p>
          {String(index + 2).padStart(2, '0')} · {participant.name} · {participant.publicKey}
        </p>{/each}
    </div>
    {#if keys < total}<div
        class="mx-auto mt-4 max-w-2xl border border-[#9d8244] p-4"
      >
        <div class="grid gap-3 sm:grid-cols-[0.7fr_1.3fr_auto]">
          <input
            class="min-w-0 border-b border-[#9d8244] bg-transparent px-3 py-3 text-xs outline-none"
            placeholder="Device name"
            bind:value={deviceName}
          /><input
            class="min-w-0 border-b border-[#9d8244] bg-transparent px-3 py-3 text-xs outline-none"
            placeholder="Public key"
            bind:value={publicKey}
          /><button
            class="flex items-center gap-2 bg-[#9d8244] px-5 text-sm text-[#171512]"
            onclick={join}><HeartHandshake /> Join</button
          >
        </div>
        {#if addError}<p class="mt-2 text-xs text-[#df7a66]">{addError}</p>{/if}
      </div>{:else}<button
        disabled={!name.trim() || threshold > total}
        class="mx-auto mt-4 flex items-center gap-3 border border-[#9d8244] px-6 py-4 text-sm text-[#d5b65e] disabled:opacity-30"
        onclick={() => (created = true)}
        ><KeyRound />{created
          ? `${name} sealed as a whole`
          : `Seal ${threshold}-of-${total} Sentinel vault`}</button
      >{/if}
  </section>
</main>
