<script lang="ts">
  import { CircleGauge, Cpu, KeyRound, Plus, ShieldCheck } from '@lucide/svelte'
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
  let announcement = $state('')
  let addError = $state('')
  let finalized = $state(false)
  const keys = $derived(1 + participants.length)
  const ready = $derived(
    Boolean(name.trim()) && keys === total && threshold <= total,
  )

  function loadKey() {
    const nextName = deviceName.trim()
    const nextKey = announcement.trim()
    if (!nextName || !nextKey) {
      addError = 'DEVICE NAME + PUBLIC KEY REQUIRED'
      return
    }
    if (
      participants.some(
        (participant) =>
          participant.name.toLocaleLowerCase() === nextName.toLocaleLowerCase(),
      ) ||
      participants.some((participant) => participant.publicKey === nextKey)
    ) {
      addError = 'DUPLICATE DEVICE OR PUBLIC KEY'
      return
    }
    participants = [...participants, { name: nextName, publicKey: nextKey }]
    deviceName = ''
    announcement = ''
    addError = ''
  }

  function changeTotal(event: Event) {
    const next = Number((event.currentTarget as HTMLInputElement).value)
    if (!Number.isFinite(next) || next < 2) return
    total = next
    threshold = Math.min(threshold, total)
    participants = []
    finalized = false
  }
</script>

<main
  class="min-h-screen bg-[#242523] p-4 pt-24 text-[#e9e7dc] sm:p-10 sm:pt-24"
>
  <ExperimentBack {navigate} />
  <section
    class="mx-auto max-w-6xl overflow-hidden rounded-[2rem] border-4 border-[#111] bg-[#4b4c47] p-3 shadow-[0_35px_100px_black]"
  >
    <div
      class="rounded-[1.4rem] border border-white/10 bg-[#30312e] p-6 shadow-inner sm:p-10"
    >
      <header
        class="flex flex-wrap items-center justify-between gap-6 border-b border-black/70 pb-7"
      >
        <div class="flex items-center gap-4">
          <div
            class="grid size-14 place-items-center rounded-lg border border-black bg-[#1c1d1b] text-[#ffb84a]"
          >
            <Cpu />
          </div>
          <div>
            <p class="font-mono text-xs tracking-[0.18em] text-[#a6a79f]">
              NOOK SENTINEL GENESIS APPLIANCE
            </p>
            <h1 class="text-2xl font-bold">THRESHOLD CONTROL / MK-IV</h1>
          </div>
        </div>
        <div class="flex items-center gap-3 font-mono text-xs">
          <span
            class="size-2 rounded-full bg-[#7dff6d] shadow-[0_0_12px_#7dff6d]"
          ></span> DRAFT MEMORY ONLINE
        </div>
      </header>
      <div class="mt-8 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div class="space-y-5">
          <div
            class="rounded-xl border-2 border-[#171815] bg-[#262724] p-6 shadow-[inset_0_2px_8px_black]"
          >
            <p class="font-mono text-xs text-[#8e9187]">
              VAULT NAME / VOLATILE BUFFER
            </p>
            <input
              class="mt-4 w-full border-b border-[#777] bg-transparent py-2 text-3xl font-bold outline-none placeholder:text-[#666]"
              placeholder="SENTINEL NAME"
              bind:value={name}
              oninput={() => (finalized = false)}
            />
          </div>
          <div class="grid gap-5 sm:grid-cols-2">
            <label
              class="rounded-xl border-2 border-[#171815] bg-[#262724] p-6 font-mono text-xs text-[#8e9187]"
              >N · TOTAL KEY SLOTS<input
                type="number"
                min="2"
                max="16"
                value={total}
                onchange={changeTotal}
                class="mt-3 w-full bg-transparent text-5xl text-[#ffb84a] outline-none"
              /></label
            ><label
              class="rounded-xl border-2 border-[#171815] bg-[#262724] p-6 font-mono text-xs text-[#8e9187]"
              >K · THRESHOLD<input
                type="number"
                min="2"
                max={total}
                bind:value={threshold}
                oninput={() => (finalized = false)}
                class="mt-3 w-full bg-transparent text-5xl text-[#7dff6d] outline-none"
              /></label
            >
          </div>
          <div
            class="rounded-xl border-2 border-[#171815] bg-[#111210] p-6 font-mono"
          >
            <div class="flex items-center justify-between">
              <p class="text-xs text-[#777a72]">PARTICIPANT PUBLIC-KEY BUS</p>
              <span class="text-[#ffb84a]">{keys}/{total} LOADED</span>
            </div>
            <div class="mt-4 space-y-2 text-[10px]">
              <p
                class="border border-[#333] bg-[#080908] px-3 py-2 text-[#7dff6d]"
              >
                SLOT 01 · THIS DEVICE · pk_local_a9f2…91cc
              </p>
              {#each participants as participant, index (participant.publicKey)}<p
                  class="border border-[#333] bg-[#080908] px-3 py-2 text-[#c4c8bc]"
                >
                  SLOT {String(index + 2).padStart(2, '0')} · {participant.name.toUpperCase()}
                  · {participant.publicKey}
                </p>{/each}
            </div>
            {#if keys < total}<div
                class="mt-4 grid gap-2 sm:grid-cols-[0.7fr_1.3fr_auto]"
              >
                <input
                  class="min-w-0 bg-[#080908] px-3 py-3 text-xs outline-none"
                  placeholder="DEVICE NAME"
                  bind:value={deviceName}
                /><input
                  class="min-w-0 bg-[#080908] px-3 py-3 text-xs outline-none"
                  placeholder="PUBLIC KEY"
                  bind:value={announcement}
                /><button
                  class="border border-[#555] px-4"
                  onclick={loadKey}
                  aria-label="Load participant device"><Plus /></button
                >
              </div>{/if}
            {#if addError}<p class="mt-2 text-[10px] text-[#ff745f]">
                {addError}
              </p>{/if}
            <p class="mt-3 text-[10px] text-[#777a72]">
              SLOT 01: LOCAL DEVICE · EXTERNAL DEVICES NEVER ENTER CONTROL PLANE
            </p>
          </div>
        </div>
        <div
          class="flex flex-col items-center rounded-xl border-2 border-[#171815] bg-[#20211f] p-7 shadow-[inset_0_2px_10px_black]"
        >
          <p class="font-mono text-xs tracking-[0.18em] text-[#8e9187]">
            GENESIS INTERLOCK
          </p>
          <div
            class="relative mt-8 grid size-44 place-items-center rounded-full border-[12px] border-[#111] bg-[conic-gradient(#ffb84a_0_var(--load),#353631_var(--load)_100%)] shadow-[0_12px_25px_black]"
            style={`--load:${(keys / total) * 100}%`}
          >
            <span
              class="grid size-28 place-items-center rounded-full border-4 border-[#111] bg-[#4b4c47]"
              ><CircleGauge class="size-12" /></span
            >
          </div>
          <strong
            class={`mt-7 font-mono text-xl ${finalized ? 'text-[#7dff6d]' : 'text-[#ffb84a]'}`}
            >{finalized
              ? 'VAULT SEALED'
              : keys === total
                ? 'ARMED'
                : 'KEYS REQUIRED'}</strong
          ><span class="mt-2 text-center text-xs text-[#898c83]"
            >{finalized
              ? `${threshold}-OF-${total} · SEALED`
              : keys === total
                ? 'GENESIS INTERLOCK READY'
                : `${threshold}-OF-${total} · LOAD ALL KEYS`}</span
          >
          <button
            disabled={!ready || finalized}
            class="mt-7 w-full border-2 border-[#ffb84a] bg-[#3a2d16] px-5 py-4 font-mono text-sm font-bold tracking-[0.08em] text-[#ffd28b] shadow-[inset_0_0_0_3px_#171815,0_5px_0_#111] transition active:translate-y-1 active:shadow-[inset_0_0_0_3px_#171815,0_1px_0_#111] disabled:cursor-not-allowed disabled:border-[#555] disabled:bg-[#292a27] disabled:text-[#696b65] disabled:shadow-[inset_0_0_0_3px_#171815]"
            onclick={() => (finalized = true)}
          >
            {finalized ? 'VAULT SEALED' : 'SEAL SENTINEL VAULT'}
          </button>
        </div>
      </div>
      <footer
        class="mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-black/70 pt-6 font-mono text-xs text-[#898c83]"
      >
        <span
          ><ShieldCheck class="mr-2 inline size-4 text-[#7dff6d]" />ALL N KEYS
          REQUIRED FOR GENESIS</span
        ><span
          ><KeyRound class="mr-2 inline size-4 text-[#ffb84a]" />K SHARES
          REQUIRED TO UNLOCK</span
        >
      </footer>
    </div>
  </section>
</main>
