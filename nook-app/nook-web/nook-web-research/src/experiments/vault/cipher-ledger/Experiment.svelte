<script lang="ts">
  import { Check, Feather, KeyRound, Plus, Stamp } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'

  interface ParticipantDevice {
    name: string
    publicKey: string
  }

  let { navigate }: ExperimentProps = $props()
  let name = $state('')
  let total = $state(3)
  let threshold = $state(2)
  let participants = $state<ParticipantDevice[]>([])
  let deviceName = $state('')
  let publicKey = $state('')
  let addError = $state('')
  let finalized = $state(false)
  const keys = $derived(1 + participants.length)

  function addKey() {
    const nextName = deviceName.trim()
    const nextKey = publicKey.trim()
    if (!nextName || !nextKey) {
      addError = 'Device name and public key are both required.'
      return
    }
    if (
      participants.some(
        (participant) =>
          participant.name.toLocaleLowerCase() === nextName.toLocaleLowerCase(),
      )
    ) {
      addError = 'Device name already entered.'
      return
    }
    if (participants.some((participant) => participant.publicKey === nextKey)) {
      addError = 'Public key already entered.'
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
    finalized = false
  }
</script>

<main class="min-h-screen bg-[#e9e2d2] text-[#211e19]">
  <ExperimentBack {navigate} light />
  <div class="mx-auto max-w-7xl px-6 py-24 sm:px-10">
    <header
      class="grid gap-8 border-y-2 border-[#211e19] py-8 md:grid-cols-[1fr_auto] md:items-end"
    >
      <div>
        <p class="font-mono text-xs tracking-[0.2em] uppercase">
          Sentinel genesis ledger · folio 001
        </p>
        <h1 class="mt-4 font-serif text-6xl tracking-[-0.05em] sm:text-8xl">
          The Cipher Ledger
        </h1>
      </div>
      <div class="font-mono text-xs leading-6 md:text-right">
        <p>RECORD: {finalized ? 'VAULT GENESIS' : 'IN-MEMORY DRAFT'}</p>
        <p>POLICY: {threshold}-OF-{total}</p>
        <p>ROSTER: {keys}/{total} KEYS</p>
      </div>
    </header>

    <section
      class="grid border-b-2 border-[#211e19] lg:grid-cols-[0.8fr_1.2fr]"
    >
      <div class="border-[#211e19] py-10 lg:border-r-2 lg:pr-10">
        <p class="font-mono text-xs tracking-[0.18em] uppercase">
          I · Name the draft
        </p>
        <input
          class="mt-5 w-full border-b-2 border-[#211e19] bg-transparent py-3 font-serif text-4xl outline-none placeholder:text-[#766e60]"
          placeholder="Sentinel vault name"
          bind:value={name}
        />
        <p class="mt-4 font-serif text-lg italic text-[#6e6658]">
          A name creates only a temporary folio in memory. No vault exists yet.
        </p>

        <div class="mt-12 border-t border-[#211e19] pt-7">
          <p class="font-mono text-xs tracking-[0.18em] uppercase">
            II · Inscribe Shamir policy
          </p>
          <div class="mt-5 grid grid-cols-2 gap-5">
            <label class="border-2 border-[#211e19] p-4 font-mono text-xs"
              >N · TOTAL<input
                type="number"
                min="2"
                max="16"
                value={total}
                onchange={changeTotal}
                class="mt-2 w-full bg-transparent font-serif text-5xl outline-none"
              /></label
            >
            <label class="border-2 border-[#211e19] p-4 font-mono text-xs"
              >K · THRESHOLD<input
                type="number"
                min="2"
                max={total}
                bind:value={threshold}
                class="mt-2 w-full bg-transparent font-serif text-5xl outline-none"
              /></label
            >
          </div>
        </div>
      </div>

      <div class="py-10 lg:pl-10">
        <div class="flex items-center justify-between">
          <p class="font-mono text-xs tracking-[0.18em] uppercase">
            III · Participant key register
          </p>
          <Feather class="size-5" />
        </div>
        <p class="mt-4 max-w-xl font-serif text-xl leading-8">
          Devices stay outside this record. The owner manually enters each
          standalone signed public-key announcement.
        </p>
        <ol class="mt-7 divide-y divide-[#211e19]/25 border-y border-[#211e19]">
          <li
            class="grid grid-cols-[4rem_1fr_auto] gap-4 py-4 font-mono text-xs"
          >
            <span class="text-[#7a6f5e]">P-01</span><span
              ><b>THIS DEVICE</b><br /><span class="text-[#756c5e]"
                >pk_local_a9f2…91cc</span
              ></span
            ><Check class="size-4" />
          </li>
          {#each participants as participant, index (participant.publicKey)}
            <li
              class="grid grid-cols-[4rem_1fr_auto] gap-4 py-4 font-mono text-xs"
            >
              <span class="text-[#7a6f5e]"
                >P-{String(index + 2).padStart(2, '0')}</span
              >
              <span
                ><b>{participant.name.toUpperCase()}</b><br /><span
                  class="text-[#756c5e]">{participant.publicKey}</span
                ></span
              >
              <Check class="size-4" />
            </li>
          {/each}
        </ol>
        {#if keys < total}
          <div class="mt-6 border-2 border-[#211e19] p-4">
            <p class="font-mono text-[10px]">
              ADD PARTICIPANT DEVICE · {total - keys} REMAINING
            </p>
            <div class="mt-3 grid gap-3 sm:grid-cols-[0.7fr_1.3fr_auto]">
              <input
                class="min-w-0 border-b border-[#211e19] bg-transparent px-2 py-2 font-mono text-xs outline-none"
                placeholder="Device name"
                bind:value={deviceName}
              /><input
                class="min-w-0 border-b border-[#211e19] bg-transparent px-2 py-2 font-mono text-xs outline-none"
                placeholder="Public key"
                bind:value={publicKey}
              /><button
                class="border-2 border-[#211e19] p-3"
                onclick={addKey}
                aria-label="Add participant device"><Plus /></button
              >
            </div>
            {#if addError}<p class="mt-2 font-mono text-[10px] text-[#9f2f2f]">
                {addError}
              </p>{/if}
          </div>
        {/if}
        <button
          disabled={!name.trim() ||
            keys !== total ||
            threshold > total ||
            threshold < 2}
          class="mt-6 flex w-full items-center justify-center gap-3 border-2 border-[#211e19] bg-[#211e19] px-6 py-4 font-mono text-xs font-bold tracking-wider text-[#f4eddd] uppercase disabled:opacity-30"
          onclick={() => (finalized = true)}
          ><Stamp class="size-4" />{finalized
            ? 'Vault sealed in ledger'
            : 'Seal Sentinel vault'}</button
        >
      </div>
    </section>
    <footer
      class="flex flex-wrap items-center justify-between gap-6 py-8 font-mono text-xs"
    >
      <span
        ><KeyRound class="mr-2 inline size-4" />All {total} keys required for genesis</span
      ><span>Later unlock: any {threshold} shares</span>
    </footer>
  </div>
</main>
