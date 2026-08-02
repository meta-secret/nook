<!--
DIRECTION: Keyboard-first. The graph is not drawn, it is queried — type a short
identifier you copied out of a password manager and the console prints back
every route it carries, as aligned columns and box-drawn ASCII.
-->
<script lang="ts">
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import GraphSwitch from '../_shared/GraphSwitch.svelte'
  import {
    devicesForPasskey,
    devicesForVault,
    GraphId,
    graphById,
    HereKind,
    hereDevices,
    isHere,
    type KeyGraph,
    kindLabel,
    NodeKind,
    openableHere,
    type Passkey,
    passkeysForDevice,
    passkeysForVault,
    Reach,
    storeLabel,
    usableHere,
    type Vault,
    vaultsForDevice,
    vaultsForPasskey,
  } from '../_shared/key-graph'
  import type { ExperimentProps } from '../../index'

  interface Block {
    id: number
    prompt: string
    lines: string[]
  }

  interface Match {
    kind: NodeKind
    id: string
    shortId: string
    label: string
  }

  interface Route {
    passkey: string
    device: string
    vault: string
    store: string
    reach: string
  }

  const BOX_W = 12
  const PITCH = 4
  const INPUT_ID = 'access-terminal-input'
  const LOG_ID = 'access-terminal-log'

  /** Box-drawing strokes as north/south/east/west bits, so crossing wires
   *  merge into the right junction instead of overwriting each other. */
  const STROKES: Record<string, number> = {
    '│': 3,
    '─': 12,
    '└': 5,
    '┌': 6,
    '├': 7,
    '┘': 9,
    '┐': 10,
    '┤': 11,
    '┴': 13,
    '┬': 14,
    '┼': 15,
  }
  const GLYPHS = ' │││─└┌├─┘┐┤─┴┬┼'

  let { navigate }: ExperimentProps = $props()
  let graphId = $state(GraphId.Tangle)
  let draft = $state('')
  let history = $state<string[]>([])
  let historyIndex = $state(0)
  let nextId = $state(1)
  let transcript = $state<Block[]>([banner(graphById(GraphId.Tangle))])

  const graph = $derived(graphById(graphId))
  const suggestions = $derived(suggestionsFor(graph))

  function pad(text: string, width: number): string {
    return text.length >= width ? text : text + ' '.repeat(width - text.length)
  }

  function columns(cells: string[], widths: number[]): string {
    return cells
      .map((cell, index) => pad(cell, widths[index] ? widths[index] : 0))
      .join('')
      .trimEnd()
  }

  function reachWord(passkey: Passkey): string {
    return passkey.reach === Reach.Here ? 'here' : 'elsewhere'
  }

  function banner(graph: KeyGraph): Block {
    const here = hereDevices(graph).map((device) => device.shortId)
    return {
      id: 0,
      prompt: '',
      lines: [
        `nook keys · ${graph.label}`,
        columns(
          [
            `passkeys ${graph.passkeys.length}`,
            `device keys ${graph.devices.length}`,
            `vaults ${graph.vaults.length}`,
          ],
          [14, 17, 12],
        ),
        `here ${here.length > 0 ? here.join(' ') : '—  no device key'}`,
        '',
        'ls · id <id> · opens <id> · here · map · help · clear',
      ],
    }
  }

  function passkeyMatches(graph: KeyGraph, query: string): Match[] {
    return graph.passkeys
      .filter((passkey) =>
        hits(query, passkey.shortId, passkey.id, passkey.label),
      )
      .map((passkey) => ({
        kind: NodeKind.Passkey,
        id: passkey.id,
        shortId: passkey.shortId,
        label: passkey.label,
      }))
  }

  function deviceMatches(graph: KeyGraph, query: string): Match[] {
    return graph.devices
      .filter((device) => hits(query, device.shortId, device.id, device.label))
      .map((device) => ({
        kind: NodeKind.Device,
        id: device.id,
        shortId: device.shortId,
        label: device.label,
      }))
  }

  function vaultMatches(graph: KeyGraph, query: string): Match[] {
    return graph.vaults
      .filter((vault) => hits(query, vault.shortId, vault.id, vault.label))
      .map((vault) => ({
        kind: NodeKind.Vault,
        id: vault.id,
        shortId: vault.shortId,
        label: vault.label,
      }))
  }

  function hits(query: string, shortId: string, id: string, label: string) {
    const needle = query.toLowerCase()
    return (
      shortId.toLowerCase().startsWith(needle) ||
      id.toLowerCase() === needle ||
      label.toLowerCase().includes(needle)
    )
  }

  function routesFromPasskey(graph: KeyGraph, passkeyId: string): Route[] {
    return graph.passkeys
      .filter((passkey) => passkey.id === passkeyId)
      .flatMap((passkey) =>
        devicesForPasskey(graph, passkey.id).flatMap((device) =>
          vaultsForDevice(graph, device.id).map((vault) => ({
            passkey: passkey.shortId,
            device: device.shortId,
            vault: vault.shortId,
            store: storeLabel(passkey.store),
            reach: reachWord(passkey),
          })),
        ),
      )
  }

  function routesIntoVault(graph: KeyGraph, vault: Vault): Route[] {
    return devicesForVault(graph, vault).flatMap((device) =>
      passkeysForDevice(graph, device).map((passkey) => ({
        passkey: passkey.shortId,
        device: device.shortId,
        vault: vault.shortId,
        store: storeLabel(passkey.store),
        reach: reachWord(passkey),
      })),
    )
  }

  function routeLines(routes: Route[]): string[] {
    if (routes.length === 0) return ['  —  no route']
    return routes.map((route) =>
      columns(
        [
          `  ${route.passkey} ──> ${route.device} ──> ${route.vault}`,
          route.store,
          route.reach,
        ],
        [34, 18, 10],
      ),
    )
  }

  function passkeyReport(graph: KeyGraph, id: string): string[] {
    return graph.passkeys
      .filter((passkey) => passkey.id === id)
      .flatMap((passkey) => [
        columns(['passkey', passkey.shortId, passkey.label], [9, 9, 24]),
        columns(['store', storeLabel(passkey.store)], [9, 24]),
        columns(['reach', reachWord(passkey)], [9, 24]),
        columns(
          [
            'unlocks',
            devicesForPasskey(graph, passkey.id)
              .map((device) => device.shortId)
              .join('  '),
          ],
          [9, 24],
        ),
        columns(
          [
            'opens',
            vaultsForPasskey(graph, passkey.id)
              .map((vault) => vault.shortId)
              .join('  '),
          ],
          [9, 24],
        ),
        '',
        ...routeLines(routesFromPasskey(graph, passkey.id)),
      ])
  }

  function deviceReport(graph: KeyGraph, id: string): string[] {
    return graph.devices
      .filter((device) => device.id === id)
      .flatMap((device) => [
        columns(['device', device.shortId, device.label], [9, 9, 24]),
        columns(['platform', device.platform], [9, 24]),
        columns(['here', isHere(graph, device) ? 'yes' : 'no'], [9, 24]),
        '',
        ...routeLines(
          vaultsForDevice(graph, device.id).flatMap((vault) =>
            passkeysForDevice(graph, device).map((passkey) => ({
              passkey: passkey.shortId,
              device: device.shortId,
              vault: vault.shortId,
              store: storeLabel(passkey.store),
              reach: reachWord(passkey),
            })),
          ),
        ),
      ])
  }

  function vaultReport(graph: KeyGraph, id: string): string[] {
    return graph.vaults
      .filter((vault) => vault.id === id)
      .flatMap((vault) => {
        const routes = routesIntoVault(graph, vault)
        const stores = new Set(routes.map((route) => route.store))
        return [
          columns(['vault', vault.shortId, vault.label], [9, 9, 24]),
          columns(['secrets', `${vault.secrets}`], [9, 24]),
          columns(
            ['here', openableHere(graph, vault) ? 'opens' : 'locked'],
            [9, 24],
          ),
          columns(
            [
              'routes',
              `${passkeysForVault(graph, vault).length}`,
              'managers',
              `${stores.size}`,
            ],
            [9, 10, 10, 6],
          ),
          '',
          ...routeLines(routes),
        ]
      })
  }

  function reportFor(graph: KeyGraph, match: Match): string[] {
    if (match.kind === NodeKind.Passkey) return passkeyReport(graph, match.id)
    if (match.kind === NodeKind.Device) return deviceReport(graph, match.id)
    return vaultReport(graph, match.id)
  }

  function matchLines(matches: Match[]): string[] {
    return matches.map((match) =>
      columns(
        [`  ${match.shortId}`, kindLabel(match.kind), match.label],
        [10, 12, 24],
      ),
    )
  }

  function listPasskeys(graph: KeyGraph): string[] {
    return [
      'passkeys',
      columns(
        ['  id', 'manager', 'reach', 'unlocks', 'opens'],
        [10, 18, 12, 10, 8],
      ),
      ...graph.passkeys.map((passkey) =>
        columns(
          [
            `  ${passkey.shortId}`,
            storeLabel(passkey.store),
            reachWord(passkey),
            `${devicesForPasskey(graph, passkey.id).length}`,
            `${vaultsForPasskey(graph, passkey.id).length}`,
          ],
          [10, 18, 12, 10, 8],
        ),
      ),
    ]
  }

  function listDevices(graph: KeyGraph): string[] {
    return [
      'device keys',
      columns(
        ['  id', 'platform', 'here', 'passkeys', 'vaults'],
        [10, 18, 8, 18, 8],
      ),
      ...graph.devices.map((device) =>
        columns(
          [
            `  ${device.shortId}`,
            device.platform,
            isHere(graph, device) ? 'yes' : '·',
            passkeysForDevice(graph, device)
              .map((passkey) => passkey.shortId)
              .join(' '),
            `${vaultsForDevice(graph, device.id).length}`,
          ],
          [10, 18, 8, 18, 8],
        ),
      ),
    ]
  }

  function listVaults(graph: KeyGraph): string[] {
    return [
      'vaults',
      columns(
        ['  id', 'name', 'secrets', 'passkeys', 'here'],
        [10, 16, 10, 25, 8],
      ),
      ...graph.vaults.map((vault) =>
        columns(
          [
            `  ${vault.shortId}`,
            vault.label,
            `${vault.secrets}`,
            passkeysForVault(graph, vault)
              .map((passkey) => passkey.shortId)
              .join(' '),
            openableHere(graph, vault) ? 'opens' : 'locked',
          ],
          [10, 16, 10, 25, 8],
        ),
      ),
    ]
  }

  function hereReport(graph: KeyGraph): string[] {
    const devices = hereDevices(graph)
    const usable = usableHere(graph).map((passkey) => passkey.shortId)
    const open = graph.vaults
      .filter((vault) => openableHere(graph, vault))
      .map((vault) => vault.shortId)
    return [
      columns(
        [
          'browser',
          devices.length > 0
            ? devices.map((device) => device.shortId).join(' ')
            : '—  no device key',
        ],
        [10, 30],
      ),
      columns(
        ['present', usable.length > 0 ? usable.join('  ') : '—'],
        [10, 30],
      ),
      columns(['opens', open.length > 0 ? open.join('  ') : '—'], [10, 30]),
    ]
  }

  function put(grid: string[][], x: number, y: number, mark: string) {
    const row = grid[y]
    if (!row) return
    if (x < 0 || x >= row.length) return
    const current = row[x]
    row[x] = merge(current ? current : ' ', mark)
  }

  function merge(current: string, mark: string): string {
    if (mark === '>') return mark
    if (current === ' ') return mark
    const held = STROKES[current]
    const added = STROKES[mark]
    if (!held || !added) return current
    return GLYPHS.charAt(held | added)
  }

  function box(grid: string[][], x: number, top: number, body: string) {
    const bar = '─'.repeat(BOX_W - 2)
    const face = [`┌${bar}┐`, `│ ${pad(body, BOX_W - 4)} │`, `└${bar}┘`]
    face.forEach((line, row) =>
      line.split('').forEach((mark, i) => put(grid, x + i, top + row, mark)),
    )
  }

  function wire(
    grid: string[][],
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    channel: number,
  ) {
    for (let x = fromX; x < channel; x += 1) put(grid, x, fromY, '─')
    if (fromY === toY) {
      put(grid, channel, fromY, '─')
    } else {
      const step = fromY < toY ? 1 : -1
      put(grid, channel, fromY, step === 1 ? '┐' : '┘')
      for (let y = fromY + step; y !== toY; y += step)
        put(grid, channel, y, '│')
      put(grid, channel, toY, step === 1 ? '└' : '┌')
    }
    for (let x = channel + 1; x < toX - 1; x += 1) put(grid, x, toY, '─')
    put(grid, toX - 1, toY, '>')
  }

  function place(line: string[], x: number, text: string) {
    text.split('').forEach((mark, i) => {
      if (x + i < line.length) line[x + i] = mark
    })
  }

  function mapArt(graph: KeyGraph): string[] {
    const unlocks = graph.devices.flatMap((device) =>
      device.passkeyIds.map((passkeyId) => ({
        from: passkeyId,
        to: device.id,
      })),
    )
    const opens = graph.vaults.flatMap((vault) =>
      vault.deviceIds.map((deviceId) => ({ from: deviceId, to: vault.id })),
    )
    const passkeyX = 1
    const deviceX = passkeyX + BOX_W + 2 * unlocks.length + 1
    const vaultX = deviceX + BOX_W + 2 * opens.length + 1
    const width = vaultX + BOX_W + 1
    const rows =
      Math.max(
        graph.passkeys.length,
        graph.devices.length,
        graph.vaults.length,
      ) *
        PITCH -
      1
    const grid: string[][] = Array.from({ length: rows }, () =>
      Array.from({ length: width }, () => ' '),
    )

    graph.passkeys.forEach((passkey, index) =>
      box(
        grid,
        passkeyX,
        index * PITCH,
        `${passkey.shortId} ${passkey.reach === Reach.Here ? '*' : '.'}`,
      ),
    )
    graph.devices.forEach((device, index) =>
      box(
        grid,
        deviceX,
        index * PITCH,
        `${device.shortId} ${isHere(graph, device) ? '*' : '.'}`,
      ),
    )
    graph.vaults.forEach((vault, index) =>
      box(
        grid,
        vaultX,
        index * PITCH,
        `${vault.shortId} ${openableHere(graph, vault) ? '*' : '.'}`,
      ),
    )

    unlocks.forEach((edge, index) => {
      const fromRow =
        graph.passkeys.findIndex((passkey) => passkey.id === edge.from) *
          PITCH +
        1
      const toRow =
        graph.devices.findIndex((device) => device.id === edge.to) * PITCH + 1
      wire(
        grid,
        passkeyX + BOX_W,
        fromRow,
        deviceX,
        toRow,
        passkeyX + BOX_W + 1 + 2 * index,
      )
    })
    opens.forEach((edge, index) => {
      const fromRow =
        graph.devices.findIndex((device) => device.id === edge.from) * PITCH + 1
      const toRow =
        graph.vaults.findIndex((vault) => vault.id === edge.to) * PITCH + 1
      wire(
        grid,
        deviceX + BOX_W,
        fromRow,
        vaultX,
        toRow,
        deviceX + BOX_W + 1 + 2 * index,
      )
    })

    const heading = Array.from({ length: width }, () => ' ')
    place(heading, passkeyX, 'PASSKEYS')
    place(heading, deviceX, 'DEVICE KEYS')
    place(heading, vaultX, 'VAULTS')

    return [
      heading.join('').trimEnd(),
      '',
      ...grid.map((row) => row.join('').trimEnd()),
      '',
      '* usable from this browser   . elsewhere',
    ]
  }

  function legend(graph: KeyGraph): string[] {
    return [
      ...graph.passkeys.map((passkey) =>
        columns(
          [`  ${passkey.shortId}`, passkey.label, storeLabel(passkey.store)],
          [10, 20, 18],
        ),
      ),
      ...graph.devices.map((device) =>
        columns(
          [`  ${device.shortId}`, device.label, device.platform],
          [10, 20, 18],
        ),
      ),
      ...graph.vaults.map((vault) =>
        columns(
          [`  ${vault.shortId}`, vault.label, `${vault.secrets} secrets`],
          [10, 20, 18],
        ),
      ),
    ]
  }

  function helpLines(): string[] {
    return [
      columns(['  ls', 'passkeys · device keys · vaults'], [16, 40]),
      columns(['  id <id>', 'everything that identifier reaches'], [16, 40]),
      columns(['  opens <id>', 'passkeys that open a vault'], [16, 40]),
      columns(['  here', 'what this browser holds'], [16, 40]),
      columns(['  map', 'the whole graph, drawn'], [16, 40]),
      columns(['  clear', 'wipe the transcript'], [16, 40]),
    ]
  }

  function lookup(graph: KeyGraph, query: string): Match[] {
    return [
      ...passkeyMatches(graph, query),
      ...deviceMatches(graph, query),
      ...vaultMatches(graph, query),
    ]
  }

  function idCommand(graph: KeyGraph, query: string): string[] {
    if (query.length === 0) return ['id <id>', ...matchLines(lookup(graph, ''))]
    const matches = lookup(graph, query)
    if (matches.length === 0) {
      return [`no match  ${query}`, '', ...matchLines(lookup(graph, ''))]
    }
    if (matches.length > 1) {
      return [`${matches.length} matches  ${query}`, '', ...matchLines(matches)]
    }
    return matches.flatMap((match) => reportFor(graph, match))
  }

  function opensCommand(graph: KeyGraph, query: string): string[] {
    if (query.length === 0) {
      return ['opens <id>', '', ...matchLines(vaultMatches(graph, ''))]
    }
    const matches = vaultMatches(graph, query)
    if (matches.length === 0) {
      return [`no vault  ${query}`, '', ...matchLines(vaultMatches(graph, ''))]
    }
    return matches.flatMap((match) => vaultReport(graph, match.id))
  }

  function outputFor(graph: KeyGraph, command: string): string[] {
    const [verb, ...rest] = command.split(' ')
    const argument = rest.join(' ')
    if (command === 'ls') {
      return [
        ...listPasskeys(graph),
        '',
        ...listDevices(graph),
        '',
        ...listVaults(graph),
      ]
    }
    if (command === 'ls passkeys') return listPasskeys(graph)
    if (command === 'ls devices' || command === 'ls device-keys') {
      return listDevices(graph)
    }
    if (command === 'ls vaults') return listVaults(graph)
    if (command === 'here') return hereReport(graph)
    if (command === 'map' || command === 'graph') {
      return [...mapArt(graph), '', ...legend(graph)]
    }
    if (command === 'help') return helpLines()
    if (verb === 'id' || verb === 'show') return idCommand(graph, argument)
    if (verb === 'opens') return opensCommand(graph, argument)
    if (verb.length === 6) return idCommand(graph, verb)
    return [`unknown  ${command}`, '', ...helpLines()]
  }

  function suggestionsFor(graph: KeyGraph): string[] {
    return [
      'map',
      'ls',
      'here',
      ...graph.passkeys.map((passkey) => `id ${passkey.shortId}`),
      ...graph.vaults.map((vault) => `opens ${vault.shortId}`),
      'clear',
    ]
  }

  function run(raw: string) {
    const command = raw.trim().toLowerCase().replace(/\s+/g, ' ')
    if (command.length === 0) return
    history = [...history, command]
    historyIndex = history.length
    draft = ''
    if (command === 'clear') {
      transcript = [banner(graph)]
      nextId = 1
      return
    }
    transcript = [
      ...transcript,
      { id: nextId, prompt: command, lines: outputFor(graph, command) },
    ]
    nextId += 1
  }

  function historyAt(index: number): string {
    const [entry] = history.slice(index, index + 1)
    return entry ? entry : ''
  }

  function onKey(event: KeyboardEvent) {
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

  $effect(() => {
    const count = transcript.length
    const frame = requestAnimationFrame(() => {
      const node = document.getElementById(LOG_ID)
      if (node instanceof HTMLElement && count > 0) {
        node.scrollTop = node.scrollHeight
      }
    })
    return () => cancelAnimationFrame(frame)
  })
</script>

<main class="min-h-[100svh] bg-[#14110c] text-[#e8dcc4]">
  <ExperimentBack {navigate} />
  <GraphSwitch
    {graph}
    onGraph={(next) => {
      graphId = next
      history = []
      historyIndex = 0
      nextId = 1
      transcript = [banner(graphById(next))]
    }}
  />

  <section class="mx-auto max-w-3xl px-4 pt-28 pb-16 sm:px-6 sm:pt-24">
    <div
      class="overflow-hidden rounded-lg border border-[#3a3020] bg-[#0f0d09] shadow-[0_24px_60px_rgb(0_0_0/0.45)]"
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
        <span class="ml-auto flex items-center gap-2 font-mono text-[10px]">
          <span
            class={`size-1.5 rounded-full ${graph.here.kind === HereKind.Prepared ? 'bg-[#e0a458]' : 'bg-[#5d5340]'}`}
            aria-hidden="true"
          ></span>
          {#each hereDevices(graph) as device (device.id)}
            <span class="tracking-[0.16em] text-[#e0a458]">
              {device.shortId}
            </span>
          {/each}
          {#if graph.here.kind === HereKind.Unprepared}
            <span class="tracking-[0.16em] text-[#8a7c66]">no device key</span>
          {/if}
        </span>
      </div>

      <div
        id={LOG_ID}
        role="log"
        aria-live="polite"
        aria-label="Key graph console output"
        class="h-[26rem] overflow-auto px-4 py-4 sm:h-[32rem]"
      >
        {#each transcript as block (block.id)}
          <div class="mb-4">
            {#if block.prompt.length > 0}
              <p class="font-mono text-[11px] text-[#e0a458] sm:text-xs">
                keys ▸ {block.prompt}
              </p>
            {/if}
            <pre
              class="mt-1 font-mono text-[11px] leading-5 whitespace-pre text-[#cbbfa7] sm:text-xs">{block.lines.join(
                '\n',
              )}</pre>
          </div>
        {/each}
      </div>

      <div class="border-t border-[#3a3020] bg-[#12100b] px-4 py-3">
        <div
          class="flex flex-wrap gap-1.5"
          role="group"
          aria-label="Suggested commands"
        >
          {#each suggestions as command (command)}
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

        <form
          class="mt-3 flex items-center gap-2 border-t border-[#241e15] pt-3"
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
            placeholder="id 4f2a91"
            class="min-w-0 flex-1 bg-transparent font-mono text-xs text-[#e8dcc4] outline-none placeholder:text-[#6b6047]"
          />
          <button
            type="submit"
            class="rounded border border-[#3a3020] px-3 py-1 font-mono text-[10px] tracking-[0.16em] text-[#a8977a] uppercase transition hover:border-[#e0a458] hover:text-[#e8dcc4] motion-reduce:transition-none"
          >
            Run
          </button>
        </form>
      </div>
    </div>
  </section>
</main>
