import { Effect, Schema } from 'effect'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  bind_authentication_page_observation_facts,
  classify_companion_authentication_workflow_facts,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  GoogleLoginBrowserContextSchema,
  GoogleLoginContinuationMessageType,
  GoogleLoginContinuationOperation,
  GoogleLoginContinuationResponse,
  GoogleLoginDocumentId,
  GoogleLoginFrameId,
  GoogleLoginSourceOrigin,
  GoogleLoginTabId,
  type GoogleLoginBrowserContext,
  type GoogleLoginBrowserMessage,
  type GoogleLoginSessionMessage,
  type GoogleLoginRuntimeResponse,
} from '../../../../nook-web-shared/src/extension/google-login-continuation-messages'
import {
  CompanionWasmSessionMessageType,
  type CompanionWasmRuntimeMessage,
  type CompanionWasmSessionResponse,
} from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import {
  passwordFormInteraction,
  type PasswordFormObservation,
} from '../../../../nook-web-shared/src/extension/password-forms'
import type { AuthenticationWorkflowSnapshotMessage } from '../../../../nook-web-extension/src/lib/auth-workflow-messages'
import type { AuthenticationWorkflowRoutingResponse } from '../../../../nook-web-extension/src/background/service-worker/authentication-workflow-routing'
import {
  WebsiteFocusedLoginRevealMessageType,
  type WebsiteFocusedLoginRevealMessage,
  type WebsiteFocusedLoginFillResponse,
} from '../../../../nook-web-extension/src/lib/focused-login-fill-messages'
import {
  GoogleLoginDocumentContinuation,
  GoogleLoginStartDisposition,
} from '../../../../nook-web-extension/src/content/autofill/google-login-continuation'
import { GoogleLoginSessionContinuations } from '../../../../nook-web-extension/src/offscreen/google-login-continuation'
import { pageQrCapture } from '../../../../nook-web-extension/src/lib/page-qr-capture'
import {
  ExtensionSessionDocumentOwner,
  extensionSessionDocument,
  type ExtensionSessionTransportDelivery,
} from '../../../../nook-web-extension/src/background/service-worker/session-document'
import {
  ExtensionSessionReadinessMessageType,
  type ExtensionSessionReadinessQuery,
  type ExtensionSessionReadyResponse,
} from '../../../../nook-web-extension/src/lib/extension-session-readiness'

enum IdentifierNextInteraction {
  Automatic = 'automatic',
  Manual = 'manual',
  EditAndRestore = 'edit-and-restore',
}
enum SelectionApproval {
  Active = 'active',
  Revoked = 'revoked',
}
enum UsernameDelivery {
  Immediate = 'immediate',
  RevokeApprovalWhilePending = 'revoke-approval-while-pending',
}
enum AdvanceSnapshotDelivery {
  Immediate = 'immediate',
  RevokeAtFirst = 'revoke-at-first',
  RevokeAtSecond = 'revoke-at-second',
}
enum SequenceSessionDocumentPreparation {
  Unprepared = 'unprepared',
  Prepared = 'prepared',
}
type SequenceSessionDocument =
  | { readonly kind: SequenceSessionDocumentPreparation.Unprepared }
  | {
      readonly kind: SequenceSessionDocumentPreparation.Prepared
      readonly owner: ExtensionSessionDocumentOwner
    }

type SequenceRuntimeMessage =
  | GoogleLoginBrowserMessage
  | CompanionWasmRuntimeMessage
  | AuthenticationWorkflowSnapshotMessage
  | WebsiteFocusedLoginRevealMessage
  | ExtensionSessionReadinessQuery
interface SequenceSessionResponse {
  readonly ok: true
  readonly result: CompanionWasmSessionResponse
}
type SequenceRuntimeResponse =
  | SequenceSessionResponse
  | AuthenticationWorkflowRoutingResponse
  | WebsiteFocusedLoginFillResponse
type SequenceChromeResponse =
  | SequenceRuntimeResponse
  | CompanionWasmSessionResponse
  | ExtensionSessionReadyResponse
type ChromeResponseCallback = (response: SequenceChromeResponse) => void
// Chrome sendMessage supports both Promise and callback delivery overloads.
type ChromeRuntimeInvocation =
  | [message: SequenceRuntimeMessage]
  | [message: SequenceRuntimeMessage, respond: ChromeResponseCallback]
interface SequenceChromeHost {
  readonly runtime: {
    readonly ContextType: { readonly OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' }
    readonly getURL: (path: string) => string
    readonly getContexts: () => Promise<SequenceOffscreenContexts>
    readonly sendMessage: (
      ...invocation: ChromeRuntimeInvocation
    ) => Promise<SequenceChromeResponse>
  }
  readonly offscreen: { readonly closeDocument: () => Promise<void> }
}
interface SequenceOffscreenContext {
  readonly contextType: 'OFFSCREEN_DOCUMENT'
  readonly documentUrl: string
}
type SequenceOffscreenContexts = SequenceOffscreenContext[]
type SequenceSessionResult = Awaited<
  ReturnType<GoogleLoginSessionContinuations['handle']>
>
type SelectedGoogleAccount = Parameters<
  GoogleLoginDocumentContinuation['start']
>[0]['account']
type RevealedCredentials =
  WebsiteFocusedLoginRevealMessage['payload']['credential'][]
type FilledCredentialValues = string[]
type ContinuationOperations = GoogleLoginContinuationOperation[]
type IdentifierNextInteractions = IdentifierNextInteraction[]
interface AdvanceApprovalLoss {
  readonly delivery: AdvanceSnapshotDelivery
  readonly expectedSnapshots: number
}
type AdvanceApprovalLosses = AdvanceApprovalLoss[]

/** One Google DOM sequence using real content, transport, and Rust policy owners. */
class GoogleLoginContentSequence {
  readonly content = new GoogleLoginDocumentContinuation(globalThis)
  private readonly session = new GoogleLoginSessionContinuations()
  private sessionDocument: SequenceSessionDocument = {
    kind: SequenceSessionDocumentPreparation.Unprepared,
  }
  private readonly context: GoogleLoginBrowserContext = {
    tabId: GoogleLoginTabId.make(7),
    frameId: GoogleLoginFrameId.make(0),
    documentId: GoogleLoginDocumentId.make('google-selected-document'),
    sourceOrigin: GoogleLoginSourceOrigin.make('https://accounts.google.com'),
  }
  private readonly account: SelectedGoogleAccount = {
    vaultStoreId: 'selected-vault',
    secretId: 'selected-login',
    authorizationGeneration: 'selected-generation',
  }
  readonly reveals: RevealedCredentials = []
  readonly passwordInputs: FilledCredentialValues = []
  readonly usernameInputs: FilledCredentialValues = []
  readonly identifierNextValues: FilledCredentialValues = []
  readonly operations: ContinuationOperations = []
  identifierNextClicks = 0
  passwordNextClicks = 0
  private readonly previousUrl = location.href
  private approval = SelectionApproval.Active
  private usernameDelivery = UsernameDelivery.Immediate
  private advanceDelivery = AdvanceSnapshotDelivery.Immediate
  advanceSnapshots = 0

  constructor(private readonly nextInteraction: IdentifierNextInteraction) {}

  install = Effect.fnUntraced(function* (this: GoogleLoginContentSequence) {
    const chromeHost: SequenceChromeHost = {
      runtime: {
        ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
        getURL: (path) => this.extensionUrl(path),
        getContexts: () => this.offscreenContexts(),
        sendMessage: (...invocation: ChromeRuntimeInvocation) =>
          this.deliver(invocation),
      },
      offscreen: { closeDocument: () => Promise.resolve() },
    }
    vi.stubGlobal('chrome', chromeHost)
    this.sessionDocument = {
      kind: SequenceSessionDocumentPreparation.Prepared,
      owner: new ExtensionSessionDocumentOwner(),
    }
    yield* Effect.promise(() =>
      pageQrCapture.prepareAuthenticationAuthenticatorSetupObservation(),
    )
    location.href = 'https://accounts.google.com/v3/signin/identifier'
    document.body.innerHTML =
      '<main><h1>Sign in</h1><input id="identifierId" name="identifier" type="email" autocomplete="username"><div id="identifierNext"><button type="button">Next</button></div></main>'
    const identifier = this.identifier()
    const next = this.identifierNext()
    const firstUsernameInput: AddEventListenerOptions = { once: true }
    identifier.addEventListener(
      'input',
      () => {
        this.usernameInputs.push(identifier.value)
        void Effect.runPromise(this.afterUsernameInput())
      },
      firstUsernameInput,
    )
    next.addEventListener('click', () => {
      this.identifierNextClicks += 1
      this.identifierNextValues.push(identifier.value)
      this.showPassword()
    })
  })

  private extensionUrl(path: string): string {
    return `chrome-extension://nook-sequence-extension/${path}`
  }

  private documentOwner(): ExtensionSessionDocumentOwner {
    switch (this.sessionDocument.kind) {
      case SequenceSessionDocumentPreparation.Unprepared:
        throw new Error('Expected the installed Chrome session document owner')
      case SequenceSessionDocumentPreparation.Prepared:
        return this.sessionDocument.owner
    }
  }

  private offscreenContexts(): Promise<SequenceOffscreenContexts> {
    const context: SequenceOffscreenContext = {
      contextType: 'OFFSCREEN_DOCUMENT',
      documentUrl: this.extensionUrl(extensionSessionDocument),
    }
    const contexts: SequenceOffscreenContexts = [context]
    return Promise.resolve(contexts)
  }

  private waitForIdentifierTurn(): Promise<void> {
    return new Promise((resolve) => globalThis.setTimeout(resolve, 0))
  }

  private afterUsernameInput = Effect.fnUntraced(function* (
    this: GoogleLoginContentSequence,
  ) {
    switch (this.nextInteraction) {
      case IdentifierNextInteraction.Automatic:
        return
      case IdentifierNextInteraction.Manual:
        yield* Effect.promise(this.waitForIdentifierTurn.bind(this))
        this.manualNext()
        return
      case IdentifierNextInteraction.EditAndRestore: {
        yield* Effect.promise(this.waitForIdentifierTurn.bind(this))
        const identifier = this.identifier()
        identifier.value = 'another@nook.test'
        const editEvent: EventInit = { bubbles: true }
        identifier.dispatchEvent(new Event('input', editEvent))
        identifier.value = 'selected@nook.test'
        this.manualNext()
      }
    }
  })

  /** Simulates only Chrome's delivery overload and service-worker context stamp. */
  private deliver(
    invocation: ChromeRuntimeInvocation,
  ): Promise<SequenceChromeResponse> {
    const delivery = Effect.runPromise(this.respond(invocation[0]))
    switch (invocation.length) {
      case 1:
        return delivery
      case 2:
        void delivery.then(invocation[1])
        return delivery
    }
  }

  private respond = Effect.fnUntraced(function* (
    this: GoogleLoginContentSequence,
    message: SequenceRuntimeMessage,
  ) {
    switch (message.type) {
      case GoogleLoginContinuationMessageType.Session: {
        switch (true) {
          case 'browserContext' in message: {
            const browserContext = yield* Schema.decodeUnknownEffect(
              GoogleLoginBrowserContextSchema,
            )(message.browserContext)
            const sessionMessage: GoogleLoginSessionMessage = {
              ...message,
              browserContext,
            }
            const result = yield* Effect.promise(() =>
              this.session.handle(sessionMessage),
            )
            return this.sessionValue(result)
          }
          case true:
            break
        }
        this.operations.push(message.payload.operation)
        const sessionMessage: GoogleLoginSessionMessage = {
          ...message,
          browserContext: this.context,
        }
        const opened = yield* Effect.promise(() => this.documentOwner().open())
        const transport = opened.match(
          (value) => value,
          (failure) => {
            throw failure
          },
        )
        const delivery: ExtensionSessionTransportDelivery = {
          message: sessionMessage,
        }
        const delivered = yield* Effect.promise(() =>
          transport.sendMessage(delivery),
        )
        const value = delivered.match(
          (response) => response,
          (failure) => {
            throw failure
          },
        )
        const result = yield* GoogleLoginContinuationResponse.decode(value)
        const response: GoogleLoginRuntimeResponse = { ok: true, result }
        return response
      }
      case ExtensionSessionReadinessMessageType.Query: {
        const response: ExtensionSessionReadyResponse = { ok: true }
        return response
      }
      case 'nook:authentication-workflow-snapshot': {
        const response = this.snapshot(message)
        switch (this.usernameInputs.length > 0) {
          case false:
            return response
          case true:
            this.advanceSnapshots += 1
            break
        }
        switch (this.advanceDelivery) {
          case AdvanceSnapshotDelivery.Immediate:
            break
          case AdvanceSnapshotDelivery.RevokeAtFirst:
            switch (this.advanceSnapshots) {
              case 1:
                yield* Effect.yieldNow
                this.approval = SelectionApproval.Revoked
                break
            }
            break
          case AdvanceSnapshotDelivery.RevokeAtSecond:
            switch (this.advanceSnapshots) {
              case 2:
                yield* Effect.yieldNow
                this.approval = SelectionApproval.Revoked
                break
            }
            break
        }
        return response
      }
      case WebsiteFocusedLoginRevealMessageType.Reveal:
        return yield* this.reveal(message)
      case CompanionWasmSessionMessageType.ProjectAuthenticationLoginChecklist:
      case CompanionWasmSessionMessageType.ClassifyFocusedCredentialField:
      case CompanionWasmSessionMessageType.RevalidateFocusedCredentialField:
      case CompanionWasmSessionMessageType.GetAuthenticationActivityProgress:
      case CompanionWasmSessionMessageType.ExtractAuthenticationBackupCodeCandidates:
      case CompanionWasmSessionMessageType.ProjectAuthenticationNavigationPath:
      case CompanionWasmSessionMessageType.AuthenticationAuthenticatorSetupObservation:
      case CompanionWasmSessionMessageType.AuthenticationWorkflowPilotPresentationCapability:
      case CompanionWasmSessionMessageType.PasswordWorkflowActivity:
      case CompanionWasmSessionMessageType.BindAuthenticationPageObservationFacts:
      case CompanionWasmSessionMessageType.AuthenticationPageObservationFactsMatchBinding:
      case CompanionWasmSessionMessageType.AuthenticationEnrollmentWorkflowMatch:
      case CompanionWasmSessionMessageType.HasLoginContext:
      case CompanionWasmSessionMessageType.ClassifyPageInputField:
      case CompanionWasmSessionMessageType.ClassifyPageInputs:
      case CompanionWasmSessionMessageType.LooksLikeLoginAdvanceControlLabel:
      case CompanionWasmSessionMessageType.LooksLikeManualCheckpointLabel:
      case CompanionWasmSessionMessageType.LooksLikePasskeyControlLabel:
      case CompanionWasmSessionMessageType.LooksLikeEmailVerificationBody:
      case CompanionWasmSessionMessageType.LooksLikeOneTimeCodeAutoSubmitSignal:
      case CompanionWasmSessionMessageType.AuthenticationRecoveryCopyEvidence:
      case CompanionWasmSessionMessageType.IsNookVaultAppUrl:
      case CompanionWasmSessionMessageType.DecodeAuthenticationWorkflowRuntimeResponse:
      case CompanionWasmSessionMessageType.DecodeContentRuntimeResponse:
      case CompanionWasmSessionMessageType.EvaluateAuthenticationPolicies:
      case CompanionWasmSessionMessageType.RevalidateApprovedAuthenticationWorkflow: {
        const result = yield* Effect.promise(() => this.session.handle(message))
        return this.chromeSessionResponse(result)
      }
    }
  })

  private chromeSessionResponse(
    result: SequenceSessionResult,
  ): SequenceSessionResponse {
    return { ok: true, result: this.sessionValue(result) }
  }

  private sessionValue(
    result: SequenceSessionResult,
  ): CompanionWasmSessionResponse {
    return result.match(
      (value) => value,
      (failure) => {
        throw failure
      },
    )
  }

  private snapshot(
    message: AuthenticationWorkflowSnapshotMessage,
  ): AuthenticationWorkflowRoutingResponse {
    const batch: Parameters<
      typeof classify_companion_authentication_workflow_facts
    >[0] = { observations: message.payload.observations }
    const classified = classify_companion_authentication_workflow_facts(batch)
    switch (classified.kind) {
      case 'no-match':
      case 'rejected':
        throw new Error('Expected a Rust-classified Google identifier workflow')
      case 'matched':
        break
    }
    const facts =
      message.payload.observations[classified.snapshot.observationIndex]
    switch (true) {
      case !facts:
        throw new Error('Expected the selected Google workflow facts')
      case true:
        break
    }
    const selectedBatch: Parameters<
      typeof bind_authentication_page_observation_facts
    >[0] = { observations: [facts] }
    return {
      workflow: { ok: true, snapshot: classified.snapshot },
      loginMatches: { kind: 'unavailable' },
      selectedFacts: { state: 'selected', facts },
      factsBindingToken:
        bind_authentication_page_observation_facts(selectedBatch),
    }
  }

  private reveal = Effect.fnUntraced(function* (
    this: GoogleLoginContentSequence,
    message: WebsiteFocusedLoginRevealMessage,
  ): Effect.fn.Return<WebsiteFocusedLoginFillResponse> {
    expect(message.payload.origin).toBe(this.context.sourceOrigin)
    expect(message.payload.vaultStoreId).toBe(this.account.vaultStoreId)
    expect(message.payload.secretId).toBe(this.account.secretId)
    expect(message.payload.authorizationGeneration).toBe(
      this.account.authorizationGeneration,
    )
    this.reveals.push(message.payload.credential)
    switch (message.payload.credential) {
      case 'Username': {
        switch (this.usernameDelivery) {
          case UsernameDelivery.Immediate:
            break
          case UsernameDelivery.RevokeApprovalWhilePending:
            yield* Effect.yieldNow
            this.approval = SelectionApproval.Revoked
            break
        }
        return { ok: true, value: 'selected@nook.test' }
      }
      case 'CurrentPassword':
        return { ok: true, value: 'same-selected-password' }
    }
  })

  revokeApprovalWhileUsernameIsPending(): void {
    this.usernameDelivery = UsernameDelivery.RevokeApprovalWhilePending
  }

  revokeApprovalAtAdvanceSnapshot(delivery: AdvanceSnapshotDelivery): void {
    this.advanceDelivery = delivery
  }

  private workflow(): PasswordFormObservation {
    const workflow =
      passwordFormInteraction.summarizeAuthenticationWorkflowForms()[0]
    switch (true) {
      case !workflow:
        throw new Error('Expected the current Google workflow')
      case true:
        break
    }
    return workflow
  }

  identifier(): HTMLInputElement {
    const field = document.querySelector('#identifierId')
    switch (true) {
      case !(field instanceof HTMLInputElement):
        throw new Error('Expected the Google identifier input')
      case true:
        break
    }
    return field
  }

  private identifierNext(): HTMLButtonElement {
    const button = document.querySelector('#identifierNext button')
    switch (true) {
      case !(button instanceof HTMLButtonElement):
        throw new Error('Expected the nested Google identifier Next button')
      case true:
        break
    }
    return button
  }

  private showPassword(): void {
    history.replaceState('', '', '/v3/signin/challenge/pwd')
    document.body.innerHTML =
      '<main><h1>Welcome</h1><input id="currentpassword1" name="Passwd" type="password" autocomplete="current-password"><div id="passwordNext"><button type="button">Next</button></div></main>'
    const password = this.password()
    password.addEventListener('input', () =>
      this.passwordInputs.push(password.value),
    )
    this.passwordNext().addEventListener('click', () => {
      this.passwordNextClicks += 1
    })
  }

  password(): HTMLInputElement {
    const field = document.querySelector('#currentpassword1')
    switch (true) {
      case !(field instanceof HTMLInputElement):
        throw new Error('Expected the empty Google current-password input')
      case true:
        break
    }
    return field
  }

  passwordNext(): HTMLButtonElement {
    const button = document.querySelector('#passwordNext button')
    switch (true) {
      case !(button instanceof HTMLButtonElement):
        throw new Error('Expected the Google password Next button')
      case true:
        break
    }
    return button
  }

  start = Effect.fnUntraced(function* (
    this: GoogleLoginContentSequence,
    expected: GoogleLoginStartDisposition,
  ) {
    const selection: Parameters<GoogleLoginDocumentContinuation['start']>[0] = {
      account: this.account,
      workflow: this.workflow(),
      approvalIsActive: () => this.approval === SelectionApproval.Active,
    }
    expect(yield* Effect.promise(() => this.content.start(selection))).toBe(
      expected,
    )
  })

  manualNext(): void {
    const next = this.identifierNext()
    next.click()
  }

  observe = Effect.fnUntraced(function* (this: GoogleLoginContentSequence) {
    const workflows =
      passwordFormInteraction.summarizeAuthenticationWorkflowForms()
    yield* Effect.promise(() => this.content.observe(workflows))
  })

  close = Effect.fnUntraced(function* (this: GoogleLoginContentSequence) {
    this.content.cancel()
    this.session.cancel(this.context)
    yield* Effect.promise(this.waitForIdentifierTurn.bind(this))
    yield* Effect.promise(() => this.documentOwner().close())
    location.href = this.previousUrl
    document.body.replaceChildren()
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('selected Google content sequence', () => {
  const interactions: IdentifierNextInteractions = [
    IdentifierNextInteraction.Automatic,
    IdentifierNextInteraction.Manual,
  ]
  test.each(interactions)(
    '%s identifier Next fills the selected password once and leaves final submission explicit',
    async (interaction) => {
      const fixture = new GoogleLoginContentSequence(interaction)
      try {
        await Effect.runPromise(fixture.install())
        await Effect.runPromise(
          fixture.start(GoogleLoginStartDisposition.Started),
        )
        const filledUsernames: FilledCredentialValues = ['selected@nook.test']
        expect(fixture.usernameInputs).toEqual(filledUsernames)
        expect(fixture.identifierNextValues).toEqual(filledUsernames)
        expect(fixture.identifierNextClicks).toBe(1)
        expect(fixture.password().value).toBe('')
        await Effect.runPromise(fixture.observe())
        await Effect.runPromise(fixture.observe())
        const selectedCredentials: RevealedCredentials = [
          'Username',
          'CurrentPassword',
        ]
        const filledPasswords: FilledCredentialValues = [
          'same-selected-password',
        ]
        expect(fixture.reveals).toEqual(selectedCredentials)
        expect(fixture.passwordInputs).toEqual(filledPasswords)
        expect(
          fixture.operations.filter(
            (operation) => operation === GoogleLoginContinuationOperation.Admit,
          ),
        ).toHaveLength(1)
        expect(fixture.passwordNextClicks).toBe(0)
        fixture.passwordNext().click()
        expect(fixture.passwordNextClicks).toBe(1)
      } finally {
        await Effect.runPromise(fixture.close())
      }
    },
  )

  test('editing the identifier and restoring its value keeps cancellation sticky', async () => {
    const fixture = new GoogleLoginContentSequence(
      IdentifierNextInteraction.EditAndRestore,
    )
    try {
      await Effect.runPromise(fixture.install())
      await Effect.runPromise(
        fixture.start(GoogleLoginStartDisposition.Rejected),
      )
      await Effect.runPromise(fixture.observe())
      const restoredIdentifier: FilledCredentialValues = ['selected@nook.test']
      expect(fixture.identifierNextValues).toEqual(restoredIdentifier)
      const identifierOnly: RevealedCredentials = ['Username']
      const noPasswordFill: FilledCredentialValues = []
      expect(fixture.reveals).toEqual(identifierOnly)
      expect(fixture.passwordInputs).toEqual(noPasswordFill)
      expect(fixture.password().value).toBe('')
      expect(fixture.passwordNextClicks).toBe(0)
    } finally {
      await Effect.runPromise(fixture.close())
    }
  })

  const advanceApprovalLosses: AdvanceApprovalLosses = [
    { delivery: AdvanceSnapshotDelivery.RevokeAtFirst, expectedSnapshots: 1 },
    { delivery: AdvanceSnapshotDelivery.RevokeAtSecond, expectedSnapshots: 2 },
  ]
  test.each(advanceApprovalLosses)(
    '$delivery advance snapshot cancels immediately and cannot reveal the later password',
    async (loss) => {
      const fixture = new GoogleLoginContentSequence(
        IdentifierNextInteraction.Automatic,
      )
      try {
        await Effect.runPromise(fixture.install())
        fixture.revokeApprovalAtAdvanceSnapshot(loss.delivery)
        await Effect.runPromise(
          fixture.start(GoogleLoginStartDisposition.Rejected),
        )
        expect(fixture.identifier().value).toBe('selected@nook.test')
        expect(fixture.advanceSnapshots).toBe(loss.expectedSnapshots)
        expect(fixture.identifierNextClicks).toBe(0)
        const operationsAfterRejection: ContinuationOperations =
          fixture.operations.slice()
        const cancelledSelection: ContinuationOperations = [
          GoogleLoginContinuationOperation.Begin,
          GoogleLoginContinuationOperation.Cancel,
        ]
        expect(operationsAfterRejection).toEqual(cancelledSelection)
        fixture.manualNext()
        await Effect.runPromise(fixture.observe())
        const identifierOnly: RevealedCredentials = ['Username']
        const noPasswordFill: FilledCredentialValues = []
        expect(fixture.reveals).toEqual(identifierOnly)
        expect(fixture.password().value).toBe('')
        expect(fixture.passwordInputs).toEqual(noPasswordFill)
        expect(fixture.passwordNextClicks).toBe(0)
      } finally {
        await Effect.runPromise(fixture.close())
      }
    },
  )

  test('approval lost during username delivery cancels the retained password selection', async () => {
    const fixture = new GoogleLoginContentSequence(
      IdentifierNextInteraction.Manual,
    )
    try {
      await Effect.runPromise(fixture.install())
      fixture.revokeApprovalWhileUsernameIsPending()
      await Effect.runPromise(
        fixture.start(GoogleLoginStartDisposition.Rejected),
      )
      const operationsAfterRejection: ContinuationOperations =
        fixture.operations.slice()
      expect(fixture.identifier().value).toBe('')
      fixture.manualNext()
      await Effect.runPromise(fixture.observe())
      const cancelledSelection: ContinuationOperations = [
        GoogleLoginContinuationOperation.Begin,
        GoogleLoginContinuationOperation.Cancel,
      ]
      expect(operationsAfterRejection).toEqual(cancelledSelection)
      const identifierOnly: RevealedCredentials = ['Username']
      const noPasswordFill: FilledCredentialValues = []
      expect(fixture.reveals).toEqual(identifierOnly)
      expect(fixture.password().value).toBe('')
      expect(fixture.passwordInputs).toEqual(noPasswordFill)
      expect(fixture.passwordNextClicks).toBe(0)
    } finally {
      await Effect.runPromise(fixture.close())
    }
  })

  test('manual password input remains untouched by the pending selection', async () => {
    const fixture = new GoogleLoginContentSequence(
      IdentifierNextInteraction.Automatic,
    )
    try {
      await Effect.runPromise(fixture.install())
      await Effect.runPromise(
        fixture.start(GoogleLoginStartDisposition.Started),
      )
      const password = fixture.password()
      password.value = 'user-entered-password'
      const editEvent: EventInit = { bubbles: true }
      password.dispatchEvent(new Event('input', editEvent))
      await Effect.runPromise(fixture.observe())
      expect(password.value).toBe('user-entered-password')
      const identifierOnly: RevealedCredentials = ['Username']
      expect(fixture.reveals).toEqual(identifierOnly)
      expect(fixture.passwordNextClicks).toBe(0)
    } finally {
      await Effect.runPromise(fixture.close())
    }
  })
})
