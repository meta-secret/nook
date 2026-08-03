<!--
DIRECTION: My device key is established once, at the top, as the one object
this browser can act on. Below it, one row per vault, and inside it one row per
passkey that opens it — never one per route, so no identifier is ever printed
twice. Every row holds the same four columns: which manager holds the passkey,
which other devices carry it, and a final fixed slot that is filled when the
passkey works from this browser and hollow when it does not. Reading down that
last column answers the question without a sentence.
-->
<script lang="ts">
  import { Laptop, Vault as VaultIcon } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import GraphSwitch from '../_shared/GraphSwitch.svelte'
  import {
    defaultNode,
    type Device,
    devicesForVault,
    GraphId,
    graphById,
    HereKind,
    hereDevices,
    highlightFor,
    isHere,
    type KeyGraph,
    KeyStore,
    NodeKind,
    type NodeRef,
    type Passkey,
    passkeysForDevice,
    Reach,
    storeLabel,
    type Vault,
    vaultsForDevice,
  } from '../_shared/key-graph'
  import type { ExperimentProps } from '../../index'
  import { Redundancy } from './chain-grade'

  /** One passkey that opens a vault, with every device key that carries it. */
  interface Way {
    key: string
    passkeyId: string
    passkeyShortId: string
    store: KeyStore
    storeName: string
    /** The passkey is not presentable in this browser at all. */
    elsewhere: boolean
    /** Presentable here and carried by this browser's device key. */
    here: boolean
    others: Device[]
  }

  interface VaultRead {
    vault: Vault
    ways: Way[]
    passkeys: number
    managers: number
    now: number
    pips: boolean[]
    grade: Redundancy
  }

  const STORE_INK: Record<KeyStore, string> = {
    [KeyStore.ApplePasswords]: '#6b7280',
    [KeyStore.Bitwarden]: '#2f5fd0',
    [KeyStore.OnePassword]: '#1f7a5c',
    [KeyStore.SecurityKey]: '#a1751a',
  }

  const CAPS = 'font-mono text-[10px] tracking-[0.22em] uppercase'
  const ACTION =
    'rounded-full border border-[#1a1815]/30 px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] uppercase transition hover:border-[#1a1815] motion-reduce:transition-none'

  let { navigate }: ExperimentProps = $props()
  let graphId = $state(GraphId.Tangle)
  let selected = $state<NodeRef>(defaultNode(graphById(GraphId.Tangle)))

  const graph = $derived(graphById(graphId))
  const highlight = $derived(highlightFor(graph, selected))
  const reads = $derived(graph.vaults.map((vault) => readFor(graph, vault)))
  const others = $derived(
    graph.devices.filter((device) => !isHere(graph, device)),
  )

  function rank(way: Way): number {
    if (way.here) return 0
    return way.elsewhere ? 2 : 1
  }

  function wayFor(
    source: KeyGraph,
    vault: Vault,
    passkey: Passkey,
    carriers: Device[],
  ): Way {
    const carrying = carriers.filter((device) =>
      device.passkeyIds.includes(passkey.id),
    )
    return {
      key: `${vault.id}-${passkey.id}`,
      passkeyId: passkey.id,
      passkeyShortId: passkey.shortId,
      store: passkey.store,
      storeName: storeLabel(passkey.store),
      elsewhere: passkey.reach === Reach.Elsewhere,
      here:
        passkey.reach === Reach.Here &&
        carrying.some((device) => isHere(source, device)),
      others: carrying.filter((device) => !isHere(source, device)),
    }
  }

  function readFor(source: KeyGraph, vault: Vault): VaultRead {
    const carriers = devicesForVault(source, vault)
    const reaching = new Set(
      carriers.flatMap((device) => [...device.passkeyIds]),
    )
    const ways = source.passkeys
      .filter((passkey) => reaching.has(passkey.id))
      .map((passkey) => wayFor(source, vault, passkey, carriers))
      .sort((left, right) => rank(left) - rank(right))
    const managers = new Set(ways.map((way) => way.store)).size
    return {
      vault,
      ways,
      passkeys: ways.length,
      managers,
      now: ways.filter((way) => way.here).length,
      pips: source.passkeys.map((passkey) => reaching.has(passkey.id)),
      grade: gradeOf(ways.length, managers),
    }
  }

  function gradeOf(passkeys: number, managers: number): Redundancy {
    if (passkeys === 0) return Redundancy.Severed
    if (passkeys === 1) return Redundancy.Single
    return managers === 1 ? Redundancy.OneManager : Redundancy.Spread
  }

  function gradeLabel(read: VaultRead): string {
    if (read.grade === Redundancy.Severed) return 'no passkey'
    const total = graph.passkeys.length
    return `${read.passkeys} of ${total} passkeys · ${read.managers} manager${read.managers === 1 ? '' : 's'}`
  }

  function gradeInk(grade: Redundancy): string {
    if (grade === Redundancy.Spread) return 'text-[#1f5c44]'
    if (grade === Redundancy.OneManager) return 'text-[#8a5d0f]'
    return 'text-[#a8431c]'
  }

  function gradeEdge(grade: Redundancy): string {
    if (grade === Redundancy.Spread) return 'border-l-[#1f5c44]'
    if (grade === Redundancy.OneManager) return 'border-l-[#8a5d0f]'
    return 'border-l-[#a8431c]'
  }

  function gradePip(grade: Redundancy): string {
    if (grade === Redundancy.Spread) return 'bg-[#1f5c44]'
    if (grade === Redundancy.OneManager) return 'bg-[#8a5d0f]'
    return 'bg-[#a8431c]'
  }

  function braceY(count: number, index: number): number {
    return ((index + 0.5) / count) * 100
  }

  function wayWord(way: Way): string {
    if (way.here) return 'Usable from this browser now'
    if (way.elsewhere) return 'Passkey not available on this browser'
    const names = way.others.map((device) => device.label).join(', ')
    return `Only through ${names}`
  }

  function pick(kind: NodeKind, id: string) {
    selected = { kind, id }
  }

  function isSelected(kind: NodeKind, id: string): boolean {
    return selected.kind === kind && selected.id === id
  }

  function dim(lit: boolean): string {
    return lit ? 'opacity-100' : 'opacity-40'
  }

  /** Rows stay readable when unselected: identifiers are the point of the sketch. */
  function dimRow(lit: boolean): string {
    return lit ? 'opacity-100' : 'opacity-75'
  }

  function chosenEdge(chosen: boolean): string {
    return chosen ? 'border-[#1a1815]' : 'border-[#1a1815]/25'
  }
</script>

<main class="min-h-[100svh] bg-[#f6f3ec] text-[#1a1815]">
  <ExperimentBack {navigate} light />
  <GraphSwitch
    {graph}
    light
    onGraph={(next) => {
      graphId = next
      selected = defaultNode(graphById(next))
    }}
  />

  <section class="mx-auto max-w-3xl px-5 pt-28 pb-20 sm:px-8 sm:pt-24">
    {#each hereDevices(graph) as device (device.id)}
      <article
        class={`border-2 bg-[#fffdf7] px-4 py-4 transition motion-reduce:transition-none sm:px-5 ${
          isSelected(NodeKind.Device, device.id)
            ? 'border-[#1a1815]'
            : 'border-[#1a1815]/70'
        }`}
      >
        <div class="flex flex-wrap items-start gap-x-4 gap-y-3">
          <div class="min-w-0 flex-1">
            <p class="{CAPS} text-[#1a1815]/50">My device</p>
            <button
              type="button"
              aria-pressed={isSelected(NodeKind.Device, device.id)}
              aria-label={`My device key ${device.shortId}`}
              class="mt-1 flex items-center gap-2 font-mono text-[26px] leading-none tracking-[0.08em]"
              onclick={() => pick(NodeKind.Device, device.id)}
            >
              <Laptop class="size-5 shrink-0" aria-hidden="true" />
              {device.shortId}
            </button>
            <p class="mt-1.5 text-[12px] text-[#1a1815]/60">
              {device.platform}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            <button type="button" class={ACTION}>rename</button>
            <button type="button" class={ACTION}>enrol passkey</button>
            <button
              type="button"
              class="{ACTION} border-[#a8431c]/40 text-[#a8431c] hover:border-[#a8431c]"
            >
              revoke
            </button>
          </div>
        </div>

        <div class="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-2">
          <span class="{CAPS} w-20 shrink-0 text-[#1a1815]/45">Unlocks</span>
          {#each passkeysForDevice(graph, device) as passkey (passkey.id)}
            <button
              type="button"
              aria-pressed={isSelected(NodeKind.Passkey, passkey.id)}
              aria-label={`Passkey ${passkey.shortId} in ${storeLabel(passkey.store)}`}
              class={`flex items-center gap-1.5 border px-2 py-1 transition motion-reduce:transition-none ${chosenEdge(isSelected(NodeKind.Passkey, passkey.id))}`}
              onclick={() => pick(NodeKind.Passkey, passkey.id)}
            >
              <span
                class="size-2 shrink-0 rounded-full"
                style={`background:${STORE_INK[passkey.store]}`}
                aria-hidden="true"
              ></span>
              <span class="font-mono text-[13px] tracking-[0.06em]">
                {passkey.shortId}
              </span>
              <span class="text-[11px] text-[#1a1815]/55">
                {storeLabel(passkey.store)}
              </span>
              {#if passkey.reach === Reach.Elsewhere}
                <span class="{CAPS} text-[9px] text-[#a8431c]">elsewhere</span>
              {/if}
            </button>
          {:else}
            <span class="{CAPS} text-[#a8431c]">no passkey enrolled</span>
          {/each}
        </div>

        <div class="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-2">
          <span class="{CAPS} w-20 shrink-0 text-[#1a1815]/45">Opens</span>
          {#each vaultsForDevice(graph, device.id) as vault (vault.id)}
            <button
              type="button"
              aria-pressed={isSelected(NodeKind.Vault, vault.id)}
              aria-label={`Vault ${vault.shortId}, ${vault.label}`}
              class={`flex items-center gap-1.5 border px-2 py-1 transition motion-reduce:transition-none ${chosenEdge(isSelected(NodeKind.Vault, vault.id))}`}
              onclick={() => pick(NodeKind.Vault, vault.id)}
            >
              <VaultIcon
                class="size-3 shrink-0 text-[#1a1815]/55"
                aria-hidden="true"
              />
              <span class="font-mono text-[13px] tracking-[0.06em]">
                {vault.shortId}
              </span>
              <span class="text-[11px] text-[#1a1815]/55">{vault.label}</span>
            </button>
          {:else}
            <span class="{CAPS} text-[#a8431c]">no vault</span>
          {/each}
        </div>
      </article>
    {/each}

    {#if graph.here.kind === HereKind.Unprepared}
      <article
        class="border-2 border-dashed border-[#a8431c]/60 bg-[#fffdf7] px-4 py-4 sm:px-5"
      >
        <p class="{CAPS} text-[#1a1815]/50">My device</p>
        <p class="mt-1 font-mono text-[26px] leading-none text-[#a8431c]">
          no device key
        </p>
        <button
          type="button"
          class="{ACTION} mt-3 border-[#1a1815]/40 hover:border-[#1a1815]"
        >
          set up this browser
        </button>
      </article>
    {/if}

    <p class="{CAPS} mt-10 text-[#1a1815]/45">Vaults</p>

    <div class="mt-3 hidden sm:flex" aria-hidden="true">
      <div class="flex min-w-0 flex-1 items-center gap-2 px-4 pb-1">
        <span class="size-2 shrink-0"></span>
        <span class="{CAPS} w-[4.6rem] shrink-0 text-[9px] text-[#1a1815]/35">
          Passkey
        </span>
        <span class="{CAPS} min-w-0 flex-1 text-[9px] text-[#1a1815]/35">
          Manager
        </span>
        <span
          class="{CAPS} w-[5.4rem] shrink-0 text-right text-[9px] tracking-[0.14em] text-[#1a1815]/35"
        >
          From here
        </span>
      </div>
      <div class="w-8 shrink-0"></div>
      <div class="w-56 shrink-0"></div>
    </div>

    <ul class="space-y-3">
      {#each reads as read (read.vault.id)}
        {@const lit = highlight.vaultIds.includes(read.vault.id)}
        {@const chosen = isSelected(NodeKind.Vault, read.vault.id)}
        <li
          class={`border border-l-2 transition motion-reduce:transition-none ${gradeEdge(read.grade)} ${chosen ? 'border-y-[#1a1815] border-r-[#1a1815]' : 'border-y-[#1a1815]/20 border-r-[#1a1815]/20'} ${dimRow(lit)} ${
            read.grade === Redundancy.Severed
              ? 'bg-[repeating-linear-gradient(45deg,#a8431c14_0_6px,transparent_6px_12px)]'
              : ''
          }`}
        >
          <div class="flex flex-col sm:flex-row-reverse sm:items-stretch">
            <button
              type="button"
              aria-pressed={chosen}
              class="flex shrink-0 flex-col justify-center gap-1.5 border-b border-[#1a1815]/15 px-4 py-3 text-left sm:w-56 sm:border-b-0 sm:border-l"
              onclick={() => pick(NodeKind.Vault, read.vault.id)}
            >
              <span class="flex items-center gap-2">
                <VaultIcon
                  class="size-3.5 shrink-0 text-[#1a1815]/55"
                  aria-hidden="true"
                />
                <span class="truncate text-[13px]">{read.vault.label}</span>
                <span
                  class={`ml-auto shrink-0 font-mono text-[9px] tracking-[0.14em] uppercase ${read.now > 0 ? 'text-[#1f5c44]' : 'text-[#1a1815]/40'}`}
                >
                  {read.now > 0 ? 'opens here' : 'not here'}
                </span>
              </span>
              <span class="font-mono text-xl tracking-[0.08em]">
                {read.vault.shortId}
              </span>
              <span class="flex items-center gap-1.5">
                <span class="flex items-center gap-1" aria-hidden="true">
                  {#each read.pips as filled, index (index)}
                    <span
                      class={`size-2 rounded-full ${filled ? gradePip(read.grade) : 'border border-[#1a1815]/25'}`}
                    ></span>
                  {/each}
                </span>
                <span
                  class={`font-mono text-[10px] tracking-[0.1em] uppercase ${gradeInk(read.grade)}`}
                >
                  {gradeLabel(read)}
                </span>
              </span>
              <span class="font-mono text-[10px] text-[#1a1815]/40">
                {read.vault.secrets} secrets
              </span>
            </button>

            <div class="relative hidden w-8 shrink-0 sm:block">
              <svg
                viewBox="0 0 24 100"
                preserveAspectRatio="none"
                class="absolute inset-0 h-full w-full"
                aria-hidden="true"
                focusable="false"
              >
                {#each read.ways as way, index (way.key)}
                  <path
                    d={`M0 ${braceY(read.ways.length, index)} H7 C15 ${braceY(read.ways.length, index)} 15 50 24 50`}
                    fill="none"
                    vector-effect="non-scaling-stroke"
                    stroke-width={way.here ? 1.5 : 1}
                    class={way.here
                      ? 'stroke-[#1a1815]/70'
                      : 'stroke-[#1a1815]/20'}
                  />
                {/each}
              </svg>
            </div>

            {#if read.ways.length === 0}
              <div class="flex flex-1 items-center gap-3 px-4 py-5">
                <span class="flex-1 border-t border-dashed border-[#a8431c]/60"
                ></span>
                <span
                  class="font-mono text-[11px] tracking-[0.16em] text-[#a8431c] uppercase"
                >
                  no passkey reaches this
                </span>
                <span class="flex-1 border-t border-dashed border-[#a8431c]/60"
                ></span>
              </div>
            {:else}
              <div
                class="grid min-w-0 flex-1"
                style={`grid-template-rows: repeat(${read.ways.length}, minmax(0, 1fr))`}
              >
                {#each read.ways as way (way.key)}
                  {@const wayLit = highlight.passkeyIds.includes(way.passkeyId)}
                  <div
                    class={`flex min-w-0 items-center gap-2 px-4 py-2 transition motion-reduce:transition-none ${lit ? dim(wayLit) : ''} ${way.here ? 'bg-[#1f5c44]/8' : ''}`}
                  >
                    <span class="sr-only">{wayWord(way)}</span>
                    <span
                      class="size-2 shrink-0 rounded-full"
                      style={`background:${STORE_INK[way.store]}`}
                      aria-hidden="true"
                    ></span>
                    <button
                      type="button"
                      aria-pressed={isSelected(NodeKind.Passkey, way.passkeyId)}
                      aria-label={`Passkey ${way.passkeyShortId} in ${way.storeName}`}
                      class={`w-[4.6rem] shrink-0 border-b text-left font-mono text-[13px] tracking-[0.06em] transition motion-reduce:transition-none ${
                        isSelected(NodeKind.Passkey, way.passkeyId)
                          ? 'border-b-[#1a1815]'
                          : 'border-b-transparent'
                      }`}
                      onclick={() => pick(NodeKind.Passkey, way.passkeyId)}
                    >
                      {way.passkeyShortId}
                    </button>
                    <span
                      class="min-w-0 flex-1 truncate text-[11px] text-[#1a1815]/55"
                    >
                      {way.storeName}
                    </span>
                    {#if way.elsewhere}
                      <span
                        class="shrink-0 font-mono text-[9px] tracking-[0.14em] text-[#a8431c] uppercase"
                      >
                        elsewhere
                      </span>
                    {/if}
                    {#each way.others as device (device.id)}
                      <button
                        type="button"
                        aria-pressed={isSelected(NodeKind.Device, device.id)}
                        aria-label={`Also on device key ${device.shortId}, ${device.label}`}
                        class={`flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] text-[#1a1815]/55 transition motion-reduce:transition-none ${chosenEdge(isSelected(NodeKind.Device, device.id))}`}
                        onclick={() => pick(NodeKind.Device, device.id)}
                      >
                        <Laptop class="size-2.5 shrink-0" aria-hidden="true" />
                        {device.shortId}
                      </button>
                    {/each}
                    <span
                      class="flex w-6 shrink-0 items-center justify-end sm:w-[5.4rem]"
                      aria-hidden="true"
                    >
                      {#if way.here}
                        <span
                          class="size-2.5 rounded-full bg-[#1f5c44] ring-3 ring-[#1f5c44]/20"
                        ></span>
                      {:else}
                        <span
                          class="size-2.5 rounded-full border border-[#1a1815]/45"
                        ></span>
                      {/if}
                    </span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </li>
      {/each}
    </ul>

    {#if others.length > 0}
      <div class="mt-10 flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <span class="{CAPS} text-[#1a1815]/35">Other devices</span>
        {#each others as device (device.id)}
          <button
            type="button"
            aria-pressed={isSelected(NodeKind.Device, device.id)}
            aria-label={`Device key ${device.shortId}, ${device.label}`}
            class={`flex items-center gap-1.5 border-b transition motion-reduce:transition-none ${
              isSelected(NodeKind.Device, device.id)
                ? 'border-b-[#1a1815]/50'
                : 'border-b-transparent'
            }`}
            onclick={() => pick(NodeKind.Device, device.id)}
          >
            <span class="font-mono text-[12px] text-[#1a1815]/55">
              {device.shortId}
            </span>
            <span class="text-[11px] text-[#1a1815]/40">{device.label}</span>
          </button>
        {/each}
      </div>
    {/if}
  </section>
</main>
