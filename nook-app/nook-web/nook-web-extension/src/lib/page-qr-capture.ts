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

function barcodeDetectorConstructor():
  | (new (options?: { formats?: string[] }) => BarcodeDetectorLike)
  | undefined {
  const candidate = (
    globalThis as typeof globalThis & {
      BarcodeDetector?: new (options?: {
        formats?: string[]
      }) => BarcodeDetectorLike
    }
  ).BarcodeDetector
  return typeof candidate === 'function' ? candidate : undefined
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
): Promise<ImageBitmap | undefined> {
  try {
    if (element instanceof HTMLCanvasElement) {
      return await createImageBitmap(element)
    }
    if (element instanceof HTMLImageElement) {
      if (!element.complete || element.naturalWidth === 0) return undefined
      return await createImageBitmap(element)
    }
    if (element instanceof SVGSVGElement) {
      const serialized = new XMLSerializer().serializeToString(element)
      const blob = new Blob([serialized], { type: 'image/svg+xml' })
      return await createImageBitmap(blob)
    }
  } catch {
    return undefined
  }
  return undefined
}

function collectQrMedia(): HTMLElement[] {
  const media = [
    ...document.querySelectorAll('canvas, img, svg'),
  ] as HTMLElement[]
  return media
    .filter((element) => isVisibleElement(element) && looksLikeQrMedia(element))
    .slice(0, MAX_QR_CANDIDATES)
}

export async function decodeVisibleOtpauthCandidates(): Promise<{
  status: 'ready' | 'unsupported' | 'empty' | 'ambiguous'
  candidates: DecodedOtpauthCandidate[]
}> {
  const Detector = barcodeDetectorConstructor()
  if (!Detector) {
    return { status: 'unsupported', candidates: [] }
  }
  const detector = new Detector({ formats: ['qr_code'] })
  const candidates: DecodedOtpauthCandidate[] = []
  const seen = new Set<string>()
  let index = 0
  for (const element of collectQrMedia()) {
    index += 1
    const bitmap = await bitmapFromElement(element)
    if (!bitmap) continue
    try {
      const codes = await detector.detect(bitmap)
      for (const code of codes) {
        const value = code.rawValue?.trim() ?? ''
        if (!value.startsWith(OTPAUTH_TOTP_PREFIX) || seen.has(value)) continue
        seen.add(value)
        candidates.push({
          sourceLabel: `QR ${index}`,
          otpauthUri: value,
        })
      }
    } catch {
      // Cross-origin or undecodable media is skipped without weakening
      // host permissions.
    } finally {
      bitmap.close()
    }
  }
  if (candidates.length === 0) return { status: 'empty', candidates: [] }
  if (candidates.length > 1) return { status: 'ambiguous', candidates }
  return { status: 'ready', candidates }
}

export function clearOtpauthCandidate(
  candidate: DecodedOtpauthCandidate,
): void {
  candidate.otpauthUri = ''
  candidate.sourceLabel = ''
}
