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
import { Effect, Exit, Schema } from 'effect'
import {
  QrPictureCaptureKind,
  QrMediaKind,
  QrMediaRaster,
  type QrMedia,
} from './qr-media-raster'
import {
  AuthenticatorEnrollmentCandidatesDecoder,
  AuthenticatorEnrollmentSourceBound,
} from '../../../nook-web-shared/src/extension/authenticator-enrollment-candidates'
import {
  ElementRendering,
  RenderedElementVisibility,
} from './rendered-element-visibility'
import {
  SetupKeyTextCandidates,
  type SetupKeySource,
  type SetupKeySources,
} from './setup-key-candidates'
import type {
  NookAuthenticatorEnrollmentCandidateSource,
  NookAuthenticatorEnrollmentCandidates,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'

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

const MAX_QR_CANDIDATES = AuthenticatorEnrollmentSourceBound.MaxPictures

const MIN_QR_EDGE_PX = 80

/** One Rust-accepted candidate; its label is the source and 1-based ordinal. */
export type DecodedOtpauthCandidate = {
  readonly source: NookAuthenticatorEnrollmentCandidateSource
  readonly ordinal: number
  otpauthUri: string
}

enum InstructionElementCapture {
  Excluded = 'excluded',
  Visible = 'visible',
}

enum InstructionCandidateKind {
  /** Headings, paragraphs, and a dialog's own label or description. */
  Prose = 'prose',
  /** A dialog div or span before the QR that counts only for its own text. */
  TextLeaf = 'text-leaf',
}

type InstructionCandidate = {
  readonly kind: InstructionCandidateKind
  readonly element: HTMLElement
}

/** Instruction candidates in the order their copy reads them. */
type InstructionCandidates = InstructionCandidate[]

/** The visible QR media collected for one observation or trusted decode. */
type VisibleQrMedia = QrMedia[]

/** One dialog's instruction lookup for the QR media it contains. */
type DialogInstructionRequest = {
  readonly dialog: HTMLElement
  readonly media: Element
}

/** One dialog without QR media, read only for its title and headings. */
type DialogHeadingRequest = {
  readonly dialog: HTMLElement
}

/** The dialog attributes whose referenced elements count as its copy. */
type DialogReferenceRequest = {
  readonly dialog: HTMLElement
  readonly attributes: readonly string[]
}

/** One dialog element considered as instruction copy for that media. */
type DialogContentRequest = {
  readonly element: HTMLElement
  readonly media: Element
}

export enum DecodeVisibleOtpauthCandidatesResultStatus {
  Ready = 'ready',
  Empty = 'empty',
  Ambiguous = 'ambiguous',
  /** The offscreen decoder or its reply was unavailable. */
  Failed = 'failed',
}

type DecodedOtpauthCandidates = DecodedOtpauthCandidate[]

export type DecodedOtpauthCandidatesResult = {
  readonly status: DecodeVisibleOtpauthCandidatesResultStatus
  readonly candidates: DecodedOtpauthCandidates
}

/** How the content script reads the offscreen reply: Rust's candidates or a failure. */
type CandidatesDecodeOutcome = {
  readonly onFailure: () => DecodedOtpauthCandidatesResult
  readonly onSuccess: (
    accepted: NookAuthenticatorEnrollmentCandidates,
  ) => DecodedOtpauthCandidatesResult
}

/** A setup scope and the instruction candidates its pre-consent copy reads. */
type SetupScope = {
  readonly element: HTMLElement
  readonly candidates: InstructionCandidate[]
}

enum SetupScopeCopy {
  Instructed = 'instructed',
  Silent = 'silent',
}

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
  /** A manual-key dialog is read only for its title and these headings. */
  static readonly HEADING_SELECTOR = 'h1,h2,h3,h4,h5,h6'
  static readonly DIALOG_TITLE_ATTRIBUTES: readonly string[] = [
    'aria-labelledby',
  ]
  /** Markup that may set a setup key inside a heading. */
  static readonly KEY_MARKUP_SELECTOR = 'strong,b,code,kbd,samp,mark,input'
  static readonly DIALOG_TEXT_LEAF_SELECTOR = 'div,span'
  /** Setup scopes a manual-key view without QR media may describe itself in. */
  static readonly MAX_SETUP_SCOPES = 8

  private setupObservation: SetupObservationPreparation = {
    kind: SetupObservationPreparationKind.Unprepared,
  }
  private readonly raster: QrMediaRaster
  private readonly setupKeyTexts: SetupKeyTextCandidates
  private readonly visibility: RenderedElementVisibility
  constructor(private readonly browser: typeof globalThis) {
    this.raster = new QrMediaRaster(browser)
    this.setupKeyTexts = new SetupKeyTextCandidates(browser)
    this.visibility = new RenderedElementVisibility(browser)
  }

  private isVisibleElement(element: Element): boolean {
    // SVG media has no `hidden` property; the attribute covers both namespaces.
    if (
      element.hasAttribute('hidden') ||
      element.getAttribute('aria-hidden') === 'true'
    ) {
      return false
    }
    // The size and viewport gate runs first so small icons skip computed style.
    const rect = element.getBoundingClientRect()
    if (
      rect.width < MIN_QR_EDGE_PX ||
      rect.height < MIN_QR_EDGE_PX ||
      rect.bottom <= 0 ||
      rect.right <= 0 ||
      rect.top >= this.browser.window.innerHeight ||
      rect.left >= this.browser.window.innerWidth
    ) {
      return false
    }
    const style = this.browser.window.getComputedStyle(element)
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0'
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

  /**
   * Pre-consent copy only: never QR payloads or setup keys. With visible QR
   * media each one reports its nearby instructions. Without any, only an open
   * dialog can describe a manual-key view, through its labelled title and its
   * headings. Its description, paragraphs, and any heading holding emphasized,
   * code-like, or input markup stay out, because a site may print the key there.
   */
  private authenticatorSetupMetadata(): AuthenticationAuthenticatorSetupBatch {
    const media = this.collectQrMedia()
    switch (media.length === 0) {
      case false:
        return {
          visibleInstructionCopies: media.map((item) =>
            this.instructionCopy(
              this.nearbyInstructionCandidates(item.element),
            ),
          ),
          qrMedia: 'present',
        }
      case true:
        return {
          visibleInstructionCopies: this.instructedManualKeyDialogs().map(
            (scope) => this.instructionCopy(scope.candidates),
          ),
          qrMedia: 'absent',
        }
    }
  }

  /** Outermost dialogs in page order, each read only for its title and headings. */
  private manualKeyDialogs(): SetupScope[] {
    return Array.from(
      this.browser.document.querySelectorAll(
        PageQrCapture.DIALOG_SCOPE_SELECTOR,
      ),
    )
      .filter((element) => element instanceof HTMLElement)
      .filter(
        (dialog) =>
          !(
            dialog.parentElement?.closest(
              PageQrCapture.DIALOG_SCOPE_SELECTOR,
            ) instanceof Element
          ),
      )
      .map((dialog): SetupScope => {
        const request: DialogHeadingRequest = { dialog }
        return {
          element: dialog,
          candidates: this.dialogHeadingCandidates(request),
        }
      })
  }

  private instructedManualKeyDialogs(): SetupScope[] {
    return this.manualKeyDialogs()
      .filter(
        (scope) =>
          this.scopeCopy(scope.candidates) === SetupScopeCopy.Instructed,
      )
      .slice(0, PageQrCapture.MAX_SETUP_SCOPES)
  }

  private scopeCopy(candidates: InstructionCandidates): SetupScopeCopy {
    switch (this.instructionCopy(candidates).trim().length > 0) {
      case true:
        return SetupScopeCopy.Instructed
      case false:
        return SetupScopeCopy.Silent
    }
  }

  /**
   * The single setup scope nearest the instructions or QR, after the trusted
   * click: the first QR's dialog, section, or parent, or else the first
   * instructed manual-key dialog, anchored at its first instruction.
   */
  private setupKeySources(media: VisibleQrMedia): SetupKeySources {
    switch (media.length === 0) {
      case false:
        return media.slice(0, 1).flatMap((item) =>
          this.mediaScope(item.element).map((scope): SetupKeySource => ({
            scope,
            anchor: item.element,
          })),
        )
      case true:
        return this.instructedManualKeyDialogs()
          .slice(0, 1)
          .flatMap((dialog) =>
            this.capturedInstructionElements(dialog.candidates)
              .slice(0, 1)
              .map((anchor): SetupKeySource => ({
                scope: dialog.element,
                anchor,
              })),
          )
    }
  }

  /** The dialog, section, or parent that frames one QR's instructions. */
  private mediaScope(media: Element): HTMLElement[] {
    const scopes = [
      media.closest(PageQrCapture.DIALOG_SCOPE_SELECTOR),
      media.closest(PageQrCapture.INSTRUCTION_SCOPE_SELECTOR),
      media.parentElement,
    ].filter((element) => element instanceof HTMLElement)
    return scopes.slice(0, 1)
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

  private instructionCopy(candidates: InstructionCandidates): string {
    let copy = ''
    for (const instruction of this.capturedInstructionElements(candidates)) {
      copy = this.boundedInstructionCopy(`${copy}\n${instruction.innerText}`)
    }
    return copy
  }

  /** Visible candidates in order, without text that another one already holds. */
  private capturedInstructionElements(
    candidates: InstructionCandidates,
  ): HTMLElement[] {
    const captured: HTMLElement[] = []
    for (const candidate of candidates) {
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
      const request: DialogInstructionRequest = { dialog, media }
      return this.dialogInstructionCandidates(request)
    }
    const scope = media.closest(PageQrCapture.INSTRUCTION_SCOPE_SELECTOR)
    switch (true) {
      case scope instanceof HTMLElement:
        return this.scopeProseElements(scope).map(
          (element): InstructionCandidate => ({
            kind: InstructionCandidateKind.Prose,
            element,
          }),
        )
      case true:
      default:
        return this.adjacentInstructionCandidates(media)
    }
  }

  /**
   * The dialog's own label and description come first so they fit the copy
   * bound; its remaining headings, paragraphs, and text-bearing div/span
   * leaves follow in document order. Nested dialogs keep their own copy.
   */
  private dialogInstructionCandidates(
    request: DialogInstructionRequest,
  ): InstructionCandidate[] {
    const { dialog, media } = request
    const referenceRequest: DialogReferenceRequest = {
      dialog,
      attributes: PageQrCapture.DIALOG_REFERENCE_ATTRIBUTES,
    }
    const references = this.dialogReferenceCandidates(referenceRequest)
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
      .flatMap((element) => {
        const content: DialogContentRequest = { element, media }
        return this.dialogContentCandidates(content)
      })
    return [...references, ...contents]
  }

  /** The elements the dialog names through these attributes, which it contains. */
  private dialogReferenceCandidates(
    request: DialogReferenceRequest,
  ): InstructionCandidate[] {
    const { dialog, attributes } = request
    const referencedIds = attributes
      .map((attribute) => dialog.getAttribute(attribute))
      .filter((value) => typeof value === 'string')
      .join(' ')
      .split(/\s+/)
      .filter((id) => id.length > 0)
    return referencedIds
      .map((id) => this.browser.document.getElementById(id))
      .filter((element) => element instanceof HTMLElement)
      .filter((element) => dialog.contains(element))
      .map((element): InstructionCandidate => ({
        kind: InstructionCandidateKind.Prose,
        element,
      }))
  }

  /**
   * A dialog without QR media: its aria-labelledby title, then its own
   * headings. A title or heading holding emphasized, code-like, or input
   * markup is skipped, since a site may set the key there.
   */
  private dialogHeadingCandidates(
    request: DialogHeadingRequest,
  ): InstructionCandidate[] {
    const { dialog } = request
    const titleRequest: DialogReferenceRequest = {
      dialog,
      attributes: PageQrCapture.DIALOG_TITLE_ATTRIBUTES,
    }
    const headings = Array.from(
      dialog.querySelectorAll(PageQrCapture.HEADING_SELECTOR),
    )
      .filter((element) => element instanceof HTMLElement)
      .filter(
        (element) =>
          element.closest(PageQrCapture.DIALOG_SCOPE_SELECTOR) === dialog,
      )
      .map((element): InstructionCandidate => ({
        kind: InstructionCandidateKind.Prose,
        element,
      }))
    return [
      ...this.dialogReferenceCandidates(titleRequest),
      ...headings,
    ].filter(
      (candidate) =>
        !(
          candidate.element.matches(PageQrCapture.KEY_MARKUP_SELECTOR) ||
          candidate.element.querySelector(
            PageQrCapture.KEY_MARKUP_SELECTOR,
          ) instanceof Element
        ),
    )
  }

  /**
   * Prose always qualifies. A div or span leaf qualifies only before the QR
   * media in document order, so text shown after the code (such as a setup
   * key revealed below it) never enters the instruction copy.
   */
  private dialogContentCandidates(
    request: DialogContentRequest,
  ): InstructionCandidate[] {
    const { element, media } = request
    switch (element.matches(PageQrCapture.PROSE_SELECTOR)) {
      case true:
        return [{ kind: InstructionCandidateKind.Prose, element }]
      case false:
        break
    }
    const position = element.compareDocumentPosition(media)
    const precedesMedia =
      (position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 &&
      (position & Node.DOCUMENT_POSITION_CONTAINED_BY) === 0
    switch (precedesMedia) {
      case true:
        return [{ kind: InstructionCandidateKind.TextLeaf, element }]
      case false:
        return []
    }
  }

  /**
   * Ordinary page widgets often wrap their media in empty divs. Follow only
   * those media-only wrappers to the nearest preceding sibling branch, then
   * stop. Any text node, including whitespace, stops traversal without reading
   * its payload. Never search outward past text or read an ancestor's copy.
   */
  private adjacentInstructionCandidates(
    media: Element,
  ): InstructionCandidate[] {
    const directProse = [media.previousElementSibling, media.nextElementSibling]
      .filter((element) => element instanceof HTMLElement)
      .filter((element) => element.matches(PageQrCapture.PROSE_SELECTOR))
    switch (directProse.length > 0) {
      case true:
        return directProse.map((element): InstructionCandidate => ({
          kind: InstructionCandidateKind.Prose,
          element,
        }))
      case false:
        break
    }
    let branch = media
    while (branch.parentElement instanceof HTMLElement) {
      const preceding = branch.previousElementSibling
      switch (true) {
        case preceding instanceof HTMLElement:
          return this.adjacentBranchCandidates(preceding)
        case true:
        default:
          break
      }
      const parent = branch.parentElement
      switch (
        parent.matches('div,span') &&
        parent.children.length === 1 &&
        !Array.from(parent.childNodes).some((node) => node instanceof Text)
      ) {
        case true:
          branch = parent
          break
        case false:
          return []
      }
    }
    return []
  }

  /** A single adjacent instruction branch, excluding other page surfaces. */
  private adjacentBranchCandidates(
    branch: HTMLElement,
  ): InstructionCandidate[] {
    const copySelector = `${PageQrCapture.PROSE_SELECTOR},div,span`
    const otherSurface = `${PageQrCapture.INSTRUCTION_SCOPE_SELECTOR},${PageQrCapture.DIALOG_SCOPE_SELECTOR},main,aside,nav,header,footer,canvas,img,svg,input,textarea,select,button,code,pre,kbd,samp,[data-secret],[data-setup-key],[data-nook-backup-codes],[data-nook-backup-code]`
    switch (
      branch.matches(copySelector) &&
      !branch.matches(otherSurface) &&
      !(branch.querySelector(otherSurface) instanceof Element)
    ) {
      case false:
        return []
      case true:
        break
    }
    return [branch, ...branch.querySelectorAll(copySelector)]
      .filter((element) => element instanceof HTMLElement)
      .map((element): InstructionCandidate => {
        switch (element.matches(PageQrCapture.PROSE_SELECTOR)) {
          case true:
            return { kind: InstructionCandidateKind.Prose, element }
          case false:
            return { kind: InstructionCandidateKind.TextLeaf, element }
        }
      })
  }

  /** Headings and paragraphs that belong to this section scope, not a nested one. */
  private scopeProseElements(scope: HTMLElement): HTMLElement[] {
    return Array.from(scope.querySelectorAll(PageQrCapture.PROSE_SELECTOR))
      .filter((element) => element instanceof HTMLElement)
      .filter(
        (element) =>
          element.closest(PageQrCapture.INSTRUCTION_SCOPE_SELECTOR) === scope,
      )
  }

  authenticationAuthenticatorSetupMutationRequiresScan(
    record: MutationRecord,
  ): boolean {
    if (record.type !== 'childList' && record.type !== 'characterData')
      return false
    // Only candidates holding the mutated node need the visibility check.
    return this.setupInstructionCandidateGroups().some((candidates) =>
      candidates
        .filter((candidate) => candidate.element.contains(record.target))
        .some(
          (candidate) =>
            this.instructionCandidateCapture(candidate) ===
            InstructionElementCapture.Visible,
        ),
    )
  }

  /** Each QR's instruction candidates, or each manual-key scope's without QR media. */
  private setupInstructionCandidateGroups(): InstructionCandidate[][] {
    const media = this.collectQrMedia()
    switch (media.length === 0) {
      case false:
        return media.map((item) =>
          this.nearbyInstructionCandidates(item.element),
        )
      case true:
        return this.manualKeyDialogs().map((scope) => scope.candidates)
    }
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
      'input,textarea,select,button,code,pre,kbd,samp,[hidden],[aria-hidden="true"],[data-nook-backup-codes],[data-nook-backup-code],[data-secret],[data-setup-key]'
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
    switch (this.visibility.rendering(element)) {
      case ElementRendering.Hidden:
        return InstructionElementCapture.Excluded
      case ElementRendering.Rendered:
        return InstructionElementCapture.Visible
    }
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

  private finalizeOtpauthCandidates(
    candidates: DecodedOtpauthCandidates,
  ): DecodedOtpauthCandidatesResult {
    switch (candidates.length) {
      case 0:
        return {
          status: DecodeVisibleOtpauthCandidatesResultStatus.Empty,
          candidates,
        }
      case 1:
        return {
          status: DecodeVisibleOtpauthCandidatesResultStatus.Ready,
          candidates,
        }
      default:
        return {
          status: DecodeVisibleOtpauthCandidatesResultStatus.Ambiguous,
          candidates,
        }
    }
  }

  private failedCandidates(): DecodedOtpauthCandidatesResult {
    return {
      status: DecodeVisibleOtpauthCandidatesResultStatus.Failed,
      candidates: [],
    }
  }

  /** Rasterizes each visible QR once; unreadable media is skipped. */
  private async capturedPictures(media: VisibleQrMedia): Promise<string[]> {
    const pictureDataUrls: string[] = []
    for (const item of media) {
      const capture = await this.raster.opaquePicture(item)
      switch (capture.kind) {
        case QrPictureCaptureKind.Unavailable:
          continue
        case QrPictureCaptureKind.Captured:
          pictureDataUrls.push(capture.pngDataUrl)
      }
    }
    return pictureDataUrls
  }

  /**
   * Runs only after the trusted **Add 2FA from this page** click. The content
   * script rasterizes the visible QR media and reads bounded setup-key text
   * candidates from the nearest setup scope; the offscreen document decodes the
   * pictures and Rust returns only the otpauth candidates it accepts.
   */
  async resolveVisibleOtpauthCandidates(): Promise<DecodedOtpauthCandidatesResult> {
    const media = this.collectQrMedia()
    const setupKeyTexts = this.setupKeyTexts.collect(
      this.setupKeySources(media),
    )
    const pictureDataUrls = await this.capturedPictures(media)
    const message: CompanionWasmRuntimeMessage = {
      type: CompanionWasmSessionMessageType.ResolveAuthenticatorEnrollmentCandidates,
      payload: {
        pictureDataUrls,
        setupKeyTexts,
      },
      origin: this.browser.location.origin,
    }
    const delivery = await sendCompanionWasmRuntimeMessage(
      this.browser,
      message,
    ).finally(() => {
      // The page keeps no copy of the captured pictures or texts once sent.
      pictureDataUrls.fill('')
      setupKeyTexts.fill('')
    })
    switch (delivery.kind) {
      case CompanionWasmRuntimeDeliveryKind.Unavailable:
        return this.failedCandidates()
      case CompanionWasmRuntimeDeliveryKind.Delivered:
        break
    }
    const outcome: CandidatesDecodeOutcome = {
      onFailure: () => this.failedCandidates(),
      onSuccess: ({ candidates: accepted }) =>
        this.finalizeOtpauthCandidates(
          [...accepted.entries()].map(
            ([index, candidate]): DecodedOtpauthCandidate => ({
              ...candidate,
              ordinal:
                accepted
                  .slice(0, index)
                  .filter((earlier) => earlier.source === candidate.source)
                  .length + 1,
            }),
          ),
        ),
    }
    return Exit.match(
      Schema.decodeUnknownExit(AuthenticatorEnrollmentCandidatesDecoder)(
        delivery.response,
      ),
      outcome,
    )
  }

  clearOtpauthCandidate(candidate: DecodedOtpauthCandidate): void {
    candidate.otpauthUri = ''
  }
}

export const pageQrCapture = new PageQrCapture(globalThis)
