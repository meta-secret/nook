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
import {
  QrBitmapCaptureKind,
  QrMediaKind,
  QrMediaRaster,
  type QrMedia,
} from './qr-media-raster'

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

enum InstructionCandidateKind {
  /** Headings, paragraphs, and a dialog's own label or description. */
  Prose = 'prose',
  /** A dialog div or span that counts only when it holds its own text. */
  TextLeaf = 'text-leaf',
}

type InstructionCandidate = {
  readonly kind: InstructionCandidateKind
  readonly element: HTMLElement
}

export enum DecodeVisibleOtpauthCandidatesResultStatus {
  Ready = 'ready',
  Unsupported = 'unsupported',
  Empty = 'empty',
  Ambiguous = 'ambiguous',
}

type DecodedOtpauthCandidates = DecodedOtpauthCandidate[]

/** Owns this browser host’s resources and interaction lifecycle. */
class PageQrCapture {
  static readonly INSTRUCTION_SCOPE_SELECTOR =
    'section, article, form, [role="group"]'
  /** A modal's own title and body describe the QR it shows. */
  static readonly DIALOG_SCOPE_SELECTOR =
    'dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"]'
  static readonly DIALOG_REFERENCE_ATTRIBUTES: readonly string[] = [
    'aria-labelledby',
    'aria-describedby',
  ]
  static readonly PROSE_SELECTOR = 'h1,h2,h3,h4,h5,h6,p'
  static readonly DIALOG_TEXT_LEAF_SELECTOR = 'div,span'

  private setupObservation: SetupObservationPreparation = {
    kind: SetupObservationPreparationKind.Unprepared,
  }
  private readonly raster: QrMediaRaster
  constructor(private readonly browser: BarcodeDetectorGlobal) {
    this.raster = new QrMediaRaster(browser)
  }

  private barcodeDetectorConstructor(): BarcodeDetectorAvailability {
    const candidate = this.browser.BarcodeDetector
    return typeof candidate === 'function'
      ? { kind: BarcodeDetectorAvailabilityKind.Available, Detector: candidate }
      : { kind: BarcodeDetectorAvailabilityKind.Unsupported }
  }

  private isVisibleElement(element: Element): boolean {
    // SVG media has no `hidden` property; the attribute covers both namespaces.
    if (
      element.hasAttribute('hidden') ||
      element.getAttribute('aria-hidden') === 'true'
    ) {
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

  private looksLikeQrMedia(element: Element): boolean {
    const tokens = [
      ((v) => (v ? v : ''))(element.getAttribute('alt')),
      ((v) => (v ? v : ''))(element.getAttribute('aria-label')),
      ((v) => (v ? v : ''))(element.getAttribute('title')),
      element.id,
      // SVG className is an SVGAnimatedString; the attribute is the class list.
      ((v) => (v ? v : ''))(element.getAttribute('class')),
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
      this.nearbyInstructionCopy(media.element),
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
                yield* Schema.decodeUnknownEffect(
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

  private nearbyInstructionCopy(media: Element): string {
    let copy = ''
    for (const instruction of this.capturedInstructionElements(media)) {
      copy = this.boundedInstructionCopy(`${copy}\n${instruction.innerText}`)
    }
    return copy
  }

  /** Visible candidates in order, without text that another one already holds. */
  private capturedInstructionElements(media: Element): HTMLElement[] {
    const captured: HTMLElement[] = []
    for (const candidate of this.nearbyInstructionCandidates(media)) {
      switch (this.instructionCandidateCapture(candidate)) {
        case InstructionElementCapture.Excluded:
          continue
        case InstructionElementCapture.Visible:
          break
      }
      const overlapsCaptured = captured.some(
        (kept) =>
          kept.contains(candidate.element) || candidate.element.contains(kept),
      )
      switch (overlapsCaptured) {
        case true:
          continue
        case false:
          captured.push(candidate.element)
      }
    }
    return captured
  }

  private nearbyInstructionCandidates(media: Element): InstructionCandidate[] {
    const dialog = media.closest(PageQrCapture.DIALOG_SCOPE_SELECTOR)
    if (dialog instanceof HTMLElement) {
      return this.dialogInstructionCandidates(dialog)
    }
    return this.nearbyInstructionElements(media).map(
      (element): InstructionCandidate => ({
        kind: InstructionCandidateKind.Prose,
        element,
      }),
    )
  }

  /**
   * The dialog's own label and description come first so they fit the copy
   * bound; its remaining headings, paragraphs, and text-bearing div/span
   * leaves follow in document order. Nested dialogs keep their own copy.
   */
  private dialogInstructionCandidates(
    dialog: HTMLElement,
  ): InstructionCandidate[] {
    const referencedIds = PageQrCapture.DIALOG_REFERENCE_ATTRIBUTES.map(
      (attribute) => dialog.getAttribute(attribute),
    )
      .filter((value) => typeof value === 'string')
      .join(' ')
      .split(/\s+/)
      .filter((id) => id.length > 0)
    const references = referencedIds
      .map((id) => this.browser.document.getElementById(id))
      .filter((element) => element instanceof HTMLElement)
      .filter((element) => dialog.contains(element))
      .map(
        (element): InstructionCandidate => ({
          kind: InstructionCandidateKind.Prose,
          element,
        }),
      )
    const contents = Array.from(
      dialog.querySelectorAll(
        `${PageQrCapture.PROSE_SELECTOR},${PageQrCapture.DIALOG_TEXT_LEAF_SELECTOR}`,
      ),
    )
      .filter((element) => element instanceof HTMLElement)
      .filter(
        (element) =>
          element.closest(PageQrCapture.DIALOG_SCOPE_SELECTOR) === dialog,
      )
      .map((element) => this.dialogInstructionCandidate(element))
    return [...references, ...contents]
  }

  private dialogInstructionCandidate(
    element: HTMLElement,
  ): InstructionCandidate {
    switch (element.matches(PageQrCapture.PROSE_SELECTOR)) {
      case true:
        return { kind: InstructionCandidateKind.Prose, element }
      case false:
        return { kind: InstructionCandidateKind.TextLeaf, element }
    }
  }

  private nearbyInstructionElements(media: Element): HTMLElement[] {
    const scopeSelector = PageQrCapture.INSTRUCTION_SCOPE_SELECTOR
    const scopes = [media.closest(scopeSelector)].filter(
      (element) => element instanceof HTMLElement,
    )
    for (const scope of scopes) {
      return Array.from(scope.querySelectorAll(PageQrCapture.PROSE_SELECTOR))
        .filter((element) => element instanceof HTMLElement)
        .filter((element) => element.closest(scopeSelector) === scope)
    }
    return [media.previousElementSibling, media.nextElementSibling]
      .filter((element) => element instanceof HTMLElement)
      .filter((element) => element.matches(PageQrCapture.PROSE_SELECTOR))
  }

  authenticationAuthenticatorSetupMutationRequiresScan(
    record: MutationRecord,
  ): boolean {
    if (record.type !== 'childList' && record.type !== 'characterData')
      return false
    // Only candidates holding the mutated node need the visibility check.
    return this.collectQrMedia().some((media) =>
      this.nearbyInstructionCandidates(media.element)
        .filter((candidate) => candidate.element.contains(record.target))
        .some(
          (candidate) =>
            this.instructionCandidateCapture(candidate) ===
            InstructionElementCapture.Visible,
        ),
    )
  }

  private instructionCandidateCapture(
    candidate: InstructionCandidate,
  ): InstructionElementCapture {
    switch (this.instructionElementVisibility(candidate.element)) {
      case InstructionElementCapture.Excluded:
        return InstructionElementCapture.Excluded
      case InstructionElementCapture.Visible:
        break
    }
    switch (candidate.kind) {
      case InstructionCandidateKind.Prose:
        return InstructionElementCapture.Visible
      case InstructionCandidateKind.TextLeaf:
        return this.textLeafCapture(candidate.element)
    }
  }

  /** A div or span counts only for text it holds itself, not a wrapper's. */
  private textLeafCapture(element: HTMLElement): InstructionElementCapture {
    const ownsText = Array.from(element.childNodes).some(
      (node) => node instanceof Text && node.data.trim().length > 0,
    )
    switch (ownsText) {
      case true:
        return InstructionElementCapture.Visible
      case false:
        return InstructionElementCapture.Excluded
    }
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

  /** Decodes one queried page element into the QR media it can be. */
  private qrMedia(element: Element): QrMedia[] {
    if (element instanceof HTMLCanvasElement) {
      return [{ kind: QrMediaKind.Canvas, element }]
    }
    if (element instanceof HTMLImageElement) {
      return [{ kind: QrMediaKind.Image, element }]
    }
    if (element instanceof SVGSVGElement) {
      return [{ kind: QrMediaKind.Vector, element }]
    }
    return []
  }

  private collectQrMedia(): QrMedia[] {
    return [...this.browser.document.querySelectorAll('canvas, img, svg')]
      .flatMap((element) => this.qrMedia(element))
      .filter(
        (media) =>
          this.isVisibleElement(media.element) &&
          this.looksLikeQrMedia(media.element),
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
    for (const media of this.collectQrMedia()) {
      index += 1
      const capture = await this.raster.opaqueBitmap(media)
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
