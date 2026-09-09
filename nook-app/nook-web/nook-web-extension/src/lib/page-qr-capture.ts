const OTPAUTH_TOTP_PREFIX = 'otpauth://totp/'

const MAX_QR_CANDIDATES = 8

const MIN_QR_EDGE_PX = 80

export type DecodedOtpauthCandidate = {
  sourceLabel: string
  otpauthUri: string
}

type BarcodeDetectorLike = {
  detect: (
    source: ImageBitmapSource,
  ) => Promise<Array<{ rawValue?: string; format?: string }>>
}

type BarcodeDetectorOptions = {
  formats: string[]
}

type BarcodeDetectorConstructor = new (
  options: BarcodeDetectorOptions,
) => BarcodeDetectorLike

type BarcodeDetectorGlobal = typeof globalThis & {
  BarcodeDetector?: BarcodeDetectorConstructor
}

enum BarcodeDetectorAvailabilityKind {
  Unsupported = 'unsupported',
  Available = 'available',
}

type BarcodeDetectorAvailability =
  | { kind: BarcodeDetectorAvailabilityKind.Unsupported }
  | {
      kind: BarcodeDetectorAvailabilityKind.Available
      Detector: BarcodeDetectorConstructor
    }

enum QrBitmapCaptureKind {
  Captured = 'captured',
  Unavailable = 'unavailable',
}

type QrBitmapCapture =
  | { kind: QrBitmapCaptureKind.Captured; bitmap: ImageBitmap }
  | { kind: QrBitmapCaptureKind.Unavailable }

export enum DecodeVisibleOtpauthCandidatesResultStatus {
  Ready = 'ready',
  Unsupported = 'unsupported',
  Empty = 'empty',
  Ambiguous = 'ambiguous',
}

type DecodedOtpauthCandidates = DecodedOtpauthCandidate[]

/** Owns this browser host’s resources and interaction lifecycle. */
class PageQrCapture {
  constructor(private readonly browser: typeof globalThis) {}

  private barcodeDetectorConstructor(): BarcodeDetectorAvailability {
    const candidate = (this.browser as BarcodeDetectorGlobal).BarcodeDetector
    return typeof candidate === 'function'
      ? { kind: BarcodeDetectorAvailabilityKind.Available, Detector: candidate }
      : { kind: BarcodeDetectorAvailabilityKind.Unsupported }
  }

  private isVisibleElement(element: Element): boolean {
    if (!(element instanceof HTMLElement)) return false
    if (element.hidden || element.getAttribute('aria-hidden') === 'true') {
      return false
    }
    const style = this.browser.window.getComputedStyle(element)
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0'
    ) {
      return false
    }
    const rect = element.getBoundingClientRect()
    return (
      rect.width >= MIN_QR_EDGE_PX &&
      rect.height >= MIN_QR_EDGE_PX &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < this.browser.window.innerHeight &&
      rect.left < this.browser.window.innerWidth
    )
  }

  private looksLikeQrMedia(element: HTMLElement): boolean {
    const tokens = [
      ((v) => (v ? v : ''))(element.getAttribute('alt')),
      ((v) => (v ? v : ''))(element.getAttribute('aria-label')),
      ((v) => (v ? v : ''))(element.getAttribute('title')),
      element.id,
      element.className.toString(),
    ]
      .join(' ')
      .toLowerCase()
    if (
      tokens.includes('qr') ||
      tokens.includes('otpauth') ||
      tokens.includes('authenticator') ||
      tokens.includes('2fa') ||
      tokens.includes('totp')
    ) {
      return true
    }
    const rect = element.getBoundingClientRect()
    const ratio = rect.width / Math.max(rect.height, 1)
    return ratio > 0.75 && ratio < 1.35
  }

  pageHasQrEnrollmentHint(): boolean {
    const media = [
      ...this.browser.document.querySelectorAll('canvas, img, svg'),
    ] as HTMLElement[]
    return media.some(
      (element) =>
        this.isVisibleElement(element) && this.looksLikeQrMedia(element),
    )
  }

  private async bitmapFromElement(
    element: HTMLElement,
  ): Promise<QrBitmapCapture> {
    try {
      if (element instanceof HTMLCanvasElement) {
        return {
          kind: QrBitmapCaptureKind.Captured,
          bitmap: await this.browser.createImageBitmap(element),
        }
      }
      if (element instanceof HTMLImageElement) {
        if (!element.complete || element.naturalWidth === 0) {
          return { kind: QrBitmapCaptureKind.Unavailable }
        }
        return {
          kind: QrBitmapCaptureKind.Captured,
          bitmap: await this.browser.createImageBitmap(element),
        }
      }
      if (element instanceof SVGSVGElement) {
        const serialized = new XMLSerializer().serializeToString(element)
        const blobOptions: BlobPropertyBag = { type: 'image/svg+xml' }
        const blob = new Blob([serialized], blobOptions)
        return {
          kind: QrBitmapCaptureKind.Captured,
          bitmap: await this.browser.createImageBitmap(blob),
        }
      }
    } catch {
      return { kind: QrBitmapCaptureKind.Unavailable }
    }
    return { kind: QrBitmapCaptureKind.Unavailable }
  }

  private collectQrMedia(): HTMLElement[] {
    const media = [
      ...this.browser.document.querySelectorAll('canvas, img, svg'),
    ] as HTMLElement[]
    return media
      .filter(
        (element) =>
          this.isVisibleElement(element) && this.looksLikeQrMedia(element),
      )
      .slice(0, MAX_QR_CANDIDATES)
  }

  private collectMarkedOtpauthCandidates(): DecodedOtpauthCandidate[] {
    const elements = [
      ...this.browser.document.querySelectorAll('[data-nook-otpauth-uri]'),
    ] as HTMLElement[]
    const candidates: DecodedOtpauthCandidate[] = []
    const seen = new Set<string>()
    let index = 0
    for (const element of elements) {
      if (!this.isVisibleElement(element)) continue
      const value = ((v) => (v ? v : ''))(
        element.getAttribute('data-nook-otpauth-uri')?.trim(),
      )
      if (!value.startsWith(OTPAUTH_TOTP_PREFIX) || seen.has(value)) continue
      index += 1
      seen.add(value)
      const candidate: DecodedOtpauthCandidate = {
        sourceLabel: `QR ${index}`,
        otpauthUri: value,
      }
      candidates.push(candidate)
    }
    return candidates
  }

  private finalizeOtpauthCandidates(candidates: DecodedOtpauthCandidates): {
    status:
      | DecodeVisibleOtpauthCandidatesResultStatus.Ready
      | DecodeVisibleOtpauthCandidatesResultStatus.Empty
      | DecodeVisibleOtpauthCandidatesResultStatus.Ambiguous
    candidates: DecodedOtpauthCandidate[]
  } {
    if (candidates.length === 0) {
      return {
        status: DecodeVisibleOtpauthCandidatesResultStatus.Empty,
        candidates: [],
      }
    }
    if (candidates.length > 1) {
      return {
        status: DecodeVisibleOtpauthCandidatesResultStatus.Ambiguous,
        candidates,
      }
    }
    return {
      status: DecodeVisibleOtpauthCandidatesResultStatus.Ready,
      candidates,
    }
  }

  async decodeVisibleOtpauthCandidates(): Promise<{
    status:
      | DecodeVisibleOtpauthCandidatesResultStatus.Ready
      | DecodeVisibleOtpauthCandidatesResultStatus.Unsupported
      | DecodeVisibleOtpauthCandidatesResultStatus.Empty
      | DecodeVisibleOtpauthCandidatesResultStatus.Ambiguous
    candidates: DecodedOtpauthCandidate[]
  }> {
    // Prefer an explicit page-provided otpauth URI (fixtures and cooperative
    // sites) so enrollment works without BarcodeDetector.
    const marked = this.collectMarkedOtpauthCandidates()
    if (marked.length > 0) {
      return this.finalizeOtpauthCandidates(marked)
    }

    const detectorAvailability = this.barcodeDetectorConstructor()
    if (
      detectorAvailability.kind === BarcodeDetectorAvailabilityKind.Unsupported
    ) {
      return {
        status: DecodeVisibleOtpauthCandidatesResultStatus.Unsupported,
        candidates: [],
      }
    }
    const { Detector } = detectorAvailability
    const detectorOptions: BarcodeDetectorOptions = { formats: ['qr_code'] }
    const detector = new Detector(detectorOptions)
    const candidates: DecodedOtpauthCandidate[] = []
    const seen = new Set<string>()
    let index = 0
    for (const element of this.collectQrMedia()) {
      index += 1
      const capture = await this.bitmapFromElement(element)
      if (capture.kind === QrBitmapCaptureKind.Unavailable) continue
      const { bitmap } = capture
      try {
        const codes = await detector.detect(bitmap)
        for (const code of codes) {
          const value = ((v) => (v ? v : ''))(code.rawValue?.trim())
          if (!value.startsWith(OTPAUTH_TOTP_PREFIX) || seen.has(value))
            continue
          seen.add(value)
          const candidate: DecodedOtpauthCandidate = {
            sourceLabel: `QR ${index}`,
            otpauthUri: value,
          }
          candidates.push(candidate)
        }
      } catch {
        // Cross-origin or undecodable media is skipped without weakening
        // host permissions.
      } finally {
        bitmap.close()
      }
    }
    return this.finalizeOtpauthCandidates(candidates)
  }

  clearOtpauthCandidate(candidate: DecodedOtpauthCandidate): void {
    candidate.otpauthUri = ''
    candidate.sourceLabel = ''
  }
}

export const pageQrCapture = new PageQrCapture(globalThis)
