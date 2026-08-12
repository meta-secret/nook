import {
  type Device,
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
  type Vault,
  vaultsForDevice,
  vaultsForPasskey,
} from '../_shared/key-graph'

export interface TerminalBlock {
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

type Block = TerminalBlock

type TerminalReportColumnPadding = { text: string; width: number }

function pad({ text, width }: TerminalReportColumnPadding): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length)
}

type KeyAccessTerminalColumnLayout = {
  cells: string[]
  widths: number[]
}

type TerminalShortIdentifiers = string[]

function columns({ cells, widths }: KeyAccessTerminalColumnLayout): string {
  return [...cells.entries()]
    .map(([index, cell]) => {
      const nookNamedArgument117: Parameters<typeof pad>[0] = {
        text: cell,
        width: widths[index] ? widths[index] : 0,
      }
      return pad(nookNamedArgument117)
    })
    .join('')
    .trimEnd()
}

function ids(shortIds: TerminalShortIdentifiers): string {
  return shortIds.length > 0 ? shortIds.join('  ') : '—'
}

/** The identifier of this browser's device key, or an empty string. */
function hereId(graph: KeyGraph): string {
  return hereDevices(graph)
    .map((device) => device.shortId)
    .join('')
}

function reachWord(passkey: Passkey): string {
  return passkey.reach === Reach.Here ? 'here' : 'elsewhere'
}

/** Whether this passkey opens this vault through the key of this browser. */
type RouteHereArgs = {
  graph: KeyGraph
  passkeyId: string
  vault: Vault
}

function routeHere({ graph, passkeyId, vault }: RouteHereArgs) {
  return hereDevices(graph).some(
    (device) =>
      vault.deviceIds.includes(device.id) &&
      device.passkeyIds.includes(passkeyId),
  )
}

/** `here`, or the identifiers of the other devices the route depends on. */
type RouteWordArgs = {
  graph: KeyGraph
  passkeyId: string
  vault: Vault
}

function routeWord({ graph, passkeyId, vault }: RouteWordArgs): string {
  const nookNamedArgument118: Parameters<typeof routeHere>[0] = {
    graph,
    passkeyId,
    vault,
  }
  if (routeHere(nookNamedArgument118)) return 'here'
  const via = graph.devices
    .filter(
      (device) =>
        vault.deviceIds.includes(device.id) &&
        device.passkeyIds.includes(passkeyId),
    )
    .map((device) => device.shortId)
  return via.length > 0 ? `via ${via.join(' ')}` : 'no route'
}

type TerminalReportBranchPosition = { index: number; count: number }

function branch({ index, count }: TerminalReportBranchPosition): string {
  return index === count - 1 ? '└─' : '├─'
}

type VaultBlockArgs = {
  graph: KeyGraph
  vault: Vault
}

function vaultBlock({ graph, vault }: VaultBlockArgs): string[] {
  const nookNamedArgument120: Parameters<typeof openableHere>[0] = {
    graph,
    vault,
  }
  const nookNamedArgument119: Parameters<typeof columns>[0] = {
    cells: [
      vault.shortId,
      vault.label,
      `${vault.secrets}`,
      openableHere(nookNamedArgument120) ? 'opens here' : 'locked',
    ],
    widths: [8, 16, 5, 12],
  }
  const head = columns(nookNamedArgument119)
  const nookNamedArgument121: Parameters<typeof passkeysForVault>[0] = {
    graph,
    vault,
  }
  const openers = passkeysForVault(nookNamedArgument121)
  if (openers.length === 0) return [head, '  ╳  no passkey']
  return [
    head,
    ...[...openers.entries()].map(([index, passkey]) => {
      const nookNamedArgument123: Parameters<typeof branch>[0] = {
        index,
        count: openers.length,
      }
      const nookNamedArgument124: Parameters<typeof routeWord>[0] = {
        graph,
        passkeyId: passkey.id,
        vault,
      }
      const nookNamedArgument122: Parameters<typeof columns>[0] = {
        cells: [
          `  ${branch(nookNamedArgument123)} ${passkey.shortId}`,
          storeLabel(passkey.store),
          routeWord(nookNamedArgument124),
        ],
        widths: [14, 18, 14],
      }
      return columns(nookNamedArgument122)
    }),
  ]
}

function mapLines(graph: KeyGraph): string[] {
  const here = hereId(graph)
  return [
    'vaults · what opens each',
    '',
    ...graph.vaults.flatMap((vault) => {
      const nookNamedArgument125: Parameters<typeof vaultBlock>[0] = {
        graph,
        vault,
      }
      return [...vaultBlock(nookNamedArgument125), '']
    }),
    here.length > 0
      ? `here = through my device key ${here}`
      : 'no device key in this browser',
  ]
}

function myLines(graph: KeyGraph): string[] {
  const devices = hereDevices(graph)
  const open = graph.vaults
    .filter((vault) => {
      const nookNamedArgument126: Parameters<typeof openableHere>[0] = {
        graph,
        vault,
      }
      return openableHere(nookNamedArgument126)
    })
    .map((vault) => vault.shortId)
  const shut = graph.vaults
    .filter((vault) => {
      const nookNamedArgument127: Parameters<typeof openableHere>[0] = {
        graph,
        vault,
      }
      return !openableHere(nookNamedArgument127)
    })
    .map((vault) => vault.shortId)
  const head = devices.flatMap((device) => {
    const nookNamedArgument128: Parameters<typeof columns>[0] = {
      cells: ['my device', device.shortId, device.platform],
      widths: [12, 9, 22],
    }
    const nookNamedArgument130: Parameters<typeof passkeysForDevice>[0] = {
      graph,
      device,
    }
    const nookNamedArgument129: Parameters<typeof columns>[0] = {
      cells: [
        'unlocked',
        ids(
          passkeysForDevice(nookNamedArgument130).map(
            (passkey) => passkey.shortId,
          ),
        ),
      ],
      widths: [12, 30],
    }
    return [columns(nookNamedArgument128), columns(nookNamedArgument129)]
  })
  const nookNamedArgument131: Parameters<typeof columns>[0] = {
    cells: ['my device', '—  no device key'],
    widths: [12, 30],
  }
  const nookNamedArgument132: Parameters<typeof columns>[0] = {
    cells: ['opens', ids(open)],
    widths: [12, 30],
  }
  const nookNamedArgument133: Parameters<typeof columns>[0] = {
    cells: ['locked', ids(shut)],
    widths: [12, 30],
  }
  return [
    ...head,
    ...(devices.length > 0 ? [] : [columns(nookNamedArgument131)]),
    columns(nookNamedArgument132),
    columns(nookNamedArgument133),
  ]
}

type OtherDeviceLinesArgs = {
  graph: KeyGraph
  device: Device
}

function otherDeviceLines({ graph, device }: OtherDeviceLinesArgs): string[] {
  const nookNamedArgument134: Parameters<typeof columns>[0] = {
    cells: ['other device', device.shortId, device.label],
    widths: [14, 9, 20],
  }
  const nookNamedArgument135: Parameters<typeof columns>[0] = {
    cells: ['platform', device.platform],
    widths: [14, 24],
  }
  const nookNamedArgument137: Parameters<typeof vaultsForDevice>[0] = {
    graph,
    deviceId: device.id,
  }
  const nookNamedArgument136: Parameters<typeof columns>[0] = {
    cells: [
      'vaults',
      ids(vaultsForDevice(nookNamedArgument137).map((vault) => vault.shortId)),
    ],
    widths: [14, 30],
  }
  return [
    columns(nookNamedArgument134),
    columns(nookNamedArgument135),
    columns(nookNamedArgument136),
  ]
}

type PasskeyLinesArgs = {
  graph: KeyGraph
  passkey: Passkey
}

function passkeyLines({ graph, passkey }: PasskeyLinesArgs): string[] {
  const nookNamedArgument138: Parameters<typeof vaultsForPasskey>[0] = {
    graph,
    passkeyId: passkey.id,
  }
  const reached = vaultsForPasskey(nookNamedArgument138)
  const nookNamedArgument139: Parameters<typeof columns>[0] = {
    cells: ['passkey', passkey.shortId, passkey.label],
    widths: [10, 9, 24],
  }
  const nookNamedArgument140: Parameters<typeof columns>[0] = {
    cells: ['manager', storeLabel(passkey.store)],
    widths: [10, 24],
  }
  const nookNamedArgument141: Parameters<typeof columns>[0] = {
    cells: ['present', reachWord(passkey)],
    widths: [10, 24],
  }
  return [
    columns(nookNamedArgument139),
    columns(nookNamedArgument140),
    columns(nookNamedArgument141),
    '',
    'opens',
    ...(reached.length === 0
      ? ['  ╳  no vault']
      : [...reached.entries()].map(([index, vault]) => {
          const nookNamedArgument143: Parameters<typeof branch>[0] = {
            index,
            count: reached.length,
          }
          const nookNamedArgument144: Parameters<typeof routeWord>[0] = {
            graph,
            passkeyId: passkey.id,
            vault,
          }
          const nookNamedArgument142: Parameters<typeof columns>[0] = {
            cells: [
              `  ${branch(nookNamedArgument143)} ${vault.shortId}`,
              vault.label,
              routeWord(nookNamedArgument144),
            ],
            widths: [14, 18, 14],
          }
          return columns(nookNamedArgument142)
        })),
  ]
}

function listPasskeys(graph: KeyGraph): string[] {
  const nookNamedArgument145: Parameters<typeof columns>[0] = {
    cells: ['  id', 'manager', 'present', 'vaults'],
    widths: [10, 19, 11, 8],
  }
  return [
    'passkeys',
    columns(nookNamedArgument145),
    ...graph.passkeys.map((passkey) => {
      const nookNamedArgument147: Parameters<typeof vaultsForPasskey>[0] = {
        graph,
        passkeyId: passkey.id,
      }
      const nookNamedArgument146: Parameters<typeof columns>[0] = {
        cells: [
          `  ${passkey.shortId}`,
          storeLabel(passkey.store),
          reachWord(passkey),
          `${vaultsForPasskey(nookNamedArgument147).length}`,
        ],
        widths: [10, 19, 11, 8],
      }
      return columns(nookNamedArgument146)
    }),
  ]
}

function listVaults(graph: KeyGraph): string[] {
  const nookNamedArgument148: Parameters<typeof columns>[0] = {
    cells: ['  id', 'name', 'secrets', 'keys', 'here'],
    widths: [10, 16, 9, 7, 12],
  }
  return [
    'vaults',
    columns(nookNamedArgument148),
    ...graph.vaults.map((vault) => {
      const nookNamedArgument150: Parameters<typeof passkeysForVault>[0] = {
        graph,
        vault,
      }
      const nookNamedArgument151: Parameters<typeof openableHere>[0] = {
        graph,
        vault,
      }
      const nookNamedArgument149: Parameters<typeof columns>[0] = {
        cells: [
          `  ${vault.shortId}`,
          vault.label,
          `${vault.secrets}`,
          `${passkeysForVault(nookNamedArgument150).length}`,
          openableHere(nookNamedArgument151) ? 'opens' : 'locked',
        ],
        widths: [10, 16, 9, 7, 12],
      }
      return columns(nookNamedArgument149)
    }),
  ]
}

function listOthers(graph: KeyGraph): string[] {
  const devices = graph.devices.filter((device) => {
    const nookNamedArgument152: Parameters<typeof isHere>[0] = {
      graph,
      device,
    }
    return !isHere(nookNamedArgument152)
  })
  if (devices.length === 0) return ['other devices', '  —']
  return [
    'other devices',
    ...devices.map((device) => {
      const nookNamedArgument154: Parameters<typeof vaultsForDevice>[0] = {
        graph,
        deviceId: device.id,
      }
      const nookNamedArgument153: Parameters<typeof columns>[0] = {
        cells: [
          `  ${device.shortId}`,
          device.label,
          device.platform,
          `${vaultsForDevice(nookNamedArgument154).length} vaults`,
        ],
        widths: [10, 16, 18, 10],
      }
      return columns(nookNamedArgument153)
    }),
  ]
}

function helpLines(): string[] {
  const nookNamedArgument155: Parameters<typeof columns>[0] = {
    cells: ['  map', 'vaults · the passkeys that open them'],
    widths: [12, 40],
  }
  const nookNamedArgument156: Parameters<typeof columns>[0] = {
    cells: ['  ls', 'passkeys · vaults · other devices'],
    widths: [12, 40],
  }
  const nookNamedArgument157: Parameters<typeof columns>[0] = {
    cells: ['  id <id>', 'one identifier'],
    widths: [12, 40],
  }
  const nookNamedArgument158: Parameters<typeof columns>[0] = {
    cells: ['  here', 'what this browser can do now'],
    widths: [12, 40],
  }
  const nookNamedArgument159: Parameters<typeof columns>[0] = {
    cells: ['  tab', 'complete an identifier'],
    widths: [12, 40],
  }
  const nookNamedArgument160: Parameters<typeof columns>[0] = {
    cells: ['  clear', 'wipe the transcript'],
    widths: [12, 40],
  }
  return [
    columns(nookNamedArgument155),
    columns(nookNamedArgument156),
    columns(nookNamedArgument157),
    columns(nookNamedArgument158),
    columns(nookNamedArgument159),
    columns(nookNamedArgument160),
  ]
}

/** The header the console keeps even after clear, as a real terminal does. */
export function banner(graph: KeyGraph): Block {
  const others = graph.devices.filter((device) => {
    const nookNamedArgument161: Parameters<typeof isHere>[0] = {
      graph,
      device,
    }
    return !isHere(nookNamedArgument161)
  }).length
  const nookNamedArgument162: Parameters<typeof columns>[0] = {
    cells: [
      `passkeys ${graph.passkeys.length}`,
      `vaults ${graph.vaults.length}`,
      `other devices ${others}`,
    ],
    widths: [13, 11, 18],
  }
  return {
    id: 0,
    prompt: '',
    lines: [
      `nook keys · ${graph.label}`,
      columns(nookNamedArgument162),
      '',
      'map · ls · id <id> · here · help · clear',
    ],
  }
}

export function opening(graph: KeyGraph): Block[] {
  return [banner(graph), { id: 1, prompt: 'map', lines: mapLines(graph) }]
}

type KeyAccessTerminalTextMatch = {
  query: string
  shortId: string
  id: string
  label: string
}

function hits({ query, shortId, id, label }: KeyAccessTerminalTextMatch) {
  const needle = query.toLowerCase()
  return (
    shortId.toLowerCase().startsWith(needle) ||
    id.toLowerCase() === needle ||
    label.toLowerCase().includes(needle)
  )
}

type KeyAccessTerminalGraphLookup = { graph: KeyGraph; query: string }

function lookup({ graph, query }: KeyAccessTerminalGraphLookup): Match[] {
  return [
    ...graph.passkeys
      .filter((passkey) => {
        const nookNamedArgument163: Parameters<typeof hits>[0] = {
          query,
          shortId: passkey.shortId,
          id: passkey.id,
          label: passkey.label,
        }
        return hits(nookNamedArgument163)
      })
      .map((passkey) => ({
        kind: NodeKind.Passkey,
        id: passkey.id,
        shortId: passkey.shortId,
        label: passkey.label,
      })),
    ...graph.vaults
      .filter((vault) => {
        const nookNamedArgument164: Parameters<typeof hits>[0] = {
          query,
          shortId: vault.shortId,
          id: vault.id,
          label: vault.label,
        }
        return hits(nookNamedArgument164)
      })
      .map((vault) => ({
        kind: NodeKind.Vault,
        id: vault.id,
        shortId: vault.shortId,
        label: vault.label,
      })),
    ...graph.devices
      .filter((device) => {
        const nookNamedArgument165: Parameters<typeof hits>[0] = {
          query,
          shortId: device.shortId,
          id: device.id,
          label: device.label,
        }
        return hits(nookNamedArgument165)
      })
      .map((device) => ({
        kind: NodeKind.Device,
        id: device.id,
        shortId: device.shortId,
        label: device.label,
      })),
  ]
}

/** My device key never reads as one more `Device key` row among the rest. */
type KindWordArgs = { graph: KeyGraph; match: Match }

function kindWord({ graph, match }: KindWordArgs): string {
  if (match.kind !== NodeKind.Device) return kindLabel(match.kind)
  return graph.devices.some((device) => {
    const nookNamedArgument166: Parameters<typeof isHere>[0] = {
      graph,
      device,
    }
    return device.id === match.id && isHere(nookNamedArgument166)
  })
    ? 'my device'
    : 'other device'
}

type MatchLinesArgs = {
  graph: KeyGraph
  matches: Match[]
}

function matchLines({ graph, matches }: MatchLinesArgs): string[] {
  return matches.map((match) => {
    const nookNamedArgument168: Parameters<typeof kindWord>[0] = {
      graph,
      match,
    }
    const nookNamedArgument167: Parameters<typeof columns>[0] = {
      cells: [
        `  ${match.shortId}`,
        kindWord(nookNamedArgument168),
        match.label,
      ],
      widths: [10, 14, 22],
    }
    return columns(nookNamedArgument167)
  })
}

/** The identifiers you can ask about, grouped so classes never interleave. */
function indexLines(graph: KeyGraph): string[] {
  const others = graph.devices.filter((device) => {
    const nookNamedArgument169: Parameters<typeof isHere>[0] = {
      graph,
      device,
    }
    return !isHere(nookNamedArgument169)
  })
  return [
    'passkeys',
    ...graph.passkeys.map((passkey) => {
      const nookNamedArgument170: Parameters<typeof columns>[0] = {
        cells: [`  ${passkey.shortId}`, passkey.label],
        widths: [10, 24],
      }
      return columns(nookNamedArgument170)
    }),
    '',
    'vaults',
    ...graph.vaults.map((vault) => {
      const nookNamedArgument171: Parameters<typeof columns>[0] = {
        cells: [`  ${vault.shortId}`, vault.label],
        widths: [10, 24],
      }
      return columns(nookNamedArgument171)
    }),
    ...(others.length > 0
      ? [
          '',
          'other devices',
          ...others.map((device) => {
            const nookNamedArgument172: Parameters<typeof columns>[0] = {
              cells: [`  ${device.shortId}`, device.label],
              widths: [10, 24],
            }
            return columns(nookNamedArgument172)
          }),
        ]
      : []),
  ]
}

type ReportForArgs = {
  graph: KeyGraph
  match: Match
}

function reportFor({ graph, match }: ReportForArgs): string[] {
  if (match.kind === NodeKind.Passkey) {
    return graph.passkeys
      .filter((passkey) => passkey.id === match.id)
      .flatMap((passkey) => {
        const nookNamedArgument173: Parameters<typeof passkeyLines>[0] = {
          graph,
          passkey,
        }
        return passkeyLines(nookNamedArgument173)
      })
  }
  if (match.kind === NodeKind.Vault) {
    return graph.vaults
      .filter((vault) => vault.id === match.id)
      .flatMap((vault) => {
        const nookNamedArgument174: Parameters<typeof vaultBlock>[0] = {
          graph,
          vault,
        }
        return vaultBlock(nookNamedArgument174)
      })
  }
  return graph.devices
    .filter((device) => device.id === match.id)
    .flatMap((device) => {
      const nookNamedArgument175: Parameters<typeof isHere>[0] = {
        graph,
        device,
      }
      const nookNamedArgument176: Parameters<typeof otherDeviceLines>[0] = {
        graph,
        device,
      }
      return isHere(nookNamedArgument175)
        ? myLines(graph)
        : otherDeviceLines(nookNamedArgument176)
    })
}

type IdCommandArgs = {
  graph: KeyGraph
  query: string
}

function idCommand({ graph, query }: IdCommandArgs): string[] {
  if (query.length === 0) return ['id <id>', '', ...indexLines(graph)]
  const nookNamedArgument177: Parameters<typeof lookup>[0] = { graph, query }
  const matches = lookup(nookNamedArgument177)
  if (matches.length === 0) {
    return [`no match  ${query}`, '', ...indexLines(graph)]
  }
  if (matches.length > 1) {
    const nookNamedArgument178: Parameters<typeof matchLines>[0] = {
      graph,
      matches,
    }
    return [
      `${matches.length} matches  ${query}`,
      '',
      ...matchLines(nookNamedArgument178),
    ]
  }
  return matches.flatMap((match) => {
    const nookNamedArgument179: Parameters<typeof reportFor>[0] = {
      graph,
      match,
    }
    return reportFor(nookNamedArgument179)
  })
}

type OutputForArgs = {
  graph: KeyGraph
  command: string
}

export function outputFor({ graph, command }: OutputForArgs): string[] {
  const [verb, ...rest] = command.split(' ')
  const argument = rest.join(' ')
  if (command === 'map') return mapLines(graph)
  if (command === 'ls') {
    return [
      ...listPasskeys(graph),
      '',
      ...listVaults(graph),
      '',
      ...listOthers(graph),
    ]
  }
  if (command === 'here') return myLines(graph)
  if (command === 'help') return helpLines()
  const nookNamedArgument180: Parameters<typeof idCommand>[0] = {
    graph,
    query: argument,
  }
  if (verb === 'id') return idCommand(nookNamedArgument180)
  const nookNamedArgument181: Parameters<typeof idCommand>[0] = {
    graph,
    query: verb,
  }
  if (verb && verb.length === 6) return idCommand(nookNamedArgument181)
  return [`unknown  ${command}`, '', ...helpLines()]
}
