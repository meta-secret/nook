<!--
DIRECTION: Keyboard-first. The graph is not drawn, it is queried — type a short
identifier you copied out of a password manager and the console prints back
every route it carries, as aligned columns and box-drawn ASCII.
-->
<script lang="ts">
  type OutputForArgs = {
    graph: KeyGraph
    command: string
  }

  type OpensCommandArgs = {
    graph: KeyGraph
    query: string
  }

  type IdCommandArgs = {
    graph: KeyGraph
    query: string
  }

  type AccessTerminalGraphLookup = {
    graph: KeyGraph
    query: string
  }

  type ReportForArgs = {
    graph: KeyGraph
    match: Match
  }

  type VaultReportArgs = {
    graph: KeyGraph
    id: string
  }

  type DeviceReportArgs = {
    graph: KeyGraph
    id: string
  }

  type PasskeyReportArgs = {
    graph: KeyGraph
    id: string
  }

  type AccessTerminalTextMatch = {
    query: string
    shortId: string
    id: string
    label: string
  }

  type VaultMatchesArgs = {
    graph: KeyGraph
    query: string
  }

  type DeviceMatchesArgs = {
    graph: KeyGraph
    query: string
  }

  type PasskeyMatchesArgs = {
    graph: KeyGraph
    query: string
  }

  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import GraphSwitch from '../../keys-management/_shared/GraphSwitch.svelte'
  import {
    AccessTerminalRouteProjection,
    type AccessTerminalRoutes,
    type PasskeyRouteProjectionRequest,
    type VaultRouteProjectionRequest,
  } from './access-terminal-route-projection'
  import { TerminalGraphMap as GraphMap } from './terminal-map'
  import {
    GraphId,
    HereKind,
    type KeyGraph,
    NodeKind,
    KeyGraphView as GraphView,
  } from '../../keys-management/_shared/key-graph'
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

  type TerminalMatches = Match[]

  const INPUT_ID = 'access-terminal-input'
  const LOG_ID = 'access-terminal-log'

  let { navigate }: ExperimentProps = $props()
  let graphId = $state(GraphId.Tangle)
  let draft = $state('')
  let history = $state<string[]>([])
  let historyIndex = $state(0)
  let nextId = $state(1)
  let transcript = $state<Block[]>([
    banner(GraphView.graphById(GraphId.Tangle)),
  ])

  const graph = $derived(GraphView.graphById(graphId))
  const suggestions = $derived(suggestionsFor(graph))

  function banner(graph: KeyGraph): Block {
    const here = new GraphView(graph)
      .hereDevices()
      .map((device) => device.shortId)
    const summaryColumns: Parameters<typeof GraphMap.columns>[0] = {
      cells: [
        `passkeys ${graph.passkeys.length}`,
        `device keys ${graph.devices.length}`,
        `vaults ${graph.vaults.length}`,
      ],
      widths: [14, 17, 12],
    }

    return {
      id: 0,
      prompt: '',
      lines: [
        `nook keys · ${graph.label}`,
        GraphMap.columns(summaryColumns),
        `here ${here.length > 0 ? here.join(' ') : '—  no device key'}`,
        '',
        'ls · id <id> · opens <id> · here · map · help · clear',
      ],
    }
  }

  function passkeyMatches({ graph, query }: PasskeyMatchesArgs): Match[] {
    return graph.passkeys
      .filter((passkey) => {
        const textMatch: AccessTerminalTextMatch = {
          query,
          shortId: passkey.shortId,
          id: passkey.id,
          label: passkey.label,
        }
        return hits(textMatch)
      })
      .map((passkey) => ({
        kind: NodeKind.Passkey,
        id: passkey.id,
        shortId: passkey.shortId,
        label: passkey.label,
      }))
  }

  function deviceMatches({ graph, query }: DeviceMatchesArgs): Match[] {
    return graph.devices
      .filter((device) => {
        const textMatch: AccessTerminalTextMatch = {
          query,
          shortId: device.shortId,
          id: device.id,
          label: device.label,
        }
        return hits(textMatch)
      })
      .map((device) => ({
        kind: NodeKind.Device,
        id: device.id,
        shortId: device.shortId,
        label: device.label,
      }))
  }

  function vaultMatches({ graph, query }: VaultMatchesArgs): Match[] {
    return graph.vaults
      .filter((vault) => {
        const textMatch: AccessTerminalTextMatch = {
          query,
          shortId: vault.shortId,
          id: vault.id,
          label: vault.label,
        }
        return hits(textMatch)
      })
      .map((vault) => ({
        kind: NodeKind.Vault,
        id: vault.id,
        shortId: vault.shortId,
        label: vault.label,
      }))
  }

  function hits({ query, shortId, id, label }: AccessTerminalTextMatch) {
    const needle = query.toLowerCase()
    return (
      shortId.toLowerCase().startsWith(needle) ||
      id.toLowerCase() === needle ||
      label.toLowerCase().includes(needle)
    )
  }

  function routeLines(routes: AccessTerminalRoutes): string[] {
    if (routes.length === 0) return ['  —  no route']
    return routes.map((route) => {
      const routeColumns: Parameters<typeof GraphMap.columns>[0] = {
        cells: [
          `  ${route.passkey} ──> ${route.device} ──> ${route.vault}`,
          route.store,
          route.reach,
        ],
        widths: [34, 18, 10],
      }
      return GraphMap.columns(routeColumns)
    })
  }

  function passkeyReport({ graph, id }: PasskeyReportArgs): string[] {
    return graph.passkeys
      .filter((passkey) => passkey.id === id)
      .flatMap((passkey) => {
        const routeProjection = new AccessTerminalRouteProjection(graph)
        const passkeyDevicesRequest: Parameters<
          GraphView['devicesForPasskey']
        >[0] = {
          passkeyId: passkey.id,
        }
        const passkeyVaultsRequest: Parameters<
          GraphView['vaultsForPasskey']
        >[0] = {
          passkeyId: passkey.id,
        }
        const routesRequest: PasskeyRouteProjectionRequest = {
          passkeyId: passkey.id,
        }
        const nookNamedArgument21: Parameters<typeof GraphMap.columns>[0] = {
          cells: ['passkey', passkey.shortId, passkey.label],
          widths: [9, 9, 24],
        }
        const nookNamedArgument22: Parameters<typeof GraphMap.columns>[0] = {
          cells: ['store', GraphView.storeLabel(passkey.store)],
          widths: [9, 24],
        }
        const nookNamedArgument23: Parameters<typeof GraphMap.columns>[0] = {
          cells: ['reach', routeProjection.reachWord(passkey)],
          widths: [9, 24],
        }

        const nookNamedArgument24: Parameters<typeof GraphMap.columns>[0] = {
          cells: [
            'unlocks',
            new GraphView(graph)
              .devicesForPasskey(passkeyDevicesRequest)
              .map((device) => device.shortId)
              .join('  '),
          ],
          widths: [9, 24],
        }

        const nookNamedArgument26: Parameters<typeof GraphMap.columns>[0] = {
          cells: [
            'opens',
            new GraphView(graph)
              .vaultsForPasskey(passkeyVaultsRequest)
              .map((vault) => vault.shortId)
              .join('  '),
          ],
          widths: [9, 24],
        }

        return [
          GraphMap.columns(nookNamedArgument21),
          GraphMap.columns(nookNamedArgument22),
          GraphMap.columns(nookNamedArgument23),
          GraphMap.columns(nookNamedArgument24),
          GraphMap.columns(nookNamedArgument26),
          '',
          ...routeLines(routeProjection.fromPasskey(routesRequest)),
        ]
      })
  }

  function deviceReport({ graph, id }: DeviceReportArgs): string[] {
    return graph.devices
      .filter((device) => device.id === id)
      .flatMap((device) => {
        const routeProjection = new AccessTerminalRouteProjection(graph)
        const deviceHereRequest: Parameters<GraphView['isHere']>[0] = {
          device,
        }
        const deviceVaultsRequest: Parameters<GraphView['vaultsForDevice']>[0] =
          {
            deviceId: device.id,
          }
        const devicePasskeysRequest: Parameters<
          GraphView['passkeysForDevice']
        >[0] = {
          device,
        }
        const nookNamedArgument29: Parameters<typeof GraphMap.columns>[0] = {
          cells: ['device', device.shortId, device.label],
          widths: [9, 9, 24],
        }
        const nookNamedArgument30: Parameters<typeof GraphMap.columns>[0] = {
          cells: ['platform', device.platform],
          widths: [9, 24],
        }

        const nookNamedArgument31: Parameters<typeof GraphMap.columns>[0] = {
          cells: [
            'here',
            new GraphView(graph).isHere(deviceHereRequest) ? 'yes' : 'no',
          ],
          widths: [9, 24],
        }

        return [
          GraphMap.columns(nookNamedArgument29),
          GraphMap.columns(nookNamedArgument30),
          GraphMap.columns(nookNamedArgument31),
          '',
          ...routeLines(
            new GraphView(graph)
              .vaultsForDevice(deviceVaultsRequest)
              .flatMap((vault) => {
                return new GraphView(graph)
                  .passkeysForDevice(devicePasskeysRequest)
                  .map((passkey) => ({
                    passkey: passkey.shortId,
                    device: device.shortId,
                    vault: vault.shortId,
                    store: GraphView.storeLabel(passkey.store),
                    reach: routeProjection.reachWord(passkey),
                  }))
              }),
          ),
        ]
      })
  }

  function vaultReport({ graph, id }: VaultReportArgs): string[] {
    return graph.vaults
      .filter((vault) => vault.id === id)
      .flatMap((vault) => {
        const routeProjectionRequest: VaultRouteProjectionRequest = {
          vault,
        }
        const routes = new AccessTerminalRouteProjection(graph).intoVault(
          routeProjectionRequest,
        )
        const stores = new Set(routes.map((route) => route.store))
        const vaultOpenabilityRequest: Parameters<
          GraphView['openableHere']
        >[0] = {
          vault,
        }
        const vaultPasskeysRequest: Parameters<
          GraphView['passkeysForVault']
        >[0] = {
          vault,
        }
        const nookNamedArgument36: Parameters<typeof GraphMap.columns>[0] = {
          cells: ['vault', vault.shortId, vault.label],
          widths: [9, 9, 24],
        }
        const nookNamedArgument37: Parameters<typeof GraphMap.columns>[0] = {
          cells: ['secrets', `${vault.secrets}`],
          widths: [9, 24],
        }

        const nookNamedArgument38: Parameters<typeof GraphMap.columns>[0] = {
          cells: [
            'here',
            new GraphView(graph).openableHere(vaultOpenabilityRequest)
              ? 'opens'
              : 'locked',
          ],
          widths: [9, 24],
        }

        const nookNamedArgument40: Parameters<typeof GraphMap.columns>[0] = {
          cells: [
            'routes',
            `${
              new GraphView(graph).passkeysForVault(vaultPasskeysRequest).length
            }`,
            'managers',
            `${stores.size}`,
          ],
          widths: [9, 10, 10, 6],
        }
        return [
          GraphMap.columns(nookNamedArgument36),
          GraphMap.columns(nookNamedArgument37),
          GraphMap.columns(nookNamedArgument38),
          GraphMap.columns(nookNamedArgument40),
          '',
          ...routeLines(routes),
        ]
      })
  }

  function reportFor({ graph, match }: ReportForArgs): string[] {
    if (match.kind === NodeKind.Passkey) {
      const reportRequest: PasskeyReportArgs = {
        graph,
        id: match.id,
      }
      return passkeyReport(reportRequest)
    }

    if (match.kind === NodeKind.Device) {
      const reportRequest: DeviceReportArgs = {
        graph,
        id: match.id,
      }
      return deviceReport(reportRequest)
    }

    const reportRequest: VaultReportArgs = {
      graph,
      id: match.id,
    }
    return vaultReport(reportRequest)
  }

  function matchLines(matches: TerminalMatches): string[] {
    return matches.map((match) => {
      const matchColumns: Parameters<typeof GraphMap.columns>[0] = {
        cells: [
          `  ${match.shortId}`,
          GraphView.kindLabel(match.kind),
          match.label,
        ],
        widths: [10, 12, 24],
      }
      return GraphMap.columns(matchColumns)
    })
  }

  function listPasskeys(graph: KeyGraph): string[] {
    const headingColumns: Parameters<typeof GraphMap.columns>[0] = {
      cells: ['  id', 'manager', 'reach', 'unlocks', 'opens'],
      widths: [10, 18, 12, 10, 8],
    }
    return [
      'passkeys',
      GraphMap.columns(headingColumns),
      ...graph.passkeys.map((passkey) => {
        const routeProjection = new AccessTerminalRouteProjection(graph)
        const nookNamedArgument48: Parameters<
          GraphView['devicesForPasskey']
        >[0] = {
          passkeyId: passkey.id,
        }
        const passkeyVaultsRequest: Parameters<
          GraphView['vaultsForPasskey']
        >[0] = {
          passkeyId: passkey.id,
        }

        const nookNamedArgument47: Parameters<typeof GraphMap.columns>[0] = {
          cells: [
            `  ${passkey.shortId}`,
            GraphView.storeLabel(passkey.store),
            routeProjection.reachWord(passkey),
            `${new GraphView(graph).devicesForPasskey(nookNamedArgument48).length}`,
            `${
              new GraphView(graph).vaultsForPasskey(passkeyVaultsRequest).length
            }`,
          ],
          widths: [10, 18, 12, 10, 8],
        }
        return GraphMap.columns(nookNamedArgument47)
      }),
    ]
  }

  function listDevices(graph: KeyGraph): string[] {
    const headingColumns: Parameters<typeof GraphMap.columns>[0] = {
      cells: ['  id', 'platform', 'here', 'passkeys', 'vaults'],
      widths: [10, 18, 8, 18, 8],
    }
    return [
      'device keys',
      GraphMap.columns(headingColumns),
      ...graph.devices.map((device) => {
        const nookNamedArgument52: Parameters<GraphView['isHere']>[0] = {
          device,
        }
        const nookNamedArgument53: Parameters<
          GraphView['passkeysForDevice']
        >[0] = {
          device,
        }
        const deviceVaultsRequest: Parameters<GraphView['vaultsForDevice']>[0] =
          {
            deviceId: device.id,
          }

        const nookNamedArgument51: Parameters<typeof GraphMap.columns>[0] = {
          cells: [
            `  ${device.shortId}`,
            device.platform,
            new GraphView(graph).isHere(nookNamedArgument52) ? 'yes' : '·',
            new GraphView(graph)
              .passkeysForDevice(nookNamedArgument53)
              .map((passkey) => passkey.shortId)
              .join(' '),
            `${
              new GraphView(graph).vaultsForDevice(deviceVaultsRequest).length
            }`,
          ],
          widths: [10, 18, 8, 18, 8],
        }
        return GraphMap.columns(nookNamedArgument51)
      }),
    ]
  }

  function listVaults(graph: KeyGraph): string[] {
    const headingColumns: Parameters<typeof GraphMap.columns>[0] = {
      cells: ['  id', 'name', 'secrets', 'passkeys', 'here'],
      widths: [10, 16, 10, 25, 8],
    }
    return [
      'vaults',
      GraphMap.columns(headingColumns),
      ...graph.vaults.map((vault) => {
        const nookNamedArgument57: Parameters<
          GraphView['passkeysForVault']
        >[0] = {
          vault,
        }
        const vaultOpenabilityRequest: Parameters<
          GraphView['openableHere']
        >[0] = {
          vault,
        }

        const nookNamedArgument56: Parameters<typeof GraphMap.columns>[0] = {
          cells: [
            `  ${vault.shortId}`,
            vault.label,
            `${vault.secrets}`,
            new GraphView(graph)
              .passkeysForVault(nookNamedArgument57)
              .map((passkey) => passkey.shortId)
              .join(' '),
            new GraphView(graph).openableHere(vaultOpenabilityRequest)
              ? 'opens'
              : 'locked',
          ],
          widths: [10, 16, 10, 25, 8],
        }
        return GraphMap.columns(nookNamedArgument56)
      }),
    ]
  }

  function hereReport(graph: KeyGraph): string[] {
    const devices = new GraphView(graph).hereDevices()
    const usable = new GraphView(graph)
      .usableHere()
      .map((passkey) => passkey.shortId)
    const open = graph.vaults
      .filter((vault) => {
        const vaultOpenabilityRequest: Parameters<
          GraphView['openableHere']
        >[0] = {
          vault,
        }
        return new GraphView(graph).openableHere(vaultOpenabilityRequest)
      })
      .map((vault) => vault.shortId)
    const nookNamedArgument60: Parameters<typeof GraphMap.columns>[0] = {
      cells: [
        'browser',
        devices.length > 0
          ? devices.map((device) => device.shortId).join(' ')
          : '—  no device key',
      ],
      widths: [10, 30],
    }
    const nookNamedArgument61: Parameters<typeof GraphMap.columns>[0] = {
      cells: ['present', usable.length > 0 ? usable.join('  ') : '—'],
      widths: [10, 30],
    }
    const openVaultsColumns: Parameters<typeof GraphMap.columns>[0] = {
      cells: ['opens', open.length > 0 ? open.join('  ') : '—'],
      widths: [10, 30],
    }

    return [
      GraphMap.columns(nookNamedArgument60),
      GraphMap.columns(nookNamedArgument61),
      GraphMap.columns(openVaultsColumns),
    ]
  }

  function helpLines(): string[] {
    const nookNamedArgument89: Parameters<typeof GraphMap.columns>[0] = {
      cells: ['  ls', 'passkeys · device keys · vaults'],
      widths: [16, 40],
    }
    const nookNamedArgument90: Parameters<typeof GraphMap.columns>[0] = {
      cells: ['  id <id>', 'everything that identifier reaches'],
      widths: [16, 40],
    }
    const nookNamedArgument91: Parameters<typeof GraphMap.columns>[0] = {
      cells: ['  opens <id>', 'passkeys that open a vault'],
      widths: [16, 40],
    }
    const nookNamedArgument92: Parameters<typeof GraphMap.columns>[0] = {
      cells: ['  here', 'what this browser holds'],
      widths: [16, 40],
    }
    const nookNamedArgument93: Parameters<typeof GraphMap.columns>[0] = {
      cells: ['  map', 'the whole graph, drawn'],
      widths: [16, 40],
    }
    const clearHelpColumns: Parameters<typeof GraphMap.columns>[0] = {
      cells: ['  clear', 'wipe the transcript'],
      widths: [16, 40],
    }

    return [
      GraphMap.columns(nookNamedArgument89),
      GraphMap.columns(nookNamedArgument90),
      GraphMap.columns(nookNamedArgument91),
      GraphMap.columns(nookNamedArgument92),
      GraphMap.columns(nookNamedArgument93),
      GraphMap.columns(clearHelpColumns),
    ]
  }

  function lookup({ graph, query }: AccessTerminalGraphLookup): Match[] {
    const nookNamedArgument95: Parameters<typeof passkeyMatches>[0] = {
      graph,
      query,
    }
    const nookNamedArgument96: Parameters<typeof deviceMatches>[0] = {
      graph,
      query,
    }
    const vaultMatchesRequest: VaultMatchesArgs = {
      graph,
      query,
    }

    return [
      ...passkeyMatches(nookNamedArgument95),
      ...deviceMatches(nookNamedArgument96),
      ...vaultMatches(vaultMatchesRequest),
    ]
  }

  function idCommand({ graph, query }: IdCommandArgs): string[] {
    if (query.length === 0) {
      const lookupRequest: AccessTerminalGraphLookup = {
        graph,
        query: '',
      }
      return ['id <id>', ...matchLines(lookup(lookupRequest))]
    }

    const lookupRequest: AccessTerminalGraphLookup = { graph, query }
    const matches = lookup(lookupRequest)
    if (matches.length === 0) {
      const allMatchesRequest: AccessTerminalGraphLookup = {
        graph,
        query: '',
      }
      return [
        `no match  ${query}`,
        '',
        ...matchLines(lookup(allMatchesRequest)),
      ]
    }
    if (matches.length > 1) {
      return [`${matches.length} matches  ${query}`, '', ...matchLines(matches)]
    }
    return matches.flatMap((match) => {
      const reportRequest: ReportForArgs = {
        graph,
        match,
      }
      return reportFor(reportRequest)
    })
  }

  function opensCommand({ graph, query }: OpensCommandArgs): string[] {
    if (query.length === 0) {
      const allVaultsRequest: VaultMatchesArgs = {
        graph,
        query: '',
      }
      return ['opens <id>', '', ...matchLines(vaultMatches(allVaultsRequest))]
    }

    const vaultLookupRequest: VaultMatchesArgs = { graph, query }
    const matches = vaultMatches(vaultLookupRequest)
    if (matches.length === 0) {
      const allVaultsRequest: VaultMatchesArgs = {
        graph,
        query: '',
      }
      return [
        `no vault  ${query}`,
        '',
        ...matchLines(vaultMatches(allVaultsRequest)),
      ]
    }
    return matches.flatMap((match) => {
      const reportRequest: VaultReportArgs = {
        graph,
        id: match.id,
      }
      return vaultReport(reportRequest)
    })
  }

  function outputFor({ graph, command }: OutputForArgs): string[] {
    const [verb = '', ...rest] = command.split(' ')
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
      return [
        ...new GraphMap(graph).mapArt(),
        '',
        ...new GraphMap(graph).legend(),
      ]
    }
    if (command === 'help') return helpLines()

    if (verb === 'id' || verb === 'show') {
      const request: IdCommandArgs = {
        graph,
        query: argument,
      }
      return idCommand(request)
    }

    if (verb === 'opens') {
      const request: OpensCommandArgs = {
        graph,
        query: argument,
      }
      return opensCommand(request)
    }

    if (verb.length === 6) {
      const request: IdCommandArgs = {
        graph,
        query: verb,
      }
      return idCommand(request)
    }
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

    const outputRequest: OutputForArgs = { graph, command }
    transcript = [
      ...transcript,
      {
        id: nextId,
        prompt: command,
        lines: outputFor(outputRequest),
      },
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
    onGraph={(next: GraphId) => {
      graphId = next
      history = []
      historyIndex = 0
      nextId = 1
      transcript = [banner(GraphView.graphById(next))]
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
          {#each new GraphView(graph).hereDevices() as device (device.id)}
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
