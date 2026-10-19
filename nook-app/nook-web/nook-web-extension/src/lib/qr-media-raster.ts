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

export enum QrBitmapCaptureKind {
  Captured = 'captured',
  Unavailable = 'unavailable',
}

export type QrBitmapCapture =
  | {
      readonly kind: QrBitmapCaptureKind.Captured
      readonly bitmap: ImageBitmap
    }
  | { readonly kind: QrBitmapCaptureKind.Unavailable }

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
 * Draws one visible QR media element onto an opaque light canvas so the single
 * BarcodeDetector path sees dark modules on a light background. Inline SVG is
 * serialized at its rendered size and decoded as an image first, because
 * Chromium's createImageBitmap does not decode SVG blobs.
 */
export class QrMediaRaster {
  static readonly UNDERLAY_COLOR = '#ffffff'
  static readonly SVG_DATA_URL_PREFIX = 'data:image/svg+xml;charset=utf-8,'

  private readonly unavailableSource: QrRasterSource = {
    kind: QrRasterSourceKind.Unavailable,
  }
  private readonly unavailableCapture: QrBitmapCapture = {
    kind: QrBitmapCaptureKind.Unavailable,
  }

  constructor(private readonly browser: typeof globalThis) {}

  async opaqueBitmap(media: QrMedia): Promise<QrBitmapCapture> {
    try {
      const source = await this.rasterSource(media)
      switch (source.kind) {
        case QrRasterSourceKind.Unavailable:
          return this.unavailableCapture
        case QrRasterSourceKind.Ready:
          return await this.underlaidBitmap(source)
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

  private async underlaidBitmap(
    source: ReadyQrRasterSource,
  ): Promise<QrBitmapCapture> {
    const canvas = this.browser.document.createElement('canvas')
    canvas.width = source.width
    canvas.height = source.height
    const context = canvas.getContext('2d')
    if (!context) return this.unavailableCapture
    context.fillStyle = QrMediaRaster.UNDERLAY_COLOR
    context.fillRect(0, 0, source.width, source.height)
    context.drawImage(source.image, 0, 0, source.width, source.height)
    const capture: QrBitmapCapture = {
      kind: QrBitmapCaptureKind.Captured,
      bitmap: await this.browser.createImageBitmap(canvas),
    }
    return capture
  }
}
