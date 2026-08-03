<!--
DIRECTION: One printed board carrying one route at a time. The device key of
this browser is a board of its own — passkey sockets above it, a vault slot
below it, copper in between that a test pulse either crosses or does not.
Every other device key is a line in a quiet register underneath, nothing more.
-->
<script lang="ts">
  import {
    Fingerprint,
    Laptop,
    Pencil,
    Plus,
    Trash2,
    Vault as VaultIcon,
    Zap,
  } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import GraphSwitch from '../_shared/GraphSwitch.svelte'
  import {
    GraphId,
    graphById,
    isHere,
    type KeyGraph,
    type LocalKey,
    localKey,
    LocalKeyKind,
    openableHere,
    type Passkey,
    Reach,
    storeLabel,
    vaultsForDevice,
    vaultsOpenableHere,
  } from '../_shared/key-graph'
  import type { ExperimentProps } from '../../index'
  import {
    Circuit,
    type Seat,
    SeatKind,
    type Slot,
    SlotKind,
    Socket,
  } from './circuit'

  /** Two doglegs and a junction, the way copper actually turns a corner. */
  const TRACE = 'M12 0 V14 L4 24 V42 L12 52 V56'
  const STEP_MS = 460

  let { navigate }: ExperimentProps = $props()
  let graphId = $state(GraphId.Tangle)
  let passkeyId = $state(firstPasskeyId(graphById(GraphId.Tangle)))
  let vaultId = $state(firstVaultId(graphById(GraphId.Tangle)))
  let runToken = $state(1)
  /** How many of the three parts the pulse has energized so far. */
  let reached = $state(0)

  const graph = $derived(graphById(graphId))
  const myKey = $derived(localKey(graph))
  const others = $derived(
    graph.devices.filter((device) => !isHere(graph, device)),
  )
  const seated = $derived(seatIn(graph, passkeyId))
  const slotted = $derived(slotIn(graph, vaultId))
  const circuit = $derived(circuitOf(myKey, seated, slotted))
  const conducts = $derived(conductsOf(circuit))
  const running = $derived(reached < conducts)
  const brokenUpper = $derived(
    circuit === Circuit.PasskeyElsewhere ||
      circuit === Circuit.NotEnrolled ||
      circuit === Circuit.NoDeviceKey,
  )
  const brokenLower = $derived(
    circuit === Circuit.VaultUnreachable || circuit === Circuit.NoDeviceKey,
  )

  /**
   * Walks the pulse one part per tick. A new run cancels the one in flight, and
   * a reduced-motion request lands on the end state without the staging.
   */
  $effect(() => {
    const stops = runToken > 0 ? conducts : 0
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      reached = stops
      return
    }
    reached = 0
    const timers: ReturnType<typeof setTimeout>[] = []
    for (let step = 1; step <= stops; step += 1) {
      timers.push(setTimeout(() => (reached = step), step * STEP_MS))
    }
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  })

  function seatIn(graph: KeyGraph, id: string): Seat {
    for (const passkey of graph.passkeys) {
      if (passkey.id === id) return { kind: SeatKind.Seated, passkey }
    }
    return { kind: SeatKind.Empty }
  }

  function slotIn(graph: KeyGraph, id: string): Slot {
    for (const vault of graph.vaults) {
      if (vault.id === id) return { kind: SlotKind.Slotted, vault }
    }
    return { kind: SlotKind.Empty }
  }

  function firstPasskeyId(graph: KeyGraph): string {
    const key = localKey(graph)
    const own = graph.passkeys.filter(
      (passkey) =>
        passkey.reach === Reach.Here &&
        key.kind === LocalKeyKind.Present &&
        key.device.passkeyIds.includes(passkey.id),
    )
    for (const passkey of own.length > 0 ? own : graph.passkeys) {
      return passkey.id
    }
    return ''
  }

  function firstVaultId(graph: KeyGraph): string {
    const open = vaultsOpenableHere(graph)
    for (const vault of open.length > 0 ? open : graph.vaults) {
      return vault.id
    }
    return ''
  }

  function circuitOf(key: LocalKey, seat: Seat, slot: Slot): Circuit {
    if (key.kind === LocalKeyKind.Missing) return Circuit.NoDeviceKey
    if (
      seat.kind === SeatKind.Empty ||
      seat.passkey.reach === Reach.Elsewhere
    ) {
      return Circuit.PasskeyElsewhere
    }
    if (!key.device.passkeyIds.includes(seat.passkey.id)) {
      return Circuit.NotEnrolled
    }
    if (
      slot.kind === SlotKind.Empty ||
      !slot.vault.deviceIds.includes(key.device.id)
    ) {
      return Circuit.VaultUnreachable
    }
    return Circuit.Closed
  }

  function conductsOf(circuit: Circuit): number {
    if (circuit === Circuit.NoDeviceKey) return 0
    if (circuit === Circuit.Closed) return 3
    return circuit === Circuit.VaultUnreachable ? 2 : 1
  }

  function verdict(circuit: Circuit): string {
    if (circuit === Circuit.Closed) return 'continuity'
    if (circuit === Circuit.NoDeviceKey) return 'no device key'
    if (circuit === Circuit.PasskeyElsewhere) return 'open · passkey elsewhere'
    if (circuit === Circuit.NotEnrolled) return 'open · not on this key'
    return 'open · vault not enrolled'
  }

  function socketOf(key: LocalKey, passkey: Passkey): Socket {
    if (passkey.reach === Reach.Elsewhere) return Socket.Elsewhere
    if (
      key.kind === LocalKeyKind.Missing ||
      !key.device.passkeyIds.includes(passkey.id)
    ) {
      return Socket.NotEnrolled
    }
    return Socket.Live
  }

  function socketWord(socket: Socket): string {
    if (socket === Socket.Live) return 'on this key'
    return socket === Socket.Elsewhere ? 'elsewhere' : 'other device'
  }

  function carrier(energized: boolean, empty: boolean): string {
    if (empty) return 'border-dashed border-[#1d2b30] bg-transparent'
    if (energized) {
      return 'border-[#2dd4bf]/55 bg-[#08191b] shadow-[0_0_26px_-10px_#2dd4bf]'
    }
    return 'border-[#12242a] bg-[#080f12]'
  }

  function seat(id: string) {
    passkeyId = id
    runToken += 1
  }

  function slot(id: string) {
    vaultId = id
    runToken += 1
  }

  function swapGraph(next: GraphId) {
    graphId = next
    passkeyId = firstPasskeyId(graphById(next))
    vaultId = firstVaultId(graphById(next))
    runToken += 1
  }
</script>

{#snippet designator(caption: string, tag: string)}
  <div
    class="flex items-baseline justify-between gap-2 px-3 pt-2.5 font-mono text-[10px] tracking-[0.2em] text-[#4a6b68] uppercase"
  >
    <span>{caption}</span>
    <span>{tag}</span>
  </div>
{/snippet}

{#snippet trace(live: boolean, broken: boolean, label: string)}
  <div class="flex items-center gap-3 pl-5">
    <svg
      viewBox="0 0 24 56"
      class="h-14 w-6 shrink-0"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={TRACE}
        fill="none"
        stroke-width="1.25"
        pathLength="1"
        stroke-dasharray={broken ? '0.44 0.16 0.4' : 'none'}
        class={broken ? 'stroke-[#3d2c17]' : 'stroke-[#173139]'}
      />
      {#if broken}
        <circle cx="4" cy="24.4" r="1.5" class="fill-[#e0a35c]" />
        <circle cx="4" cy="34" r="1.5" class="fill-[#e0a35c]" />
      {:else}
        <path
          d={TRACE}
          fill="none"
          stroke-width="1.75"
          pathLength="1"
          class="stroke-[#2dd4bf] transition-[stroke-dashoffset] duration-[440ms] ease-linear [stroke-dasharray:1] motion-reduce:duration-0"
          style={`stroke-dashoffset: ${live ? 0 : 1}`}
        />
        <circle
          cx="4"
          cy="24"
          r="1.9"
          class={live ? 'fill-[#2dd4bf]' : 'fill-[#1c353c]'}
        />
      {/if}
    </svg>
    <span
      class={`font-mono text-[10px] tracking-[0.22em] uppercase ${
        broken ? 'text-[#e0a35c]' : live ? 'text-[#2dd4bf]' : 'text-[#3f5d5b]'
      }`}
    >
      {broken ? 'cut' : label}
    </span>
  </div>
{/snippet}

<main class="min-h-[100svh] bg-[#04070a] text-[#d5e4e2]">
  <ExperimentBack {navigate} />
  <GraphSwitch {graph} onGraph={swapGraph} />

  <div class="mx-auto max-w-2xl px-4 pt-24 pb-20 sm:px-8 sm:pt-20">
    <section
      class="rounded-xl border border-[#2dd4bf]/30 bg-[#070d10] p-3 shadow-[inset_0_1px_0_#14282e] sm:p-5"
      aria-label="My device"
    >
      <header class="flex flex-wrap items-center gap-x-2 gap-y-2 px-1">
        <span
          class="rounded-sm bg-[#2dd4bf] px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-[0.18em] text-[#04211f] uppercase"
        >
          My device
        </span>
        <span class="truncate text-[12px] text-[#7c948f]">
          {myKey.kind === LocalKeyKind.Present
            ? myKey.device.platform
            : 'not set up in this browser'}
        </span>
      </header>

      <div class="mt-2.5 flex flex-wrap gap-1.5 px-1">
        {#if myKey.kind === LocalKeyKind.Present}
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-sm border border-[#1c3a3f] px-2 py-1 font-mono text-[10px] tracking-[0.12em] text-[#8fb3ae] uppercase transition hover:border-[#2dd4bf]/60 hover:text-[#2dd4bf] motion-reduce:transition-none"
          >
            <Pencil class="size-3" aria-hidden="true" />
            Rename
          </button>
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-sm border border-[#1c3a3f] px-2 py-1 font-mono text-[10px] tracking-[0.12em] text-[#8fb3ae] uppercase transition hover:border-[#2dd4bf]/60 hover:text-[#2dd4bf] motion-reduce:transition-none"
          >
            <Plus class="size-3" aria-hidden="true" />
            Enrol passkey
          </button>
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-sm border border-[#3d2c17] px-2 py-1 font-mono text-[10px] tracking-[0.12em] text-[#c08a4a] uppercase transition hover:border-[#e0a35c]/70 hover:text-[#e0a35c] motion-reduce:transition-none"
          >
            <Trash2 class="size-3" aria-hidden="true" />
            Revoke
          </button>
        {:else}
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-sm bg-[#2dd4bf] px-2.5 py-1 font-mono text-[10px] font-semibold tracking-[0.12em] text-[#04211f] uppercase"
          >
            <Plus class="size-3" aria-hidden="true" />
            Set up this browser
          </button>
        {/if}
      </div>

      <div
        class="mt-5 rounded-md border transition {carrier(reached >= 1, false)}"
      >
        {@render designator('Passkey', 'U1')}
        <ul class="space-y-1 p-2">
          {#each graph.passkeys as passkey (passkey.id)}
            {@const kind = socketOf(myKey, passkey)}
            {@const chosen = passkey.id === passkeyId}
            <li>
              <button
                type="button"
                aria-pressed={chosen}
                class={`flex w-full items-start gap-2.5 rounded-sm border px-2.5 py-2 text-left transition motion-reduce:transition-none ${
                  chosen
                    ? 'border-[#2dd4bf]/60 bg-[#0b1f21]'
                    : 'border-transparent bg-[#060c0f] hover:border-[#1c3a3f]'
                }`}
                onclick={() => seat(passkey.id)}
              >
                <span
                  class={`mt-1 size-2.5 shrink-0 rounded-[2px] border ${
                    kind === Socket.Live
                      ? 'border-[#2dd4bf] bg-[#2dd4bf]'
                      : 'border-[#e0a35c]/70'
                  }`}
                  aria-hidden="true"
                ></span>
                <span
                  class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5"
                >
                  <span
                    class="font-mono text-[15px] tracking-[0.08em] text-[#e6f5f1]"
                  >
                    {passkey.shortId}
                  </span>
                  <span class="truncate text-[11px] text-[#7c948f]">
                    {storeLabel(passkey.store)}
                  </span>
                </span>
                <span
                  class={`shrink-0 font-mono text-[9px] tracking-[0.14em] uppercase ${
                    kind === Socket.Live ? 'text-[#2dd4bf]' : 'text-[#c08a4a]'
                  }`}
                >
                  {socketWord(kind)}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      </div>

      {@render trace(reached >= 2, brokenUpper, 'unlocks')}

      <div
        class="rounded-md border px-3 pb-3 transition {carrier(
          reached >= 2,
          myKey.kind === LocalKeyKind.Missing,
        )}"
      >
        {@render designator('Device key', 'U2')}
        {#if myKey.kind === LocalKeyKind.Present}
          <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Laptop class="size-4 shrink-0 text-[#2dd4bf]" aria-hidden="true" />
            <span
              class="font-mono text-2xl tracking-[0.1em] text-[#e6f5f1] tabular-nums"
            >
              {myKey.device.shortId}
            </span>
            <span
              class="rounded-sm border border-[#2dd4bf]/50 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.16em] text-[#2dd4bf] uppercase"
            >
              This browser
            </span>
          </div>
        {:else}
          <p
            class="mt-1.5 font-mono text-[13px] tracking-[0.14em] text-[#c08a4a] uppercase"
          >
            empty socket
          </p>
        {/if}
      </div>

      {@render trace(reached >= 3, brokenLower, 'opens')}

      <div class="rounded-md border transition {carrier(reached >= 3, false)}">
        {@render designator('Vault', 'U3')}
        <div class="flex flex-wrap gap-1.5 px-2 pt-2">
          {#each graph.vaults as vault (vault.id)}
            {@const chosen = vault.id === vaultId}
            {@const reachable = openableHere(graph, vault)}
            <button
              type="button"
              aria-pressed={chosen}
              class={`flex items-center gap-1.5 rounded-sm border px-2 py-1 transition motion-reduce:transition-none ${
                chosen
                  ? 'border-[#2dd4bf]/60 bg-[#0b1f21]'
                  : 'border-[#12242a] bg-[#060c0f] hover:border-[#1c3a3f]'
              }`}
              onclick={() => slot(vault.id)}
            >
              <span
                class={`size-1.5 shrink-0 rounded-full ${
                  reachable ? 'bg-[#2dd4bf]' : 'bg-[#3d4a4d]'
                }`}
                aria-hidden="true"
              ></span>
              <span class="font-mono text-[12px] tracking-[0.06em]">
                {vault.shortId}
              </span>
              <span class="text-[11px] text-[#7c948f]">{vault.label}</span>
            </button>
          {/each}
        </div>
        {#if slotted.kind === SlotKind.Slotted}
          <div
            class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[#12242a] px-3 py-3"
          >
            <VaultIcon
              class={`size-4 shrink-0 ${reached >= 3 ? 'text-[#2dd4bf]' : 'text-[#3f5d5b]'}`}
              aria-hidden="true"
            />
            <span
              class="font-mono text-2xl tracking-[0.1em] text-[#e6f5f1] tabular-nums"
            >
              {slotted.vault.shortId}
            </span>
            <span class="text-[12px] text-[#7c948f]">{slotted.vault.label}</span
            >
            <span class="ml-auto font-mono text-[10px] text-[#4a6b68]">
              {slotted.vault.secrets} secrets
            </span>
          </div>
        {/if}
      </div>

      <div
        class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-dashed border-[#12242a] px-1 pt-3"
      >
        <span class="flex items-center gap-1" aria-hidden="true">
          {#each [0, 1, 2] as index (index)}
            <span
              class={`size-2 rounded-full transition motion-reduce:transition-none ${
                reached > index
                  ? 'bg-[#2dd4bf]'
                  : 'border border-[#1c353c] bg-transparent'
              }`}
            ></span>
          {/each}
        </span>
        <span
          class={`font-mono text-[11px] tracking-[0.16em] uppercase ${
            circuit === Circuit.Closed ? 'text-[#2dd4bf]' : 'text-[#e0a35c]'
          }`}
        >
          {verdict(circuit)}
        </span>
        <button
          type="button"
          class="ml-auto flex items-center gap-1.5 rounded-sm bg-[#2dd4bf] px-3 py-1.5 font-mono text-[10px] font-semibold tracking-[0.16em] text-[#04211f] uppercase transition hover:bg-[#5ee7d6] motion-reduce:transition-none"
          onclick={() => (runToken += 1)}
        >
          <Zap class="size-3.5" aria-hidden="true" />
          {running ? 'pulse' : 'test'}
        </button>
      </div>
    </section>

    <section class="mt-10" aria-label="Other devices">
      <header
        class="flex items-baseline gap-2 px-1 font-mono text-[10px] tracking-[0.2em] uppercase"
      >
        <span class="text-[#3f5d5b]">Other devices</span>
        <span class="text-[#2a3f42]">read only</span>
        <span class="ml-auto text-[#2a3f42]">{others.length}</span>
      </header>
      <ul class="mt-1">
        {#each others as device (device.id)}
          {@const touches = vaultsForDevice(graph, device.id).some(
            (vault) => vault.id === vaultId,
          )}
          <li
            class={`flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-[#101a1e] px-1 py-2.5 transition motion-reduce:transition-none ${
              touches ? 'opacity-100' : 'opacity-45'
            }`}
          >
            <Fingerprint
              class="size-3 shrink-0 self-center text-[#2a3f42]"
              aria-hidden="true"
            />
            <span
              class="font-mono text-[13px] tracking-[0.08em] text-[#9fb8b4]"
            >
              {device.shortId}
            </span>
            <span class="min-w-0 truncate text-[11px] text-[#5f7a77]">
              {device.label} · {device.platform}
            </span>
            <span class="ml-auto flex flex-wrap items-center gap-1">
              {#each vaultsForDevice(graph, device.id) as vault (vault.id)}
                <span
                  class={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] tracking-[0.06em] ${
                    vault.id === vaultId
                      ? 'bg-[#123033] text-[#8fd8cd]'
                      : 'text-[#46605d]'
                  }`}
                >
                  {vault.shortId}
                </span>
              {/each}
            </span>
          </li>
        {:else}
          <li
            class="border-t border-[#101a1e] px-1 py-2.5 font-mono text-[11px] tracking-[0.16em] text-[#2a3f42] uppercase"
          >
            none
          </li>
        {/each}
      </ul>
    </section>
  </div>
</main>
