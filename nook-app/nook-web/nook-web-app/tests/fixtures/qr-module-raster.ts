import type { QrModuleRows } from './otpauth-qr-modules'

/** One fixture QR drawn with square modules and a four-module quiet zone. */
export type QrModuleRasterRequest = {
  readonly modules: QrModuleRows
  readonly modulePx: number
}

/** Row-major RGBA bytes of a rasterized fixture QR. */
export type QrModulePixels = {
  readonly data: Uint8ClampedArray<ArrayBuffer>
  readonly width: number
  readonly height: number
}

const QUIET_ZONE_MODULES = 4
const DARK_MODULE = '#'
const RGBA_BYTES_PER_PIXEL = 4
const DARK_CHANNEL = 0
const LIGHT_CHANNEL = 255
const OPAQUE_ALPHA = 255

/** Renders checked-in QR module grids the way a page would show them. */
export class QrModuleRaster {
  constructor(private readonly request: QrModuleRasterRequest) {}

  /** Edge length in pixels, including the quiet zone. */
  get edgePx(): number {
    const { modules, modulePx } = this.request
    return (modules.length + QUIET_ZONE_MODULES * 2) * modulePx
  }

  /** Opaque black-on-white pixels, as a page canvas would hold them. */
  pixels(): QrModulePixels {
    const edge = this.edgePx
    const data = new Uint8ClampedArray(edge * edge * RGBA_BYTES_PER_PIXEL)
    for (let y = 0; y < edge; y += 1) {
      for (let x = 0; x < edge; x += 1) {
        const offset = (y * edge + x) * RGBA_BYTES_PER_PIXEL
        data.fill(this.channelAt({ x, y }), offset, offset + 3)
        data[offset + 3] = OPAQUE_ALPHA
      }
    }
    const pixels: QrModulePixels = { data, width: edge, height: edge }
    return pixels
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

  private channelAt({ x, y }: QrPixelPosition): number {
    const { modules, modulePx } = this.request
    const rowIndex = Math.floor(y / modulePx) - QUIET_ZONE_MODULES
    const columnIndex = Math.floor(x / modulePx) - QUIET_ZONE_MODULES
    // Quiet-zone positions fall outside the grid and read as light.
    const module = modules
      .filter((_, index) => index === rowIndex)
      .join('')
      .charAt(columnIndex)
    switch (module) {
      case DARK_MODULE:
        return DARK_CHANNEL
      default:
        return LIGHT_CHANNEL
    }
  }
}

type QrPixelPosition = {
  readonly x: number
  readonly y: number
}
