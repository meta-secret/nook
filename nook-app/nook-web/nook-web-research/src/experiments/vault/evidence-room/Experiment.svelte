<script lang="ts">
  import {
    Check,
    ClipboardList,
    Package,
    Plus,
    ScanBarcode,
    ShieldCheck,
  } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'

  interface ParticipantDevice {
    name: string
    publicKey: string
  }

  let { navigate }: ExperimentProps = $props()
  let selected = $state(1)
  let name = $state('')
  let total = $state(3)
  let threshold = $state(2)
  let participants = $state<ParticipantDevice[]>([])
  let deviceName = $state('')
  let publicKey = $state('')
  let addError = $state('')
  let sealed = $state(false)
  const keys = $derived(1 + participants.length)

  function addKey() {
    const nextName = deviceName.trim()
    const nextKey = publicKey.trim()
    if (!nextName || !nextKey) {
      addError = 'Both fields are required evidence.'
      return
    }
    if (
      participants.some(
        (participant) =>
          participant.name.toLocaleLowerCase() === nextName.toLocaleLowerCase(),
      ) ||
      participants.some((participant) => participant.publicKey === nextKey)
    ) {
      addError = 'Duplicate device or public key evidence.'
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
    sealed = false
  }
</script>

<main class="min-h-screen bg-[#d8d3c7] text-[#1d1b18]">
  <ExperimentBack {navigate} light />
  <section class="mx-auto max-w-7xl px-6 py-24">
    <header
      class="flex flex-wrap items-end justify-between gap-8 border-b-4 border-black pb-7"
    >
      <div>
        <p class="font-mono text-xs tracking-[0.18em] uppercase">
          Nook cryptographic evidence division
        </p>
        <h1
          class="mt-3 text-6xl font-black tracking-[-0.06em] uppercase sm:text-8xl"
        >
          Genesis case file
        </h1>
      </div>
      <div class="border-4 border-black bg-[#f2efe6] p-4 font-mono text-xs">
        <ShieldCheck class="mr-2 inline size-5" />
        {sealed ? 'VAULT SEALED / CASE CLOSED' : 'DRAFT VOLATILE / ROOM 02'}
      </div>
    </header>
    <div class="mt-10 grid gap-6 lg:grid-cols-[1fr_23rem]">
      <div class="grid gap-4 sm:grid-cols-2">
        {#each [{ id: 1, title: 'Vault identity', status: name ? 'RECORDED' : 'PENDING' }, { id: 2, title: 'Shamir policy', status: `${threshold}-OF-${total}` }, { id: 3, title: 'Participant keys', status: `${keys}/${total} VERIFIED` }, { id: 4, title: 'Atomic genesis', status: sealed ? 'SEALED' : 'HELD' }] as item (item.id)}<button
            class={`relative min-h-64 border-4 border-black p-6 text-left ${selected === item.id ? 'bg-[#fff9df]' : 'bg-[#eee9dc]'}`}
            onclick={() => (selected = item.id)}
            ><Package class="size-10" /><span
              class="absolute top-5 right-5 rotate-3 border-2 border-[#a93232] px-3 py-2 font-mono text-xs font-bold text-[#a93232]"
              >{item.status}</span
            >
            <h2 class="mt-16 text-2xl font-black">{item.title}</h2>
            <p class="mt-2 font-mono text-xs">EXHIBIT NX-00{item.id}</p>
            <ScanBarcode
              class="absolute right-5 bottom-5 size-16 opacity-40"
            /></button
          >{/each}
      </div>
      <aside class="border-4 border-black bg-[#f2efe6] p-6">
        <ClipboardList class="size-8" />
        <p class="mt-7 font-mono text-xs">SELECTED EXHIBIT</p>
        <h2 class="mt-2 text-4xl font-black">NX-00{selected}</h2>
        {#if selected === 1}<p class="mt-6 text-sm">
            Name-only evidence begins the in-memory case.
          </p>
          <input
            class="mt-5 w-full border-2 border-black bg-transparent p-3 font-bold outline-none"
            placeholder="Nexus vault name"
            bind:value={name}
          />{:else if selected === 2}<p class="mt-6 text-sm">
            Record total shares N and unlock threshold K.
          </p>
          <div class="mt-5 grid grid-cols-2 gap-3">
            <label class="border-2 border-black p-3 text-xs"
              >N<input
                type="number"
                min="2"
                max="16"
                value={total}
                onchange={changeTotal}
                class="mt-2 w-full bg-transparent text-4xl font-black outline-none"
              /></label
            ><label class="border-2 border-black p-3 text-xs"
              >K<input
                type="number"
                min="2"
                max={total}
                bind:value={threshold}
                class="mt-2 w-full bg-transparent text-4xl font-black outline-none"
              /></label
            >
          </div>{:else if selected === 3}<p class="mt-6 text-sm">
            The owner logs standalone signed public-key announcements. Devices
            remain outside the room.
          </p>
          <ol class="mt-5 border-l-2 border-black pl-5 text-sm">
            <li class="mb-3">
              <b>P-01 · This device</b><br />pk_local_a9f2…91cc
            </li>
            {#each participants as participant, index (participant.publicKey)}<li
                class="mb-3"
              >
                <b
                  >P-{String(index + 2).padStart(2, '0')} · {participant.name}</b
                ><br />{participant.publicKey}
              </li>{/each}
          </ol>
          {#if keys < total}<div class="mt-3 border-2 border-black p-3">
              <input
                class="w-full border-b border-black bg-transparent py-2 text-xs outline-none"
                placeholder="Device name"
                bind:value={deviceName}
              /><textarea
                class="mt-2 min-h-16 w-full bg-transparent py-2 text-xs outline-none"
                placeholder="Public key evidence"
                bind:value={publicKey}></textarea><button
                class="mt-2 flex w-full items-center justify-center gap-2 bg-black py-3 font-bold text-white"
                onclick={addKey}><Plus /> LOG DEVICE + KEY</button
              >{#if addError}<p class="mt-2 text-xs text-[#a93232]">
                  {addError}
                </p>{/if}
            </div>{/if}{:else}<p class="mt-6 text-sm">
            All exhibits must be complete before the vault can be created.
          </p>
          <ol class="mt-5 space-y-3 text-sm">
            <li>{name ? '✓' : '○'} Name recorded</li>
            <li>
              {threshold >= 2 && threshold <= total ? '✓' : '○'} Policy valid
            </li>
            <li>{keys === total ? '✓' : '○'} All N keys verified</li>
          </ol>
          <button
            disabled={!name.trim() ||
              threshold > total ||
              threshold < 2 ||
              keys !== total}
            class="mt-8 flex w-full items-center justify-center gap-2 bg-black py-4 font-bold text-white disabled:opacity-30"
            onclick={() => (sealed = true)}
            ><Check />
            {sealed ? 'CASE + VAULT SEALED' : 'SEAL NEXUS VAULT'}</button
          >{/if}
      </aside>
    </div>
  </section>
</main>
