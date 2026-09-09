import {
  type KeyGraph,
  Reach,
  KeyGraphView,
} from '../../keys-management/_shared/key-graph'

const BOX_W = 12

const PITCH = 4

/** Box-drawing strokes as north/south/east/west bits. */
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

type TerminalColumnPadding = { text: string; width: number }

type TerminalMapColumnLayout = {
  cells: string[]
  widths: number[]
}

type TerminalGridStrokePlacement = {
  grid: string[][]
  x: number
  y: number
  mark: string
}

type TerminalStrokeMerge = { current: string; mark: string }

type TerminalMapBoxDrawing = {
  grid: string[][]
  x: number
  top: number
  body: string
}

type TerminalMapWireDrawing = {
  grid: string[][]
  fromX: number
  fromY: number
  toX: number
  toY: number
  channel: number
}

type TerminalMapLineTextPlacement = {
  line: string[]
  x: number
  text: string
}

/** Owns browser orchestration for one nook web research/src/experiments/inspiration/access terminal/terminal map context. */
export class TerminalGraphMap {
  constructor(private readonly graph: KeyGraph) {}

  static pad({ text, width }: TerminalColumnPadding): string {
    return text.length >= width ? text : text + ' '.repeat(width - text.length)
  }

  static columns({ cells, widths }: TerminalMapColumnLayout): string {
    return [...cells.entries()]
      .map(([index, cell]) => {
        const column: Parameters<typeof TerminalGraphMap.pad>[0] = {
          text: cell,
          width: widths[index] ? widths[index] : 0,
        }
        return TerminalGraphMap.pad(column)
      })
      .join('')
      .trimEnd()
  }

  private static put({ grid, x, y, mark }: TerminalGridStrokePlacement) {
    const row = grid[y]
    if (!row) return
    if (x < 0 || x >= row.length) return
    const current = row[x]
    const nookNamedArgument63: Parameters<typeof TerminalGraphMap.merge>[0] = {
      current: current ? current : ' ',
      mark,
    }
    row[x] = TerminalGraphMap.merge(nookNamedArgument63)
  }

  private static merge({ current, mark }: TerminalStrokeMerge): string {
    if (mark === '>') return mark
    if (current === ' ') return mark
    const held = STROKES[current]
    const added = STROKES[mark]
    if (!held || !added) return current
    return GLYPHS.charAt(held | added)
  }

  private static box({ grid, x, top, body }: TerminalMapBoxDrawing) {
    const bar = '─'.repeat(BOX_W - 2)
    const nookNamedArgument64: Parameters<typeof TerminalGraphMap.pad>[0] = {
      text: body,
      width: BOX_W - 4,
    }
    const face = [
      `┌${bar}┐`,
      `│ ${TerminalGraphMap.pad(nookNamedArgument64)} │`,
      `└${bar}┘`,
    ]
    ;[...face.entries()].forEach(([row, line]) =>
      [...[...line].entries()].forEach(([i, mark]) => {
        const nookNamedArgument65: Parameters<typeof TerminalGraphMap.put>[0] =
          {
            grid,
            x: x + i,
            y: top + row,
            mark,
          }
        return TerminalGraphMap.put(nookNamedArgument65)
      }),
    )
  }

  private static wire({
    grid,
    fromX,
    fromY,
    toX,
    toY,
    channel,
  }: TerminalMapWireDrawing) {
    for (let x = fromX; x < channel; x += 1) {
      const horizontalStart: Parameters<typeof TerminalGraphMap.put>[0] = {
        grid,
        x,
        y: fromY,
        mark: '─',
      }
      TerminalGraphMap.put(horizontalStart)
    }
    if (fromY === toY) {
      const nookNamedArgument67: Parameters<typeof TerminalGraphMap.put>[0] = {
        grid,
        x: channel,
        y: fromY,
        mark: '─',
      }
      TerminalGraphMap.put(nookNamedArgument67)
    } else {
      const step = fromY < toY ? 1 : -1
      const nookNamedArgument68: Parameters<typeof TerminalGraphMap.put>[0] = {
        grid,
        x: channel,
        y: fromY,
        mark: step === 1 ? '┐' : '┘',
      }
      TerminalGraphMap.put(nookNamedArgument68)
      for (let y = fromY + step; y !== toY; y += step) {
        const verticalSegment: Parameters<typeof TerminalGraphMap.put>[0] = {
          grid,
          x: channel,
          y,
          mark: '│',
        }
        TerminalGraphMap.put(verticalSegment)
      }
      const nookNamedArgument70: Parameters<typeof TerminalGraphMap.put>[0] = {
        grid,
        x: channel,
        y: toY,
        mark: step === 1 ? '└' : '┌',
      }
      TerminalGraphMap.put(nookNamedArgument70)
    }
    for (let x = channel + 1; x < toX - 1; x += 1) {
      const horizontalEnd: Parameters<typeof TerminalGraphMap.put>[0] = {
        grid,
        x,
        y: toY,
        mark: '─',
      }
      TerminalGraphMap.put(horizontalEnd)
    }
    const nookNamedArgument72: Parameters<typeof TerminalGraphMap.put>[0] = {
      grid,
      x: toX - 1,
      y: toY,
      mark: '>',
    }
    TerminalGraphMap.put(nookNamedArgument72)
  }

  private static place({ line, x, text }: TerminalMapLineTextPlacement) {
    ;[...[...text].entries()].forEach(([i, mark]) => {
      if (x + i < line.length) line[x + i] = mark
    })
  }

  mapArt(): string[] {
    const graph = this.graph
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
    const nookNamedArgument73: Parameters<typeof Array.from>[0] = {
      length: rows,
    }
    const grid: string[][] = Array.from(nookNamedArgument73, () => {
      const nookNamedArgument74: Parameters<typeof Array.from>[0] = {
        length: width,
      }
      return Array.from(nookNamedArgument74, () => ' ')
    })

    ;[...graph.passkeys.entries()].forEach(([index, passkey]) => {
      const nookNamedArgument75: Parameters<typeof TerminalGraphMap.box>[0] = {
        grid,
        x: passkeyX,
        top: index * PITCH,
        body: `${passkey.shortId} ${passkey.reach === Reach.Here ? '*' : '.'}`,
      }
      return TerminalGraphMap.box(nookNamedArgument75)
    })
    ;[...graph.devices.entries()].forEach(([index, device]) => {
      const nookNamedArgument77: Parameters<KeyGraphView['isHere']>[0] = {
        device,
      }
      const nookNamedArgument76: Parameters<typeof TerminalGraphMap.box>[0] = {
        grid,
        x: deviceX,
        top: index * PITCH,
        body: `${device.shortId} ${new KeyGraphView(graph).isHere(nookNamedArgument77) ? '*' : '.'}`,
      }
      return TerminalGraphMap.box(nookNamedArgument76)
    })
    ;[...graph.vaults.entries()].forEach(([index, vault]) => {
      const nookNamedArgument79: Parameters<KeyGraphView['openableHere']>[0] = {
        vault,
      }
      const nookNamedArgument78: Parameters<typeof TerminalGraphMap.box>[0] = {
        grid,
        x: vaultX,
        top: index * PITCH,
        body: `${vault.shortId} ${new KeyGraphView(graph).openableHere(nookNamedArgument79) ? '*' : '.'}`,
      }
      return TerminalGraphMap.box(nookNamedArgument78)
    })
    ;[...unlocks.entries()].forEach(([index, edge]) => {
      const fromRow =
        graph.passkeys.findIndex((passkey) => passkey.id === edge.from) *
          PITCH +
        1
      const toRow =
        graph.devices.findIndex((device) => device.id === edge.to) * PITCH + 1
      const nookNamedArgument80: Parameters<typeof TerminalGraphMap.wire>[0] = {
        grid,
        fromX: passkeyX + BOX_W,
        fromY: fromRow,
        toX: deviceX,
        toY: toRow,
        channel: passkeyX + BOX_W + 1 + 2 * index,
      }
      TerminalGraphMap.wire(nookNamedArgument80)
    })
    ;[...opens.entries()].forEach(([index, edge]) => {
      const fromRow =
        graph.devices.findIndex((device) => device.id === edge.from) * PITCH + 1
      const toRow =
        graph.vaults.findIndex((vault) => vault.id === edge.to) * PITCH + 1
      const nookNamedArgument81: Parameters<typeof TerminalGraphMap.wire>[0] = {
        grid,
        fromX: deviceX + BOX_W,
        fromY: fromRow,
        toX: vaultX,
        toY: toRow,
        channel: deviceX + BOX_W + 1 + 2 * index,
      }
      TerminalGraphMap.wire(nookNamedArgument81)
    })

    const nookNamedArgument82: Parameters<typeof Array.from>[0] = {
      length: width,
    }
    const heading = Array.from(nookNamedArgument82, () => ' ')
    const nookNamedArgument83: Parameters<typeof TerminalGraphMap.place>[0] = {
      line: heading,
      x: passkeyX,
      text: 'PASSKEYS',
    }
    TerminalGraphMap.place(nookNamedArgument83)
    const nookNamedArgument84: Parameters<typeof TerminalGraphMap.place>[0] = {
      line: heading,
      x: deviceX,
      text: 'DEVICE KEYS',
    }
    TerminalGraphMap.place(nookNamedArgument84)
    const nookNamedArgument85: Parameters<typeof TerminalGraphMap.place>[0] = {
      line: heading,
      x: vaultX,
      text: 'VAULTS',
    }
    TerminalGraphMap.place(nookNamedArgument85)

    return [
      heading.join('').trimEnd(),
      '',
      ...grid.map((row) => row.join('').trimEnd()),
      '',
      '* usable from this browser   . elsewhere',
    ]
  }

  legend(): string[] {
    const graph = this.graph
    return [
      ...graph.passkeys.map((passkey) => {
        const nookNamedArgument86: Parameters<
          typeof TerminalGraphMap.columns
        >[0] = {
          cells: [
            `  ${passkey.shortId}`,
            passkey.label,
            KeyGraphView.storeLabel(passkey.store),
          ],
          widths: [10, 20, 18],
        }
        return TerminalGraphMap.columns(nookNamedArgument86)
      }),
      ...graph.devices.map((device) => {
        const nookNamedArgument87: Parameters<
          typeof TerminalGraphMap.columns
        >[0] = {
          cells: [`  ${device.shortId}`, device.label, device.platform],
          widths: [10, 20, 18],
        }
        return TerminalGraphMap.columns(nookNamedArgument87)
      }),
      ...graph.vaults.map((vault) => {
        const nookNamedArgument88: Parameters<
          typeof TerminalGraphMap.columns
        >[0] = {
          cells: [
            `  ${vault.shortId}`,
            vault.label,
            `${vault.secrets} secrets`,
          ],
          widths: [10, 20, 18],
        }
        return TerminalGraphMap.columns(nookNamedArgument88)
      }),
    ]
  }
}
