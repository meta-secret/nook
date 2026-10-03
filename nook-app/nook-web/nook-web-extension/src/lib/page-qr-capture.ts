import {
  type AuthenticationAuthenticatorSetupBatch,
  type AuthenticationAuthenticatorSetupObservation,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  CompanionWasmSessionMessageType,
  CompanionWasmAuthenticatorSetupResponseDecoder,
  type CompanionWasmRuntimeMessage,
} from '../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import {
  CompanionWasmRuntimeDeliveryKind,
  sendCompanionWasmRuntimeMessage,
} from '../../../nook-web-shared/src/extension/companion-wasm-runtime-transport'
import { Effect, Schema } from 'effect'

enum SetupObservationPreparationKind {
  Unprepared = 'unprepared',
  Prepared = 'prepared',
}

export type AuthenticationAuthenticatorSetupSnapshot = {
  readonly metadataKey: string
  readonly observation: AuthenticationAuthenticatorSetupObservation
}

type SetupObservationPreparation =
  | { readonly kind: SetupObservationPreparationKind.Unprepared }
  | {
      readonly kind: SetupObservationPreparationKind.Prepared
      readonly metadataKey: string
      readonly observation: AuthenticationAuthenticatorSetupObservation
    }

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

enum InstructionElementCapture {
  Excluded = 'excluded',
  Visible = 'visible',
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
  private setupObservation: SetupObservationPreparation = {
    kind: SetupObservationPreparationKind.Unprepared,
  }
  constructor(private readonly browser: BarcodeDetectorGlobal) {}

  private barcodeDetectorConstructor(): BarcodeDetectorAvailability {
    const candidate = this.browser.BarcodeDetector
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

  private authenticatorSetupMetadata(): AuthenticationAuthenticatorSetupBatch {
    const visibleInstructionCopies = this.collectQrMedia().map((media) =>
      this.nearbyInstructionCopy(media),
    )
    switch (visibleInstructionCopies.length === 0) {
      case true:
        return { visibleInstructionCopies, qrMedia: 'absent' }
      case false:
        return { visibleInstructionCopies, qrMedia: 'present' }
    }
  }

  prepareAuthenticationAuthenticatorSetupObservation(): Promise<AuthenticationAuthenticatorSetupSnapshot> {
    return Effect.runPromise(
      Effect.gen(
        function* prepareSetupObservation(this: PageQrCapture) {
          this.setupObservation = {
            kind: SetupObservationPreparationKind.Unprepared,
          }
          const metadata = this.authenticatorSetupMetadata()
          const message: CompanionWasmRuntimeMessage = {
            type: CompanionWasmSessionMessageType.AuthenticationAuthenticatorSetupObservation,
            payload: metadata,
            origin: this.browser.location.origin,
          }
          const delivery = yield* Effect.promise(() =>
            sendCompanionWasmRuntimeMessage(this.browser, message),
          )
          switch (delivery.kind) {
            case CompanionWasmRuntimeDeliveryKind.Unavailable:
              return yield* Effect.fail(
                new Error('Authenticator setup runtime unavailable.'),
              )
            case CompanionWasmRuntimeDeliveryKind.Delivered: {
              const { authenticatorSetupObservation: observation } =
                yield* Schema.decodeUnknown(
                  CompanionWasmAuthenticatorSetupResponseDecoder,
                )(delivery.response).pipe(
                  Effect.mapError(
                    () =>
                      new Error(
                        'Authenticator setup runtime response rejected.',
                      ),
                  ),
                )
              const snapshot: AuthenticationAuthenticatorSetupSnapshot = {
                metadataKey: JSON.stringify(metadata),
                observation,
              }
              this.setupObservation = {
                kind: SetupObservationPreparationKind.Prepared,
                ...snapshot,
              }
              return Object.freeze(snapshot)
            }
          }
        }.bind(this),
      ),
    )
  }

  authenticationAuthenticatorSetupSnapshotIsCurrent(
    snapshot: AuthenticationAuthenticatorSetupSnapshot,
  ): boolean {
    return (
      snapshot.metadataKey === JSON.stringify(this.authenticatorSetupMetadata())
    )
  }

  authenticationAuthenticatorSetupObservation(): AuthenticationAuthenticatorSetupObservation {
    switch (this.setupObservation.kind) {
      case SetupObservationPreparationKind.Unprepared:
        throw new Error('Authenticator setup observation is not prepared.')
      case SetupObservationPreparationKind.Prepared:
        switch (
          this.setupObservation.metadataKey ===
          JSON.stringify(this.authenticatorSetupMetadata())
        ) {
          case true:
            return this.setupObservation.observation
          case false:
            throw new Error('Authenticator setup observation is stale.')
        }
    }
  }

  private nearbyInstructionCopy(media: HTMLElement): string {
    let copy = ''
    for (const paragraph of this.nearbyInstructionElements(media)) {
      switch (this.instructionElementVisibility(paragraph)) {
        case InstructionElementCapture.Excluded:
          continue
        case InstructionElementCapture.Visible:
          break
      }
      copy = this.boundedInstructionCopy(`${copy}\n${paragraph.innerText}`)
    }
    return copy
  }

  private nearbyInstructionElements(media: HTMLElement): HTMLElement[] {
    const scopeSelector = 'section, article, form, [role="group"]'
    const scopes = [media.closest(scopeSelector)].filter(
      (element) => element instanceof HTMLElement,
    )
    for (const scope of scopes) {
      return Array.from(scope.querySelectorAll('h1,h2,h3,h4,h5,h6,p'))
        .filter((element) => element instanceof HTMLElement)
        .filter((element) => element.closest(scopeSelector) === scope)
    }
    return [media.previousElementSibling, media.nextElementSibling]
      .filter((element) => element instanceof HTMLElement)
      .filter((element) => element.matches('h1,h2,h3,h4,h5,h6,p'))
  }

  private instructionElementVisibility(
    element: Element,
  ): InstructionElementCapture {
    switch (element instanceof HTMLElement) {
      case false:
        return InstructionElementCapture.Excluded
      case true:
        break
    }
    const forbidden =
      'input,textarea,select,button,code,pre,kbd,samp,[hidden],[aria-hidden="true"],[data-nook-otpauth-uri],[data-nook-backup-codes],[data-nook-backup-code],[data-secret],[data-setup-key]'
    switch (
      element.matches(forbidden) ||
      element.querySelector(forbidden) instanceof Element ||
      element.closest(forbidden) instanceof Element
    ) {
      case true:
        return InstructionElementCapture.Excluded
      case false:
        break
    }
    const rect = element.getBoundingClientRect()
    switch (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < this.browser.window.innerHeight &&
      rect.left < this.browser.window.innerWidth
    ) {
      case false:
        return InstructionElementCapture.Excluded
      case true:
        break
    }
    for (
      let ancestor: HTMLElement | Element = element;
      ancestor instanceof HTMLElement;
    ) {
      const style = this.browser.window.getComputedStyle(ancestor)
      switch (
        ancestor.hasAttribute('hidden') ||
        ancestor.getAttribute('aria-hidden') === 'true' ||
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0'
      ) {
        case true:
          return InstructionElementCapture.Excluded
        case false:
          break
      }
      const parents: HTMLElement[] = [ancestor.parentElement].filter(
        (element) => element instanceof HTMLElement,
      )
      for (const parent of parents) ancestor = parent
      switch (parents.length) {
        case 0:
          return InstructionElementCapture.Visible
        default:
          break
      }
    }
    return InstructionElementCapture.Excluded
  }

  private boundedInstructionCopy(text: string): string {
    let copy = ''
    let bytes = 0
    const encoder = new TextEncoder()
    for (const character of text) {
      bytes += encoder.encode(character).length
      switch (bytes > 512) {
        case true:
          return copy
        case false:
          copy += character
          break
      }
    }
    return copy
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
    ].flatMap((element) => (element instanceof HTMLElement ? [element] : []))
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
    ].flatMap((element) => (element instanceof HTMLElement ? [element] : []))
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
