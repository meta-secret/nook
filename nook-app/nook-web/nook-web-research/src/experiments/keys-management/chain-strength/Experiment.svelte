<!--
DIRECTION: My device key is established once, at the top, as the one object
this browser can act on. Below it, one row per vault: every way in is a strand
that reads left to right — passkey identifier, the device key it passes
through, the vault. Strands that run through my device are solid and marked;
the rest are dashed. Other devices only get a quiet footer: they exist, and
that is all this browser can say about them.
-->
<script lang="ts">
  import { Fingerprint, Laptop, Vault as VaultIcon } from '@lucide/svelte'
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
  import { PathReach, Redundancy } from './chain-grade'

  /** One passkey → device key → vault way in, as one line of the rope. */
  interface Strand {
    key: string
    passkeyId: string
    passkeyShortId: string
    store: KeyStore
    storeName: string
    deviceId: string
    deviceShortId: string
    deviceLabel: string
    mine: boolean
    reach: PathReach
  }

  interface VaultRead {
    vault: Vault
    strands: Strand[]
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

  function reachFor(mine: boolean, usable: boolean): PathReach {
    if (!usable) return PathReach.PasskeyElsewhere
    return mine ? PathReach.Now : PathReach.OtherDevice
  }

  function rank(reach: PathReach): number {
    if (reach === PathReach.Now) return 0
    return reach === PathReach.OtherDevice ? 1 : 2
  }

  function strandFor(
    source: KeyGraph,
    vault: Vault,
    device: Device,
    passkey: Passkey,
  ): Strand {
    const mine = isHere(source, device)
    return {
      key: `${vault.id}-${device.id}-${passkey.id}`,
      passkeyId: passkey.id,
      passkeyShortId: passkey.shortId,
      store: passkey.store,
      storeName: storeLabel(passkey.store),
      deviceId: device.id,
      deviceShortId: device.shortId,
      deviceLabel: device.label,
      mine,
      reach: reachFor(mine, passkey.reach === Reach.Here),
    }
  }

  function readFor(source: KeyGraph, vault: Vault): VaultRead {
    const strands = devicesForVault(source, vault)
      .flatMap((device) =>
        passkeysForDevice(source, device).map((passkey) =>
          strandFor(source, vault, device, passkey),
        ),
      )
      .sort((left, right) => rank(left.reach) - rank(right.reach))
    const reaching = new Set(strands.map((strand) => strand.passkeyId))
    const managers = new Set(strands.map((strand) => strand.store)).size
    return {
      vault,
      strands,
      passkeys: reaching.size,
      managers,
      now: strands.filter((strand) => strand.reach === PathReach.Now).length,
      pips: source.passkeys.map((passkey) => reaching.has(passkey.id)),
      grade: gradeOf(reaching.size, managers),
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

  function rule(reach: PathReach): string {
    return reach === PathReach.Now
      ? 'border-[#1a1815]/45'
      : 'border-dashed border-[#1a1815]/25'
  }

  function reachWord(strand: Strand): string {
    if (strand.reach === PathReach.Now) return 'Usable from this browser now'
    if (strand.reach === PathReach.OtherDevice) {
      return `Runs through ${strand.deviceLabel}`
    }
    return 'Passkey not available on this browser'
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

    <ul class="mt-3 space-y-3">
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
                {#each read.strands as strand, index (strand.key)}
                  <path
                    d={`M0 ${braceY(read.strands.length, index)} H7 C15 ${braceY(read.strands.length, index)} 15 50 24 50`}
                    fill="none"
                    vector-effect="non-scaling-stroke"
                    stroke-width={strand.reach === PathReach.Now ? 1.5 : 1}
                    class={strand.reach === PathReach.Now
                      ? 'stroke-[#1a1815]/70'
                      : 'stroke-[#1a1815]/20'}
                  />
                {/each}
              </svg>
            </div>

            {#if read.strands.length === 0}
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
                style={`grid-template-rows: repeat(${read.strands.length}, minmax(0, 1fr))`}
              >
                {#each read.strands as strand (strand.key)}
                  {@const strandLit = highlight.passkeyIds.includes(
                    strand.passkeyId,
                  )}
                  <div
                    class={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 transition motion-reduce:transition-none ${lit ? dim(strandLit) : ''} ${strand.reach === PathReach.Now ? 'bg-[#1f5c44]/8' : ''}`}
                  >
                    <span class="sr-only">{reachWord(strand)}</span>
                    <span
                      class="size-2 shrink-0 rounded-full"
                      style={`background:${STORE_INK[strand.store]}`}
                      aria-hidden="true"
                    ></span>
                    <button
                      type="button"
                      aria-pressed={isSelected(
                        NodeKind.Passkey,
                        strand.passkeyId,
                      )}
                      aria-label={`Passkey ${strand.passkeyShortId} in ${strand.storeName}`}
                      class={`flex items-center gap-1.5 border-b font-mono text-[13px] tracking-[0.06em] transition motion-reduce:transition-none ${
                        isSelected(NodeKind.Passkey, strand.passkeyId)
                          ? 'border-b-[#1a1815]'
                          : 'border-b-transparent'
                      }`}
                      onclick={() => pick(NodeKind.Passkey, strand.passkeyId)}
                    >
                      <Fingerprint
                        class="size-3 shrink-0 text-[#1a1815]/50"
                        aria-hidden="true"
                      />
                      {strand.passkeyShortId}
                    </button>
                    <span class="shrink-0 text-[11px] text-[#1a1815]/55">
                      {strand.storeName}
                    </span>
                    {#if strand.reach === PathReach.PasskeyElsewhere}
                      <span
                        class="shrink-0 font-mono text-[9px] tracking-[0.14em] text-[#a8431c] uppercase"
                      >
                        elsewhere
                      </span>
                    {/if}
                    <span
                      class={`min-w-5 flex-1 border-t ${rule(strand.reach)}`}
                      aria-hidden="true"
                    ></span>
                    <button
                      type="button"
                      aria-pressed={isSelected(
                        NodeKind.Device,
                        strand.deviceId,
                      )}
                      aria-label={strand.mine
                        ? 'Through my device key'
                        : `Through device key ${strand.deviceShortId}, ${strand.deviceLabel}`}
                      class={`flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] tracking-[0.12em] uppercase transition motion-reduce:transition-none ${
                        strand.mine
                          ? 'bg-[#1a1815] text-[#f6f3ec]'
                          : `border text-[#1a1815]/55 ${chosenEdge(isSelected(NodeKind.Device, strand.deviceId))}`
                      }`}
                      onclick={() => pick(NodeKind.Device, strand.deviceId)}
                    >
                      <Laptop class="size-3 shrink-0" aria-hidden="true" />
                      {strand.mine ? 'my device' : strand.deviceShortId}
                    </button>
                    <span
                      class={`w-4 shrink-0 border-t ${rule(strand.reach)}`}
                      aria-hidden="true"
                    ></span>
                    {#if strand.reach === PathReach.Now}
                      <span
                        class="shrink-0 rounded-full bg-[#1f5c44] px-1.5 py-0.5 font-mono text-[9px] tracking-[0.14em] text-[#f6f3ec] uppercase"
                        aria-hidden="true"
                      >
                        now
                      </span>
                    {/if}
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
