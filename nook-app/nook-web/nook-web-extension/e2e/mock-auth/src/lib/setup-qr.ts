import { MOCK_AUTH_ENROLL_QR_MODULES } from './otpauth-qr-modules'

/** How the account settings dialog renders its authenticator QR code. */
export enum SetupQrVariant {
  /** An `<img>` whose PNG arrives after the dialog opens. */
  AsyncImage = 'img',
  /** An inline `<svg>` with one path per dark module. */
  InlineSvg = 'svg',
  /** A `<canvas>` the page paints after mounting. */
  Canvas = 'canvas',
}

const QUIET_ZONE_MODULES = 4
const MODULE_PX = 5
const DARK_MODULE = '#'

export function setupQrVariant(search: string): SetupQrVariant {
  const [requested = ''] = new URLSearchParams(search).getAll('qr')
  switch (requested) {
    case SetupQrVariant.InlineSvg:
      return SetupQrVariant.InlineSvg
    case SetupQrVariant.Canvas:
      return SetupQrVariant.Canvas
    default:
      return SetupQrVariant.AsyncImage
  }
}

/** `?dialog=native` opens the dialog with showModal(), in the top layer. */
export function nativeModalDialog(search: string): boolean {
  return new URLSearchParams(search).get('dialog') === 'native'
}

/** Edge of the rendered QR code in CSS pixels, quiet zone included. */
export const SETUP_QR_EDGE_PX =
  (MOCK_AUTH_ENROLL_QR_MODULES.length + QUIET_ZONE_MODULES * 2) * MODULE_PX

/** The SVG path data for every dark module. */
export function setupQrSvgPath(): string {
  return MOCK_AUTH_ENROLL_QR_MODULES.flatMap((row, rowIndex) =>
    [...row].flatMap((module, columnIndex) => {
      switch (module) {
        case DARK_MODULE:
          return [
            `M${(columnIndex + QUIET_ZONE_MODULES) * MODULE_PX} ${(rowIndex + QUIET_ZONE_MODULES) * MODULE_PX}h${MODULE_PX}v${MODULE_PX}h-${MODULE_PX}z`,
          ]
        default:
          return []
      }
    }),
  ).join('')
}

/** Paints the QR code, quiet zone included, onto a canvas of SETUP_QR_EDGE_PX. */
export function paintSetupQr(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Setup QR canvas has no 2D context')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#000000'
  MOCK_AUTH_ENROLL_QR_MODULES.forEach((row, rowIndex) => {
    ;[...row].forEach((module, columnIndex) => {
      if (module !== DARK_MODULE) return
      context.fillRect(
        (columnIndex + QUIET_ZONE_MODULES) * MODULE_PX,
        (rowIndex + QUIET_ZONE_MODULES) * MODULE_PX,
        MODULE_PX,
        MODULE_PX,
      )
    })
  })
}

/** Like a site fetching its enrollment QR: a PNG object URL, after a delay. */
export async function fetchSetupQrObjectUrl(): Promise<string> {
  await new Promise((resolve) => window.setTimeout(resolve, 400))
  const response = await fetch('/totp-enroll-qr.png')
  if (!response.ok) throw new Error('Setup QR image failed to load')
  return URL.createObjectURL(await response.blob())
}

/** Which view the settings page's authenticator dialog shows. */
export enum DialogStep {
  Closed = 'closed',
  Scan = 'scan',
  Verify = 'verify',
}

/** Whether the dialog's QR code has arrived. */
export enum QrLoad {
  Pending = 'pending',
  Ready = 'ready',
}
