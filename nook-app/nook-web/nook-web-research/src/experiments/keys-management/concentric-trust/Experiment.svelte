<!--
DIRECTION: Possession drawn as containment. One onion per vault — the outer
frame is every passkey that encloses it, the frame nested inside is every
device key that opens it, and the core is the vault. Count the rim segments to
count the passkeys; read the identifier off every layer. Selecting anything
dims every onion it does not reach, and dims the layers inside the ones it does.
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
    KeyStore,
    NodeKind,
    type NodeRef,
    openableHere,
    type Passkey,
    passkeysForVault,
    Reach,
    storeLabel,
    type Vault,
    vaultsForDevice,
    vaultsForPasskey,
  } from '../_shared/key-graph'
  import type { ExperimentProps } from '../../index'

  interface Shell {
    vault: Vault
    passkeys: Passkey[]
    devices: Device[]
    openable: boolean
  }

  const STORE_INK: Record<KeyStore, string> = {
    [KeyStore.ApplePasswords]: '#b9c4cf',
    [KeyStore.Bitwarden]: '#5b8cff',
    [KeyStore.OnePassword]: '#37c493',
    [KeyStore.SecurityKey]: '#e6ad48',
  }

  const CAPTION =
    'font-mono text-[9px] tracking-[0.2em] text-[#5c6772] uppercase'
  const STATE =
    'rounded px-1.5 py-0.5 font-mono text-[9px] tracking-[0.14em] uppercase'

  let { navigate }: ExperimentProps = $props()
  let graphId = $state(GraphId.Tangle)
  let selected = $state<NodeRef>(defaultNode(graphById(GraphId.Tangle)))

  const graph = $derived(graphById(graphId))
  const highlight = $derived(highlightFor(graph, selected))
  const shells = $derived<Shell[]>(
    graph.vaults.map((vault) => ({
      vault,
      passkeys: passkeysForVault(graph, vault),
      devices: devicesForVault(graph, vault),
      openable: openableHere(graph, vault),
    })),
  )
  const looseKeys = $derived(
    graph.passkeys.filter(
      (passkey) => vaultsForPasskey(graph, passkey.id).length === 0,
    ),
  )
  const looseDevices = $derived(
    graph.devices.filter(
      (device) => vaultsForDevice(graph, device.id).length === 0,
    ),
  )

  function pick(kind: NodeKind, id: string) {
    selected = { kind, id }
  }

  function chosen(kind: NodeKind, id: string): boolean {
    return selected.kind === kind && selected.id === id
  }

  function railClass(passkey: Passkey): string {
    const base =
      'w-[10.5rem] shrink-0 rounded-xl border p-3 text-left transition duration-200 motion-reduce:transition-none'
    if (chosen(NodeKind.Passkey, passkey.id)) {
      return `${base} border-[#7ce0c0] bg-[#0f1f1b]`
    }
    if (highlight.passkeyIds.includes(passkey.id)) {
      return `${base} border-[#2c3a44] bg-[#0c1015] hover:border-[#4b5c69]`
    }
    return `${base} border-[#171b21] bg-[#080a0d] opacity-30 hover:opacity-60`
  }

  function shellClass(shell: Shell): string {
    const base =
      'rounded-2xl border p-4 transition duration-200 motion-reduce:transition-none'
    if (highlight.vaultIds.includes(shell.vault.id)) {
      return `${base} border-[#2a333d] bg-[#0b0e13]`
    }
    return `${base} border-[#161a20] bg-[#090b0e] opacity-25`
  }

  function tint(hex: string, alpha: number): string {
    const red = Number.parseInt(hex.slice(1, 3), 16)
    const green = Number.parseInt(hex.slice(3, 5), 16)
    const blue = Number.parseInt(hex.slice(5, 7), 16)
    return `rgba(${red},${green},${blue},${alpha})`
  }

  /**
   * The band of colour between the outer frame and the frame inside it. One
   * hard stop per enclosing passkey, so the ring around a shared vault is
   * visibly striped in the colours of the managers that own it.
   */
  function shellTint(shell: Shell): string {
    const count = shell.passkeys.length
    if (count === 0) return 'background-image:none'
    const stops = shell.passkeys.map((passkey, index) => {
      const from = Math.round((index / count) * 100)
      const to = Math.round(((index + 1) / count) * 100)
      return `${tint(STORE_INK[passkey.store], 0.13)} ${from}% ${to}%`
    })
    return `background-image:linear-gradient(115deg, ${stops.join(', ')})`
  }

  /** Layers inside a dimmed onion stay flat; only a lit onion sorts its layers. */
  function layerLit(cardLit: boolean, inSubgraph: boolean): boolean {
    return !cardLit || inSubgraph
  }

  function chipClass(lit: boolean, isChosen: boolean): string {
    const base =
      'flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-left transition duration-200 motion-reduce:transition-none'
    if (isChosen) return `${base} border-[#7ce0c0] bg-[#0f1f1b]`
    if (lit)
      return `${base} border-[#2c3a44] bg-[#0d1117] hover:border-[#4b5c69]`
    return `${base} border-[#191d23] bg-[#0a0c10] opacity-30`
  }

  function coreClass(shell: Shell): string {
    const base =
      'mt-3 block w-full rounded-lg border p-3 text-left transition duration-200 motion-reduce:transition-none'
    const edge = shell.openable ? '' : 'border-dashed'
    if (chosen(NodeKind.Vault, shell.vault.id)) {
      return `${base} ${edge} border-[#7ce0c0] bg-[#0f1f1b]`
    }
    return `${base} ${edge} border-[#2c3a44] bg-[#11161c] hover:border-[#4b5c69]`
  }
</script>

<main class="min-h-[100svh] bg-[#07080b] text-[#e2e7ec]">
  <ExperimentBack {navigate} />
  <GraphSwitch
    {graph}
    onGraph={(next) => {
      graphId = next
      selected = defaultNode(graphById(next))
    }}
  />

  <section class="mx-auto max-w-5xl px-4 pt-28 pb-20 sm:px-8 sm:pt-20">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span class={CAPTION}>Passkey ⊃ device key ⊃ vault</span>
      {#each hereDevices(graph) as device (device.id)}
        <span class="{STATE} bg-[#12261f] text-[#4ad6a8]">
          Here · {device.shortId}
        </span>
      {/each}
      {#if graph.here.kind === HereKind.Unprepared}
        <span class="{STATE} bg-[#261c12] text-[#e0a33b]">
          Here · no device key
        </span>
      {/if}
    </div>

    <div class="mt-6 flex flex-wrap gap-2">
      {#each graph.passkeys as passkey (passkey.id)}
        <button
          type="button"
          aria-pressed={chosen(NodeKind.Passkey, passkey.id)}
          class={railClass(passkey)}
          onclick={() => pick(NodeKind.Passkey, passkey.id)}
        >
          <span class="flex items-center gap-2">
            <span
              class="size-2.5 shrink-0 rounded-full"
              style={`background:${STORE_INK[passkey.store]}`}
              aria-hidden="true"
            ></span>
            <span class="font-mono text-[13px] tracking-wide">
              {passkey.shortId}
            </span>
          </span>
          <span class="mt-1.5 block truncate text-[11px] text-[#98a2ac]">
            {storeLabel(passkey.store)}
          </span>
          <span class="mt-0.5 block truncate text-[11px] text-[#6d7782]">
            {passkey.label}
          </span>
          <span class="mt-2 flex flex-wrap items-center gap-1">
            {#if passkey.reach === Reach.Here}
              <span class="{STATE} bg-[#12261f] text-[#4ad6a8]"
                >Usable here</span
              >
            {:else}
              <span class="{STATE} bg-[#1b1f25] text-[#8b96a1]">Elsewhere</span>
            {/if}
            <span class="{STATE} text-[#5a636d]"
              >×{vaultsForPasskey(graph, passkey.id).length}</span
            >
          </span>
        </button>
      {/each}
    </div>

    <div class="mt-8 grid gap-5 lg:grid-cols-2">
      {#each shells as shell (shell.vault.id)}
        {@const cardLit = highlight.vaultIds.includes(shell.vault.id)}
        <div class={shellClass(shell)} style={shellTint(shell)}>
          <div class="flex h-1 gap-1" aria-hidden="true">
            {#each shell.passkeys as passkey (passkey.id)}
              <span
                class="flex-1 rounded-full"
                style={`background:${STORE_INK[passkey.store]};opacity:${
                  layerLit(cardLit, highlight.passkeyIds.includes(passkey.id))
                    ? 1
                    : 0.25
                }`}
              ></span>
            {:else}
              <span class="flex-1 rounded-full bg-[#2a2f36]"></span>
            {/each}
          </div>

          <p class="mt-3 flex items-center gap-1.5 {CAPTION}">
            <Fingerprint class="size-3 shrink-0" aria-hidden="true" />
            Passkeys ×{shell.passkeys.length}
          </p>
          <div class="mt-2 flex flex-wrap gap-1.5">
            {#each shell.passkeys as passkey (passkey.id)}
              <button
                type="button"
                aria-pressed={chosen(NodeKind.Passkey, passkey.id)}
                class={chipClass(
                  layerLit(cardLit, highlight.passkeyIds.includes(passkey.id)),
                  chosen(NodeKind.Passkey, passkey.id),
                )}
                onclick={() => pick(NodeKind.Passkey, passkey.id)}
              >
                <span
                  class="size-2 shrink-0 rounded-full"
                  style={`background:${STORE_INK[passkey.store]}`}
                  aria-hidden="true"
                ></span>
                <span class="font-mono text-[12px]">{passkey.shortId}</span>
                <span class="truncate text-[10px] text-[#8b96a1]">
                  {storeLabel(passkey.store)}
                </span>
                {#if passkey.reach === Reach.Elsewhere}
                  <span class="shrink-0 {STATE} text-[#6d7782]">Elsewhere</span>
                {/if}
              </button>
            {:else}
              <span
                class="rounded-md border border-dashed border-[#2b2118] px-2 py-1.5 font-mono text-[10px] tracking-[0.14em] text-[#e0a33b] uppercase"
              >
                No passkey
              </span>
            {/each}
          </div>

          <div class="mt-3 rounded-xl border border-[#1e252d] bg-[#070a0e] p-3">
            <p class="flex items-center gap-1.5 {CAPTION}">
              <Laptop class="size-3 shrink-0" aria-hidden="true" />
              Device keys ×{shell.devices.length}
            </p>
            <div class="mt-2 flex flex-wrap gap-1.5">
              {#each shell.devices as device (device.id)}
                <button
                  type="button"
                  aria-pressed={chosen(NodeKind.Device, device.id)}
                  class={chipClass(
                    layerLit(cardLit, highlight.deviceIds.includes(device.id)),
                    chosen(NodeKind.Device, device.id),
                  )}
                  onclick={() => pick(NodeKind.Device, device.id)}
                >
                  <Laptop class="size-3 shrink-0" aria-hidden="true" />
                  <span class="font-mono text-[12px]">{device.shortId}</span>
                  <span class="truncate text-[10px] text-[#8b96a1]">
                    {device.label}
                  </span>
                  {#if isHere(graph, device)}
                    <span class="shrink-0 {STATE} text-[#4ad6a8]">Here</span>
                  {/if}
                </button>
              {:else}
                <span
                  class="rounded-md border border-dashed border-[#2b2118] px-2 py-1.5 font-mono text-[10px] tracking-[0.14em] text-[#e0a33b] uppercase"
                >
                  No device key
                </span>
              {/each}
            </div>

            <button
              type="button"
              aria-pressed={chosen(NodeKind.Vault, shell.vault.id)}
              class={coreClass(shell)}
              onclick={() => pick(NodeKind.Vault, shell.vault.id)}
            >
              <span class="flex items-center gap-1.5 {CAPTION}">
                <VaultIcon class="size-3 shrink-0" aria-hidden="true" />
                Vault
              </span>
              <span
                class="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1"
              >
                <span
                  class="font-mono text-[20px] tracking-tight text-[#7ce0c0]"
                >
                  {shell.vault.shortId}
                </span>
                <span class="truncate text-[13px] text-[#c6cdd4]">
                  {shell.vault.label}
                </span>
              </span>
              <span class="mt-2 flex flex-wrap items-center gap-1.5">
                <span class="{STATE} bg-[#151a20] text-[#8b96a1]">
                  {shell.vault.secrets} secrets
                </span>
                {#if shell.openable}
                  <span class="{STATE} bg-[#12261f] text-[#4ad6a8]">
                    Opens here
                  </span>
                {:else}
                  <span class="{STATE} bg-[#261c12] text-[#e0a33b]">
                    Not from here
                  </span>
                {/if}
              </span>
            </button>
          </div>
        </div>
      {/each}
    </div>

    {#if looseKeys.length + looseDevices.length > 0}
      <div class="mt-6 rounded-xl border border-dashed border-[#242a32] p-3">
        <p class={CAPTION}>Encloses nothing</p>
        <div class="mt-2 flex flex-wrap gap-1.5">
          {#each looseKeys as passkey (passkey.id)}
            <button
              type="button"
              aria-pressed={chosen(NodeKind.Passkey, passkey.id)}
              class={chipClass(true, chosen(NodeKind.Passkey, passkey.id))}
              onclick={() => pick(NodeKind.Passkey, passkey.id)}
            >
              <Fingerprint class="size-3 shrink-0" aria-hidden="true" />
              <span class="font-mono text-[12px]">{passkey.shortId}</span>
            </button>
          {/each}
          {#each looseDevices as device (device.id)}
            <button
              type="button"
              aria-pressed={chosen(NodeKind.Device, device.id)}
              class={chipClass(true, chosen(NodeKind.Device, device.id))}
              onclick={() => pick(NodeKind.Device, device.id)}
            >
              <Laptop class="size-3 shrink-0" aria-hidden="true" />
              <span class="font-mono text-[12px]">{device.shortId}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </section>
</main>
