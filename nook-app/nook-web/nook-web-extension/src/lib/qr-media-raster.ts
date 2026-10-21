import { Option } from 'effect'
import { AuthenticatorEnrollmentSourceBound } from '../../../nook-web-shared/src/extension/authenticator-enrollment-candidates'

export enum QrMediaKind {
  Canvas = 'canvas',
  Image = 'image',
  Vector = 'vector',
}

/** Visible page media that may hold a QR code, decoded once at collection. */
export type QrMedia =
  | { readonly kind: QrMediaKind.Canvas; readonly element: HTMLCanvasElement }
  | { readonly kind: QrMediaKind.Image; readonly element: HTMLImageElement }
  | { readonly kind: QrMediaKind.Vector; readonly element: SVGSVGElement }

export enum QrPictureCaptureKind {
  Captured = 'captured',
  Unavailable = 'unavailable',
}

/** One visible QR media element drawn opaque, at most 512 px per edge, as a PNG data URL. */
export type QrPictureCapture =
  | {
      readonly kind: QrPictureCaptureKind.Captured
      readonly pngDataUrl: string
    }
  | { readonly kind: QrPictureCaptureKind.Unavailable }

type QrRasterSize = {
  readonly width: number
  readonly height: number
}

/** Draws onto a 2D context, or reports none when the canvas has no context. */
type QrPictureDrawing = {
  readonly onNone: () => QrPictureCapture
  readonly onSome: (context: CanvasRenderingContext2D) => QrPictureCapture
}

enum QrRasterSourceKind {
  Ready = 'ready',
  Unavailable = 'unavailable',
}

type ReadyQrRasterSource = {
  readonly kind: QrRasterSourceKind.Ready
  readonly image: CanvasImageSource
  readonly width: number
  readonly height: number
}

type QrRasterSource =
  ReadyQrRasterSource | { readonly kind: QrRasterSourceKind.Unavailable }

/**
 * Draws one visible QR media element onto an opaque light canvas so the ZXing
 * reader sees dark modules on a light background, then encodes it as a PNG.
 * Inline SVG is serialized at its rendered size and decoded as an image first.
 *
 * The copy is bounded: a picture whose longer edge exceeds 512 px is scaled
 * down, preserving its aspect ratio, so one capture holds at most 512 × 512
 * pixels before transport. A QR shown at a readable on-screen size keeps every
 * module at that bound.
 */
export class QrMediaRaster {
  static readonly UNDERLAY_COLOR = '#ffffff'
  static readonly SVG_DATA_URL_PREFIX = 'data:image/svg+xml;charset=utf-8,'

  private readonly unavailableSource: QrRasterSource = {
    kind: QrRasterSourceKind.Unavailable,
  }
  private readonly unavailableCapture: QrPictureCapture = {
    kind: QrPictureCaptureKind.Unavailable,
  }

  constructor(private readonly browser: typeof globalThis) {}

  async opaquePicture(media: QrMedia): Promise<QrPictureCapture> {
    try {
      const source = await this.rasterSource(media)
      switch (source.kind) {
        case QrRasterSourceKind.Unavailable:
          return this.unavailableCapture
        case QrRasterSourceKind.Ready:
          return this.underlaidPicture(source)
      }
    } catch {
      // Cross-origin, CSP-blocked, or undecodable media is skipped without
      // weakening host permissions.
      return this.unavailableCapture
    }
  }

  private async rasterSource(media: QrMedia): Promise<QrRasterSource> {
    switch (media.kind) {
      case QrMediaKind.Canvas: {
        const source: QrRasterSource = {
          kind: QrRasterSourceKind.Ready,
          image: media.element,
          width: media.element.width,
          height: media.element.height,
        }
        return source
      }
      case QrMediaKind.Image:
        return this.imageSource(media.element)
      case QrMediaKind.Vector:
        return this.vectorSource(media.element)
    }
  }

  private imageSource(image: HTMLImageElement): QrRasterSource {
    switch (image.complete && image.naturalWidth > 0) {
      case false:
        return this.unavailableSource
      case true: {
        const source: QrRasterSource = {
          kind: QrRasterSourceKind.Ready,
          image,
          width: image.naturalWidth,
          height: image.naturalHeight,
        }
        return source
      }
    }
  }

  private async vectorSource(svg: SVGSVGElement): Promise<QrRasterSource> {
    const clone = svg.cloneNode(true)
    if (!(clone instanceof SVGSVGElement)) return this.unavailableSource
    const rect = svg.getBoundingClientRect()
    const width = Math.round(rect.width)
    const height = Math.round(rect.height)
    // viewBox-only and CSS-sized SVGs otherwise decode at 0 or 300x150.
    clone.setAttribute('width', `${width}`)
    clone.setAttribute('height', `${height}`)
    // currentColor resolves to the page's rendered color, not the image default.
    clone.style.color = this.browser.getComputedStyle(svg).color
    // XMLSerializer emits the SVG namespace declaration for the SVG root.
    const markup = new XMLSerializer().serializeToString(clone)
    const image = this.browser.document.createElement('img')
    image.width = width
    image.height = height
    image.src = `${QrMediaRaster.SVG_DATA_URL_PREFIX}${encodeURIComponent(markup)}`
    await image.decode()
    const source: QrRasterSource = {
      kind: QrRasterSourceKind.Ready,
      image,
      width,
      height,
    }
    return source
  }

  /** Scales an oversized picture down to the 512 px edge bound, keeping its aspect ratio. */
  boundedSize(source: QrRasterSize): QrRasterSize {
    const scale = Math.min(
      1,
      AuthenticatorEnrollmentSourceBound.MaxPictureEdgePx /
        Math.max(source.width, source.height),
    )
    const bounded: QrRasterSize = {
      width: Math.max(1, Math.round(source.width * scale)),
      height: Math.max(1, Math.round(source.height * scale)),
    }
    return bounded
  }

  private underlaidPicture(source: ReadyQrRasterSource): QrPictureCapture {
    const canvas = this.browser.document.createElement('canvas')
    const size = this.boundedSize(source)
    canvas.width = size.width
    canvas.height = size.height
    const drawing: QrPictureDrawing = {
      onNone: () => this.unavailableCapture,
      onSome: (context) => {
        context.fillStyle = QrMediaRaster.UNDERLAY_COLOR
        context.fillRect(0, 0, size.width, size.height)
        context.drawImage(source.image, 0, 0, size.width, size.height)
        // A cross-origin image taints the canvas and toDataURL throws; the
        // caller's catch skips that media without widening host permissions.
        const capture: QrPictureCapture = {
          kind: QrPictureCaptureKind.Captured,
          pngDataUrl: canvas.toDataURL('image/png'),
        }
        return capture
      },
    }
    return Option.match(Option.fromNullishOr(canvas.getContext('2d')), drawing)
  }
}
