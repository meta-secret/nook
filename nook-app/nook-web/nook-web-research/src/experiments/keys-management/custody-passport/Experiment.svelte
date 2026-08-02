<!--
DIRECTION: One travel document per passkey. The visa pages are the
relationships: an admitted stamp for every vault that passkey opens, carrying
the vault identifier and the device key it travelled through, and a refusal for
every border it cannot cross. The register at the foot shows, per vault, which
passports carry a stamp for it — so two passports on one vault is visible.
-->
<script lang="ts">
  import { Fingerprint, Stamp, Vault as VaultIcon } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import GraphSwitch from '../_shared/GraphSwitch.svelte'
  import {
    defaultNode,
    type Device,
    devicesForPasskey,
    devicesForVault,
    GraphId,
    graphById,
    hereDevices,
    highlightFor,
    isHere,
    type KeyGraph,
    KeyStore,
    NodeKind,
    opens,
    type Passkey,
    passkeysForDevice,
    passkeysForVault,
    openableHere,
    Reach,
    storeLabel,
    type Vault,
    vaultsForPasskey,
  } from '../_shared/key-graph'
  import type { ExperimentProps } from '../../index'

  interface SigilCell {
    id: string
    filled: boolean
  }

  interface DataField {
    label: string
    value: string
    mono: boolean
  }

  interface MrzLine {
    id: string
    text: string
  }

  const SIGIL_SIDE = 6
  const MRZ_WIDTH = 40

  const STORE_INK: Record<KeyStore, string> = {
    [KeyStore.ApplePasswords]: '#5c4a34',
    [KeyStore.Bitwarden]: '#2f4c8c',
    [KeyStore.OnePassword]: '#1f6b52',
    [KeyStore.SecurityKey]: '#8a5a12',
  }

  const TILTS = ['-rotate-2', 'rotate-1', 'rotate-2', '-rotate-1']

  let { navigate }: ExperimentProps = $props()
  let graphId = $state(GraphId.Tangle)
  let openId = $state(openingPasskeyId(graphById(GraphId.Tangle)))

  const graph = $derived(graphById(graphId))
  const highlight = $derived(
    highlightFor(graph, { kind: NodeKind.Passkey, id: openId }),
  )
  const open = $derived(
    graph.passkeys.filter((passkey) => passkey.id === openId),
  )
  const here = $derived(hereDevices(graph))

  /** The passport you would be holding: the one this browser could present. */
  function openingPasskeyId(graph: KeyGraph): string {
    const node = defaultNode(graph)
    if (node.kind === NodeKind.Passkey) return node.id
    const [onDevice] = graph.devices
      .filter((device) => device.id === node.id)
      .flatMap((device) => passkeysForDevice(graph, device))
    if (onDevice) return onDevice.id
    const [first] = graph.passkeys
    return first ? first.id : ''
  }

  function via(vault: Vault, passkeyId: string): Device[] {
    return devicesForVault(graph, vault).filter((device) =>
      device.passkeyIds.includes(passkeyId),
    )
  }

  function shortIds(items: readonly { shortId: string }[]): string {
    return items.length === 0
      ? 'none'
      : items.map((item) => item.shortId).join(' · ')
  }

  function dataFields(passkey: Passkey): DataField[] {
    return [
      { label: 'Issued', value: passkey.createdAt, mono: false },
      { label: 'Last presented', value: passkey.lastUsedAt, mono: false },
      {
        label: 'Visas',
        value: `${vaultsForPasskey(graph, passkey.id).length}/${graph.vaults.length}`,
        mono: true,
      },
      {
        label: 'Carried',
        value: passkey.reach === Reach.Here ? 'In hand' : 'Elsewhere',
        mono: false,
      },
    ]
  }

  /** A deterministic mark drawn from the identifier, mirrored down the middle. */
  function sigilCells(seed: string): SigilCell[] {
    const cells: SigilCell[] = []
    const span = Math.max(seed.length, 1)
    for (let row = 0; row < SIGIL_SIDE; row += 1) {
      for (let col = 0; col < SIGIL_SIDE; col += 1) {
        const mirrored = col < SIGIL_SIDE / 2 ? col : SIGIL_SIDE - 1 - col
        const code = seed.charCodeAt((row * 3 + mirrored) % span)
        cells.push({
          id: `${row}-${col}`,
          filled: (code + row * 5 + mirrored * 3) % 3 !== 0,
        })
      }
    }
    return cells
  }

  function mrzField(value: string): string {
    const clean = value.toUpperCase().replace(/[^A-Z0-9]+/g, '<')
    return clean.slice(0, MRZ_WIDTH).padEnd(MRZ_WIDTH, '<')
  }

  function mrzList(items: readonly { shortId: string }[]): string {
    return items.length === 0
      ? 'NONE'
      : items.map((item) => item.shortId).join('<')
  }

  function mrzLines(passkey: Passkey): MrzLine[] {
    const reach = passkey.reach === Reach.Here ? 'HERE' : 'AWAY'
    return [
      {
        id: 'passkey',
        text: mrzField(
          `PK<${passkey.shortId}<${reach}<${storeLabel(passkey.store)}`,
        ),
      },
      {
        id: 'devices',
        text: mrzField(`DK<${mrzList(devicesForPasskey(graph, passkey.id))}`),
      },
      {
        id: 'vaults',
        text: mrzField(`VA<${mrzList(vaultsForPasskey(graph, passkey.id))}`),
      },
    ]
  }

  function tilt(index: number): string {
    const angle = TILTS[index % TILTS.length]
    return angle ? angle : 'rotate-0'
  }
</script>

<main class="min-h-[100svh] bg-[#cdc1a8] text-[#2c231a]">
  <ExperimentBack {navigate} light />
  <GraphSwitch
    {graph}
    light
    onGraph={(next) => {
      graphId = next
      openId = openingPasskeyId(graphById(next))
    }}
  />

  <section class="mx-auto max-w-4xl px-4 pt-28 pb-16 sm:px-8 sm:pt-24">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p
        class="font-mono text-[10px] tracking-[0.3em] text-[#5c4a34] uppercase"
      >
        Nook · custody
      </p>
      <p
        class="flex items-center gap-2 rounded-full border border-[#2c231a]/25 px-3 py-1 font-mono text-[10px] tracking-[0.16em] uppercase"
      >
        <span class="text-[#5c4a34]">This browser</span>
        {#each here as device (device.id)}
          <span class="tracking-[0.1em]">{device.shortId}</span>
        {/each}
        {#if here.length === 0}
          <span class="text-[#8c3b2e]">No device key</span>
        {/if}
      </p>
    </div>

    <div class="mt-5 -mx-4 overflow-x-auto px-4 pb-2 sm:-mx-8 sm:px-8">
      <ul class="flex w-max min-w-full gap-3">
        {#each graph.passkeys as passkey (passkey.id)}
          {@const chosen = passkey.id === openId}
          {@const visas = vaultsForPasskey(graph, passkey.id)}
          <li class="shrink-0">
            <button
              type="button"
              aria-pressed={chosen}
              class={`relative w-[10.5rem] overflow-hidden rounded-sm border px-3 py-3 text-left transition motion-reduce:transition-none ${
                chosen
                  ? 'border-[#2c231a] bg-[#efe6d2] shadow-[0_10px_24px_rgb(44_35_26/0.28)]'
                  : 'border-[#2c231a]/25 bg-[#e0d7c1] opacity-30 hover:opacity-100 focus-visible:opacity-100'
              }`}
              onclick={() => (openId = passkey.id)}
            >
              <span
                class="absolute inset-y-0 left-0 w-1"
                style={`background:${STORE_INK[passkey.store]}`}
                aria-hidden="true"
              ></span>
              <span class="block pl-2">
                <span
                  class="block truncate font-mono text-[9px] tracking-[0.16em] text-[#5c4a34] uppercase"
                >
                  {storeLabel(passkey.store)}
                </span>
                <span class="mt-1 block font-mono text-lg tracking-[0.12em]">
                  {passkey.shortId}
                </span>
                <span class="mt-0.5 block truncate text-[11px] text-[#5c4a34]">
                  {passkey.label}
                </span>
                <span class="mt-2 flex items-center gap-2">
                  <span
                    class={`font-mono text-[9px] tracking-[0.14em] uppercase ${
                      passkey.reach === Reach.Here
                        ? 'text-[#1f6b52]'
                        : 'text-[#8c3b2e]'
                    }`}
                  >
                    {passkey.reach === Reach.Here ? 'In hand' : 'Not here'}
                  </span>
                  <span class="ml-auto flex gap-[3px]" aria-hidden="true">
                    {#each graph.vaults as vault (vault.id)}
                      <span
                        class={`size-1.5 rounded-[1px] ${
                          opens(graph, passkey.id, vault)
                            ? 'bg-[#8c3b2e]'
                            : 'bg-[#2c231a]/20'
                        }`}
                      ></span>
                    {/each}
                  </span>
                  <span class="sr-only">
                    {visas.length} of {graph.vaults.length} vaults stamped
                  </span>
                </span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
    </div>

    {#each open as passkey (passkey.id)}
      {@const carried = passkey.reach === Reach.Here}
      {@const admitted = vaultsForPasskey(graph, passkey.id)}
      {@const refused = graph.vaults.filter(
        (vault) => !opens(graph, passkey.id, vault),
      )}
      {@const keys = devicesForPasskey(graph, passkey.id)}
      <article
        class={`mt-4 rounded-sm border shadow-[0_24px_60px_rgb(44_35_26/0.35)] ${
          carried
            ? 'border-[#2c231a]/25 bg-[#efe6d2]'
            : 'border-dashed border-[#2c231a]/40 bg-[#e3dbc8]'
        }`}
      >
        <header
          class="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-[#2c231a]/15 px-5 py-4 sm:px-7"
        >
          <p class="font-mono text-[10px] tracking-[0.26em] uppercase">
            Custody passport
          </p>
          <p
            class="flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] uppercase"
          >
            <span class="text-[#5c4a34]">Authority</span>
            <span>{storeLabel(passkey.store)}</span>
          </p>
          <p
            class={`ml-auto -rotate-3 border-2 px-2.5 py-1 font-mono text-[10px] tracking-[0.18em] uppercase ${
              carried
                ? 'border-[#1f6b52]/70 text-[#1f6b52]'
                : 'border-[#8c3b2e]/70 text-[#8c3b2e]'
            }`}
          >
            {carried ? 'In hand' : 'Not on this computer'}
          </p>
        </header>

        <div
          class="grid gap-7 px-5 py-6 sm:px-7 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]"
        >
          <div class="min-w-0">
            <div class="flex gap-4">
              <div
                class={`grid aspect-[3/4] w-[5.5rem] shrink-0 grid-cols-6 grid-rows-6 gap-[2px] border p-1.5 ${
                  carried
                    ? 'border-[#2c231a]/30 bg-[#e3d7bd]'
                    : 'border-dashed border-[#2c231a]/30'
                }`}
                aria-hidden="true"
              >
                {#each sigilCells(passkey.shortId) as cell (cell.id)}
                  <span
                    class={cell.filled
                      ? carried
                        ? 'bg-[#3d3122]'
                        : 'bg-[#2c231a]/35'
                      : 'bg-[#2c231a]/10'}
                  ></span>
                {/each}
              </div>
              <div class="min-w-0">
                <p
                  class="flex items-center gap-1.5 font-mono text-[9px] tracking-[0.18em] text-[#5c4a34] uppercase"
                >
                  <Fingerprint class="size-3" aria-hidden="true" />
                  Passkey
                </p>
                <p
                  class="mt-1 font-mono text-2xl leading-none tracking-[0.1em] break-all"
                >
                  {passkey.shortId}
                </p>
                <p class="mt-2 text-[13px] break-words">{passkey.label}</p>
                <p
                  class="mt-1 font-mono text-[10px] tracking-[0.14em] text-[#5c4a34] uppercase"
                >
                  {storeLabel(passkey.store)}
                </p>
              </div>
            </div>

            <dl
              class="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[#2c231a]/15 pt-4"
            >
              {#each dataFields(passkey) as field (field.label)}
                <div class="min-w-0">
                  <dt
                    class="font-mono text-[9px] tracking-[0.16em] text-[#5c4a34] uppercase"
                  >
                    {field.label}
                  </dt>
                  <dd
                    class={`mt-0.5 text-[13px] leading-5 ${
                      field.mono ? 'font-mono break-all' : ''
                    }`}
                  >
                    {field.value}
                  </dd>
                </div>
              {/each}
            </dl>

            <div class="mt-4 border-t border-[#2c231a]/15 pt-4">
              <p
                class="font-mono text-[9px] tracking-[0.16em] text-[#5c4a34] uppercase"
              >
                Device keys
              </p>
              <ul class="mt-2 flex flex-wrap gap-1.5">
                {#each keys as device (device.id)}
                  <li
                    class={`flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[10px] ${
                      isHere(graph, device)
                        ? 'border-[#1f6b52]/60 text-[#1f6b52]'
                        : 'border-[#2c231a]/25 text-[#3d3122]'
                    }`}
                  >
                    <span class="tracking-[0.08em]">{device.shortId}</span>
                    <span class="tracking-[0.12em] uppercase opacity-70">
                      {isHere(graph, device) ? 'here' : device.platform}
                    </span>
                  </li>
                {/each}
                {#if keys.length === 0}
                  <li
                    class="rounded-sm border border-dashed border-[#2c231a]/35 px-2 py-1 font-mono text-[10px] tracking-[0.14em] text-[#8c3b2e] uppercase"
                  >
                    None
                  </li>
                {/if}
              </ul>
            </div>
          </div>

          <div class="min-w-0">
            <p
              class="font-mono text-[9px] tracking-[0.18em] text-[#5c4a34] uppercase"
            >
              Visas · {admitted.length}
            </p>
            {#if admitted.length > 0}
              <ul class="mt-3 grid gap-4 sm:grid-cols-2">
                {#each admitted as vault, index (vault.id)}
                  <li
                    class={`border-2 border-[#8c3b2e]/70 px-3 py-3 text-[#8c3b2e] ${tilt(
                      index,
                    )}`}
                  >
                    <p
                      class="flex items-center gap-1.5 font-mono text-[9px] tracking-[0.2em] uppercase"
                    >
                      <Stamp class="size-3" aria-hidden="true" />
                      Admitted
                    </p>
                    <p
                      class="mt-1.5 font-mono text-xl leading-none tracking-[0.1em] break-all"
                    >
                      {vault.shortId}
                    </p>
                    <p class="mt-1.5 text-[13px] break-words text-[#2c231a]">
                      {vault.label}
                    </p>
                    <p
                      class="mt-2 font-mono text-[9px] tracking-[0.14em] break-all uppercase"
                    >
                      via {shortIds(via(vault, passkey.id))}
                    </p>
                    <p
                      class="mt-1 font-mono text-[9px] tracking-[0.14em] uppercase"
                    >
                      {vault.secrets} secrets · {openableHere(graph, vault)
                        ? 'opens here'
                        : 'not from here'}
                    </p>
                  </li>
                {/each}
              </ul>
            {:else}
              <p
                class="mt-3 border border-dashed border-[#2c231a]/35 px-4 py-8 text-center font-mono text-[10px] tracking-[0.18em] text-[#5c4a34] uppercase"
              >
                No visas
              </p>
            {/if}

            {#if refused.length > 0}
              <p
                class="mt-6 font-mono text-[9px] tracking-[0.18em] text-[#5c4a34] uppercase"
              >
                Refused · {refused.length}
              </p>
              <ul class="mt-3 grid gap-3 sm:grid-cols-2">
                {#each refused as vault (vault.id)}
                  <li
                    class="relative overflow-hidden border border-dashed border-[#2c231a]/35 px-3 py-3 text-[#5c4a34]"
                  >
                    <span
                      class="pointer-events-none absolute inset-x-[-10%] top-1/2 h-px -rotate-12 bg-[#8c3b2e]/40"
                      aria-hidden="true"
                    ></span>
                    <p class="font-mono text-[9px] tracking-[0.2em] uppercase">
                      No visa
                    </p>
                    <p
                      class="mt-1 font-mono text-base leading-none tracking-[0.1em] break-all"
                    >
                      {vault.shortId}
                    </p>
                    <p class="mt-1.5 text-[12px] break-words">{vault.label}</p>
                    <p
                      class="mt-1.5 font-mono text-[9px] tracking-[0.14em] break-all uppercase"
                    >
                      needs {shortIds(devicesForVault(graph, vault))}
                    </p>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        </div>

        <div
          class="border-t-2 border-[#2c231a]/25 bg-[#e6dcc2] px-5 py-4 sm:px-7"
        >
          <p
            class="font-mono text-[9px] tracking-[0.2em] text-[#5c4a34] uppercase"
          >
            Machine-readable zone
          </p>
          <div
            class="mt-2 space-y-1 font-mono text-[10px] break-all sm:text-xs"
          >
            {#each mrzLines(passkey) as line (line.id)}
              <p>{line.text}</p>
            {/each}
          </div>
        </div>
      </article>
    {/each}

    <div
      class="mt-4 rounded-sm border border-[#2c231a]/20 bg-[#e6dcc2] px-5 py-5 sm:px-7"
    >
      <p
        class="font-mono text-[10px] tracking-[0.24em] text-[#5c4a34] uppercase"
      >
        Border register
      </p>
      <ul class="mt-2 divide-y divide-[#2c231a]/10">
        {#each graph.vaults as vault (vault.id)}
          {@const lit = highlight.vaultIds.includes(vault.id)}
          <li
            class={`flex flex-wrap items-center gap-x-3 gap-y-2 py-3 transition motion-reduce:transition-none ${
              lit ? '' : 'opacity-30 hover:opacity-100 focus-within:opacity-100'
            }`}
          >
            <VaultIcon
              class="size-3.5 shrink-0 text-[#5c4a34]"
              aria-hidden="true"
            />
            <span class="font-mono text-sm tracking-[0.1em]">
              {vault.shortId}
            </span>
            <span class="text-[13px] text-[#3d3122]">{vault.label}</span>
            <span
              class={`font-mono text-[9px] tracking-[0.14em] uppercase ${
                openableHere(graph, vault) ? 'text-[#1f6b52]' : 'text-[#8c3b2e]'
              }`}
            >
              {openableHere(graph, vault) ? 'Opens here' : 'Not from here'}
            </span>
            <span class="ml-auto flex flex-wrap items-center gap-1.5">
              <Fingerprint
                class="size-3 shrink-0 text-[#5c4a34]"
                aria-hidden="true"
              />
              {#each passkeysForVault(graph, vault) as passkey (passkey.id)}
                <button
                  type="button"
                  aria-pressed={passkey.id === openId}
                  aria-label={`Open passport ${passkey.shortId}, ${storeLabel(
                    passkey.store,
                  )}`}
                  class={`rounded-sm border px-2 py-1 font-mono text-[10px] tracking-[0.08em] transition motion-reduce:transition-none ${
                    passkey.id === openId
                      ? 'border-[#2c231a] bg-[#2c231a] text-[#efe6d2]'
                      : 'border-[#2c231a]/30 hover:border-[#2c231a]'
                  }`}
                  onclick={() => (openId = passkey.id)}
                >
                  {passkey.shortId}
                </button>
              {/each}
              {#if passkeysForVault(graph, vault).length === 0}
                <span
                  class="font-mono text-[10px] tracking-[0.14em] text-[#8c3b2e] uppercase"
                >
                  None
                </span>
              {/if}
            </span>
          </li>
        {/each}
      </ul>
    </div>
  </section>
</main>
