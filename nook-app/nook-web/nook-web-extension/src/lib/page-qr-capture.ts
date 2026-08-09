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

function barcodeDetectorConstructor(): BarcodeDetectorAvailability {
  const candidate = (
    globalThis as typeof globalThis & {
      BarcodeDetector?: new (options: {
        formats: string[]
      }) => BarcodeDetectorLike
    }
  ).BarcodeDetector
  return typeof candidate === 'function'
    ? { kind: BarcodeDetectorAvailabilityKind.Available, Detector: candidate }
    : { kind: BarcodeDetectorAvailabilityKind.Unsupported }
}

function isVisibleElement(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false
  if (element.hidden || element.getAttribute('aria-hidden') === 'true') {
    return false
  }
  const style = window.getComputedStyle(element)
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
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth
  )
}

function looksLikeQrMedia(element: HTMLElement): boolean {
  const tokens = [
    element.getAttribute('alt') ?? '',
    element.getAttribute('aria-label') ?? '',
    element.getAttribute('title') ?? '',
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

export function pageHasQrEnrollmentHint(): boolean {
  const media = [
    ...document.querySelectorAll('canvas, img, svg'),
  ] as HTMLElement[]
  return media.some(
    (element) => isVisibleElement(element) && looksLikeQrMedia(element),
  )
}

async function bitmapFromElement(
  element: HTMLElement,
): Promise<QrBitmapCapture> {
  try {
    if (element instanceof HTMLCanvasElement) {
      return {
        kind: QrBitmapCaptureKind.Captured,
        bitmap: await createImageBitmap(element),
      }
    }
    if (element instanceof HTMLImageElement) {
      if (!element.complete || element.naturalWidth === 0) {
        return { kind: QrBitmapCaptureKind.Unavailable }
      }
      return {
        kind: QrBitmapCaptureKind.Captured,
        bitmap: await createImageBitmap(element),
      }
    }
    if (element instanceof SVGSVGElement) {
      const serialized = new XMLSerializer().serializeToString(element)
      const blobOptions: BlobPropertyBag = { type: 'image/svg+xml' }
      const blob = new Blob([serialized], blobOptions)
      return {
        kind: QrBitmapCaptureKind.Captured,
        bitmap: await createImageBitmap(blob),
      }
    }
  } catch {
    return { kind: QrBitmapCaptureKind.Unavailable }
  }
  return { kind: QrBitmapCaptureKind.Unavailable }
}

function collectQrMedia(): HTMLElement[] {
  const media = [
    ...document.querySelectorAll('canvas, img, svg'),
  ] as HTMLElement[]
  return media
    .filter((element) => isVisibleElement(element) && looksLikeQrMedia(element))
    .slice(0, MAX_QR_CANDIDATES)
}

function collectMarkedOtpauthCandidates(): DecodedOtpauthCandidate[] {
  const elements = [
    ...document.querySelectorAll('[data-nook-otpauth-uri]'),
  ] as HTMLElement[]
  const candidates: DecodedOtpauthCandidate[] = []
  const seen = new Set<string>()
  let index = 0
  for (const element of elements) {
    if (!isVisibleElement(element)) continue
    const value = element.getAttribute('data-nook-otpauth-uri')?.trim() ?? ''
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

export enum DecodeVisibleOtpauthCandidatesResultStatus {
  Ready = 'ready',
  Unsupported = 'unsupported',
  Empty = 'empty',
  Ambiguous = 'ambiguous',
}

function finalizeOtpauthCandidates(candidates: DecodedOtpauthCandidate[]): {
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

export async function decodeVisibleOtpauthCandidates(): Promise<{
  status:
    | DecodeVisibleOtpauthCandidatesResultStatus.Ready
    | DecodeVisibleOtpauthCandidatesResultStatus.Unsupported
    | DecodeVisibleOtpauthCandidatesResultStatus.Empty
    | DecodeVisibleOtpauthCandidatesResultStatus.Ambiguous
  candidates: DecodedOtpauthCandidate[]
}> {
  // Prefer an explicit page-provided otpauth URI (fixtures and cooperative
  // sites) so enrollment works without BarcodeDetector.
  const marked = collectMarkedOtpauthCandidates()
  if (marked.length > 0) {
    return finalizeOtpauthCandidates(marked)
  }

  const detectorAvailability = barcodeDetectorConstructor()
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
  for (const element of collectQrMedia()) {
    index += 1
    const capture = await bitmapFromElement(element)
    if (capture.kind === QrBitmapCaptureKind.Unavailable) continue
    const { bitmap } = capture
    try {
      const codes = await detector.detect(bitmap)
      for (const code of codes) {
        const value = code.rawValue?.trim() ?? ''
        if (!value.startsWith(OTPAUTH_TOTP_PREFIX) || seen.has(value)) continue
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
  return finalizeOtpauthCandidates(candidates)
}

export function clearOtpauthCandidate(
  candidate: DecodedOtpauthCandidate,
): void {
  candidate.otpauthUri = ''
  candidate.sourceLabel = ''
}
