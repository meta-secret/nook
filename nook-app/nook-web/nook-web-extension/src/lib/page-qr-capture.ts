import { omittedValue } from '../../../nook-web-shared/src/explicit-state'
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
  | void {
  const candidate = (
    globalThis as typeof globalThis & {
      BarcodeDetector?: new (options?: {
        formats?: string[]
      }) => BarcodeDetectorLike
    }
  ).BarcodeDetector
  return typeof candidate === 'function' ? candidate : omittedValue()
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
): Promise<ImageBitmap | void> {
  try {
    if (element instanceof HTMLCanvasElement) {
      return await createImageBitmap(element)
    }
    if (element instanceof HTMLImageElement) {
      if (!element.complete || element.naturalWidth === 0) return
      return await createImageBitmap(element)
    }
    if (element instanceof SVGSVGElement) {
      const serialized = new XMLSerializer().serializeToString(element)
      const blob = new Blob([serialized], { type: 'image/svg+xml' })
      return await createImageBitmap(blob)
    }
  } catch {
    return
  }
  return
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
    candidates.push({
      sourceLabel: `QR ${index}`,
      otpauthUri: value,
    })
  }
  return candidates
}

enum FinalizeOtpauthCandidatesResultStatus {
  Ready = 'ready',
  Empty = 'empty',
  Ambiguous = 'ambiguous',
}

function finalizeOtpauthCandidates(candidates: DecodedOtpauthCandidate[]): {
  status:
    | FinalizeOtpauthCandidatesResultStatus.Ready
    | FinalizeOtpauthCandidatesResultStatus.Empty
    | FinalizeOtpauthCandidatesResultStatus.Ambiguous
  candidates: DecodedOtpauthCandidate[]
} {
  if (candidates.length === 0) return { status: 'empty', candidates: [] }
  if (candidates.length > 1) return { status: 'ambiguous', candidates }
  return { status: 'ready', candidates }
}

export enum DecodeVisibleOtpauthCandidatesResultStatus {
  Ready = 'ready',
  Unsupported = 'unsupported',
  Empty = 'empty',
  Ambiguous = 'ambiguous',
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

  const Detector = barcodeDetectorConstructor()
  if (!Detector) {
    return {
      status: DecodeVisibleOtpauthCandidatesResultStatus.Unsupported,
      candidates: [],
    }
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
  return finalizeOtpauthCandidates(candidates)
}

export function clearOtpauthCandidate(
  candidate: DecodedOtpauthCandidate,
): void {
  candidate.otpauthUri = ''
  candidate.sourceLabel = ''
}
