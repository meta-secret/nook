<!--
DIRECTION: Keyboard-first, but my device key is not something you have to ask
for: it is bolted above the console as its own pane, with the passkeys that
unlock it, the vaults it opens, and the handles I may turn. The console below
answers by identifier. Its map is vault-centric — a vault, then the passkeys
that open it. Other devices only ever print as existence: identifier, name, the
vaults they touch.
-->
<script lang="ts">
  type SegmentsOfArgs = {
    line: string
    here: string
  }

  type InkOfArgs = { text: string; here: string }

  import { tick } from 'svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import GraphSwitch from '../_shared/GraphSwitch.svelte'
  import {
    GraphId,
    graphById,
    HereKind,
    hereDevices,
    isHere,
    type KeyGraph,
    passkeysForDevice,
    Reach,
    storeLabel,
    vaultsForDevice,
  } from '../_shared/key-graph'
  import type { ExperimentProps } from '../../index'
  import { Ink } from './terminal-ink'
  import {
    banner,
    opening,
    outputFor,
    type TerminalBlock,
  } from './terminal-reports'

  interface Segment {
    key: string
    text: string
    ink: Ink
  }

  const INPUT_ID = 'access-terminal-input'
  const LOG_ID = 'access-terminal-log'
  const COMMANDS = ['map', 'ls', 'here', 'help', 'clear']

  const TOKEN =
    /(\b[0-9a-f]{6}\b|\belsewhere\b|\blocked\b|\bopens here\b|\bopens\b|\bhere\b|\bno passkey\b|\bno route\b)/
  const EXACT =
    /^([0-9a-f]{6}|elsewhere|locked|opens here|opens|here|no passkey|no route)$/

  let { navigate }: ExperimentProps = $props()
  let graphId = $state(GraphId.Tangle)
  let draft = $state('')
  let history = $state<string[]>([])
  let historyIndex = $state(0)
  let nextId = $state(2)
  let transcript = $state<TerminalBlock[]>(opening(graphById(GraphId.Tangle)))

  const graph = $derived(graphById(graphId))
  const mine = $derived(hereDevices(graph))
  const mineId = $derived(mine.map((device) => device.shortId).join(''))
  const otherDevices = $derived(
    graph.devices.filter((device) => {
      const nookNamedArgument116: Parameters<typeof isHere>[0] = {
        graph,
        device,
      }
      return !isHere(nookNamedArgument116)
    }),
  )

  function run(raw: string) {
    const command = raw.trim().toLowerCase().replace(/\s+/g, ' ')
    if (command.length === 0) return
    history = [...history, command]
    historyIndex = history.length
    draft = ''
    if (command === 'clear') {
      transcript = [banner(graph)]
      nextId = 1
      void scrollToEnd()
      return
    }
    const nookNamedArgument182: Parameters<typeof outputFor>[0] = {
      graph,
      command,
    }
    transcript = [
      ...transcript,
      { id: nextId, prompt: command, lines: outputFor(nookNamedArgument182) },
    ]
    nextId += 1
    void scrollToEnd()
  }

  function allShortIds(graph: KeyGraph): string[] {
    return [
      ...graph.passkeys.map((passkey) => passkey.shortId),
      ...graph.vaults.map((vault) => vault.shortId),
      ...graph.devices.map((device) => device.shortId),
    ]
  }

  /** Tab: complete the last word to a short identifier, cycling through them. */
  function completed(text: string): string {
    const parts = text.split(' ')
    const [tail] = parts.slice(-1)
    const stem = tail ? tail : ''
    const pool = allShortIds(graph)
    const at = pool.indexOf(stem)
    const [candidate] =
      at >= 0
        ? pool.slice((at + 1) % pool.length)
        : pool.filter((id) => id.startsWith(stem))
    if (!candidate) return text
    return [...parts.slice(0, -1), candidate].join(' ')
  }

  function historyAt(index: number): string {
    const [entry] = history.slice(index, index + 1)
    return entry ? entry : ''
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault()
      run(draft)
    }
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault()
      draft = completed(draft)
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      historyIndex = Math.max(0, historyIndex - 1)
      draft = historyAt(historyIndex)
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      historyIndex = Math.min(history.length, historyIndex + 1)
      draft = historyIndex === history.length ? '' : historyAt(historyIndex)
    }
  }

  function focusInput() {
    const node = document.getElementById(INPUT_ID)
    if (node instanceof HTMLInputElement) node.focus()
  }

  function insertId(shortId: string) {
    const trimmed = draft.trimEnd()
    draft = trimmed.length === 0 ? `id ${shortId}` : `${trimmed} ${shortId}`
    focusInput()
  }

  function inkOf({ text, here }: InkOfArgs): Ink {
    if (/^[0-9a-f]{6}$/.test(text)) {
      return text === here && here.length > 0 ? Ink.Mine : Ink.Id
    }
    if (text === 'here' || text === 'opens' || text === 'opens here') {
      return Ink.Good
    }
    return Ink.Warn
  }

  function segmentsOf({ line, here }: SegmentsOfArgs): Segment[] {
    return [
      ...line
        .split(TOKEN)
        .filter((part) => part.length > 0)
        .entries(),
    ].map(([index, part]) => {
      const nookNamedArgument183: Parameters<typeof inkOf>[0] = {
        text: part,
        here,
      }
      return {
        key: `${index}-${part}`,
        text: part,
        ink: EXACT.test(part) ? inkOf(nookNamedArgument183) : Ink.Plain,
      }
    })
  }

  function inkClass(ink: Ink): string {
    if (ink === Ink.Mine) return 'text-[#f0b463] underline underline-offset-4'
    if (ink === Ink.Id) return 'text-[#f4e6c6]'
    if (ink === Ink.Good) return 'text-[#8fb87c]'
    if (ink === Ink.Warn) return 'text-[#c8794f]'
    return 'text-[#b6a98f]'
  }

  /** Keep the newest block in view once the transcript has been rendered. */
  async function scrollToEnd(): Promise<void> {
    await tick()
    const node = document.getElementById(LOG_ID)
    if (node instanceof HTMLElement) node.scrollTop = node.scrollHeight
  }
</script>

<main class="min-h-[100svh] bg-[#14110c] text-[#e8dcc4]">
  <ExperimentBack {navigate} />
  <GraphSwitch
    {graph}
    onGraph={(next) => {
      graphId = next
      history = []
      historyIndex = 0
      nextId = 2
      draft = ''
      transcript = opening(graphById(next))
    }}
  />

  <section class="mx-auto max-w-3xl px-4 pt-28 pb-16 sm:px-6 sm:pt-24">
    <p class="font-mono text-[10px] tracking-[0.26em] text-[#e0a458] uppercase">
      My device
    </p>

    {#each mine as device (device.id)}
      {@const devicePasskeys: Parameters<typeof passkeysForDevice>[0] = {
        graph,
        device,
      }}
      {@const deviceVaults: Parameters<typeof vaultsForDevice>[0] = {
        graph,
        deviceId: device.id,
      }}
      <div
        class="mt-2 rounded-lg border-2 border-[#e0a458] bg-[linear-gradient(180deg,#221a10_0%,#16120c_100%)] p-4 shadow-[0_20px_46px_rgb(0_0_0/0.5)]"
      >
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <button
            type="button"
            aria-label={`Insert device key ${device.shortId}`}
            class="font-mono text-2xl tracking-[0.1em] text-[#f7e3bb] underline decoration-[#8a6c2c] underline-offset-4 sm:text-3xl"
            onclick={() => insertId(device.shortId)}
          >
            {device.shortId}
          </button>
          <span class="text-[13px] text-[#cbbfa7]">{device.label}</span>
          <span class="font-mono text-[11px] text-[#93856b]">
            {device.platform}
          </span>
        </div>

        <dl class="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <dt
              class="font-mono text-[10px] tracking-[0.2em] text-[#8a7c60] uppercase"
            >
              Unlocked by
            </dt>
            <dd class="mt-1.5 flex flex-wrap gap-1.5">
              {#each passkeysForDevice(devicePasskeys) as passkey (passkey.id)}
                <button
                  type="button"
                  aria-label={`Insert passkey ${passkey.shortId}, ${storeLabel(passkey.store)}`}
                  class="flex items-baseline gap-1.5 rounded border border-[#5f4d2e] bg-[#1d1710] px-2 py-1 transition hover:border-[#e0a458] motion-reduce:transition-none"
                  onclick={() => insertId(passkey.shortId)}
                >
                  <span class="font-mono text-[12px] text-[#f4e6c6]">
                    {passkey.shortId}
                  </span>
                  <span class="text-[10px] text-[#a2937a]">
                    {storeLabel(passkey.store)}
                  </span>
                  {#if passkey.reach === Reach.Elsewhere}
                    <span
                      class="font-mono text-[9px] tracking-[0.1em] text-[#c8794f] uppercase"
                    >
                      elsewhere
                    </span>
                  {/if}
                </button>
              {/each}
            </dd>
          </div>
          <div>
            <dt
              class="font-mono text-[10px] tracking-[0.2em] text-[#8a7c60] uppercase"
            >
              Opens
            </dt>
            <dd class="mt-1.5 flex flex-wrap gap-1.5">
              {#each vaultsForDevice(deviceVaults) as vault (vault.id)}
                <button
                  type="button"
                  aria-label={`Insert vault ${vault.shortId}, ${vault.label}`}
                  class="flex items-baseline gap-1.5 rounded border border-[#5f4d2e] bg-[#1d1710] px-2 py-1 transition hover:border-[#e0a458] motion-reduce:transition-none"
                  onclick={() => insertId(vault.shortId)}
                >
                  <span class="font-mono text-[12px] text-[#f4e6c6]">
                    {vault.shortId}
                  </span>
                  <span class="text-[10px] text-[#a2937a]">{vault.label}</span>
                </button>
              {/each}
            </dd>
          </div>
        </dl>

        <div class="mt-4 flex flex-wrap gap-1.5 border-t border-[#3a3020] pt-3">
          {#each ['Rename', 'Enrol passkey', 'Revoke'] as action (action)}
            <button
              type="button"
              class="rounded border border-[#4a3f2c] px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-[#c3b18d] uppercase transition hover:border-[#e0a458] hover:text-[#f7e3bb] motion-reduce:transition-none"
            >
              {action}
            </button>
          {/each}
        </div>
      </div>
    {/each}

    {#if graph.here.kind === HereKind.Unprepared}
      <div
        class="mt-2 rounded-lg border-2 border-dashed border-[#4a3f2c] bg-[repeating-linear-gradient(135deg,#17130d_0_6px,#12100b_6px_12px)] p-4"
      >
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span class="font-mono text-2xl tracking-[0.1em] text-[#6b6047]">
            ······
          </span>
          <span
            class="font-mono text-[11px] tracking-[0.16em] text-[#8a7c66] uppercase"
          >
            no device key
          </span>
        </div>
        <div class="mt-4 border-t border-[#241e15] pt-3">
          <button
            type="button"
            class="rounded border border-[#4a3f2c] px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-[#e0a458] uppercase"
          >
            Create device key
          </button>
        </div>
      </div>
    {/if}

    <div
      class="mt-6 overflow-hidden rounded-lg border border-[#3a3020] bg-[#0f0d09] shadow-[0_24px_60px_rgb(0_0_0/0.45)]"
    >
      <div
        class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#3a3020] bg-[#191510] px-4 py-2.5"
      >
        <span class="flex gap-1.5" aria-hidden="true">
          <span class="size-2.5 rounded-full bg-[#4a3f2c]"></span>
          <span class="size-2.5 rounded-full bg-[#4a3f2c]"></span>
          <span class="size-2.5 rounded-full bg-[#4a3f2c]"></span>
        </span>
        <span class="font-mono text-[11px] text-[#8a7c66]">nook keys</span>
      </div>

      <div
        id={LOG_ID}
        role="log"
        aria-live="polite"
        aria-label="Key graph console output"
        class="h-[24rem] overflow-auto px-4 py-4 sm:h-[30rem]"
      >
        {#each transcript as block (block.id)}
          <div class="mb-4">
            {#if block.prompt.length > 0}
              <p class="font-mono text-[11px] text-[#e0a458] sm:text-xs">
                keys ▸ {block.prompt}
              </p>
            {/if}
            {#each block.lines as line, index (index)}
              {@const highlightedSegments: Parameters<typeof segmentsOf>[0] = {
                line,
                here: mineId,
              }}
              <p
                class="flex min-h-5 font-mono text-[11px] leading-5 sm:text-xs"
              >
                {#each segmentsOf(highlightedSegments) as segment (segment.key)}
                  <span class={`whitespace-pre ${inkClass(segment.ink)}`}>
                    {segment.text}
                  </span>
                {/each}
              </p>
            {/each}
          </div>
        {/each}
      </div>

      <div class="border-t border-[#3a3020] bg-[#12100b] px-4 py-3">
        <form
          class="flex items-center gap-2"
          onsubmit={(event) => {
            event.preventDefault()
            run(draft)
          }}
        >
          <label for={INPUT_ID} class="sr-only">Key graph command</label>
          <span class="font-mono text-xs text-[#e0a458]" aria-hidden="true">
            keys ▸
          </span>
          <input
            id={INPUT_ID}
            bind:value={draft}
            onkeydown={onKey}
            autocomplete="off"
            spellcheck="false"
            placeholder="id 5f0a7c"
            class="min-w-0 flex-1 bg-transparent font-mono text-xs text-[#e8dcc4] outline-none placeholder:text-[#6b6047]"
          />
          <button
            type="submit"
            class="rounded border border-[#3a3020] px-3 py-1 font-mono text-[10px] tracking-[0.16em] text-[#a8977a] uppercase transition hover:border-[#e0a458] hover:text-[#e8dcc4] motion-reduce:transition-none"
          >
            Run
          </button>
        </form>

        <div
          class="mt-3 flex flex-wrap gap-1.5 border-t border-[#241e15] pt-3"
          role="group"
          aria-label="Commands"
        >
          {#each COMMANDS as command (command)}
            <button
              type="button"
              class="rounded border border-[#3a3020] px-2 py-1 font-mono text-[10px] text-[#a8977a] transition hover:border-[#e0a458] hover:text-[#e8dcc4] motion-reduce:transition-none"
              onclick={() => {
                run(command)
                focusInput()
              }}
            >
              {command}
            </button>
          {/each}
        </div>

        <div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            class="font-mono text-[9px] tracking-[0.2em] text-[#6b6047] uppercase"
          >
            Passkeys
          </span>
          {#each graph.passkeys as passkey (passkey.id)}
            <button
              type="button"
              aria-label={`Insert passkey ${passkey.shortId}`}
              class="rounded border border-[#3a3020] px-2 py-0.5 font-mono text-[11px] text-[#f4e6c6] transition hover:border-[#e0a458] motion-reduce:transition-none"
              onclick={() => insertId(passkey.shortId)}
            >
              {passkey.shortId}
            </button>
          {/each}
        </div>

        <div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            class="font-mono text-[9px] tracking-[0.2em] text-[#6b6047] uppercase"
          >
            Vaults
          </span>
          {#each graph.vaults as vault (vault.id)}
            <button
              type="button"
              aria-label={`Insert vault ${vault.shortId}`}
              class="rounded border border-[#3a3020] px-2 py-0.5 font-mono text-[11px] text-[#f4e6c6] transition hover:border-[#e0a458] motion-reduce:transition-none"
              onclick={() => insertId(vault.shortId)}
            >
              {vault.shortId}
            </button>
          {/each}
        </div>
      </div>
    </div>

    {#if otherDevices.length > 0}
      <p
        class="mt-6 font-mono text-[10px] tracking-[0.24em] text-[#6b6047] uppercase"
      >
        Other devices
      </p>
      <ul class="mt-2 border-l border-dashed border-[#332b1e] pl-3">
        {#each otherDevices as device (device.id)}
          {@const deviceVaults: Parameters<typeof vaultsForDevice>[0] = {
            graph,
            deviceId: device.id,
          }}
          <li class="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5">
            <button
              type="button"
              aria-label={`Insert device key ${device.shortId}`}
              class="font-mono text-[13px] text-[#a8977a] transition hover:text-[#e8dcc4] motion-reduce:transition-none"
              onclick={() => insertId(device.shortId)}
            >
              {device.shortId}
            </button>
            <span class="text-[12px] text-[#8a7c66]">{device.label}</span>
            <span class="font-mono text-[10px] text-[#6b6047]">
              {device.platform}
            </span>
            <span class="ml-auto flex shrink-0 flex-wrap gap-1.5">
              {#each vaultsForDevice(deviceVaults) as vault (vault.id)}
                <span class="font-mono text-[11px] text-[#6b6047]">
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
