<script lang="ts">
  import {
    ArrowLeft,
    ChevronDown,
    Check,
    Cpu,
    Plus,
    ShieldCheck,
  } from '@lucide/svelte'
  import { untrack } from 'svelte'

  interface ParticipantDevice {
    name: string
    publicKey: string
  }

  interface Props {
    onBack: () => void
    initialName?: string
  }

  let { onBack, initialName = '' }: Props = $props()
  const seededName = untrack(() => initialName.trim())
  let name = $state(seededName)
  let threshold = $state(2)
  let total = $state(3)
  let participants = $state<ParticipantDevice[]>([])
  let deviceName = $state('')
  let publicKey = $state('')
  let addError = $state('')
  let selected = $state(0)
  let finalized = $state(false)
  const keys = $derived(1 + participants.length)

  function changeTotal(event: Event) {
    total = Number((event.currentTarget as HTMLSelectElement).value)
    threshold = Math.min(threshold, total)
    participants = []
    deviceName = ''
    publicKey = ''
    addError = ''
    selected = 0
    finalized = false
  }

  function changeThreshold(event: Event) {
    threshold = Number((event.currentTarget as HTMLSelectElement).value)
    finalized = false
  }

  function addParticipant() {
    const nextName = deviceName.trim()
    const nextKey = publicKey.trim()
    if (!nextName || !nextKey) {
      addError = 'Both device name and public key are required.'
      return
    }
    if (
      participants.some(
        (participant) =>
          participant.name.toLocaleLowerCase() === nextName.toLocaleLowerCase(),
      )
    ) {
      addError = 'A device with this name is already in the roster.'
      return
    }
    if (
      nextKey === 'pk_local_a9f2…91cc' ||
      participants.some((participant) => participant.publicKey === nextKey)
    ) {
      addError = 'This public key already belongs to another device.'
      return
    }
    if (keys >= total) {
      addError = 'The participant roster is already full.'
      return
    }
    participants = [...participants, { name: nextName, publicKey: nextKey }]
    selected = participants.length
    deviceName = ''
    publicKey = ''
    addError = ''
  }

  function shortKey(value: string) {
    return value.length > 24
      ? `${value.slice(0, 11)}…${value.slice(-9)}`
      : value
  }
</script>

<div
  class="min-h-screen overflow-hidden bg-[#10141a] text-white [background-image:radial-gradient(circle_at_50%_-10%,#53606d_0,transparent_42%),radial-gradient(circle_at_15%_90%,#25303a_0,transparent_36%)]"
>
  <button
    class="fixed top-5 left-36 z-50 flex h-10 items-center gap-2 rounded-full border border-white/15 bg-black/40 px-4 text-xs font-semibold text-white backdrop-blur-md"
    onclick={onBack}
  >
    <ArrowLeft class="size-4" aria-hidden="true" />
    Auth chooser
  </button>
  <div
    class="pointer-events-none fixed inset-0 opacity-25 [background-image:radial-gradient(#a9b8c5_0.7px,transparent_0.7px)] [background-size:22px_22px]"
  ></div>

  <section class="relative mx-auto max-w-7xl px-6 py-24 sm:px-10">
    <header class="grid gap-8 md:grid-cols-[1fr_auto] md:items-end">
      <div>
        <p
          class="font-mono text-[10px] tracking-[0.24em] text-[#8a98a5] uppercase"
        >
          Nook threshold wallet
        </p>
        <div class="mt-4 flex flex-wrap items-end gap-7">
          <h1 class="text-4xl font-semibold tracking-[0.18em]">SENTINEL</h1>
          <div
            class="flex rounded-full bg-white/[0.06] p-1 text-xs text-[#aeb8c2]"
          >
            <span class="rounded-full bg-white/10 px-4 py-2 text-white"
              >Vault</span
            >
            <span class="px-4 py-2">Policy</span>
            <span class="px-4 py-2">Keys</span>
          </div>
        </div>
      </div>
      <div
        class="min-w-64 rounded-xl bg-[#f4f6f7] p-4 text-[#27313a] shadow-2xl"
      >
        <p class="text-[9px] tracking-wider text-[#87919a] uppercase">
          Genesis order details
        </p>
        <div class="mt-3 flex justify-between text-xs">
          <span>Policy</span><b>{threshold}-of-{total}</b>
        </div>
        <div class="mt-2 flex justify-between text-xs">
          <span>Keys received</span><b>{keys}/{total}</b>
        </div>
      </div>
    </header>

    <div class="mt-12 grid gap-10 lg:grid-cols-[0.78fr_1.22fr]">
      <div>
        <p
          class="font-mono text-[10px] tracking-[0.18em] text-[#88949f] uppercase"
        >
          Participant key cards
        </p>
        <div class="mt-5 space-y-3">
          <button
            class={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-5 border border-l-2 px-5 py-5 text-left transition ${selected === 0 ? 'border-[#6ed9ff] bg-[#3b4650] shadow-[0_0_30px_rgb(82_198_238/0.08)]' : 'border-white/5 border-l-[#657580] bg-[#303840]/85'}`}
            onclick={() => (selected = 0)}
          >
            <span
              class="grid size-10 place-items-center border border-[#71808b] bg-[#202830] text-[#79dfff]"
            >
              <Cpu class="size-5" />
            </span>
            <span>
              <b class="text-sm">This device · Participant 01</b>
              <span class="mt-1 block font-mono text-[10px] text-[#a0abb5]">
                pk_local_a9f2…91cc · AUTOMATICALLY INCLUDED
              </span>
            </span>
            <Check class="size-4 text-[#63eaa1]" />
          </button>

          {#each participants as participant, index (participant.publicKey)}
            <button
              class={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-5 border border-l-2 px-5 py-5 text-left transition ${selected === index + 1 ? 'border-[#6ed9ff] bg-[#3b4650] shadow-[0_0_30px_rgb(82_198_238/0.08)]' : 'border-white/5 border-l-[#657580] bg-[#303840]/85'}`}
              onclick={() => (selected = index + 1)}
            >
              <span
                class="grid size-10 place-items-center border border-[#71808b] bg-[#202830] font-mono text-[9px] text-[#b9c5ce]"
              >
                P-{String(index + 2).padStart(2, '0')}
              </span>
              <span>
                <b class="text-sm"
                  >{participant.name} · Participant {String(index + 2).padStart(
                    2,
                    '0',
                  )}</b
                >
                <span class="mt-1 block font-mono text-[10px] text-[#a0abb5]"
                  >{shortKey(participant.publicKey)}</span
                >
              </span>
              <Check class="size-4 text-[#63eaa1]" />
            </button>
          {/each}

          {#if keys < total}
            <div class="border border-dashed border-[#aeb8c2] p-5">
              <div class="flex items-center justify-between gap-4">
                <div>
                  <p class="text-sm text-[#d6dde3]">Add participant device</p>
                  <p class="mt-1 font-mono text-[9px] text-[#75818c]">
                    {total - keys} ROSTER SLOT{total - keys === 1 ? '' : 'S'} REMAINING
                  </p>
                </div>
                <button
                  class="grid size-12 shrink-0 place-items-center rounded-full bg-white text-[#1f2830] disabled:opacity-30"
                  disabled={!deviceName.trim() || !publicKey.trim()}
                  onclick={addParticipant}
                  aria-label="Add participant device"
                  ><Plus class="size-5" /></button
                >
              </div>
              <div class="mt-5 grid gap-4 sm:grid-cols-2">
                <label
                  class="text-[9px] tracking-wider text-[#8d99a4] uppercase"
                  >Device name<input
                    class="mt-2 w-full border-b border-white/20 bg-transparent py-2 text-sm text-white outline-none placeholder:text-[#596670] focus:border-[#6ed9ff]"
                    placeholder="e.g. Ada's iPhone"
                    bind:value={deviceName}
                  /></label
                >
                <label
                  class="text-[9px] tracking-wider text-[#8d99a4] uppercase"
                  >Public key<input
                    class="mt-2 w-full border-b border-white/20 bg-transparent py-2 font-mono text-xs text-white outline-none placeholder:text-[#596670] focus:border-[#6ed9ff]"
                    placeholder="Paste signed public key"
                    bind:value={publicKey}
                    onkeydown={(event) =>
                      event.key === 'Enter' && addParticipant()}
                  /></label
                >
              </div>
              {#if addError}<p class="mt-3 text-[9px] text-[#ff8d75]">
                  {addError}
                </p>{/if}
            </div>
          {/if}
        </div>
      </div>

      <div>
        <p
          class="font-mono text-[10px] tracking-[0.18em] text-[#88949f] uppercase"
        >
          Active Sentinel configuration
        </p>
        <div
          class="relative mt-5 min-h-[28rem] overflow-hidden border border-[#657580] border-l-4 border-l-[#6ed9ff] bg-[#242d35] p-7 shadow-[0_35px_80px_rgb(0_0_0/0.38)] [background-image:linear-gradient(rgb(255_255_255/0.025)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.025)_1px,transparent_1px)] [background-size:32px_32px] sm:p-10"
        >
          <div class="relative flex items-start justify-between">
            <div class="flex items-center gap-3">
              <ShieldCheck class="text-[#79dfff]" /><span
                class="text-sm font-semibold tracking-wider"
                >GENESIS CONTROL PLANE</span
              >
            </div>
            <span
              class="border border-[#657580] bg-[#192128] px-3 py-2 font-mono text-[9px] tracking-wider text-[#aab5be]"
              >PRE-GENESIS / VOLATILE</span
            >
          </div>

          <div class="relative mt-10 border border-white/10 bg-black/10 p-5">
            <label
              class="block text-[10px] tracking-[0.16em] text-[#b5c0c9] uppercase"
            >
              Module 01 · Vault identity
              <input
                class="mt-3 w-full border-b border-white/25 bg-transparent py-2 text-3xl font-light tracking-tight text-white outline-none placeholder:text-white/25 focus:border-[#79dfff]"
                placeholder="Name your Sentinel"
                bind:value={name}
              />
            </label>
          </div>

          <div
            class="relative mt-6 flex flex-wrap items-end justify-between gap-8 border border-white/10 bg-black/10 p-5"
          >
            <div class="min-w-72">
              <span class="text-[10px] tracking-wider text-[#aab5be] uppercase"
                >Threshold policy</span
              >
              <span
                class="mt-2 grid h-20 grid-cols-[1fr_auto_1fr] items-center gap-5 border-b border-white/70"
              >
                <label class="relative cursor-pointer">
                  <select
                    class="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 text-sm"
                    value={threshold}
                    onchange={changeThreshold}
                    aria-label="Keys needed"
                  >
                    {#each [2, 3, 4, 5] as option (option)}<option
                        value={option}
                        disabled={option > total}>{option}</option
                      >{/each}
                  </select>
                  <span class="block text-4xl font-light text-white"
                    >{threshold}</span
                  >
                  <ChevronDown
                    class="pointer-events-none absolute top-3 right-1 size-4 text-[#aab5be]"
                  />
                  <small
                    class="mt-1 block text-[8px] tracking-wider text-[#aab5be] uppercase"
                    >needed</small
                  >
                </label>
                <span class="text-3xl font-light text-white/35">/</span>
                <label class="relative cursor-pointer">
                  <select
                    class="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 text-sm"
                    value={total}
                    onchange={changeTotal}
                    aria-label="Total devices"
                  >
                    {#each [2, 3, 4, 5] as option (option)}<option
                        value={option}>{option}</option
                      >{/each}
                  </select>
                  <span class="block text-4xl font-light text-white"
                    >{total}</span
                  >
                  <ChevronDown
                    class="pointer-events-none absolute top-3 right-1 size-4 text-[#aab5be]"
                  />
                  <small
                    class="mt-1 block text-[8px] tracking-wider text-[#aab5be] uppercase"
                    >total</small
                  >
                </label>
              </span>
            </div>
            <div
              class="border border-[#7b8993] bg-[#192128] px-5 py-3 font-mono text-xs text-[#d7e0e6]"
            >
              {keys === total
                ? 'ROSTER READY'
                : `${total - keys} KEY${total - keys === 1 ? '' : 'S'} MISSING`}
            </div>
          </div>
        </div>

        <div class="mt-6 flex flex-wrap items-center justify-between gap-5">
          <label class="flex items-center gap-3 text-xs text-[#a4afb9]"
            ><span
              class="grid size-6 place-items-center rounded border border-white/20 bg-white/5"
              ><Check class="size-3" /></span
            >All encrypted shares return to their participants</label
          >
          <button
            disabled={!name.trim() || keys !== total}
            class="rounded-md bg-[#46e56f] px-7 py-4 text-xs font-bold tracking-wide text-[#112218] uppercase shadow-[0_12px_30px_rgb(45_225_99/0.18)] disabled:opacity-25"
            onclick={() => (finalized = true)}
          >
            {finalized ? 'Sentinel vault sealed' : 'Seal Sentinel vault'}
          </button>
        </div>
      </div>
    </div>

    <footer
      class="mt-14 border-t border-white/[0.08] pt-5 text-center font-mono text-[8px] tracking-[0.14em] text-[#65717b] uppercase"
    >
      Genesis requires all N participant keys · devices remain outside the owner
      control plane
    </footer>
  </section>
</div>
