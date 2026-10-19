import type { QrModuleRows } from './otpauth-qr-modules'

/** One fixture QR drawn with square modules and a four-module quiet zone. */
export type QrModuleRasterRequest = {
  readonly modules: QrModuleRows
  readonly modulePx: number
}

const QUIET_ZONE_MODULES = 4
const DARK_MODULE = '#'

/** Renders checked-in QR module grids the way a page would show them. */
export class QrModuleRaster {
  constructor(private readonly request: QrModuleRasterRequest) {}

  /** Edge length in pixels, including the quiet zone. */
  get edgePx(): number {
    const { modules, modulePx } = this.request
    return (modules.length + QUIET_ZONE_MODULES * 2) * modulePx
  }

  /** Inline SVG markup with one square per dark module. */
  svgMarkup(attributes: string): string {
    const { modules, modulePx } = this.request
    const edge = this.edgePx
    const squares = modules.flatMap((row, rowIndex) =>
      [...row].flatMap((module, columnIndex) => {
        switch (module) {
          case DARK_MODULE:
            return [
              `M${(columnIndex + QUIET_ZONE_MODULES) * modulePx} ${(rowIndex + QUIET_ZONE_MODULES) * modulePx}h${modulePx}v${modulePx}h-${modulePx}z`,
            ]
          default:
            return []
        }
      }),
    )
    return `<svg ${attributes} width="${edge}" height="${edge}" viewBox="0 0 ${edge} ${edge}" xmlns="http://www.w3.org/2000/svg"><rect width="${edge}" height="${edge}" fill="#ffffff"/><path fill="#000000" d="${squares.join('')}"/></svg>`
  }
}
