<script lang="ts">
  import {
    Check,
    FileSignature,
    KeyRound,
    ShieldCheck,
    Wind,
  } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'

  interface ParticipantDevice {
    name: string
    publicKey: string
  }

  let { navigate }: ExperimentProps = $props()
  let chamber = $state(1)
  let name = $state('')
  let total = $state(3)
  let threshold = $state(2)
  let participants = $state<ParticipantDevice[]>([])
  let deviceName = $state('')
  let publicKey = $state('')
  let keyError = $state('')
  const keys = $derived(1 + participants.length)

  function advance() {
    if (chamber === 1 && name.trim()) chamber = 2
    else if (chamber === 2 && threshold >= 2 && threshold <= total) chamber = 3
    else if (chamber === 3 && keys === total) chamber = 4
  }

  function addDevice() {
    const nextName = deviceName.trim()
    const nextKey = publicKey.trim()
    if (!nextName || !nextKey) {
      keyError = 'Device name and public key are required.'
      return
    }
    if (
      participants.some(
        (participant) =>
          participant.name.toLocaleLowerCase() === nextName.toLocaleLowerCase(),
      ) ||
      participants.some((participant) => participant.publicKey === nextKey)
    ) {
      keyError = 'Device name and public key must be distinct.'
      return
    }
    participants = [...participants, { name: nextName, publicKey: nextKey }]
    deviceName = ''
    publicKey = ''
    keyError = ''
  }

  function changeTotal(event: Event) {
    total = Number((event.currentTarget as HTMLInputElement).value)
    threshold = Math.min(threshold, total)
    participants = []
  }
</script>

<main class="min-h-screen bg-[#dce3e5] text-[#172125]">
  <ExperimentBack {navigate} light />
  <section class="mx-auto max-w-7xl px-6 py-24">
    <header
      class="flex flex-wrap items-end justify-between gap-8 border-b-2 border-[#26363c] pb-7"
    >
      <div>
        <p class="font-mono text-xs tracking-[0.2em] uppercase">
          Sentinel admission control
        </p>
        <h1 class="mt-3 text-6xl font-bold tracking-[-0.06em] sm:text-8xl">
          Genesis Airlock
        </h1>
      </div>
      <div
        class="flex items-center gap-3 bg-[#203238] px-5 py-4 font-mono text-xs text-white"
      >
        <Wind class="size-5 text-[#7ee8ff]" /> CHAMBER 0{chamber} ACTIVE
      </div>
    </header>
    <div class="mt-10 grid gap-3 lg:grid-cols-4">
      <article
        class={`relative min-h-[31rem] border-2 p-6 ${chamber >= 1 ? 'border-[#1f7888] bg-[#eafcff]' : 'border-[#708085] bg-[#cbd4d6]'}`}
      >
        <span class="font-mono text-xs">CHAMBER 01</span>
        <div
          class="mt-12 grid size-16 place-items-center rounded-full border-2 border-[#1f7888] text-[#1f7888]"
        >
          {#if chamber > 1}<Check />{:else}<FileSignature />{/if}
        </div>
        <h2 class="mt-8 text-3xl font-bold">Name</h2>
        <p class="mt-2 text-sm text-[#667378]">Create a volatile draft.</p>
        <input
          class="mt-8 w-full border-b-2 border-[#1f7888] bg-transparent py-3 text-xl font-bold outline-none"
          placeholder="Sentinel name"
          bind:value={name}
        /><span class="absolute right-6 bottom-6 font-mono text-[10px]"
          >{chamber > 1 ? 'CLEARED' : 'ACTIVE'}</span
        >
      </article>
      <article
        class={`relative min-h-[31rem] border-2 p-6 ${chamber >= 2 ? 'border-[#1f7888] bg-[#eafcff]' : 'border-[#708085] bg-[#cbd4d6]'}`}
      >
        <span class="font-mono text-xs">CHAMBER 02</span>
        <div
          class={`mt-12 grid size-16 place-items-center rounded-full border-2 ${chamber >= 2 ? 'border-[#1f7888] text-[#1f7888]' : 'border-[#869397] text-[#7a878b]'}`}
        >
          {#if chamber > 2}<Check />{:else}<ShieldCheck />{/if}
        </div>
        <h2 class="mt-8 text-3xl font-bold">N / K</h2>
        <p class="mt-2 text-sm text-[#667378]">Set the Shamir policy.</p>
        <div class="mt-6 grid grid-cols-2 gap-2">
          <label class="border border-[#708085] p-3 text-[9px]"
            >N · DEVICES<input
              type="number"
              min="2"
              max="5"
              value={total}
              onchange={changeTotal}
              disabled={chamber !== 2}
              class="mt-2 block w-full bg-transparent text-4xl font-bold outline-none"
            /></label
          >
          <label class="border border-[#708085] p-3 text-[9px]"
            >K · TO UNLOCK<input
              type="number"
              min="2"
              max={total}
              bind:value={threshold}
              disabled={chamber !== 2}
              class="mt-2 block w-full bg-transparent text-4xl font-bold outline-none"
            /></label
          >
        </div>
        <span class="absolute right-6 bottom-6 font-mono text-[10px]"
          >{chamber > 2 ? 'CLEARED' : chamber === 2 ? 'ACTIVE' : 'SEALED'}</span
        >
      </article>
      <article
        class={`relative min-h-[31rem] border-2 p-6 ${chamber >= 3 ? 'border-[#1f7888] bg-[#eafcff]' : 'border-[#708085] bg-[#cbd4d6]'}`}
      >
        <span class="font-mono text-xs">CHAMBER 03</span>
        <div
          class={`mt-12 grid size-16 place-items-center rounded-full border-2 ${chamber >= 3 ? 'border-[#1f7888] text-[#1f7888]' : 'border-[#869397] text-[#7a878b]'}`}
        >
          {#if chamber > 3}<Check />{:else}<KeyRound />{/if}
        </div>
        <h2 class="mt-8 text-3xl font-bold">Public keys</h2>
        <p class="mt-2 text-sm text-[#667378]">
          Manual owner intake · {keys}/{total}
        </p>
        <div class="mt-5 space-y-3">
          <div
            class="border border-[#1f7888] bg-white/50 p-3 font-mono text-[9px]"
          >
            PARTICIPANT 01 · THIS DEVICE<br /><b class="mt-1 block"
              >pk_local_a9f2…91cc</b
            >
          </div>
          {#each participants as participant, index (participant.publicKey)}<div
              class="border border-[#1f7888] bg-white/50 p-3 font-mono text-[9px]"
            >
              PARTICIPANT {String(index + 2).padStart(2, '0')} · {participant.name.toUpperCase()}<br
              /><b class="mt-1 block truncate">{participant.publicKey}</b>
            </div>{/each}
          {#if keys < total}<div class="border border-[#708085] p-3">
              <input
                class="w-full border-b border-[#708085] bg-transparent py-2 text-xs outline-none"
                placeholder="Device name"
                bind:value={deviceName}
                disabled={chamber !== 3}
              /><input
                class="mt-2 w-full border-b border-[#708085] bg-transparent py-2 font-mono text-xs outline-none"
                placeholder="Public key"
                bind:value={publicKey}
                disabled={chamber !== 3}
              /><button
                class="mt-2 w-full bg-[#1f7888] py-2 text-[10px] font-bold text-white disabled:opacity-30"
                disabled={chamber !== 3 ||
                  !deviceName.trim() ||
                  !publicKey.trim()}
                onclick={addDevice}>VERIFY + ADD DEVICE</button
              >
            </div>{/if}
          {#if keyError}<p class="text-[10px] font-bold text-[#a02e36]">
              {keyError}
            </p>{/if}
        </div>
        <span class="absolute right-6 bottom-6 font-mono text-[10px]"
          >{chamber > 3
            ? 'CLEARED'
            : chamber === 3
              ? `${keys}/${total} ADMITTED`
              : 'SEALED'}</span
        >
      </article>
      <article
        class={`relative min-h-[31rem] border-2 p-6 ${chamber >= 4 ? 'border-[#1f7888] bg-[#eafcff]' : 'border-[#708085] bg-[#cbd4d6]'}`}
      >
        <span class="font-mono text-xs">CHAMBER 04</span>
        <div
          class={`mt-12 grid size-16 place-items-center rounded-full border-2 ${chamber >= 4 ? 'border-[#1f7888] text-[#1f7888]' : 'border-[#869397] text-[#7a878b]'}`}
        >
          <ShieldCheck />
        </div>
        <h2 class="mt-8 text-3xl font-bold">Seal</h2>
        <p class="mt-2 text-sm text-[#667378]">
          Atomic {threshold}-of-{total} vault creation.
        </p>
        {#if chamber === 4}<div
            class="mt-8 border-2 border-[#1f7888] p-4 text-center font-mono text-xs"
          >
            <b>{name}</b><br />ALL {total} KEYS VERIFIED<br />VAULT SEALED
          </div>{/if}<span
          class="absolute right-6 bottom-6 font-mono text-[10px]"
          >{chamber === 4 ? 'COMPLETE' : 'SEALED'}</span
        >
      </article>
    </div>
    {#if chamber < 4}<button
        class="mx-auto mt-8 flex items-center gap-3 bg-[#172125] px-8 py-4 font-bold text-white disabled:opacity-30"
        disabled={(chamber === 1 && !name.trim()) ||
          (chamber === 2 && (threshold < 2 || threshold > total)) ||
          (chamber === 3 && keys !== total)}
        onclick={advance}
        >{chamber === 3 ? 'SEAL SENTINEL VAULT' : `CLEAR CHAMBER 0${chamber}`} →</button
      >{/if}
  </section>
</main>
