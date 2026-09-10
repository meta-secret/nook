import {
  type Device,
  type KeyGraph,
  NodeKind,
  type Passkey,
  Reach,
  type Vault,
  KeyGraphView,
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

type KeyAccessTerminalColumnLayout = {
  cells: string[]
  widths: number[]
}

type TerminalShortIdentifiers = string[]

/** Whether this passkey opens this vault through the key of this browser. */
type RouteHereArgs = {
  passkeyId: string
  vault: Vault
}

/** `here`, or the identifiers of the other devices the route depends on. */
type RouteWordArgs = {
  passkeyId: string
  vault: Vault
}

type TerminalReportBranchPosition = { index: number; count: number }

type VaultBlockArgs = {
  vault: Vault
}

type OtherDeviceLinesArgs = {
  device: Device
}

type PasskeyLinesArgs = {
  passkey: Passkey
}

type KeyAccessTerminalTextMatch = {
  query: string
  shortId: string
  id: string
  label: string
}

type KeyAccessTerminalGraphLookup = { query: string }

/** My device key never reads as one more `Device key` row among the rest. */
type KindWordArgs = { match: Match }

type MatchLinesArgs = {
  matches: Match[]
}

type ReportForArgs = {
  match: Match
}

type IdCommandArgs = {
  query: string
}

type OutputForArgs = {
  command: string
}

/** Owns browser orchestration for one nook web research/src/experiments/keys management/access terminal/terminal reports context. */
export class KeyTerminalReport {
  constructor(private readonly graph: KeyGraph) {}

  private static pad({ text, width }: TerminalReportColumnPadding): string {
    return text.length >= width ? text : text + ' '.repeat(width - text.length)
  }

  private static columns({
    cells,
    widths,
  }: KeyAccessTerminalColumnLayout): string {
    return [...cells.entries()]
      .map(([index, cell]) => {
        const nookNamedArgument117: Parameters<
          typeof KeyTerminalReport.pad
        >[0] = {
          text: cell,
          width: widths[index] ? widths[index] : 0,
        }
        return KeyTerminalReport.pad(nookNamedArgument117)
      })
      .join('')
      .trimEnd()
  }

  private static ids(shortIds: TerminalShortIdentifiers): string {
    return shortIds.length > 0 ? shortIds.join('  ') : '—'
  }

  private hereId(): string {
    const graph = this.graph
    return new KeyGraphView(graph)
      .hereDevices()
      .map((device) => device.shortId)
      .join('')
  }

  private static reachWord(passkey: Passkey): string {
    return passkey.reach === Reach.Here ? 'here' : 'elsewhere'
  }

  private routeHere({ passkeyId, vault }: RouteHereArgs) {
    const graph = this.graph
    return new KeyGraphView(graph)
      .hereDevices()
      .some(
        (device) =>
          vault.deviceIds.includes(device.id) &&
          device.passkeyIds.includes(passkeyId),
      )
  }

  private routeWord({ passkeyId, vault }: RouteWordArgs): string {
    const graph = this.graph
    const nookNamedArgument118: Parameters<KeyTerminalReport['routeHere']>[0] =
      {
        passkeyId,
        vault,
      }
    if (this.routeHere(nookNamedArgument118)) return 'here'
    const via = graph.devices
      .filter(
        (device) =>
          vault.deviceIds.includes(device.id) &&
          device.passkeyIds.includes(passkeyId),
      )
      .map((device) => device.shortId)
    return via.length > 0 ? `via ${via.join(' ')}` : 'no route'
  }

  private static branch({
    index,
    count,
  }: TerminalReportBranchPosition): string {
    return index === count - 1 ? '└─' : '├─'
  }

  private vaultBlock({ vault }: VaultBlockArgs): string[] {
    const graph = this.graph
    const nookNamedArgument120: Parameters<KeyGraphView['openableHere']>[0] = {
      vault,
    }
    const nookNamedArgument119: Parameters<
      typeof KeyTerminalReport.columns
    >[0] = {
      cells: [
        vault.shortId,
        vault.label,
        `${vault.secrets}`,
        new KeyGraphView(graph).openableHere(nookNamedArgument120)
          ? 'opens here'
          : 'locked',
      ],
      widths: [8, 16, 5, 12],
    }
    const head = KeyTerminalReport.columns(nookNamedArgument119)
    const nookNamedArgument121: Parameters<
      KeyGraphView['passkeysForVault']
    >[0] = {
      vault,
    }
    const openers = new KeyGraphView(graph).passkeysForVault(
      nookNamedArgument121,
    )
    if (openers.length === 0) return [head, '  ╳  no passkey']
    return [
      head,
      ...[...openers.entries()].map(([index, passkey]) => {
        const nookNamedArgument123: Parameters<
          typeof KeyTerminalReport.branch
        >[0] = {
          index,
          count: openers.length,
        }
        const nookNamedArgument124: Parameters<
          KeyTerminalReport['routeWord']
        >[0] = {
          passkeyId: passkey.id,
          vault,
        }
        const nookNamedArgument122: Parameters<
          typeof KeyTerminalReport.columns
        >[0] = {
          cells: [
            `  ${KeyTerminalReport.branch(nookNamedArgument123)} ${passkey.shortId}`,
            KeyGraphView.storeLabel(passkey.store),
            this.routeWord(nookNamedArgument124),
          ],
          widths: [14, 18, 14],
        }
        return KeyTerminalReport.columns(nookNamedArgument122)
      }),
    ]
  }

  private mapLines(): string[] {
    const graph = this.graph
    const here = this.hereId()
    return [
      'vaults · what opens each',
      '',
      ...graph.vaults.flatMap((vault) => {
        const nookNamedArgument125: Parameters<
          KeyTerminalReport['vaultBlock']
        >[0] = {
          vault,
        }
        return [...this.vaultBlock(nookNamedArgument125), '']
      }),
      here.length > 0
        ? `here = through my device key ${here}`
        : 'no device key in this browser',
    ]
  }

  private myLines(): string[] {
    const graph = this.graph
    const devices = new KeyGraphView(graph).hereDevices()
    const open = graph.vaults
      .filter((vault) => {
        const nookNamedArgument126: Parameters<
          KeyGraphView['openableHere']
        >[0] = {
          vault,
        }
        return new KeyGraphView(graph).openableHere(nookNamedArgument126)
      })
      .map((vault) => vault.shortId)
    const shut = graph.vaults
      .filter((vault) => {
        const nookNamedArgument127: Parameters<
          KeyGraphView['openableHere']
        >[0] = {
          vault,
        }
        return !new KeyGraphView(graph).openableHere(nookNamedArgument127)
      })
      .map((vault) => vault.shortId)
    const head = devices.flatMap((device) => {
      const nookNamedArgument128: Parameters<
        typeof KeyTerminalReport.columns
      >[0] = {
        cells: ['my device', device.shortId, device.platform],
        widths: [12, 9, 22],
      }
      const nookNamedArgument130: Parameters<
        KeyGraphView['passkeysForDevice']
      >[0] = {
        device,
      }
      const nookNamedArgument129: Parameters<
        typeof KeyTerminalReport.columns
      >[0] = {
        cells: [
          'unlocked',
          KeyTerminalReport.ids(
            new KeyGraphView(graph)
              .passkeysForDevice(nookNamedArgument130)
              .map((passkey) => passkey.shortId),
          ),
        ],
        widths: [12, 30],
      }
      return [
        KeyTerminalReport.columns(nookNamedArgument128),
        KeyTerminalReport.columns(nookNamedArgument129),
      ]
    })
    const nookNamedArgument131: Parameters<
      typeof KeyTerminalReport.columns
    >[0] = {
      cells: ['my device', '—  no device key'],
      widths: [12, 30],
    }
    const nookNamedArgument132: Parameters<
      typeof KeyTerminalReport.columns
    >[0] = {
      cells: ['opens', KeyTerminalReport.ids(open)],
      widths: [12, 30],
    }
    const nookNamedArgument133: Parameters<
      typeof KeyTerminalReport.columns
    >[0] = {
      cells: ['locked', KeyTerminalReport.ids(shut)],
      widths: [12, 30],
    }
    return [
      ...head,
      ...(devices.length > 0
        ? []
        : [KeyTerminalReport.columns(nookNamedArgument131)]),
      KeyTerminalReport.columns(nookNamedArgument132),
      KeyTerminalReport.columns(nookNamedArgument133),
    ]
  }

  private otherDeviceLines({ device }: OtherDeviceLinesArgs): string[] {
    const graph = this.graph
    const nookNamedArgument134: Parameters<
      typeof KeyTerminalReport.columns
    >[0] = {
      cells: ['other device', device.shortId, device.label],
      widths: [14, 9, 20],
    }
    const nookNamedArgument135: Parameters<
      typeof KeyTerminalReport.columns
    >[0] = {
      cells: ['platform', device.platform],
      widths: [14, 24],
    }
    const nookNamedArgument137: Parameters<KeyGraphView['vaultsForDevice']>[0] =
      {
        deviceId: device.id,
      }
    const nookNamedArgument136: Parameters<
      typeof KeyTerminalReport.columns
    >[0] = {
      cells: [
        'vaults',
        KeyTerminalReport.ids(
          new KeyGraphView(graph)
            .vaultsForDevice(nookNamedArgument137)
            .map((vault) => vault.shortId),
        ),
      ],
      widths: [14, 30],
    }
    return [
      KeyTerminalReport.columns(nookNamedArgument134),
      KeyTerminalReport.columns(nookNamedArgument135),
      KeyTerminalReport.columns(nookNamedArgument136),
    ]
  }

  private passkeyLines({ passkey }: PasskeyLinesArgs): string[] {
    const graph = this.graph
    const nookNamedArgument138: Parameters<
      KeyGraphView['vaultsForPasskey']
    >[0] = {
      passkeyId: passkey.id,
    }
    const reached = new KeyGraphView(graph).vaultsForPasskey(
      nookNamedArgument138,
    )
    const nookNamedArgument139: Parameters<
      typeof KeyTerminalReport.columns
    >[0] = {
      cells: ['passkey', passkey.shortId, passkey.label],
      widths: [10, 9, 24],
    }
    const nookNamedArgument140: Parameters<
      typeof KeyTerminalReport.columns
    >[0] = {
      cells: ['manager', KeyGraphView.storeLabel(passkey.store)],
      widths: [10, 24],
    }
    const nookNamedArgument141: Parameters<
      typeof KeyTerminalReport.columns
    >[0] = {
      cells: ['present', KeyTerminalReport.reachWord(passkey)],
      widths: [10, 24],
    }
    return [
      KeyTerminalReport.columns(nookNamedArgument139),
      KeyTerminalReport.columns(nookNamedArgument140),
      KeyTerminalReport.columns(nookNamedArgument141),
      '',
      'opens',
      ...(reached.length === 0
        ? ['  ╳  no vault']
        : [...reached.entries()].map(([index, vault]) => {
            const nookNamedArgument143: Parameters<
              typeof KeyTerminalReport.branch
            >[0] = {
              index,
              count: reached.length,
            }
            const nookNamedArgument144: Parameters<
              KeyTerminalReport['routeWord']
            >[0] = {
              passkeyId: passkey.id,
              vault,
            }
            const nookNamedArgument142: Parameters<
              typeof KeyTerminalReport.columns
            >[0] = {
              cells: [
                `  ${KeyTerminalReport.branch(nookNamedArgument143)} ${vault.shortId}`,
                vault.label,
                this.routeWord(nookNamedArgument144),
              ],
              widths: [14, 18, 14],
            }
            return KeyTerminalReport.columns(nookNamedArgument142)
          })),
    ]
  }

  private listPasskeys(): string[] {
    const graph = this.graph
    const nookNamedArgument145: Parameters<
      typeof KeyTerminalReport.columns
    >[0] = {
      cells: ['  id', 'manager', 'present', 'vaults'],
      widths: [10, 19, 11, 8],
    }
    return [
      'passkeys',
      KeyTerminalReport.columns(nookNamedArgument145),
      ...graph.passkeys.map((passkey) => {
        const nookNamedArgument147: Parameters<
          KeyGraphView['vaultsForPasskey']
        >[0] = {
          passkeyId: passkey.id,
        }
        const nookNamedArgument146: Parameters<
          typeof KeyTerminalReport.columns
        >[0] = {
          cells: [
            `  ${passkey.shortId}`,
            KeyGraphView.storeLabel(passkey.store),
            KeyTerminalReport.reachWord(passkey),
            `${new KeyGraphView(graph).vaultsForPasskey(nookNamedArgument147).length}`,
          ],
          widths: [10, 19, 11, 8],
        }
        return KeyTerminalReport.columns(nookNamedArgument146)
      }),
    ]
  }

  private listVaults(): string[] {
    const graph = this.graph
    const nookNamedArgument148: Parameters<
      typeof KeyTerminalReport.columns
    >[0] = {
      cells: ['  id', 'name', 'secrets', 'keys', 'here'],
      widths: [10, 16, 9, 7, 12],
    }
    return [
      'vaults',
      KeyTerminalReport.columns(nookNamedArgument148),
      ...graph.vaults.map((vault) => {
        const nookNamedArgument150: Parameters<
          KeyGraphView['passkeysForVault']
        >[0] = {
          vault,
        }
        const nookNamedArgument151: Parameters<
          KeyGraphView['openableHere']
        >[0] = {
          vault,
        }
        const nookNamedArgument149: Parameters<
          typeof KeyTerminalReport.columns
        >[0] = {
          cells: [
            `  ${vault.shortId}`,
            vault.label,
            `${vault.secrets}`,
            `${new KeyGraphView(graph).passkeysForVault(nookNamedArgument150).length}`,
            new KeyGraphView(graph).openableHere(nookNamedArgument151)
              ? 'opens'
              : 'locked',
          ],
          widths: [10, 16, 9, 7, 12],
        }
        return KeyTerminalReport.columns(nookNamedArgument149)
      }),
    ]
  }

  private listOthers(): string[] {
    const graph = this.graph
    const devices = graph.devices.filter((device) => {
      const nookNamedArgument152: Parameters<KeyGraphView['isHere']>[0] = {
        device,
      }
      return !new KeyGraphView(graph).isHere(nookNamedArgument152)
    })
    if (devices.length === 0) return ['other devices', '  —']
    return [
      'other devices',
      ...devices.map((device) => {
        const nookNamedArgument154: Parameters<
          KeyGraphView['vaultsForDevice']
        >[0] = {
          deviceId: device.id,
        }
        const nookNamedArgument153: Parameters<
          typeof KeyTerminalReport.columns
        >[0] = {
          cells: [
            `  ${device.shortId}`,
            device.label,
            device.platform,
            `${new KeyGraphView(graph).vaultsForDevice(nookNamedArgument154).length} vaults`,
          ],
          widths: [10, 16, 18, 10],
        }
        return KeyTerminalReport.columns(nookNamedArgument153)
      }),
    ]
  }

  private static helpLines(): string[] {
    const nookNamedArgument155: Parameters<
      typeof KeyTerminalReport.columns
    >[0] = {
      cells: ['  map', 'vaults · the passkeys that open them'],
      widths: [12, 40],
    }
    const nookNamedArgument156: Parameters<
      typeof KeyTerminalReport.columns
    >[0] = {
      cells: ['  ls', 'passkeys · vaults · other devices'],
      widths: [12, 40],
    }
    const nookNamedArgument157: Parameters<
      typeof KeyTerminalReport.columns
    >[0] = {
      cells: ['  id <id>', 'one identifier'],
      widths: [12, 40],
    }
    const nookNamedArgument158: Parameters<
      typeof KeyTerminalReport.columns
    >[0] = {
      cells: ['  here', 'what this browser can do now'],
      widths: [12, 40],
    }
    const nookNamedArgument159: Parameters<
      typeof KeyTerminalReport.columns
    >[0] = {
      cells: ['  tab', 'complete an identifier'],
      widths: [12, 40],
    }
    const nookNamedArgument160: Parameters<
      typeof KeyTerminalReport.columns
    >[0] = {
      cells: ['  clear', 'wipe the transcript'],
      widths: [12, 40],
    }
    return [
      KeyTerminalReport.columns(nookNamedArgument155),
      KeyTerminalReport.columns(nookNamedArgument156),
      KeyTerminalReport.columns(nookNamedArgument157),
      KeyTerminalReport.columns(nookNamedArgument158),
      KeyTerminalReport.columns(nookNamedArgument159),
      KeyTerminalReport.columns(nookNamedArgument160),
    ]
  }

  banner(): Block {
    const graph = this.graph
    const others = graph.devices.filter((device) => {
      const nookNamedArgument161: Parameters<KeyGraphView['isHere']>[0] = {
        device,
      }
      return !new KeyGraphView(graph).isHere(nookNamedArgument161)
    }).length
    const nookNamedArgument162: Parameters<
      typeof KeyTerminalReport.columns
    >[0] = {
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
        KeyTerminalReport.columns(nookNamedArgument162),
        '',
        'map · ls · id <id> · here · help · clear',
      ],
    }
  }

  opening(): Block[] {
    return [this.banner(), { id: 1, prompt: 'map', lines: this.mapLines() }]
  }

  private static hits({
    query,
    shortId,
    id,
    label,
  }: KeyAccessTerminalTextMatch) {
    const needle = query.toLowerCase()
    return (
      shortId.toLowerCase().startsWith(needle) ||
      id.toLowerCase() === needle ||
      label.toLowerCase().includes(needle)
    )
  }

  private lookup({ query }: KeyAccessTerminalGraphLookup): Match[] {
    const graph = this.graph
    return [
      ...graph.passkeys
        .filter((passkey) => {
          const nookNamedArgument163: Parameters<
            typeof KeyTerminalReport.hits
          >[0] = {
            query,
            shortId: passkey.shortId,
            id: passkey.id,
            label: passkey.label,
          }
          return KeyTerminalReport.hits(nookNamedArgument163)
        })
        .map((passkey) => ({
          kind: NodeKind.Passkey,
          id: passkey.id,
          shortId: passkey.shortId,
          label: passkey.label,
        })),
      ...graph.vaults
        .filter((vault) => {
          const nookNamedArgument164: Parameters<
            typeof KeyTerminalReport.hits
          >[0] = {
            query,
            shortId: vault.shortId,
            id: vault.id,
            label: vault.label,
          }
          return KeyTerminalReport.hits(nookNamedArgument164)
        })
        .map((vault) => ({
          kind: NodeKind.Vault,
          id: vault.id,
          shortId: vault.shortId,
          label: vault.label,
        })),
      ...graph.devices
        .filter((device) => {
          const nookNamedArgument165: Parameters<
            typeof KeyTerminalReport.hits
          >[0] = {
            query,
            shortId: device.shortId,
            id: device.id,
            label: device.label,
          }
          return KeyTerminalReport.hits(nookNamedArgument165)
        })
        .map((device) => ({
          kind: NodeKind.Device,
          id: device.id,
          shortId: device.shortId,
          label: device.label,
        })),
    ]
  }

  private kindWord({ match }: KindWordArgs): string {
    const graph = this.graph
    if (match.kind !== NodeKind.Device)
      return KeyGraphView.kindLabel(match.kind)
    return graph.devices.some((device) => {
      const nookNamedArgument166: Parameters<KeyGraphView['isHere']>[0] = {
        device,
      }
      return (
        device.id === match.id &&
        new KeyGraphView(graph).isHere(nookNamedArgument166)
      )
    })
      ? 'my device'
      : 'other device'
  }

  private matchLines({ matches }: MatchLinesArgs): string[] {
    return matches.map((match) => {
      const nookNamedArgument168: Parameters<KeyTerminalReport['kindWord']>[0] =
        {
          match,
        }
      const nookNamedArgument167: Parameters<
        typeof KeyTerminalReport.columns
      >[0] = {
        cells: [
          `  ${match.shortId}`,
          this.kindWord(nookNamedArgument168),
          match.label,
        ],
        widths: [10, 14, 22],
      }
      return KeyTerminalReport.columns(nookNamedArgument167)
    })
  }

  private indexLines(): string[] {
    const graph = this.graph
    const others = graph.devices.filter((device) => {
      const nookNamedArgument169: Parameters<KeyGraphView['isHere']>[0] = {
        device,
      }
      return !new KeyGraphView(graph).isHere(nookNamedArgument169)
    })
    return [
      'passkeys',
      ...graph.passkeys.map((passkey) => {
        const nookNamedArgument170: Parameters<
          typeof KeyTerminalReport.columns
        >[0] = {
          cells: [`  ${passkey.shortId}`, passkey.label],
          widths: [10, 24],
        }
        return KeyTerminalReport.columns(nookNamedArgument170)
      }),
      '',
      'vaults',
      ...graph.vaults.map((vault) => {
        const nookNamedArgument171: Parameters<
          typeof KeyTerminalReport.columns
        >[0] = {
          cells: [`  ${vault.shortId}`, vault.label],
          widths: [10, 24],
        }
        return KeyTerminalReport.columns(nookNamedArgument171)
      }),
      ...(others.length > 0
        ? [
            '',
            'other devices',
            ...others.map((device) => {
              const nookNamedArgument172: Parameters<
                typeof KeyTerminalReport.columns
              >[0] = {
                cells: [`  ${device.shortId}`, device.label],
                widths: [10, 24],
              }
              return KeyTerminalReport.columns(nookNamedArgument172)
            }),
          ]
        : []),
    ]
  }

  private reportFor({ match }: ReportForArgs): string[] {
    const graph = this.graph
    if (match.kind === NodeKind.Passkey) {
      return graph.passkeys
        .filter((passkey) => passkey.id === match.id)
        .flatMap((passkey) => {
          const nookNamedArgument173: Parameters<
            KeyTerminalReport['passkeyLines']
          >[0] = {
            passkey,
          }
          return this.passkeyLines(nookNamedArgument173)
        })
    }
    if (match.kind === NodeKind.Vault) {
      return graph.vaults
        .filter((vault) => vault.id === match.id)
        .flatMap((vault) => {
          const nookNamedArgument174: Parameters<
            KeyTerminalReport['vaultBlock']
          >[0] = {
            vault,
          }
          return this.vaultBlock(nookNamedArgument174)
        })
    }
    return graph.devices
      .filter((device) => device.id === match.id)
      .flatMap((device) => {
        const nookNamedArgument175: Parameters<KeyGraphView['isHere']>[0] = {
          device,
        }
        const nookNamedArgument176: Parameters<
          KeyTerminalReport['otherDeviceLines']
        >[0] = {
          device,
        }
        return new KeyGraphView(graph).isHere(nookNamedArgument175)
          ? this.myLines()
          : this.otherDeviceLines(nookNamedArgument176)
      })
  }

  private idCommand({ query }: IdCommandArgs): string[] {
    if (query.length === 0) return ['id <id>', '', ...this.indexLines()]
    const nookNamedArgument177: Parameters<KeyTerminalReport['lookup']>[0] = {
      query,
    }
    const matches = this.lookup(nookNamedArgument177)
    if (matches.length === 0) {
      return [`no match  ${query}`, '', ...this.indexLines()]
    }
    if (matches.length > 1) {
      const nookNamedArgument178: Parameters<
        KeyTerminalReport['matchLines']
      >[0] = {
        matches,
      }
      return [
        `${matches.length} matches  ${query}`,
        '',
        ...this.matchLines(nookNamedArgument178),
      ]
    }
    return matches.flatMap((match) => {
      const nookNamedArgument179: Parameters<
        KeyTerminalReport['reportFor']
      >[0] = {
        match,
      }
      return this.reportFor(nookNamedArgument179)
    })
  }

  outputFor({ command }: OutputForArgs): string[] {
    const [verb, ...rest] = command.split(' ')
    const argument = rest.join(' ')
    if (command === 'map') return this.mapLines()
    if (command === 'ls') {
      return [
        ...this.listPasskeys(),
        '',
        ...this.listVaults(),
        '',
        ...this.listOthers(),
      ]
    }
    if (command === 'here') return this.myLines()
    if (command === 'help') return KeyTerminalReport.helpLines()
    const nookNamedArgument180: Parameters<KeyTerminalReport['idCommand']>[0] =
      {
        query: argument,
      }
    if (verb === 'id') return this.idCommand(nookNamedArgument180)
    const nookNamedArgument181: Parameters<KeyTerminalReport['idCommand']>[0] =
      {
        query: verb,
      }
    if (verb && verb.length === 6) return this.idCommand(nookNamedArgument181)
    return [`unknown  ${command}`, '', ...KeyTerminalReport.helpLines()]
  }
}
