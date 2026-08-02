<!--
DIRECTION: Redundancy drawn as rope. One row per vault; every passkey that
reaches it is a strand, carrying its own identifier and the device knot it
passes through. Count the strands and you have counted your ways back in — and
strands of one colour mean one password manager holds all of them.
-->
<script lang="ts">
  import { Fingerprint, Vault as VaultIcon } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import GraphSwitch from '../_shared/GraphSwitch.svelte'
  import {
    defaultNode,
    devicesForVault,
    GraphId,
    graphById,
    HereKind,
    hereDevices,
    highlightFor,
    type KeyGraph,
    KeyStore,
    NodeKind,
    type NodeRef,
    openableHere,
    passkeysForVault,
    Reach,
    storeLabel,
    type Vault,
    vaultsForPasskey,
  } from '../_shared/key-graph'
  import type { ExperimentProps } from '../../index'
  import { Redundancy } from './chain-grade'

  interface Knot {
    id: string
    shortId: string
  }

  interface Strand {
    key: string
    passkeyId: string
    shortId: string
    store: KeyStore
    storeName: string
    here: boolean
    knots: Knot[]
  }

  interface VaultRead {
    vault: Vault
    strands: Strand[]
    managers: number
    pips: boolean[]
    grade: Redundancy
  }

  const STORE_INK: Record<KeyStore, string> = {
    [KeyStore.ApplePasswords]: '#6b7280',
    [KeyStore.Bitwarden]: '#2f5fd0',
    [KeyStore.OnePassword]: '#1f7a5c',
    [KeyStore.SecurityKey]: '#a1751a',
  }

  let { navigate }: ExperimentProps = $props()
  let graphId = $state(GraphId.Tangle)
  let selected = $state<NodeRef>(defaultNode(graphById(GraphId.Tangle)))

  const graph = $derived(graphById(graphId))
  const highlight = $derived(highlightFor(graph, selected))
  const reads = $derived(graph.vaults.map((vault) => readFor(graph, vault)))

  function readFor(graph: KeyGraph, vault: Vault): VaultRead {
    const strands = passkeysForVault(graph, vault).map((passkey) => ({
      key: `${vault.id}-${passkey.id}`,
      passkeyId: passkey.id,
      shortId: passkey.shortId,
      store: passkey.store,
      storeName: storeLabel(passkey.store),
      here: passkey.reach === Reach.Here,
      knots: devicesForVault(graph, vault)
        .filter((device) => device.passkeyIds.includes(passkey.id))
        .map((device) => ({ id: device.id, shortId: device.shortId })),
    }))
    const managers = new Set(strands.map((strand) => strand.store)).size
    return {
      vault,
      strands,
      managers,
      pips: graph.passkeys.map((_passkey, index) => index < strands.length),
      grade: gradeOf(strands.length, managers),
    }
  }

  function gradeOf(routes: number, managers: number): Redundancy {
    if (routes === 0) return Redundancy.Severed
    if (routes === 1) return Redundancy.Single
    return managers === 1 ? Redundancy.OneManager : Redundancy.Spread
  }

  function gradeLabel(read: VaultRead): string {
    if (read.grade === Redundancy.Severed) return 'no passkey'
    if (read.grade === Redundancy.Single) return '1 route'
    return `${read.strands.length} routes · ${read.managers} manager${read.managers === 1 ? '' : 's'}`
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

  function pick(kind: NodeKind, id: string) {
    selected = { kind, id }
  }

  function isSelected(kind: NodeKind, id: string): boolean {
    return selected.kind === kind && selected.id === id
  }

  function dim(lit: boolean): string {
    return lit ? 'opacity-100' : 'opacity-25'
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
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span
        class="font-mono text-[10px] tracking-[0.22em] text-[#1a1815]/45 uppercase"
      >
        This browser
      </span>
      {#each hereDevices(graph) as device (device.id)}
        <button
          type="button"
          aria-pressed={isSelected(NodeKind.Device, device.id)}
          class={`rounded-full border px-2.5 py-1 font-mono text-[11px] transition motion-reduce:transition-none ${chosenEdge(isSelected(NodeKind.Device, device.id))}`}
          onclick={() => pick(NodeKind.Device, device.id)}
        >
          {device.shortId}
        </button>
      {/each}
      {#if graph.here.kind === HereKind.Unprepared}
        <span
          class="rounded-full border border-dashed border-[#a8431c]/60 px-2.5 py-1 font-mono text-[11px] text-[#a8431c]"
        >
          no device key
        </span>
      {/if}
    </div>

    <p
      class="mt-10 font-mono text-[10px] tracking-[0.22em] text-[#1a1815]/45 uppercase"
    >
      Passkeys
    </p>
    <div class="mt-3 flex flex-wrap gap-2">
      {#each graph.passkeys as passkey (passkey.id)}
        {@const chosen = isSelected(NodeKind.Passkey, passkey.id)}
        <button
          type="button"
          aria-pressed={chosen}
          class={`flex items-center gap-2 border px-3 py-2 transition motion-reduce:transition-none ${chosenEdge(chosen)} ${dim(highlight.passkeyIds.includes(passkey.id))}`}
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
          <span
            class={`font-mono text-[10px] tracking-[0.14em] uppercase ${passkey.reach === Reach.Here ? 'text-[#1f5c44]' : 'text-[#a8431c]'}`}
          >
            {passkey.reach === Reach.Here ? 'here' : 'elsewhere'}
          </span>
          <span class="flex items-center gap-1" aria-hidden="true">
            {#each vaultsForPasskey(graph, passkey.id) as vault (vault.id)}
              <span class="h-2.5 w-1.5 rounded-[1px] bg-[#1a1815]/45"></span>
            {/each}
          </span>
          <span class="sr-only">
            {vaultsForPasskey(graph, passkey.id).length} vaults
          </span>
        </button>
      {/each}
    </div>

    <p
      class="mt-12 font-mono text-[10px] tracking-[0.22em] text-[#1a1815]/45 uppercase"
    >
      Vaults · strands are the passkeys that reach them
    </p>

    <ul class="mt-3 space-y-3">
      {#each reads as read (read.vault.id)}
        {@const lit = highlight.vaultIds.includes(read.vault.id)}
        {@const chosen = isSelected(NodeKind.Vault, read.vault.id)}
        <li
          class={`border border-l-2 transition motion-reduce:transition-none ${gradeEdge(read.grade)} ${chosen ? 'border-y-[#1a1815] border-r-[#1a1815]' : 'border-y-[#1a1815]/20 border-r-[#1a1815]/20'} ${dim(lit)} ${
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
                  class={`ml-auto shrink-0 font-mono text-[9px] tracking-[0.14em] uppercase ${openableHere(graph, read.vault) ? 'text-[#1f5c44]' : 'text-[#1a1815]/40'}`}
                >
                  {openableHere(graph, read.vault) ? 'opens here' : 'locked'}
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
                    stroke-width={highlight.passkeyIds.includes(
                      strand.passkeyId,
                    )
                      ? 1.5
                      : 1}
                    class={highlight.passkeyIds.includes(strand.passkeyId)
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
                    class={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 transition motion-reduce:transition-none ${dim(strandLit)}`}
                  >
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
                      aria-label={`Passkey ${strand.shortId} in ${strand.storeName}`}
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
                      {strand.shortId}
                    </button>
                    <span class="shrink-0 text-[11px] text-[#1a1815]/55">
                      {strand.storeName}
                    </span>
                    {#if !strand.here}
                      <span
                        class="shrink-0 font-mono text-[9px] tracking-[0.14em] text-[#a8431c] uppercase"
                      >
                        elsewhere
                      </span>
                    {/if}
                    <span
                      class={`min-w-6 flex-1 border-t ${strand.here ? 'border-[#1a1815]/30' : 'border-dashed border-[#a8431c]/50'}`}
                      aria-hidden="true"
                    ></span>
                    {#each strand.knots as knot (knot.id)}
                      <button
                        type="button"
                        aria-pressed={isSelected(NodeKind.Device, knot.id)}
                        aria-label={`Device key ${knot.shortId}`}
                        class={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[11px] transition motion-reduce:transition-none ${chosenEdge(isSelected(NodeKind.Device, knot.id))}`}
                        onclick={() => pick(NodeKind.Device, knot.id)}
                      >
                        {knot.shortId}
                      </button>
                    {/each}
                    <span
                      class={`w-4 shrink-0 border-t ${strand.here ? 'border-[#1a1815]/30' : 'border-dashed border-[#a8431c]/50'}`}
                      aria-hidden="true"
                    ></span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  </section>
</main>
