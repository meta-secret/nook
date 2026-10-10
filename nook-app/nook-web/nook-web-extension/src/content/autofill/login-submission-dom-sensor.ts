import { semanticSubmitControlSelector } from '../../../../nook-web-shared/src/extension/authentication-control-selectors'
import { authenticationSubmissionControls, AuthenticationSubmissionDestination } from '../../../../nook-web-shared/src/extension/password-form-submission-controls'
import { AuthenticationInputSurface } from '../../../../nook-web-shared/src/extension/authentication-input-surface'
import {
  passwordFieldDiscovery,
  passwordFormCredentialInteraction,
  PasswordFormQueryKind,
  PasswordFormScopeKind,
  LoginCredentialsLookupKind,
  type LoginCredentials,
} from '../../../../nook-web-shared/src/extension/password-forms'
import type {
  CompanionWasmPageInputFieldObservation,
} from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import {
  type LoginPasswordFieldHistory,
  type LoginSubmissionIntent,
  type LoginSubmissionCapture,
  type AuthenticationPageObservationFacts,
  type AuthenticationDetailedAdvanceControlObservation,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export enum LoginSubmissionDomObservationKind {
  Ignored = 'ignored',
  Observed = 'observed',
}

type LoginSubmissionDomRoot = HTMLFormElement | HTMLElement
type LoginSubmissionInput = {
  readonly field: HTMLInputElement
  readonly observation: CompanionWasmPageInputFieldObservation
  readonly passwordHistory: LoginPasswordFieldHistory
  value: string
}
type LoginSubmissionInputs = LoginSubmissionInput[]

export type LoginSubmissionDomObservation =
  | { readonly kind: LoginSubmissionDomObservationKind.Ignored }
  | {
      readonly kind: LoginSubmissionDomObservationKind.Observed
      readonly snapshot: LoginSubmissionDomSnapshot
    }

type LoginSubmissionSnapshotRequest = {
  readonly event: Event
  readonly root: LoginSubmissionDomRoot
  readonly inputs: LoginSubmissionInputs
}

export type LoginSubmissionCredentialIndices = {
  readonly usernameIndex: number
  readonly passwordIndex: number
}

/** Owns plaintext only during the immediate captured submission operation. */
export class LoginSubmissionDomSnapshot extends AuthenticationInputSurface {
  sawMutation = false
  private readonly observer = new MutationObserver(() => { this.sawMutation = true })
  readonly startedAt = Date.now()
  readonly submittedUrl = location.href
  readonly controls = this.controlLabels(document)
  private readonly capturedIntent: LoginSubmissionIntent
  readonly event: Event
  readonly root: LoginSubmissionDomRoot
  readonly explicitCredentials: ReturnType<typeof passwordFormCredentialInteraction.readLoginCredentials>
  private readonly inputs: LoginSubmissionInputs

  constructor({ event, root, inputs }: LoginSubmissionSnapshotRequest) {
    super(globalThis)
    this.event = event
    this.root = root
    this.inputs = inputs
    const observerOptions: MutationObserverInit = {childList: true, subtree: true, attributes: true}
    this.observer.observe(document.documentElement, observerOptions)
    switch (true) {
      case root instanceof HTMLFormElement: {
        const request: Parameters<typeof passwordFormCredentialInteraction.readLoginCredentials>[0] = { kind: PasswordFormQueryKind.Scoped, root, formScope: { kind: PasswordFormScopeKind.Owned, owner: root } }
        this.explicitCredentials = passwordFormCredentialInteraction.readLoginCredentials(request)
        break
      }
      case true: default: this.explicitCredentials = {kind: LoginCredentialsLookupKind.Absent}; break
    }
    this.capturedIntent = this.readIntent()
  }

  captureRecord(): LoginSubmissionCapture {
    let explicitCandidate: LoginSubmissionCapture['explicit_candidate'] = 'Absent'
    switch (this.explicitCredentials.kind) {
      case LoginCredentialsLookupKind.Found: explicitCandidate = 'Present'; break
      case LoginCredentialsLookupKind.Absent: break
    }
    return {
      intent: this.capturedIntent,
      fields: this.inputs.map(({observation, passwordHistory}) => ({
        input_type: observation.inputType, disabled: observation.disabled, read_only: observation.readOnly,
        autocomplete_tokens: [...observation.autocompleteTokens], identity_text: observation.identityText,
        login_context: observation.loginContext, password_history: passwordHistory,
      })),
      submitted_at: this.startedAt, submitted_url: this.submittedUrl, controls: [...this.controls], explicit_candidate: explicitCandidate,
    }
  }

  capturedValues(): string[] {return this.inputs.map((input) => input.value)}

  intent(): LoginSubmissionIntent { return this.capturedIntent }

  mutationOccurred(): boolean {
    this.sawMutation ||= this.observer.takeRecords().length > 0
    return this.sawMutation
  }

  private readIntent(): LoginSubmissionIntent {
    let event: LoginSubmissionIntent['event']
    switch (this.event.type) {
      case 'submit': event = 'FormSubmit'; break
      case 'click': event = 'Click'; break
      case 'keydown': event = 'Enter'; break
      default: event = 'Other'; break
    }
    let trust: LoginSubmissionIntent['trust']
    switch (this.event.isTrusted) {
      case true: trust = 'Trusted'; break
      case false: trust = 'Untrusted'; break
    }
    return { event, trust, target: this.submissionTarget(), control_label: this.controlLabel(), context: this.context() }
  }

  private submissionTarget(): LoginSubmissionIntent['target'] {
    switch (this.event.type) {
      case 'keydown': {
        const index = this.inputs.findIndex((input) => input.field === this.event.target)
        switch (index >= 0) {
          case true: return {kind: 'CredentialField', field_index: {value: index}}
          case false: return {kind: 'OutsideCredentialScope'}
        }
        break
      }
      default: return {kind: 'CredentialScope'}
    }
  }

  private controlLabel(): string {
    const event = this.event
    switch (true) {
      case 'submitter' in event && event.submitter instanceof Element: return this.label(event.submitter)
      case true: default: break
    }
    const target = event.target
    switch (true) {
      case target instanceof Element: {
        const control = target.closest('button, [role="button"], input[type="submit"], input[type="button"], input[type="image"]')
        switch (true) { case control instanceof Element: return this.label(control); case true: default: return '' }
        break
      }
      case true: default: return ''
    }
  }

  private label(control: Element): string {
    switch (true) {
      case control instanceof HTMLElement: return authenticationSubmissionControls.controlLabel(control).slice(0, 256)
      case true: default: return ''
    }
  }

  private context(): AuthenticationPageObservationFacts {
    const root = this.root
    const headings = Array.from(root.querySelectorAll('h1,h2,legend,[role="heading"]')).slice(0, 8)
      .map((heading) => heading.textContent).join(' ')
    let manualCheckpoint: AuthenticationPageObservationFacts['ceremony']['manualCheckpoint']
    switch (passwordFieldDiscovery.pageHasManualCheckpoint(root)) {
      case true: manualCheckpoint = 'present'; break
      case false: manualCheckpoint = 'absent'; break
    }
    return {
      // Rust derives these counts from the exact same submission input metadata.
      fields: { usernameFieldCount: 0, currentPasswordFieldCount: 0, newPasswordFieldCount: 0, genericPasswordFieldCount: 0, oneTimeCodeFieldCount: 0, actionablePasswordFieldCount: 0, readonlyPasswordFieldCount: 0 },
      ceremony: {
        oneTimeCodeProgression: 'advance-control-required', oneTimeCodeHandlerSignal: '',
        authenticationContext: { authenticationUsername: 'absent', sourceOrigin: location.origin, formIdentity: [root.id, root.className, headings].join(' ').slice(0, 256), destinationIdentity: location.pathname },
        manualCheckpoint, advanceControl: 'absent',
      },
      authenticator: { authenticatorSetup: 'absent', backupCodesCopy: '', passkeyControl: 'absent', passkeyAccountAvailability: 'unavailable', matchingPasskeyAccountCount: 0, detailedPasskeyControl: { kind: 'absent' } },
      credentialSubmission: { kind: 'absent' }, detailedAdvanceControl: this.advanceControl(),
    }
  }

  private advanceControl(): AuthenticationDetailedAdvanceControlObservation {
    const target = this.event.target
    let selected: HTMLElement
    switch (true) {
      case target instanceof Element: {
        const control = target.closest('button, [role="button"], input[type="submit"], input[type="button"], input[type="image"]')
        switch (true) { case control instanceof HTMLElement: selected = control; break; case true: default: return {kind: 'absent'} }
        break
      }
      case true: default: return {kind: 'absent'}
    }
    let formScope: Parameters<typeof authenticationSubmissionControls.controlDestinationIdentity>[0]['formScope'] = {kind: PasswordFormScopeKind.Unowned}
    let ownership: Extract<AuthenticationPageObservationFacts['detailedAdvanceControl'], {kind: `${LoginSubmissionDomObservationKind.Observed}`}>['observations'][number]['ownership'] = 'locally-scoped'
    const root = this.root
    switch (true) {
      case root instanceof HTMLFormElement: formScope = {kind: PasswordFormScopeKind.Owned, owner: root}; ownership = 'owned-form'; break
      case true: default: break
    }
    let actionability: Extract<AuthenticationPageObservationFacts['detailedAdvanceControl'], {kind: `${LoginSubmissionDomObservationKind.Observed}`}>['observations'][number]['actionability'] = 'actionable'
    switch (authenticationSubmissionControls.controlIsInert(selected)) {case true: actionability = 'inert'; break; case false: break}
    let semantics: Extract<AuthenticationPageObservationFacts['detailedAdvanceControl'], {kind: `${LoginSubmissionDomObservationKind.Observed}`}>['observations'][number]['semantics'] = 'activation'
    switch (selected.matches(semanticSubmitControlSelector)) {case true: semantics = 'semantic-submit'; break; case false: break}
    const destinationRequest: Parameters<typeof authenticationSubmissionControls.controlDestinationIdentity>[0] = {control: selected, formScope}
    const observation: Extract<AuthenticationPageObservationFacts['detailedAdvanceControl'], {kind: `${LoginSubmissionDomObservationKind.Observed}`}>['observations'][number] = {
      actionability, ownership, semantics, authenticationUsername: 'absent', passwordFieldCount: 0,
      newPasswordFieldCount: 0, oneTimeCodeFieldCount: 0,
      semanticSubmitControlCount: this.root.querySelectorAll(semanticSubmitControlSelector).length,
      sourceOrigin: location.origin, formIdentity: [this.root.id, this.root.className].join(' ').slice(0, 256),
      destinationIdentity: authenticationSubmissionControls.controlDestinationIdentity(destinationRequest),
      label: authenticationSubmissionControls.controlLabel(selected).slice(0, 256),
      machineIdentity: authenticationSubmissionControls.controlMachineIdentity(selected).slice(0, 256),
      submissionMethod: authenticationSubmissionControls.controlSubmissionMethod(selected),
      submissionDestinationSource: AuthenticationSubmissionDestination.source(selected),
    }
    return {kind: LoginSubmissionDomObservationKind.Observed, observations: [observation]}
  }

  credentials({ usernameIndex, passwordIndex }: LoginSubmissionCredentialIndices): LoginCredentials {
    const username = this.inputs[usernameIndex]
    const password = this.inputs[passwordIndex]
    switch (true) {
      case typeof username === 'object':
        break
      case true: default:
        throw new RangeError('submitted username field unavailable')
    }
    switch (true) {
      case typeof password === 'object':
        break
      case true: default:
        throw new RangeError('submitted password field unavailable')
    }
    return { username: username.value, password: password.value }
  }

  credentialNodes({ usernameIndex, passwordIndex }: LoginSubmissionCredentialIndices): HTMLInputElement[] {
    return [this.inputs[usernameIndex], this.inputs[passwordIndex]].flatMap((input) => {
      switch (true) { case typeof input === 'object': return [input.field]; case true: default: return [] }
    })
  }

  dispose(): void {
    this.observer.disconnect()
    for (const input of this.inputs) input.value = ''
    this.inputs.length = 0
    switch (this.explicitCredentials.kind) {
      case LoginCredentialsLookupKind.Found:
        this.explicitCredentials.credentials.username = ''
        this.explicitCredentials.credentials.password = ''
        break
      case LoginCredentialsLookupKind.Absent: break
    }
  }

  controlLabels(root: ParentNode): string[] {
    return Array.from(root.querySelectorAll<HTMLElement>('button, a[href], [role="button"], input[type="button"], input[type="submit"]'))
      .filter((control) => !control.closest('#nook-auth-widget') && this.isRenderedElement(control))
      .slice(0, 64)
      .map((control) => [control.textContent, control.getAttribute('aria-label'), control.getAttribute('title')]
        .join(' ').slice(0, 256))
  }
}

/** Reads native DOM associations before site event handlers replace fields. */
export class LoginSubmissionDomSensor extends AuthenticationInputSurface {
  private readonly passwordIdentities = new WeakMap<HTMLInputElement, string>()

  constructor() {
    super(globalThis)
  }

  rememberPasswordFields(): void {
    for (const field of document.querySelectorAll<HTMLInputElement>('input[type="password"]')) {
      this.passwordIdentities.set(field, this.fieldIdentity(field))
    }
  }

  rememberPasswordMutations(mutations: readonly MutationRecord[]): void {
    for (const mutation of mutations) this.rememberPasswordMutation(mutation)
    this.rememberPasswordFields()
  }

  private rememberPasswordMutation(mutation: MutationRecord): void {
    switch (mutation.type === 'attributes' && mutation.attributeName === 'type' && mutation.oldValue === 'password') {
      case false: return
      case true: break
    }
    switch (true) {
      case mutation.target instanceof HTMLInputElement: this.passwordIdentities.set(mutation.target, this.fieldIdentity(mutation.target)); break
      case true: default: break
    }
  }

  private fieldIdentity(field: HTMLInputElement): string {
    return [field.id, field.name, field.autocomplete].join(' ')
  }

  private passwordHistory(field: HTMLInputElement): LoginPasswordFieldHistory {
    switch (this.passwordIdentities.get(field) === this.fieldIdentity(field)) {
      case true: return 'PreviouslyPassword'
      case false: return 'Unobserved'
    }
  }
  observe(event: Event): LoginSubmissionDomObservation {
    switch (event.type) {
      case 'submit':
        switch (true) {
          case event.target instanceof HTMLFormElement: {
            const request: LoginSubmissionRootObservation = { event, root: event.target }
            return this.snapshot(request)
          }
          case true: default:
            return { kind: LoginSubmissionDomObservationKind.Ignored }
        }
        break
      case 'click':
        return this.observeControlClick(event)
      case 'keydown':
        return this.observeEnter(event)
      default:
        return { kind: LoginSubmissionDomObservationKind.Ignored }
    }
  }

  private observeControlClick(event: Event): LoginSubmissionDomObservation {
    const target = event.target
    switch (event.isTrusted && target instanceof Element) {
      case false:
        return { kind: LoginSubmissionDomObservationKind.Ignored }
      case true:
        break
    }
    switch (true) {
      case target instanceof Element: {
        const control = target.closest('button, [role="button"], input[type="submit"], input[type="button"], input[type="image"]')
        switch (true) {
          case control instanceof HTMLElement: {
            const request: LoginSubmissionControlObservation = {event, control}
            return this.observeControl(request)
          }
          case true: default: return {kind: LoginSubmissionDomObservationKind.Ignored}
        }
        break
      }
      case true: default:
        return { kind: LoginSubmissionDomObservationKind.Ignored }
    }
  }

  private observeEnter(event: Event): LoginSubmissionDomObservation {
    switch (true) {
      case event instanceof KeyboardEvent && event.isTrusted && event.key === 'Enter' && !event.repeat && !event.isComposing && event.target instanceof HTMLInputElement: {
        const request: LoginSubmissionControlObservation = { event, control: event.target }
        return this.observeControl(request)
      }
      case true: default:
        return { kind: LoginSubmissionDomObservationKind.Ignored }
    }
  }

  private observeControl({ event, control }: LoginSubmissionControlObservation): LoginSubmissionDomObservation {
    switch (control.closest('#nook-auth-widget') instanceof Element) {
      case true:
        return { kind: LoginSubmissionDomObservationKind.Ignored }
      case false:
        break
    }
    switch (true) {
      case control instanceof HTMLInputElement || control instanceof HTMLButtonElement:
        switch (true) {
          case control.form instanceof HTMLFormElement: {
            const request: LoginSubmissionRootObservation = { event, root: control.form }
            return this.snapshot(request)
          }
          case true: default:
            break
        }
        break
      case true: default:
        break
    }
    const owned = control.closest('form')
    switch (true) {
      case owned instanceof HTMLFormElement: {
        const request: LoginSubmissionRootObservation = { event, root: owned }
        return this.snapshot(request)
      }
      case true: default:
        break
    }
    let root = control.parentElement
    while (root && root !== document.body && root !== document.documentElement) {
      const inputs = this.unownedInputs(root)
      switch (inputs.length >= 2) {
        case true: {
          const request: LoginSubmissionRootObservation = { event, root }
          return this.snapshot(request)
        }
        case false: break
      }
      switch (root.matches('section, article, aside, nav, main, [role="form"]')) {
        case true: return {kind: LoginSubmissionDomObservationKind.Ignored}
        case false: break
      }
      root = root.parentElement
    }
    return { kind: LoginSubmissionDomObservationKind.Ignored }
  }

  private unownedInputs(root: HTMLElement): HTMLInputElement[] {
    return Array.from(root.querySelectorAll<HTMLInputElement>('input'))
      .filter((field) => !field.form)
  }

  private snapshot({ event, root }: LoginSubmissionRootObservation): LoginSubmissionDomObservation {
    let fields: HTMLInputElement[]
    switch (true) {
      case root instanceof HTMLFormElement:
        fields = Array.from(root.elements).filter((field) => field instanceof HTMLInputElement)
        break
      case true: default:
        fields = this.unownedInputs(root)
        break
    }
    const inputs: LoginSubmissionInputs = fields.filter((field) => this.isRenderedInput(field)).map((field) => ({
      field,
      observation: passwordFieldDiscovery.focusedFieldObservation(field),
      passwordHistory: this.passwordHistory(field),
      value: field.value,
    }))
    const request: LoginSubmissionSnapshotRequest = { event, root, inputs }
    return { kind: LoginSubmissionDomObservationKind.Observed, snapshot: new LoginSubmissionDomSnapshot(request) }
  }
}

type LoginSubmissionRootObservation = {
  readonly event: Event
  readonly root: LoginSubmissionDomRoot
}

type LoginSubmissionControlObservation = {
  readonly event: Event
  readonly control: HTMLElement
}
