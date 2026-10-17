import type {
  SignInAttemptAuthFields,
  SignInAttemptPageEvidence,
  SignInPageColor,
  SignInPageLink,
  SignInPageLinkIndex,
  SignInPageMessage,
  SignInPageMessagePlacement,
  SignInPageMessageSource,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  passwordFieldDiscovery,
  passwordFormInteraction,
  type PasswordFormObservation,
} from '../../../../nook-web-shared/src/extension/password-forms'
import { authenticationSurfaceObservation } from './authentication-surface-observation'
import { AUTHENTICATION_SUCCESS_MARKER_SELECTOR } from './authentication-outcome-observation'
import {
  AuthenticationControlLabels,
  type AuthenticationControlLabelRequest,
} from './authentication-control-labels'
import {
  SignInAttemptObservation,
  type SignInAttemptMessageChangeRequest,
  type SignInAttemptObservationContext,
  type SignInAttemptRouteRequest,
  type SignInAttemptSubmitCapture,
} from './sign-in-attempt-observation'
import { WIDGET_HOST_ID } from './workflow-ui'

enum AuthContainerKind {
  Absent = 'absent',
  Present = 'present',
}
type AuthContainer =
  | { readonly kind: AuthContainerKind.Absent }
  | {
      readonly kind: AuthContainerKind.Present
      readonly container: Element
      readonly scope: Element
    }
type PresentAuthContainer = Extract<
  AuthContainer,
  { readonly kind: AuthContainerKind.Present }
>
type MessageCandidate = {
  readonly element: Element
  readonly source: SignInPageMessageSource
}
type MessageCandidates = MessageCandidate[]
type SignInAttemptPolicyHints = Parameters<
  typeof passwordFormInteraction.prepareCompanionWorkflowPolicies
>[0]
type AnchorCandidates = HTMLAnchorElement[]
type SensorElements = Element[]
type ElementAttribute = ReturnType<Element['getAttribute']>
type CollectedEvidence = {
  readonly container: AuthContainer
  readonly candidates: MessageCandidates
}
type PresentEvidence = {
  readonly container: PresentAuthContainer
  readonly candidates: MessageCandidates
}
type MessageProjection = {
  readonly candidate: MessageCandidate
  readonly container: Element
  readonly context: SignInAttemptObservationContext
}
type MessageEvidenceRequest = {
  readonly evidence: CollectedEvidence
  readonly context: SignInAttemptObservationContext
}
type PresentMessageEvidenceRequest = {
  readonly evidence: PresentEvidence
  readonly context: SignInAttemptObservationContext
}
type LinkProjection = {
  readonly element: HTMLAnchorElement
  readonly index: SignInPageLinkIndex
}
type ColorProjection = {
  readonly element: Element
  readonly property: ColorProperty
}
enum ColorProperty {
  Foreground = 'color',
  Background = 'background-color',
}
enum ElementPresence {
  Rendered = 'rendered',
  Hidden = 'hidden',
}
enum ElementDisplay {
  Inline = 'inline',
  Block = 'block',
}
enum ParsedColorKind {
  Opaque = 'opaque',
  Transparent = 'transparent',
  Unreadable = 'unreadable',
}
enum PainterKind {
  Unprepared = 'unprepared',
  Ready = 'ready',
  Unavailable = 'unavailable',
}
type Painter =
  | { readonly kind: PainterKind.Unprepared }
  | {
      readonly kind: PainterKind.Ready
      readonly context: CanvasRenderingContext2D
    }
  | { readonly kind: PainterKind.Unavailable }
type ParsedColor =
  | { readonly kind: ParsedColorKind.Opaque; readonly color: SignInPageColor }
  | { readonly kind: ParsedColorKind.Transparent }
  | { readonly kind: ParsedColorKind.Unreadable }

export enum SignInAttemptLinkTargetKind {
  Available = 'available',
  Unavailable = 'unavailable',
}
/** A link revalidated at click time: connected, visible and still at its handle. */
export type SignInAttemptLinkTarget =
  | {
      readonly kind: SignInAttemptLinkTargetKind.Available
      readonly link: SignInPageLink
      readonly element: HTMLAnchorElement
    }
  | { readonly kind: SignInAttemptLinkTargetKind.Unavailable }
type AvailableLinkTarget = Extract<
  SignInAttemptLinkTarget,
  { readonly kind: SignInAttemptLinkTargetKind.Available }
>

/**
 * Sensor only: collects raw, bounded, non-secret structural facts of the
 * visible page around the authentication form. Whether a message is an error,
 * its reason, and whether a link resets a password are Rust decisions.
 * Input values are never read.
 */
export class SignInAttemptEvidenceSensor {
  static readonly MAX_MESSAGES = 6
  static readonly MAX_LINKS = 8
  static readonly MAX_MESSAGE_TEXT = 300
  /** Raw text (markup whitespace included) a message subtree may hold before it is skipped. */
  static readonly MAX_READ_TEXT = 1200
  static readonly MIN_CONTAINER_TEXT = 8
  static readonly MAX_LINK_TEXT = 80
  static readonly MAX_LINK_HREF = 300
  static readonly MAX_TOKENS = 12
  static readonly MAX_TOKEN_LENGTH = 48
  static readonly TOKEN_ANCESTOR_LEVELS = 2
  static readonly NEAR_ANCESTOR_LEVELS = 3
  static readonly FIELD_ANCESTOR_LEVELS = 6
  static readonly MAX_SCANNED_ELEMENTS = 800
  static readonly ALERT_SELECTOR =
    '[role="alert"], [role="status"], [aria-live="polite"], [aria-live="assertive"]'
  static readonly CONTROL_SELECTOR =
    'input, select, textarea, button, label, [contenteditable="true"]'
  static readonly SKIPPED_SELECTOR =
    'script, style, template, noscript, svg, canvas, iframe, object, embed'
  static readonly AUTH_FIELD_SELECTOR =
    'input[type="password"], input[autocomplete~="username"], input[autocomplete="one-time-code"], input[type="email"]'
  static readonly SUCCESS_MARKER_SELECTOR =
    AUTHENTICATION_SUCCESS_MARKER_SELECTOR
  static readonly ERROR_MARKER_SELECTOR = '[data-nook-auth-outcome="error"]'
  static readonly PAINT_SETTINGS: CanvasRenderingContext2DSettings = {
    willReadFrequently: true,
  }
  static readonly UNPAINTED = 'rgba(0, 0, 0, 0)'
  private painter: Painter = { kind: PainterKind.Unprepared }
  /** CSS initial canvas colors, observed when no ancestor paints a color. */
  static readonly CANVAS: SignInPageColor = { red: 255, green: 255, blue: 255 }

  constructor(private readonly browser: typeof globalThis) {}

  /**
   * Facts collected synchronously right before submission (Rust keeps only
   * their presence), plus the in-memory snapshot this document compares its
   * later same-document observations against.
   */
  capture(): SignInAttemptSubmitCapture {
    const evidence = this.collect()
    const messages = new WeakMap<Element, string>()
    for (const candidate of evidence.candidates) {
      messages.set(candidate.element, this.visibleText(candidate.element))
    }
    const request: MessageEvidenceRequest = {
      evidence,
      context: SignInAttemptObservation.NEW_DOCUMENT,
    }
    return {
      baseline: {
        messages: this.projectMessages(request),
        auth_fields: this.authFields(),
        controls: this.controls(),
      },
      snapshot: { pathname: this.browser.location.pathname, messages },
    }
  }

  /** The fill path's hints for the Rust policy batch prepared before a submit. */
  static readonly POLICY_HINTS: SignInAttemptPolicyHints = {
    authenticatorSetupHint: 'absent',
    backupCodesHint: false,
  }

  /** Refreshes the existing field classification, then collects the page facts. */
  async observe(
    context: SignInAttemptObservationContext,
  ): Promise<SignInAttemptPageEvidence> {
    await passwordFieldDiscovery.prepareCompanionClassification(
      this.browser.document,
    )
    // Form admissibility is cached per Rust policy batch; a batch prepared for
    // an earlier DOM would hide the re-rendered form's fields, so refresh it
    // for this DOM exactly as the fill path does before its submit.
    await passwordFormInteraction.prepareCompanionWorkflowPolicies(
      SignInAttemptEvidenceSensor.POLICY_HINTS,
    )
    return this.page(context)
  }

  page(context: SignInAttemptObservationContext): SignInAttemptPageEvidence {
    const evidence = this.collect()
    const route: SignInAttemptRouteRequest = {
      context,
      pathname: this.browser.location.pathname,
    }
    const messages: MessageEvidenceRequest = { evidence, context }
    return {
      document: SignInAttemptObservation.relation(route),
      auth_fields: this.authFields(),
      manual_checkpoint_present: passwordFieldDiscovery.pageHasManualCheckpoint(
        this.browser.document,
      ),
      success_marker_present: this.markerPresent(
        SignInAttemptEvidenceSensor.SUCCESS_MARKER_SELECTOR,
      ),
      error_marker_present: this.markerPresent(
        SignInAttemptEvidenceSensor.ERROR_MARKER_SELECTOR,
      ),
      controls: this.controls(),
      messages: this.projectMessages(messages),
      links: this.links(evidence),
    }
  }

  /** Raw labels through the shared login-save collector; Rust classifies them. */
  private controls(): string[] {
    const request: AuthenticationControlLabelRequest = {
      root: this.browser.document,
      rendered: (control) =>
        this.presence(control) === ElementPresence.Rendered,
    }
    return AuthenticationControlLabels.collect(request)
  }

  /** Re-collects links in document order and revalidates the requested handle. */
  link(index: SignInPageLinkIndex): SignInAttemptLinkTarget {
    const element = this.anchors(this.collect()).at(index)
    switch (true) {
      case element instanceof this.browser.HTMLAnchorElement &&
        element.isConnected &&
        this.presence(element) === ElementPresence.Rendered: {
        const projection: LinkProjection = { element, index }
        return {
          kind: SignInAttemptLinkTargetKind.Available,
          link: this.projectLink(projection),
          element,
        }
      }
      case true:
        break
    }
    return { kind: SignInAttemptLinkTargetKind.Unavailable }
  }

  /**
   * The very element chosen earlier, still connected, visible, at the same
   * handle, and with the same text and href Rust revalidated.
   */
  confirm(target: AvailableLinkTarget): boolean {
    const fresh = this.link(target.link.index)
    switch (fresh.kind) {
      case SignInAttemptLinkTargetKind.Unavailable:
        return false
      case SignInAttemptLinkTargetKind.Available:
        return (
          fresh.element === target.element &&
          fresh.link.text === target.link.text &&
          fresh.link.href === target.link.href
        )
    }
  }

  private collect(): CollectedEvidence {
    const container = this.authContainer()
    switch (container.kind) {
      case AuthContainerKind.Absent:
        return { container, candidates: [] }
      case AuthContainerKind.Present:
        return { container, candidates: this.messageCandidates(container) }
    }
  }

  private markerPresent(selector: string): boolean {
    return Array.from(this.browser.document.querySelectorAll(selector)).some(
      (element) => this.presence(element) === ElementPresence.Rendered,
    )
  }

  private authFields(): SignInAttemptAuthFields {
    const forms = passwordFormInteraction.summarizeAuthenticationWorkflowForms()
    return {
      username_present: forms.some(
        (form) => form.summary.usernameFieldCount > 0,
      ),
      current_password_present: forms.some(
        (form) =>
          form.summary.currentPasswordFieldCount +
            form.summary.genericPasswordFieldCount >
          0,
      ),
      one_time_code_present: forms.some(
        (form) => form.summary.oneTimeCodeFieldCount > 0,
      ),
    }
  }

  private authContainer(): AuthContainer {
    const form = passwordFormInteraction
      .summarizeAuthenticationWorkflowForms()
      .find(
        (candidate) =>
          candidate.summary.passwordFieldCount +
            candidate.summary.usernameFieldCount +
            candidate.summary.oneTimeCodeFieldCount >
          0,
      )
    switch (true) {
      case form instanceof Object: {
        const container = this.containerElement(form)
        return {
          kind: AuthContainerKind.Present,
          container,
          scope: this.nearScope(container),
        }
      }
      case true:
        break
    }
    return { kind: AuthContainerKind.Absent }
  }

  private containerElement(form: PasswordFormObservation): Element {
    const boundary =
      authenticationSurfaceObservation.authenticationWorkflowBoundary(form)
    const document = this.browser.document
    switch (true) {
      case boundary instanceof this.browser.Element &&
        boundary !== document.body &&
        boundary !== document.documentElement:
        return boundary
      case true:
        break
    }
    return this.commonFieldAncestor()
  }

  /** Nearest ancestor holding every visible authentication field (bounded climb). */
  private commonFieldAncestor(): Element {
    const document = this.browser.document
    const fields = Array.from(
      document.querySelectorAll(
        SignInAttemptEvidenceSensor.AUTH_FIELD_SELECTOR,
      ),
    ).filter((field) => this.presence(field) === ElementPresence.Rendered)
    const holder = fields
      .slice(0, 1)
      .flatMap((first) =>
        this.ancestors(first).slice(
          1,
          SignInAttemptEvidenceSensor.FIELD_ANCESTOR_LEVELS + 1,
        ),
      )
      .filter((ancestor) => ancestor !== document.documentElement)
      .find((ancestor) => fields.every((field) => ancestor.contains(field)))
    switch (true) {
      case holder instanceof this.browser.Element:
        return holder
      case true:
        break
    }
    return document.body
  }

  /** The container's ancestor up to three levels, bounded below the root element. */
  private nearScope(container: Element): Element {
    const scope = this.ancestors(container)
      .slice(0, SignInAttemptEvidenceSensor.NEAR_ANCESTOR_LEVELS + 1)
      .filter((ancestor) => ancestor !== this.browser.document.documentElement)
      .at(-1)
    switch (true) {
      case scope instanceof this.browser.Element:
        return scope
      case true:
        break
    }
    return container
  }

  /** The element followed by its ancestors, nearest first. */
  private ancestors(element: Element): SensorElements {
    const parent = element.parentElement
    switch (true) {
      case parent instanceof this.browser.Element:
        return [element, ...this.ancestors(parent)]
      case true:
        break
    }
    return [element]
  }

  private messageCandidates(
    container: PresentAuthContainer,
  ): MessageCandidates {
    const ordered = [
      ...this.alertCandidates(container),
      ...this.fieldReferenceCandidates(container),
      ...this.containerCandidates(container),
    ]
    const selected: MessageCandidates = []
    for (const candidate of ordered) {
      const overlapping = selected.some(
        (chosen) =>
          chosen.element.contains(candidate.element) ||
          candidate.element.contains(chosen.element),
      )
      switch (
        overlapping ||
        selected.length >= SignInAttemptEvidenceSensor.MAX_MESSAGES
      ) {
        case true:
          continue
        case false:
          selected.push(candidate)
      }
    }
    return selected
  }

  private alertCandidates(container: PresentAuthContainer): MessageCandidates {
    return Array.from(
      container.scope.querySelectorAll(
        SignInAttemptEvidenceSensor.ALERT_SELECTOR,
      ),
    )
      .filter((element) => this.textBearing(element))
      .map((element) => {
        const candidate: MessageCandidate = {
          element,
          source: this.alertSource(element),
        }
        return candidate
      })
  }

  private alertSource(element: Element): SignInPageMessageSource {
    const role = this.attributeText(element.getAttribute('role'))
    switch (role === 'alert' || role === 'status') {
      case true:
        return 'Alert'
      case false:
        return 'LiveRegion'
    }
  }

  private fieldReferenceCandidates(
    container: PresentAuthContainer,
  ): MessageCandidates {
    const references = Array.from(
      container.container.querySelectorAll(
        'input[aria-errormessage], input[aria-describedby]',
      ),
    )
      .filter((input) => this.presence(input) === ElementPresence.Rendered)
      .flatMap((input) => [
        ...this.idReferences(input.getAttribute('aria-errormessage')),
        ...this.idReferences(input.getAttribute('aria-describedby')),
      ])
    return [...new Set(references)]
      .flatMap((id) => this.referencedElement(id))
      .filter((element) => this.textBearing(element))
      .map((element) => {
        const candidate: MessageCandidate = {
          element,
          source: 'FieldReference',
        }
        return candidate
      })
  }

  private idReferences(attribute: ElementAttribute): string[] {
    return this.attributeText(attribute)
      .split(/\s+/)
      .filter((id) => id.length > 0)
  }

  private attributeText(attribute: ElementAttribute): string {
    switch (true) {
      case typeof attribute === 'string':
        return attribute
      case true:
        break
    }
    return ''
  }

  private referencedElement(id: string): SensorElements {
    const element = this.browser.document.getElementById(id)
    switch (true) {
      case element instanceof this.browser.Element:
        return [element]
      case true:
        break
    }
    return []
  }

  /** Plain visible text blocks inside/near the form (the styled-banner path). */
  private containerCandidates(
    container: PresentAuthContainer,
  ): MessageCandidates {
    const walker = this.browser.document.createTreeWalker(
      container.scope,
      this.browser.NodeFilter.SHOW_ELEMENT,
    )
    const elements: SensorElements = []
    for (
      let node = walker.nextNode();
      node instanceof this.browser.Element &&
      elements.length < SignInAttemptEvidenceSensor.MAX_SCANNED_ELEMENTS;
      node = walker.nextNode()
    ) {
      elements.push(node)
    }
    return elements
      .filter((element) => this.plainTextBlock(element))
      .map((element) => {
        const candidate: MessageCandidate = { element, source: 'Container' }
        return candidate
      })
  }

  /** A visible leaf block with bounded text and no form controls (cheap checks first). */
  private plainTextBlock(element: Element): boolean {
    return (
      this.controlFree(element) &&
      this.display(element) === ElementDisplay.Block &&
      !Array.from(element.children).some((child) => this.textBlock(child)) &&
      this.containerTextLength(element) &&
      this.presence(element) === ElementPresence.Rendered
    )
  }

  private containerTextLength(element: Element): boolean {
    const length = this.visibleText(element).length
    return (
      length >= SignInAttemptEvidenceSensor.MIN_CONTAINER_TEXT &&
      length <= SignInAttemptEvidenceSensor.MAX_MESSAGE_TEXT
    )
  }

  private textBlock(element: Element): boolean {
    return (
      !element.matches(SignInAttemptEvidenceSensor.SKIPPED_SELECTOR) &&
      this.display(element) === ElementDisplay.Block &&
      this.visibleText(element).length > 0
    )
  }

  private display(element: Element): ElementDisplay {
    switch (this.browser.getComputedStyle(element).display) {
      case '':
      case 'inline':
      case 'contents':
        return ElementDisplay.Inline
    }
    return ElementDisplay.Block
  }

  /** Alert, live-region and field-reference candidates: no controls, visible, bounded text. */
  private textBearing(element: Element): boolean {
    return (
      this.controlFree(element) &&
      this.presence(element) === ElementPresence.Rendered &&
      this.visibleText(element).length > 0
    )
  }

  /** Contract §5: a message never is or contains an input, button or label. */
  private controlFree(element: Element): boolean {
    return (
      element.id !== WIDGET_HOST_ID &&
      !element.matches(SignInAttemptEvidenceSensor.SKIPPED_SELECTOR) &&
      !element.matches(SignInAttemptEvidenceSensor.CONTROL_SELECTOR) &&
      !element.querySelector(SignInAttemptEvidenceSensor.CONTROL_SELECTOR)
    )
  }

  /**
   * Visible text of a bounded subtree. A subtree whose raw text exceeds the
   * read bound is not a message and is never rendered to text.
   */
  private visibleText(element: Element): string {
    switch (this.withinReadBound(element)) {
      case false:
        return ''
      case true:
        break
    }
    switch (true) {
      case element instanceof this.browser.HTMLElement:
        return this.normalize(element.innerText)
      case true:
        break
    }
    return this.normalize(String(element.textContent))
  }

  /** Walks text nodes only until the bound is passed; never reads the whole subtree. */
  private withinReadBound(element: Element): boolean {
    const walker = this.browser.document.createTreeWalker(
      element,
      this.browser.NodeFilter.SHOW_TEXT,
    )
    let length = 0
    for (
      let node = walker.nextNode();
      node instanceof this.browser.Node &&
      length <= SignInAttemptEvidenceSensor.MAX_READ_TEXT;
      node = walker.nextNode()
    ) {
      length += String(node.nodeValue).length
    }
    return length <= SignInAttemptEvidenceSensor.MAX_READ_TEXT
  }

  private normalize(text: string): string {
    return text.replace(/\s+/g, ' ').trim()
  }

  private presence(element: Element): ElementPresence {
    const hidden = this.ancestors(element).some((current) => {
      const style = this.browser.getComputedStyle(current)
      return (
        current.hasAttribute('hidden') ||
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        style.opacity === '0'
      )
    })
    switch (hidden || element.getAttribute('aria-hidden') === 'true') {
      case true:
        return ElementPresence.Hidden
      case false:
        return ElementPresence.Rendered
    }
  }

  private projectMessages(
    request: MessageEvidenceRequest,
  ): SignInPageMessage[] {
    const evidence = request.evidence
    switch (evidence.container.kind) {
      case AuthContainerKind.Absent:
        return []
      case AuthContainerKind.Present: {
        const present: PresentMessageEvidenceRequest = {
          evidence: {
            container: evidence.container,
            candidates: evidence.candidates,
          },
          context: request.context,
        }
        return this.projectPresentMessages(present)
      }
    }
  }

  private projectPresentMessages(
    request: PresentMessageEvidenceRequest,
  ): SignInPageMessage[] {
    return request.evidence.candidates.flatMap((candidate) => {
      const projection: MessageProjection = {
        candidate,
        container: request.evidence.container.container,
        context: request.context,
      }
      return this.projectMessage(projection)
    })
  }

  /** Text whose own color cannot be read is not offered as evidence. */
  private projectMessage(projection: MessageProjection): SignInPageMessage[] {
    const { element, source } = projection.candidate
    const foregroundRequest: ColorProjection = {
      element,
      property: ColorProperty.Foreground,
    }
    const foreground = this.color(foregroundRequest)
    switch (foreground.kind) {
      case ParsedColorKind.Transparent:
      case ParsedColorKind.Unreadable:
        return []
      case ParsedColorKind.Opaque:
        break
    }
    const visible = this.visibleText(element)
    const change: SignInAttemptMessageChangeRequest = {
      context: projection.context,
      element,
      text: visible,
    }
    const message: SignInPageMessage = {
      text: visible.slice(0, SignInAttemptEvidenceSensor.MAX_MESSAGE_TEXT),
      source,
      placement: this.placement(projection),
      tokens: this.tokens([element]),
      ancestor_tokens: this.tokens(
        this.ancestors(element).slice(
          1,
          SignInAttemptEvidenceSensor.TOKEN_ANCESTOR_LEVELS + 1,
        ),
      ),
      foreground: foreground.color,
      background: this.background(element),
      changed_since_submit: SignInAttemptObservation.changed(change),
    }
    return [message]
  }

  private placement(projection: MessageProjection): SignInPageMessagePlacement {
    switch (projection.container.contains(projection.candidate.element)) {
      case true:
        return 'InsideAuthForm'
      case false:
        return 'NearAuthForm'
    }
  }

  /** Lowercase class and id tokens of the given elements, bounded. */
  private tokens(elements: SensorElements): string[] {
    const tokens = elements
      .flatMap((current) => [...Array.from(current.classList), current.id])
      .map((token) => token.trim().toLowerCase())
      .filter((token) => token.length > 0)
      .map((token) =>
        token.slice(0, SignInAttemptEvidenceSensor.MAX_TOKEN_LENGTH),
      )
    return [...new Set(tokens)].slice(0, SignInAttemptEvidenceSensor.MAX_TOKENS)
  }

  /** First painted background from the message outward. */
  private background(element: Element): SignInPageColor {
    for (const current of this.ancestors(element)) {
      const request: ColorProjection = {
        element: current,
        property: ColorProperty.Background,
      }
      const parsed = this.color(request)
      switch (parsed.kind) {
        case ParsedColorKind.Opaque:
          return parsed.color
        case ParsedColorKind.Transparent:
        case ParsedColorKind.Unreadable:
          break
      }
    }
    return SignInAttemptEvidenceSensor.CANVAS
  }

  private color(projection: ColorProjection): ParsedColor {
    const value = this.browser
      .getComputedStyle(projection.element)
      .getPropertyValue(projection.property)
      .trim()
      .toLowerCase()
    const functional = value.match(
      /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/,
    )
    const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/)
    switch (true) {
      case value === 'transparent':
        return { kind: ParsedColorKind.Transparent }
      case functional instanceof Array:
        return this.functionalColor(functional)
      case hex instanceof Array:
        return this.hexColor(String(hex.at(1)))
      case true:
        break
    }
    return this.paintedColor(value)
  }

  /**
   * Modern color syntaxes (oklch, lab, color(), color-mix) are normalized to
   * sRGB by the browser itself: paint one pixel and read it back.
   */
  private paintedColor(value: string): ParsedColor {
    const context = this.paintContext()
    switch (context) {
      case false:
        return { kind: ParsedColorKind.Unreadable }
      default:
        break
    }
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = SignInAttemptEvidenceSensor.UNPAINTED
    context.fillStyle = value
    context.fillRect(0, 0, 1, 1)
    const pixel = context.getImageData(0, 0, 1, 1).data
    switch (pixel[3] === 0) {
      case true:
        return { kind: ParsedColorKind.Transparent }
      case false:
        return {
          kind: ParsedColorKind.Opaque,
          color: {
            red: Number(pixel[0]),
            green: Number(pixel[1]),
            blue: Number(pixel[2]),
          },
        }
    }
  }

  private paintContext(): CanvasRenderingContext2D | false {
    switch (this.painter.kind) {
      case PainterKind.Ready:
        return this.painter.context
      case PainterKind.Unavailable:
        return false
      case PainterKind.Unprepared:
        break
    }
    const canvas = this.browser.document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext(
      '2d',
      SignInAttemptEvidenceSensor.PAINT_SETTINGS,
    )
    switch (true) {
      case context instanceof Object:
        this.painter = { kind: PainterKind.Ready, context }
        return context
      case true:
        break
    }
    this.painter = { kind: PainterKind.Unavailable }
    return false
  }

  private functionalColor(channels: RegExpMatchArray): ParsedColor {
    switch (parseFloat(String(channels.at(4))) === 0) {
      case true:
        return { kind: ParsedColorKind.Transparent }
      case false:
        return {
          kind: ParsedColorKind.Opaque,
          color: {
            red: this.channel(String(channels.at(1))),
            green: this.channel(String(channels.at(2))),
            blue: this.channel(String(channels.at(3))),
          },
        }
    }
  }

  private hexColor(hex: string): ParsedColor {
    const full = Array.from(hex)
      .flatMap((digit) => Array<string>(6 / hex.length).fill(digit))
      .join('')
    return {
      kind: ParsedColorKind.Opaque,
      color: {
        red: parseInt(full.slice(0, 2), 16),
        green: parseInt(full.slice(2, 4), 16),
        blue: parseInt(full.slice(4, 6), 16),
      },
    }
  }

  private channel(value: string): number {
    return Math.max(0, Math.min(255, Math.round(parseFloat(value))))
  }

  /** Links inside captured messages first, then inside and near the form. */
  private anchors(evidence: CollectedEvidence): AnchorCandidates {
    switch (evidence.container.kind) {
      case AuthContainerKind.Absent:
        return []
      case AuthContainerKind.Present:
        break
    }
    const ordered = [
      ...evidence.candidates.flatMap((candidate) =>
        Array.from(candidate.element.querySelectorAll('a[href]')),
      ),
      ...Array.from(evidence.container.container.querySelectorAll('a[href]')),
      ...Array.from(evidence.container.scope.querySelectorAll('a[href]')),
    ]
    const anchors: AnchorCandidates = []
    for (const element of ordered) {
      switch (true) {
        case element instanceof this.browser.HTMLAnchorElement &&
          !anchors.includes(element) &&
          anchors.length < SignInAttemptEvidenceSensor.MAX_LINKS &&
          this.presence(element) === ElementPresence.Rendered &&
          this.href(element).length > 0:
          anchors.push(element)
          break
        case true:
          break
      }
    }
    return anchors
  }

  /** Absolute http(s) URL without query or fragment; empty when out of bounds. */
  private href(element: HTMLAnchorElement): string {
    const url = URL.parse(element.href)
    switch (true) {
      case url instanceof URL &&
        (url.protocol === 'https:' || url.protocol === 'http:'):
        return this.boundedHref(`${url.origin}${url.pathname}`)
      case true:
        break
    }
    return ''
  }

  private boundedHref(href: string): string {
    switch (href.length <= SignInAttemptEvidenceSensor.MAX_LINK_HREF) {
      case true:
        return href
      case false:
        return ''
    }
  }

  /** Each link's handle is its position in document-order collection. */
  private links(evidence: CollectedEvidence): SignInPageLink[] {
    const anchors = this.anchors(evidence)
    return anchors.map((element) => {
      const projection: LinkProjection = {
        element,
        index: anchors.indexOf(element),
      }
      return this.projectLink(projection)
    })
  }

  private projectLink(projection: LinkProjection): SignInPageLink {
    return {
      index: projection.index,
      text: this.linkText(projection.element).slice(
        0,
        SignInAttemptEvidenceSensor.MAX_LINK_TEXT,
      ),
      href: this.href(projection.element),
    }
  }

  /** Visible text, or the accessible name of an icon-only link. */
  private linkText(element: HTMLAnchorElement): string {
    const visible = this.visibleText(element)
    switch (visible.length > 0) {
      case true:
        return visible
      case false:
        return this.normalize(
          this.attributeText(element.getAttribute('aria-label')),
        )
    }
  }
}

export const signInAttemptEvidenceSensor = new SignInAttemptEvidenceSensor(
  globalThis,
)
