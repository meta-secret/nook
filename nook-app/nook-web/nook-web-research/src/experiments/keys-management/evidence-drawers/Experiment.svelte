<!--
DIRECTION: A cabinet, read top to bottom. My device key is not a drawer at all —
it is the bolted-on compartment above the cabinet, always open, the only part
with handles you may turn. Below it two banks of engraved drawers: vaults, then
passkeys. Pull one and the drawers it reaches slide out with it while the rest
recede. No wiring is drawn. Other devices are a flat strip at the foot: they
exist, and that is all this browser can say about them.
-->
<script lang="ts">
  import { Fingerprint, Laptop, Vault as VaultIcon } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import GraphSwitch from '../_shared/GraphSwitch.svelte'
  import {
    GraphId,
    graphById,
    HereKind,
    hereDevices,
    isHere,
    type KeyGraph,
    KeyStore,
    NodeKind,
    openableHere,
    type Passkey,
    passkeysForDevice,
    passkeysForVault,
    Reach,
    storeLabel,
    type Vault,
    vaultsForDevice,
    vaultsForPasskey,
  } from '../_shared/key-graph'
  import type { ExperimentProps } from '../../index'
  import { DrawerState, type Pull, PullKind } from './drawer-state'

  /** One passkey read against one vault: can it be used from here, or not. */
  interface Strand {
    key: string
    passkeyId: string
    shortId: string
    store: KeyStore
    storeName: string
    here: boolean
    route: string
  }

  /** One vault read against one passkey. Same question, other direction. */
  interface VaultReach {
    key: string
    vaultId: string
    shortId: string
    label: string
    here: boolean
    route: string
  }

  const FACE =
    'bg-[linear-gradient(180deg,#333a42_0%,#272c33_55%,#1e2228_100%)]'
  const AWAY =
    'bg-[repeating-linear-gradient(135deg,#2b3037_0_5px,#23282e_5px_10px)]'
  const RIB =
    'bg-[repeating-linear-gradient(90deg,#d9a441_0_1px,#3b3018_1px_3px)]'
  const PLATE = 'bg-[#262c33]'

  const STORE_INK: Record<KeyStore, string> = {
    [KeyStore.ApplePasswords]: '#9aa3ad',
    [KeyStore.Bitwarden]: '#5b86f2',
    [KeyStore.OnePassword]: '#3fae86',
    [KeyStore.SecurityKey]: '#d9a441',
  }

  let { navigate }: ExperimentProps = $props()
  let graphId = $state(GraphId.Tangle)
  let pull = $state<Pull>(firstPull(graphById(GraphId.Tangle)))

  const graph = $derived(graphById(graphId))
  const mine = $derived(hereDevices(graph))
  const others = $derived(
    graph.devices.filter((device) => !isHere(graph, device)),
  )

  function firstPull(graph: KeyGraph): Pull {
    const [vault] = graph.vaults
    if (vault) {
      return {
        kind: PullKind.Open,
        node: { kind: NodeKind.Vault, id: vault.id },
      }
    }
    const [passkey] = graph.passkeys
    if (passkey) {
      return {
        kind: PullKind.Open,
        node: { kind: NodeKind.Passkey, id: passkey.id },
      }
    }
    return { kind: PullKind.Shut }
  }

  function isPulled(kind: NodeKind, id: string): boolean {
    return (
      pull.kind === PullKind.Open &&
      pull.node.kind === kind &&
      pull.node.id === id
    )
  }

  /** The drawer face that owns a node, so focus can follow the cabinet. */
  function faceId(kind: NodeKind, id: string): string {
    return `face-${kind}-${id}`
  }

  function toggle(kind: NodeKind, id: string) {
    const shutting = isPulled(kind, id)
    pull = shutting
      ? { kind: PullKind.Shut }
      : { kind: PullKind.Open, node: { kind, id } }
    if (shutting) return
    // Pulling from inside another drawer hides the button that was clicked.
    requestAnimationFrame(() => {
      const face = document.getElementById(faceId(kind, id))
      if (face instanceof HTMLElement) face.focus()
    })
  }

  function linked(kind: NodeKind, id: string): boolean {
    if (pull.kind === PullKind.Shut) return false
    const node = pull.node
    if (node.kind === NodeKind.Vault && kind === NodeKind.Passkey) {
      return graph.vaults
        .filter((vault) => vault.id === node.id)
        .some((vault) =>
          passkeysForVault(graph, vault).some((passkey) => passkey.id === id),
        )
    }
    if (node.kind === NodeKind.Passkey && kind === NodeKind.Vault) {
      return vaultsForPasskey(graph, node.id).some((vault) => vault.id === id)
    }
    return false
  }

  function stateOf(kind: NodeKind, id: string): DrawerState {
    if (pull.kind === PullKind.Shut) return DrawerState.Rest
    if (isPulled(kind, id)) return DrawerState.Open
    return linked(kind, id) ? DrawerState.Lit : DrawerState.Dim
  }

  function isOpen(state: DrawerState): boolean {
    return state === DrawerState.Open
  }

  function slide(state: DrawerState): string {
    if (state === DrawerState.Open) return 'translate-x-2 sm:translate-x-3'
    if (state === DrawerState.Lit) return 'translate-x-1 sm:translate-x-1.5'
    return 'translate-x-0'
  }

  function fade(state: DrawerState): string {
    return state === DrawerState.Dim ? 'opacity-60 grayscale' : 'opacity-100'
  }

  function edge(state: DrawerState): string {
    if (state === DrawerState.Open) {
      return 'border-[#d9a441] shadow-[0_14px_30px_rgb(0_0_0/0.6)]'
    }
    if (state === DrawerState.Lit) {
      return 'border-[#8a6c2c] shadow-[0_6px_14px_rgb(0_0_0/0.4)]'
    }
    return 'border-[#333b44]'
  }

  /** Whether this passkey can open this vault from the browser you are in. */
  function routeHere(
    graph: KeyGraph,
    passkeyId: string,
    vault: Vault,
  ): boolean {
    return hereDevices(graph).some(
      (device) =>
        vault.deviceIds.includes(device.id) &&
        device.passkeyIds.includes(passkeyId),
    )
  }

  /** `here`, or the identifiers of the other devices the route needs. */
  function routeWord(graph: KeyGraph, passkeyId: string, vault: Vault): string {
    if (routeHere(graph, passkeyId, vault)) return 'here'
    const via = graph.devices
      .filter(
        (device) =>
          vault.deviceIds.includes(device.id) &&
          device.passkeyIds.includes(passkeyId),
      )
      .map((device) => device.shortId)
    return via.length > 0 ? `via ${via.join(' ')}` : 'no route'
  }

  function strandsFor(graph: KeyGraph, vault: Vault): Strand[] {
    return passkeysForVault(graph, vault).map((passkey) => ({
      key: `${vault.id}-${passkey.id}`,
      passkeyId: passkey.id,
      shortId: passkey.shortId,
      store: passkey.store,
      storeName: storeLabel(passkey.store),
      here: routeHere(graph, passkey.id, vault),
      route: routeWord(graph, passkey.id, vault),
    }))
  }

  function reachesFor(graph: KeyGraph, passkey: Passkey): VaultReach[] {
    return vaultsForPasskey(graph, passkey.id).map((vault) => ({
      key: `${passkey.id}-${vault.id}`,
      vaultId: vault.id,
      shortId: vault.shortId,
      label: vault.label,
      here: routeHere(graph, passkey.id, vault),
      route: routeWord(graph, passkey.id, vault),
    }))
  }

  function pips(graph: KeyGraph, vault: Vault): boolean[] {
    const count = passkeysForVault(graph, vault).length
    return graph.passkeys.map((_passkey, index) => index < count)
  }

  function routeInk(here: boolean): string {
    return here ? 'text-[#d9a441]' : 'text-[#7d8791]'
  }
</script>

<main class="min-h-[100svh] bg-[#0b0d10] text-[#dfe4ea]">
  <ExperimentBack {navigate} />
  <GraphSwitch
    {graph}
    onGraph={(next) => {
      graphId = next
      pull = firstPull(graphById(next))
    }}
  />

  <section class="mx-auto max-w-2xl px-4 pt-28 pb-16 sm:px-6 sm:pt-24">
    <p class="font-mono text-[10px] tracking-[0.26em] text-[#d9a441] uppercase">
      My device
    </p>

    {#each mine as device (device.id)}
      <div
        class="mt-2 rounded-md border-2 border-[#d9a441] bg-[linear-gradient(180deg,#251f13_0%,#17150f_100%)] p-4 shadow-[0_20px_46px_rgb(0_0_0/0.55)]"
      >
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Laptop class="size-4 shrink-0 text-[#d9a441]" aria-hidden="true" />
          <span
            class="font-mono text-2xl tracking-[0.1em] text-[#f7e8c4] sm:text-3xl"
          >
            {device.shortId}
          </span>
          <span class="text-[13px] text-[#c3ccd5]">{device.label}</span>
          <span class="font-mono text-[11px] text-[#8b949e]">
            {device.platform}
          </span>
        </div>

        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p
              class="font-mono text-[10px] tracking-[0.2em] text-[#8a7c5c] uppercase"
            >
              Unlocked by
            </p>
            <div class="mt-1.5 flex flex-wrap gap-1.5">
              {#each passkeysForDevice(graph, device) as passkey (passkey.id)}
                <button
                  type="button"
                  aria-pressed={isPulled(NodeKind.Passkey, passkey.id)}
                  aria-controls={`drawer-passkey-${passkey.id}`}
                  aria-label={`Passkey ${passkey.shortId}, ${storeLabel(passkey.store)}`}
                  class="flex items-center gap-1.5 rounded border border-[#6b5730] bg-[#221d13] px-2 py-1 transition hover:border-[#d9a441] motion-reduce:transition-none"
                  onclick={() => toggle(NodeKind.Passkey, passkey.id)}
                >
                  <span
                    class="size-1.5 shrink-0 rounded-full"
                    style={`background:${STORE_INK[passkey.store]}`}
                    aria-hidden="true"
                  ></span>
                  <span class="font-mono text-[13px] text-[#f2e2bd]">
                    {passkey.shortId}
                  </span>
                  <span class="text-[10px] text-[#a29277]">
                    {storeLabel(passkey.store)}
                  </span>
                </button>
              {/each}
            </div>
          </div>

          <div>
            <p
              class="font-mono text-[10px] tracking-[0.2em] text-[#8a7c5c] uppercase"
            >
              Opens
            </p>
            <div class="mt-1.5 flex flex-wrap gap-1.5">
              {#each vaultsForDevice(graph, device.id) as vault (vault.id)}
                <button
                  type="button"
                  aria-pressed={isPulled(NodeKind.Vault, vault.id)}
                  aria-controls={`drawer-vault-${vault.id}`}
                  aria-label={`Vault ${vault.shortId}, ${vault.label}`}
                  class="flex items-center gap-1.5 rounded border border-[#6b5730] bg-[#221d13] px-2 py-1 transition hover:border-[#d9a441] motion-reduce:transition-none"
                  onclick={() => toggle(NodeKind.Vault, vault.id)}
                >
                  <span class="font-mono text-[13px] text-[#f2e2bd]">
                    {vault.shortId}
                  </span>
                  <span class="text-[10px] text-[#a29277]">{vault.label}</span>
                </button>
              {/each}
            </div>
          </div>
        </div>

        <div class="mt-4 flex flex-wrap gap-1.5 border-t border-[#3a3120] pt-3">
          {#each ['Rename', 'Enrol passkey', 'Revoke'] as action (action)}
            <button
              type="button"
              class="rounded border border-[#4d422b] px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-[#c9b68a] uppercase transition hover:border-[#d9a441] hover:text-[#f2e2bd] motion-reduce:transition-none"
            >
              {action}
            </button>
          {/each}
        </div>
      </div>
    {/each}

    {#if graph.here.kind === HereKind.Unprepared}
      <div
        class="mt-2 rounded-md border-2 border-dashed border-[#4a525b] bg-[repeating-linear-gradient(135deg,#15181c_0_6px,#101316_6px_12px)] p-4"
      >
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Laptop class="size-4 shrink-0 text-[#6d7680]" aria-hidden="true" />
          <span class="font-mono text-2xl tracking-[0.1em] text-[#6d7680]">
            ······
          </span>
          <span
            class="font-mono text-[11px] tracking-[0.16em] text-[#8b949e] uppercase"
          >
            no device key
          </span>
        </div>
        <div class="mt-4 border-t border-[#2a3038] pt-3">
          <button
            type="button"
            class="rounded border border-[#4d422b] px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-[#d9a441] uppercase"
          >
            Create device key
          </button>
        </div>
      </div>
    {/if}

    <div
      class="mt-8 rounded-md border border-[#2a3038] bg-[linear-gradient(180deg,#1b1f24_0%,#141719_100%)] p-3 shadow-[0_24px_60px_rgb(0_0_0/0.5)] sm:p-4"
    >
      <p
        class="font-mono text-[10px] tracking-[0.24em] text-[#6d7680] uppercase"
      >
        Vaults
      </p>
      <ul class="mt-2 space-y-1.5">
        {#each graph.vaults as vault (vault.id)}
          {@const state = stateOf(NodeKind.Vault, vault.id)}
          {@const open = isOpen(state)}
          {@const here = openableHere(graph, vault)}
          <li
            class={`transition duration-300 motion-reduce:transition-none ${slide(state)} ${fade(state)}`}
          >
            <button
              type="button"
              id={faceId(NodeKind.Vault, vault.id)}
              aria-expanded={open}
              aria-controls={`drawer-vault-${vault.id}`}
              class={`flex w-full flex-col gap-1 rounded-sm border px-3 py-2 text-left ${FACE} ${edge(state)}`}
              onclick={() => toggle(NodeKind.Vault, vault.id)}
            >
              <span class="flex w-full items-center gap-2">
                <VaultIcon
                  class="size-3.5 shrink-0 text-[#7d8791]"
                  aria-hidden="true"
                />
                <span
                  class="font-mono text-[16px] tracking-[0.08em] text-[#f2e2bd]"
                >
                  {vault.shortId}
                </span>
                <span
                  class={`ml-auto shrink-0 font-mono text-[9px] tracking-[0.14em] uppercase ${here ? 'text-[#d9a441]' : 'text-[#6d7680]'}`}
                >
                  {here ? 'opens here' : 'locked here'}
                </span>
                <span
                  class={`h-4 w-6 shrink-0 rounded-[2px] ${open || state === DrawerState.Lit ? RIB : PLATE}`}
                  aria-hidden="true"
                ></span>
              </span>
              <span class="flex w-full items-center gap-2">
                <span class="min-w-0 truncate text-[12px] text-[#9aa4ae]">
                  {vault.label}
                </span>
                <span
                  class="ml-auto flex shrink-0 items-center gap-1"
                  aria-hidden="true"
                >
                  {#each pips(graph, vault) as filled, index (index)}
                    <span
                      class={`size-1.5 rounded-full ${filled ? 'bg-[#d9a441]' : 'border border-[#4a525b]'}`}
                    ></span>
                  {/each}
                </span>
                <span class="sr-only">
                  {passkeysForVault(graph, vault).length} passkeys
                </span>
              </span>
            </button>

            <div id={`drawer-vault-${vault.id}`} hidden={!open}>
              <div
                class="rounded-b-sm border-x border-b border-[#8a6c2c] bg-[#191d22] px-3 pt-2 pb-3"
              >
                <p
                  class="font-mono text-[10px] tracking-[0.2em] text-[#6d7680] uppercase"
                >
                  Opened by
                </p>
                <div class="mt-1.5 flex flex-col gap-1">
                  {#each strandsFor(graph, vault) as strand (strand.key)}
                    <button
                      type="button"
                      aria-controls={`drawer-passkey-${strand.passkeyId}`}
                      aria-label={`Passkey ${strand.shortId}, ${strand.storeName}`}
                      class="flex w-full items-center gap-2 rounded border border-[#3d454e] bg-[#22272c] px-2 py-1.5 text-left transition hover:border-[#d9a441] motion-reduce:transition-none"
                      onclick={() => toggle(NodeKind.Passkey, strand.passkeyId)}
                    >
                      <span
                        class="size-2 shrink-0 rounded-full"
                        style={`background:${STORE_INK[strand.store]}`}
                        aria-hidden="true"
                      ></span>
                      <span
                        class="font-mono text-[14px] tracking-[0.06em] text-[#f2e2bd]"
                      >
                        {strand.shortId}
                      </span>
                      <span class="min-w-0 truncate text-[11px] text-[#9aa4ae]">
                        {strand.storeName}
                      </span>
                      <span
                        class={`ml-auto shrink-0 font-mono text-[10px] tracking-[0.1em] uppercase ${routeInk(strand.here)}`}
                      >
                        {strand.route}
                      </span>
                    </button>
                  {/each}
                  {#if passkeysForVault(graph, vault).length === 0}
                    <span
                      class="rounded border border-dashed border-[#7a3a24] px-2 py-1.5 font-mono text-[11px] tracking-[0.14em] text-[#c56a45] uppercase"
                    >
                      no passkey
                    </span>
                  {/if}
                </div>
              </div>
            </div>
          </li>
        {/each}
      </ul>

      <p
        class="mt-6 font-mono text-[10px] tracking-[0.24em] text-[#6d7680] uppercase"
      >
        Passkeys
      </p>
      <ul class="mt-2 space-y-1.5">
        {#each graph.passkeys as passkey (passkey.id)}
          {@const state = stateOf(NodeKind.Passkey, passkey.id)}
          {@const open = isOpen(state)}
          {@const away = passkey.reach === Reach.Elsewhere}
          <li
            class={`transition duration-300 motion-reduce:transition-none ${slide(state)} ${fade(state)}`}
          >
            <button
              type="button"
              id={faceId(NodeKind.Passkey, passkey.id)}
              aria-expanded={open}
              aria-controls={`drawer-passkey-${passkey.id}`}
              class={`flex w-full flex-col gap-1 rounded-sm border px-3 py-2 text-left ${away ? AWAY : FACE} ${edge(state)}`}
              onclick={() => toggle(NodeKind.Passkey, passkey.id)}
            >
              <span class="flex w-full items-center gap-2">
                <Fingerprint
                  class="size-3.5 shrink-0 text-[#7d8791]"
                  aria-hidden="true"
                />
                <span
                  class={`font-mono text-[16px] tracking-[0.08em] ${away ? 'text-[#a7b0ba]' : 'text-[#f2e2bd]'}`}
                >
                  {passkey.shortId}
                </span>
                <span
                  class={`ml-auto shrink-0 font-mono text-[9px] tracking-[0.14em] uppercase ${away ? 'text-[#6d7680]' : 'text-[#d9a441]'}`}
                >
                  {away ? 'elsewhere' : 'here'}
                </span>
                <span
                  class={`h-4 w-6 shrink-0 rounded-[2px] ${away ? PLATE : open || state === DrawerState.Lit ? RIB : PLATE}`}
                  aria-hidden="true"
                ></span>
              </span>
              <span class="flex w-full items-center gap-2">
                <span
                  class="size-1.5 shrink-0 rounded-full"
                  style={`background:${STORE_INK[passkey.store]}`}
                  aria-hidden="true"
                ></span>
                <span class="min-w-0 truncate text-[12px] text-[#9aa4ae]">
                  {storeLabel(passkey.store)}
                </span>
                <span
                  class="ml-auto shrink-0 font-mono text-[10px] text-[#6d7680]"
                >
                  {vaultsForPasskey(graph, passkey.id).length}
                </span>
              </span>
            </button>

            <div id={`drawer-passkey-${passkey.id}`} hidden={!open}>
              <div
                class="rounded-b-sm border-x border-b border-[#8a6c2c] bg-[#191d22] px-3 pt-2 pb-3"
              >
                <p
                  class="font-mono text-[10px] tracking-[0.2em] text-[#6d7680] uppercase"
                >
                  Opens
                </p>
                <div class="mt-1.5 flex flex-col gap-1">
                  {#each reachesFor(graph, passkey) as reach (reach.key)}
                    <button
                      type="button"
                      aria-controls={`drawer-vault-${reach.vaultId}`}
                      aria-label={`Vault ${reach.shortId}, ${reach.label}`}
                      class="flex w-full items-center gap-2 rounded border border-[#3d454e] bg-[#22272c] px-2 py-1.5 text-left transition hover:border-[#d9a441] motion-reduce:transition-none"
                      onclick={() => toggle(NodeKind.Vault, reach.vaultId)}
                    >
                      <VaultIcon
                        class="size-3 shrink-0 text-[#7d8791]"
                        aria-hidden="true"
                      />
                      <span
                        class="font-mono text-[14px] tracking-[0.06em] text-[#f2e2bd]"
                      >
                        {reach.shortId}
                      </span>
                      <span class="min-w-0 truncate text-[11px] text-[#9aa4ae]">
                        {reach.label}
                      </span>
                      <span
                        class={`ml-auto shrink-0 font-mono text-[10px] tracking-[0.1em] uppercase ${routeInk(reach.here)}`}
                      >
                        {reach.route}
                      </span>
                    </button>
                  {/each}
                  {#if vaultsForPasskey(graph, passkey.id).length === 0}
                    <span
                      class="rounded border border-dashed border-[#4a525b] px-2 py-1.5 font-mono text-[11px] tracking-[0.14em] text-[#8b949e] uppercase"
                    >
                      no vault
                    </span>
                  {/if}
                </div>
              </div>
            </div>
          </li>
        {/each}
      </ul>
    </div>

    {#if others.length > 0}
      <p
        class="mt-8 font-mono text-[10px] tracking-[0.24em] text-[#5f6871] uppercase"
      >
        Other devices
      </p>
      <ul class="mt-2 border-l border-dashed border-[#333b44] pl-3">
        {#each others as device (device.id)}
          <li class="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5">
            <span class="font-mono text-[13px] text-[#98a1ab]">
              {device.shortId}
            </span>
            <span class="text-[12px] text-[#7d8791]">{device.label}</span>
            <span class="font-mono text-[10px] text-[#5f6871]">
              {device.platform}
            </span>
            <span class="ml-auto flex shrink-0 flex-wrap gap-1.5">
              {#each vaultsForDevice(graph, device.id) as vault (vault.id)}
                <span class="font-mono text-[11px] text-[#6d7680]">
                  {vault.shortId}
                </span>
              {/each}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</main>
