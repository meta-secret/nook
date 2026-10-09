import { Effect, Option } from 'effect'
import {
  GoogleLoginContinuationDecision,
  type GoogleLoginPageObservation,
  type GoogleLoginStartRequest,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  GoogleLoginContinuationMessageType,
  GoogleLoginContinuationOperation,
  GoogleLoginContinuationResponse,
  type GoogleLoginBrowserMessage,
  type GoogleLoginContinuationRequest,
} from '../../../../nook-web-shared/src/extension/google-login-continuation-messages'
import {
  PasswordFormQueryKind,
  PasswordFormScopeKind,
  FormSubmissionResult,
  passwordFieldDiscovery,
  passwordFormInteraction,
  passwordFormCredentialInteraction,
  type PasswordFormObservation,
  type PasswordFormScopeQuery,
} from '../../../../nook-web-shared/src/extension/password-forms'
import {
  WebsiteFocusedLoginRevealMessageType,
  WebsiteFocusedLoginRevealMessage,
  type WebsiteFocusedLoginFillResponse,
} from '../../lib/focused-login-fill-messages'
import {
  authenticationRuntimeTransport,
  RuntimeMessageDeliveryKind,
} from './runtime-message-adapter'
import {
  RevalidatedAuthenticationAction,
  AuthenticationObservationBindingKind,
  RevalidatedAuthenticationActResultKind,
  RevalidatedAuthenticationActionOutcomeKind,
  type RevalidatedAuthenticationActRequest,
  type RevalidatedAuthenticationActResult,
} from './workflow-revalidation'
import { AuthenticationWorkflowAction } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type { FillAndSubmitAccountArgs } from './login-passkey-action-types'

export enum GoogleLoginStartDisposition {
  OtherPage = 'other-page',
  Started = 'started',
  Rejected = 'rejected',
}

enum GoogleLoginSelectionRetention {
  Current = 'current',
  Changed = 'changed',
}
enum GoogleLoginDocumentState {
  Idle = 'idle',
  Selected = 'selected',
}
enum GoogleLoginWriteState {
  Observing = 'observing',
  Writing = 'writing',
}
enum GoogleLoginObservationPhase {
  Ready = 'ready',
  Actuating = 'actuating',
}
interface GoogleLoginSelection {
  readonly account: FillAndSubmitAccountArgs['account']
  readonly document: Document
  readonly identifier: HTMLInputElement
  readonly next: Element
  readonly startedAt: number
  readonly timer: ReturnType<typeof setTimeout>
}
type GoogleLoginDocumentSelection =
  | { readonly kind: GoogleLoginDocumentState.Idle }
  | {
      readonly kind: GoogleLoginDocumentState.Selected
      readonly selection: GoogleLoginSelection
    }
interface GoogleLoginStartInteraction {
  readonly account: FillAndSubmitAccountArgs['account']
  readonly workflow: PasswordFormObservation
  readonly approvalIsActive: () => boolean
}
type GoogleLoginObservedWorkflows = readonly PasswordFormObservation[]
interface GoogleLoginObservationRequest {
  readonly workflow: PasswordFormObservation
  readonly fieldQuery: PasswordFormScopeQuery
}
interface GoogleLoginAdvanceRequest {
  readonly selection: GoogleLoginSelection
  readonly interaction: GoogleLoginStartInteraction
  readonly submission: GoogleIdentifierSubmission
}
interface GoogleIdentifierSubmission {
  result: FormSubmissionResult
}
interface GoogleIdentifierActivationRequest {
  readonly advance: GoogleLoginAdvanceRequest
  readonly action: RevalidatedAuthenticationActRequest
}

/** Keeps one selected opaque item only for this document's Google two-step interaction. */
export class GoogleLoginDocumentContinuation {
  private state: GoogleLoginDocumentSelection = {
    kind: GoogleLoginDocumentState.Idle,
  }
  private writing = GoogleLoginWriteState.Observing
  private phase = GoogleLoginObservationPhase.Ready
  constructor(private readonly browser: typeof globalThis) {}
  private readonly onInput = (event: Event): void => {
    switch (this.writing) {
      case GoogleLoginWriteState.Writing:
        return
      case GoogleLoginWriteState.Observing:
        this.cancel()
    }
    void event
  }
  private readonly onClick = (event: MouseEvent): void => {
    switch (this.state.kind) {
      case GoogleLoginDocumentState.Idle:
        return
      case GoogleLoginDocumentState.Selected:
        break
    }
    switch (
      event.target instanceof this.browser.Node &&
      this.state.selection.next.contains(event.target)
    ) {
      case true:
        return
      case false:
        this.cancel()
    }
  }
  private readonly onKey = (event: KeyboardEvent): void => {
    switch (this.state.kind) {
      case GoogleLoginDocumentState.Idle:
        return
      case GoogleLoginDocumentState.Selected:
        break
    }
    switch (
      event.key === 'Enter' &&
      (event.target === this.state.selection.identifier ||
        (event.target instanceof this.browser.Node &&
          this.state.selection.next.contains(event.target)))
    ) {
      case true:
        return
      case false:
        this.cancel()
    }
  }
  private readonly onPageHide = (): void => this.cancel()
  private releaseListeners(): void {
    this.browser.document.removeEventListener('input', this.onInput, true)
    this.browser.document.removeEventListener('change', this.onInput, true)
    this.browser.document.removeEventListener('click', this.onClick, true)
    this.browser.document.removeEventListener('keydown', this.onKey, true)
    this.browser.removeEventListener('pagehide', this.onPageHide)
  }
  cancel(): void {
    switch (this.state.kind) {
      case GoogleLoginDocumentState.Idle:
        return
      case GoogleLoginDocumentState.Selected:
        this.browser.clearTimeout(this.state.selection.timer)
        break
    }
    this.state = { kind: GoogleLoginDocumentState.Idle }
    this.releaseListeners()
    const request: GoogleLoginContinuationRequest = {
      operation: GoogleLoginContinuationOperation.Cancel,
    }
    void this.send(request)
  }
  private send(request: GoogleLoginContinuationRequest) {
    const message: GoogleLoginBrowserMessage = {
      type: GoogleLoginContinuationMessageType.Session,
      origin: this.browser.location.origin,
      payload: request,
    }
    const delivery: Parameters<
      typeof authenticationRuntimeTransport.sendDecodedRuntimeMessage<GoogleLoginContinuationDecision>
    >[0] = {
      message,
      decode: (response) =>
        Effect.runSync(GoogleLoginContinuationResponse.decode(response)),
    }
    return authenticationRuntimeTransport.sendDecodedRuntimeMessage(delivery)
  }
  private retention(
    selection: GoogleLoginSelection,
  ): GoogleLoginSelectionRetention {
    switch (this.state.kind) {
      case GoogleLoginDocumentState.Idle:
        return GoogleLoginSelectionRetention.Changed
      case GoogleLoginDocumentState.Selected:
        switch (
          this.state.selection === selection &&
          selection.document === this.browser.document &&
          Date.now() - selection.startedAt < 60_000
        ) {
          case true:
            return GoogleLoginSelectionRetention.Current
          case false:
            return GoogleLoginSelectionRetention.Changed
        }
    }
  }
  private reveal(message: WebsiteFocusedLoginRevealMessage) {
    const request: Parameters<
      typeof authenticationRuntimeTransport.sendDecodedRuntimeMessage<WebsiteFocusedLoginFillResponse>
    >[0] = {
      message,
      decode: (response) =>
        Effect.runSync(
          WebsiteFocusedLoginRevealMessage.decodeResponse(response),
        ),
    }
    return authenticationRuntimeTransport.sendDecodedRuntimeMessage(request)
  }
  private observation(
    request: GoogleLoginObservationRequest,
  ): GoogleLoginPageObservation {
    switch (this.state.kind) {
      case GoogleLoginDocumentState.Idle:
        throw new Error('Google selected interaction is unavailable')
      case GoogleLoginDocumentState.Selected:
        break
    }
    const refreshed: PasswordFormObservation = {
      ...request.workflow,
      summary: passwordFormInteraction.summarizeRoot(request.fieldQuery),
    }
    const factsRequest: Parameters<
      typeof passwordFormInteraction.authenticationPageObservationFacts
    >[0] = {
      observation: refreshed,
      fieldQuery: request.fieldQuery,
      authenticatorSetupHint: 'absent',
      backupCodesCopy: '',
    }
    const fields = passwordFieldDiscovery.findPasswordFields(request.fieldQuery)
    let occupancy: GoogleLoginPageObservation['password_occupancy'] = 'Empty'
    switch (fields.some((field) => field.value.length > 0)) {
      case true:
        occupancy = 'Populated'
        break
      case false:
        break
    }
    return {
      page_url: this.browser.location.href,
      authorization_generation:
        this.state.selection.account.authorizationGeneration,
      elapsed_milliseconds: Math.max(
        0,
        Date.now() - this.state.selection.startedAt,
      ),
      identifier_integrity: 'Unchanged',
      user_intent: 'Continuing',
      password_occupancy: occupancy,
      facts:
        passwordFormInteraction.authenticationPageObservationFacts(
          factsRequest,
        ),
    }
  }
  start(
    request: GoogleLoginStartInteraction,
  ): Promise<GoogleLoginStartDisposition> {
    return Effect.runPromise(
      this.startSelected(request).pipe(
        Effect.map((disposition) => {
          switch (disposition) {
            case GoogleLoginStartDisposition.Rejected:
              this.cancel()
              break
            case GoogleLoginStartDisposition.Started:
            case GoogleLoginStartDisposition.OtherPage:
              break
          }
          return disposition
        }),
        Effect.catchDefect(() => {
          this.cancel()
          return Effect.succeed(GoogleLoginStartDisposition.Rejected)
        }),
      ),
    )
  }
  private startSelected = Effect.fnUntraced(
    this.startSelectedOperation.bind(this),
  )
  private *startSelectedOperation(request: GoogleLoginStartInteraction) {
    // This is browser routing to one observed provider; Rust admits the selection.
    switch (
      this.browser.location.origin === 'https://accounts.google.com' &&
      this.browser.location.pathname === '/v3/signin/identifier'
    ) {
      case false:
        return GoogleLoginStartDisposition.OtherPage
      case true:
        break
    }
    this.cancel()
    const fields = passwordFieldDiscovery.findUsernameFields(request.workflow)
    const identifier = fields[0]
    const next = request.workflow.root.querySelector('#identifierNext')
    switch (true) {
      case !identifier || !next:
        return GoogleLoginStartDisposition.Rejected
      case true:
        break
    }
    const selection: GoogleLoginSelection = {
      account: {
        vaultStoreId: request.account.vaultStoreId,
        secretId: request.account.secretId,
        authorizationGeneration: request.account.authorizationGeneration,
      },
      document: this.browser.document,
      identifier,
      next,
      startedAt: Date.now(),
      timer: this.browser.setTimeout(() => this.cancel(), 60_000),
    }
    this.state = { kind: GoogleLoginDocumentState.Selected, selection }
    this.browser.document.addEventListener('input', this.onInput, true)
    this.browser.document.addEventListener('change', this.onInput, true)
    this.browser.document.addEventListener('click', this.onClick, true)
    this.browser.document.addEventListener('keydown', this.onKey, true)
    this.browser.addEventListener('pagehide', this.onPageHide)
    const initialObservationRequest: GoogleLoginObservationRequest = {
      workflow: request.workflow,
      fieldQuery: {
        kind: PasswordFormQueryKind.Scoped,
        root: request.workflow.root,
        formScope: request.workflow.formScope,
      },
    }
    const start: GoogleLoginStartRequest = {
      observation: {
        ...this.observation(initialObservationRequest),
        elapsed_milliseconds: 0,
      },
      selection_authority: 'DetectedLogin',
    }
    const begin: GoogleLoginContinuationRequest = {
      operation: GoogleLoginContinuationOperation.Begin,
      request: start,
    }
    const beginning = yield* Effect.promise(() => this.send(begin))
    switch (beginning.kind) {
      case RuntimeMessageDeliveryKind.Unavailable:
        this.cancel()
        return GoogleLoginStartDisposition.Rejected
      case RuntimeMessageDeliveryKind.Delivered:
        break
    }
    switch (beginning.response) {
      case GoogleLoginContinuationDecision.Cancel:
        this.cancel()
        return GoogleLoginStartDisposition.Rejected
      case GoogleLoginContinuationDecision.FillPassword:
        this.cancel()
        return GoogleLoginStartDisposition.Rejected
      case GoogleLoginContinuationDecision.AwaitPassword:
        break
    }
    switch (
      this.retention(selection) === GoogleLoginSelectionRetention.Current &&
      request.approvalIsActive()
    ) {
      case false:
        this.cancel()
        return GoogleLoginStartDisposition.Rejected
      case true:
        break
    }
    const reveal: WebsiteFocusedLoginRevealMessage = {
      type: WebsiteFocusedLoginRevealMessageType.Reveal,
      payload: {
        origin: this.browser.location.origin,
        ...selection.account,
        credential: 'Username',
      },
    }
    const delivery = yield* Effect.promise(() => this.reveal(reveal))
    switch (delivery.kind) {
      case RuntimeMessageDeliveryKind.Unavailable:
        this.cancel()
        return GoogleLoginStartDisposition.Rejected
      case RuntimeMessageDeliveryKind.Delivered:
        break
    }
    const response = delivery.response
    switch (response.ok) {
      case false:
        this.cancel()
        return GoogleLoginStartDisposition.Rejected
      case true:
        break
    }
    try {
      switch (
        this.retention(selection) === GoogleLoginSelectionRetention.Current &&
        request.approvalIsActive()
      ) {
        case false:
          return GoogleLoginStartDisposition.Rejected
        case true:
          break
      }
      const revalidation: ConstructorParameters<
        typeof RevalidatedAuthenticationAction
      >[0] = {
        workflow: request.workflow,
        expectedAction: AuthenticationWorkflowAction.ContinueWithNook,
        observationBinding: {
          kind: AuthenticationObservationBindingKind.Unbound,
        },
        approvalIsActive: () =>
          this.retention(selection) === GoogleLoginSelectionRetention.Current &&
          request.approvalIsActive(),
        act: ({ currentWorkflow }) => {
          this.writing = GoogleLoginWriteState.Writing
          try {
            const fill: Parameters<
              typeof passwordFormInteraction.fillLoginCredentials
            >[0] = {
              kind: PasswordFormQueryKind.Scoped,
              root: currentWorkflow.root,
              formScope: currentWorkflow.formScope,
              credentials: { username: response.value, password: '' },
            }
            switch (passwordFormInteraction.fillLoginCredentials(fill)) {
              case false:
                return { kind: RevalidatedAuthenticationActResultKind.Failed }
              case true:
                break
            }
            return { kind: RevalidatedAuthenticationActResultKind.Acted }
          } finally {
            this.writing = GoogleLoginWriteState.Observing
          }
        },
      }
      const outcome = yield* Effect.promise(() =>
        new RevalidatedAuthenticationAction(revalidation).execute(),
      )
      switch (outcome.kind) {
        case RevalidatedAuthenticationActionOutcomeKind.Acted:
          break
        case RevalidatedAuthenticationActionOutcomeKind.Rejected:
        case RevalidatedAuthenticationActionOutcomeKind.ActionFailed:
        case RevalidatedAuthenticationActionOutcomeKind.ControlMissing:
          this.cancel()
          return GoogleLoginStartDisposition.Rejected
      }
      response.value = ''
      const submission: GoogleIdentifierSubmission = {
        result: FormSubmissionResult.NotObserved,
      }
      const advancement: Parameters<typeof this.advanceIdentifier>[0] = {
        selection,
        interaction: request,
        submission,
      }
      return yield* this.advanceIdentifier(advancement)
    } finally {
      response.value = ''
    }
  }
  private activateIdentifier(
    request: GoogleIdentifierActivationRequest,
  ): RevalidatedAuthenticationActResult {
    const { currentWorkflow, approvedFacts, revalidateCurrentWorkflow } =
      request.action
    let advanceControls: NonNullable<
      Parameters<
        typeof passwordFormInteraction.submitLoginForm
      >[0]['approvedAdvanceControls']
    > = []
    const advanceObservation = Option.fromNullishOr(
      approvedFacts.detailedAdvanceControl,
    )
    switch (advanceObservation._tag) {
      case 'Some':
        switch (advanceObservation.value.kind) {
          case 'observed':
            advanceControls = advanceObservation.value.observations
            break
          case 'absent':
            break
        }
        break
      case 'None':
        break
    }
    const submission: Parameters<
      typeof passwordFormInteraction.submitLoginForm
    >[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: currentWorkflow.root,
      formScope: currentWorkflow.formScope,
      approvedAdvanceControls: advanceControls,
      submissionApproval: {
        isApproved: () =>
          this.retention(request.advance.selection) ===
            GoogleLoginSelectionRetention.Current &&
          request.advance.interaction.approvalIsActive() &&
          Boolean(revalidateCurrentWorkflow()),
        reject: this.cancel.bind(this),
      },
    }
    const result = passwordFormInteraction.submitLoginForm(submission)
    request.advance.submission.result = result
    switch (result) {
      case FormSubmissionResult.Rejected:
        return { kind: RevalidatedAuthenticationActResultKind.Failed }
      case FormSubmissionResult.NotObserved:
      case FormSubmissionResult.Submitted:
        return { kind: RevalidatedAuthenticationActResultKind.Acted }
    }
  }
  private waitForIdentifierTurn(): Promise<void> {
    return new Promise((resolve) => this.browser.setTimeout(resolve, 0))
  }
  private advanceIdentifier = Effect.fnUntraced(
    this.advanceIdentifierOperation.bind(this),
  )
  private *advanceIdentifierOperation(request: GoogleLoginAdvanceRequest) {
    // Page input state is applied before fresh admission of the identifier Next.
    yield* Effect.promise(this.waitForIdentifierTurn.bind(this))
    switch (
      this.retention(request.selection) ===
        GoogleLoginSelectionRetention.Current &&
      request.interaction.approvalIsActive()
    ) {
      case false:
        return GoogleLoginStartDisposition.Rejected
      case true:
        break
    }
    const policies: Parameters<
      typeof passwordFormInteraction.prepareCompanionWorkflowPolicies
    >[0] = { authenticatorSetupHint: 'absent', backupCodesHint: false }
    yield* Effect.promise(() =>
      passwordFormInteraction.prepareCompanionWorkflowPolicies(policies),
    )
    switch (
      this.retention(request.selection) ===
        GoogleLoginSelectionRetention.Current &&
      request.interaction.approvalIsActive()
    ) {
      case false:
        return GoogleLoginStartDisposition.Rejected
      case true:
        break
    }
    // A user-admitted manual Next may already have replaced the identifier view.
    switch (request.selection.identifier.isConnected) {
      case false:
        return GoogleLoginStartDisposition.Started
      case true:
        break
    }
    const revalidation: ConstructorParameters<
      typeof RevalidatedAuthenticationAction
    >[0] = {
      workflow: request.interaction.workflow,
      expectedAction: AuthenticationWorkflowAction.ContinueWithNook,
      observationBinding: {
        kind: AuthenticationObservationBindingKind.Unbound,
      },
      approvalIsActive: () =>
        this.retention(request.selection) ===
          GoogleLoginSelectionRetention.Current &&
        request.interaction.approvalIsActive(),
      act: (action) => {
        const activation: GoogleIdentifierActivationRequest = {
          advance: request,
          action,
        }
        return this.activateIdentifier(activation)
      },
    }
    const outcome = yield* Effect.promise(() =>
      new RevalidatedAuthenticationAction(revalidation).execute(),
    )
    switch (outcome.kind) {
      case RevalidatedAuthenticationActionOutcomeKind.Rejected:
      case RevalidatedAuthenticationActionOutcomeKind.ActionFailed:
      case RevalidatedAuthenticationActionOutcomeKind.ControlMissing:
        return GoogleLoginStartDisposition.Rejected
      case RevalidatedAuthenticationActionOutcomeKind.Acted:
        break
    }
    switch (this.retention(request.selection)) {
      case GoogleLoginSelectionRetention.Changed:
        return GoogleLoginStartDisposition.Rejected
      case GoogleLoginSelectionRetention.Current:
        break
    }
    switch (request.submission.result) {
      case FormSubmissionResult.Rejected:
        return GoogleLoginStartDisposition.Rejected
      case FormSubmissionResult.Submitted:
        // Own approved Next may replace the identifier widget synchronously.
        return GoogleLoginStartDisposition.Started
      case FormSubmissionResult.NotObserved:
        switch (request.interaction.approvalIsActive()) {
          case false:
            return GoogleLoginStartDisposition.Rejected
          case true:
            return GoogleLoginStartDisposition.Started
        }
    }
  }
  async observe(workflows: GoogleLoginObservedWorkflows): Promise<void> {
    switch (this.phase) {
      case GoogleLoginObservationPhase.Actuating:
        return
      case GoogleLoginObservationPhase.Ready:
        break
    }
    this.phase = GoogleLoginObservationPhase.Actuating
    try {
      await Effect.runPromise(
        this.observePassword(workflows).pipe(
          Effect.catchDefect(() => Effect.sync(this.cancel.bind(this))),
        ),
      )
    } finally {
      this.phase = GoogleLoginObservationPhase.Ready
    }
  }
  private observePassword = Effect.fnUntraced(
    this.observePasswordOperation.bind(this),
  )
  private *observePasswordOperation(workflows: GoogleLoginObservedWorkflows) {
    switch (this.state.kind) {
      case GoogleLoginDocumentState.Idle:
        return
      case GoogleLoginDocumentState.Selected:
        break
    }
    const selection = this.state.selection
    let observationRequest: GoogleLoginObservationRequest
    switch (
      this.browser.location.origin === 'https://accounts.google.com' &&
      this.browser.location.pathname === '/v3/signin/challenge/pwd'
    ) {
      case false: {
        const workflow = workflows[0]
        switch (true) {
          case !workflow:
            return
          case workflows.length !== 1:
            this.cancel()
            return
          case true:
            break
        }
        const fieldQuery: PasswordFormScopeQuery = {
          kind: PasswordFormQueryKind.Scoped,
          root: workflow.root,
          formScope: workflow.formScope,
        }
        observationRequest = {
          workflow,
          fieldQuery,
        }
        break
      }
      case true: {
        // This selected document's facts reach Rust even when generic scope discovery has no match.
        const summaryRequest: PasswordFormScopeQuery = {
          kind: PasswordFormQueryKind.Root,
          root: this.browser.document,
        }
        const passwordObservation: PasswordFormObservation = {
          root: this.browser.document,
          formScope: { kind: PasswordFormScopeKind.Unowned },
          summary: passwordFormInteraction.summarizeRoot(summaryRequest),
        }
        observationRequest = {
          workflow: passwordObservation,
          fieldQuery: summaryRequest,
        }
        break
      }
    }
    const observation = this.observation(observationRequest)
    const inspect: GoogleLoginContinuationRequest = {
      operation: GoogleLoginContinuationOperation.Inspect,
      request: observation,
    }
    const inspection = yield* Effect.promise(() => this.send(inspect))
    switch (inspection.kind) {
      case RuntimeMessageDeliveryKind.Unavailable:
        this.cancel()
        return
      case RuntimeMessageDeliveryKind.Delivered:
        break
    }
    switch (
      this.retention(selection) === GoogleLoginSelectionRetention.Current
    ) {
      case false:
        return
      case true:
        break
    }
    switch (inspection.response) {
      case GoogleLoginContinuationDecision.Cancel:
        this.cancel()
        return
      case GoogleLoginContinuationDecision.AwaitPassword:
        return
      case GoogleLoginContinuationDecision.FillPassword:
        break
    }
    const fieldQuery: PasswordFormScopeQuery = observationRequest.fieldQuery
    const fields = passwordFieldDiscovery.findPasswordFields(fieldQuery)
    const field = fields[0]
    switch (true) {
      case !field || !field.isConnected || field.value.length > 0:
        this.cancel()
        return
      case true:
        break
    }
    const target = {
      pageUrl: this.browser.location.href,
      type: field.type,
      autocomplete: field.autocomplete,
      disabled: field.disabled,
      readOnly: field.readOnly,
    }
    const reveal: WebsiteFocusedLoginRevealMessage = {
      type: WebsiteFocusedLoginRevealMessageType.Reveal,
      payload: {
        origin: this.browser.location.origin,
        ...selection.account,
        credential: 'CurrentPassword',
      },
    }
    const delivery = yield* Effect.promise(() => this.reveal(reveal))
    switch (delivery.kind) {
      case RuntimeMessageDeliveryKind.Unavailable:
        this.cancel()
        return
      case RuntimeMessageDeliveryKind.Delivered:
        break
    }
    const response = delivery.response
    switch (response.ok) {
      case false:
        this.cancel()
        return
      case true:
        break
    }
    try {
      switch (
        this.retention(selection) === GoogleLoginSelectionRetention.Current &&
        field.isConnected &&
        field.ownerDocument === this.browser.document &&
        field.value.length === 0
      ) {
        case false:
          return
        case true:
          break
      }
      const admission: GoogleLoginContinuationRequest = {
        operation: GoogleLoginContinuationOperation.Admit,
        request: this.observation(observationRequest),
      }
      const admissionDelivery = yield* Effect.promise(() =>
        this.send(admission),
      )
      switch (admissionDelivery.kind) {
        case RuntimeMessageDeliveryKind.Unavailable:
          return
        case RuntimeMessageDeliveryKind.Delivered:
          break
      }
      switch (admissionDelivery.response) {
        case GoogleLoginContinuationDecision.AwaitPassword:
        case GoogleLoginContinuationDecision.Cancel:
          return
        case GoogleLoginContinuationDecision.FillPassword:
          break
      }
      // Browser target and route identity close the awaited admission interval.
      switch (
        this.retention(selection) === GoogleLoginSelectionRetention.Current &&
        field.isConnected &&
        field.ownerDocument === this.browser.document &&
        field.value.length === 0 &&
        target.pageUrl === this.browser.location.href &&
        target.type === field.type &&
        target.autocomplete === field.autocomplete &&
        target.disabled === field.disabled &&
        target.readOnly === field.readOnly
      ) {
        case false:
          return
        case true:
          break
      }
      const mutation: Parameters<
        typeof passwordFormCredentialInteraction.setNativeInputValue
      >[0] = { input: field, value: response.value }
      this.writing = GoogleLoginWriteState.Writing
      try {
        passwordFormCredentialInteraction.setNativeInputValue(mutation)
      } finally {
        this.writing = GoogleLoginWriteState.Observing
      }
      field.focus()
    } finally {
      response.value = ''
      this.cancel()
    }
  }
}
