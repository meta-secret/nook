import { afterEach, describe, expect, mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import {
  AuthenticationWorkflowAction,
  AuthenticationWorkflowKind,
  AuthenticationWorkflowStage,
  AuthenticatorCodeResponseKind,
  type AuthenticationPageObservationFacts,
  type AuthenticationWorkflowSnapshot,
  type AuthenticatorCodeResponse,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import {
  PasswordFormQueryKind,
  PasswordFormScopeKind,
  type OneTimeCodeFillRequest,
  type PasswordFormObservation,
} from '../../nook-web-shared/src/extension/password-forms'
import { emptyPasswordFormSummary } from '../../nook-web-shared/src/extension/password-form-summary-state'
import {
  AuthenticationWorkflowSnapshotIngress,
  AuthenticationWorkflowSnapshotMessageType,
} from '../src/lib/auth-workflow-messages'
import type { BrowserRuntimeMessageValue } from '../src/lib/browser-runtime-message'
import {
  WebsiteAuthenticatorFillMessageType,
  type WebsiteAuthenticatorFillMessage,
} from '../src/lib/login-fill-messages'
import {
  SidePanelPageCodeFillReplyKind,
  SidePanelPageFillMessageType,
  type SidePanelPageCodeFillReply,
} from '../src/lib/side-panel-page-fill'
import {
  RuntimeMessageDeliveryKind,
  type RuntimeMessageDelivery,
} from '../src/content/autofill/runtime-message-adapter'
import {
  SidePanelCodeFillAction,
  SidePanelCodeFillReception,
  SidePanelCodeFillReceiver,
  type SidePanelCodeFillCollaborators,
} from '../src/content/autofill/side-panel-code-fill'
import {
  SidePanelPageWorkflowKind,
  type SidePanelPageWorkflow,
} from '../src/content/autofill/side-panel-page-workflow'
import {
  WidgetCredentialActuation,
  widgetState,
} from '../src/content/autofill/state'
import {
  AuthenticationObservationBindingKind,
  RevalidatedAuthenticationActionOutcomeKind,
  RevalidatedAuthenticationActResultKind,
  type RevalidatedAuthenticationActRequest,
} from '../src/content/autofill/workflow-revalidation'

type RevalidationRequest = Parameters<
  SidePanelCodeFillCollaborators['revalidate']
>[0]
type CodeDelivery = RuntimeMessageDelivery<AuthenticatorCodeResponse>

await companionWasmReady

/** Values the Fill code scenarios share. */
class CodePageData {
  static readonly pageOrigin = 'https://www.namecheap.com'
  static readonly now = 1_000_000
  static readonly account = {
    vaultStoreId: 'store_work',
    secretId: 'authenticator_one',
    authorizationGeneration: 'generation-1',
  }
  static readonly ownSender: chrome.runtime.MessageSender = {
    id: 'nook-extension',
  }

  static trigger(origin = CodePageData.pageOrigin): BrowserRuntimeMessageValue {
    return {
      type: SidePanelPageFillMessageType.FillCode,
      payload: { origin, account: CodePageData.account },
    }
  }

  static snapshot(
    action: AuthenticationWorkflowAction,
  ): AuthenticationWorkflowSnapshot {
    return {
      kind: AuthenticationWorkflowKind.TotpChallenge,
      stage: AuthenticationWorkflowStage.SecondFactor,
      action,
      currentStep: 2,
      totalSteps: 3,
      approvalRequirement: 'explicit-user-approval',
      savedLoginCapability: 'unavailable',
      observationIndex: 0,
    }
  }

  static ready(code: string, expiresAt: number): CodeDelivery {
    return {
      kind: RuntimeMessageDeliveryKind.Delivered,
      response: { kind: AuthenticatorCodeResponseKind.Ready, code, expiresAt },
    }
  }

  static rejected(reason: string): CodeDelivery {
    return {
      kind: RuntimeMessageDeliveryKind.Delivered,
      response: { kind: AuthenticatorCodeResponseKind.Rejected, reason },
    }
  }

  /** One-time-code facts admitted by the Rust snapshot ingress. */
  static approvedFacts(): AuthenticationPageObservationFacts {
    const admission = AuthenticationWorkflowSnapshotIngress.admit({
      type: AuthenticationWorkflowSnapshotMessageType.NookAuthenticationWorkflowSnapshot,
      payload: {
        origin: CodePageData.pageOrigin,
        observations: [
          {
            fields: {
              usernameFieldCount: 0,
              currentPasswordFieldCount: 0,
              newPasswordFieldCount: 0,
              genericPasswordFieldCount: 0,
              oneTimeCodeFieldCount: 1,
              actionablePasswordFieldCount: 0,
              readonlyPasswordFieldCount: 0,
            },
            ceremony: {
              oneTimeCodeProgression: 'advance-control-required',
              oneTimeCodeHandlerSignal: '',
              authenticationContext: {
                authenticationUsername: 'absent',
                sourceOrigin: CodePageData.pageOrigin,
                formIdentity: 'totp',
                destinationIdentity: '/twofa/totp/',
              },
              manualCheckpoint: 'absent',
              advanceControl: 'absent',
            },
            authenticator: {
              authenticatorSetup: 'absent',
              backupCodesCopy: '',
              passkeyControl: 'absent',
              passkeyAccountAvailability: 'unavailable',
              matchingPasskeyAccountCount: 0,
              detailedPasskeyControl: { kind: 'absent' },
            },
            credentialSubmission: { kind: 'absent' },
            detailedAdvanceControl: { kind: 'absent' },
          },
        ],
      },
    })
    if (admission.kind !== 'accepted') throw new Error('facts fixture')
    const [facts] = admission.message.payload.observations
    if (!facts) throw new Error('facts fixture')
    return facts
  }
}

/**
 * A top document with a 2FA form, and page collaborators that stand in for
 * Rust and the service worker: the classified workflow, revalidation
 * verdicts and the sender-bound code answer.
 */
class CodePageFixture {
  readonly browser = new Window({
    url: `${CodePageData.pageOrigin}/twofa/totp/`,
  })
  readonly revalidations: RevalidationRequest[] = []
  readonly codeRequests: WebsiteAuthenticatorFillMessage[] = []
  readonly writes: OneTimeCodeFillRequest[] = []
  readonly submits = mock(() => {})
  readonly clicks = mock(() => {})
  page: SidePanelPageWorkflow
  verdicts: RevalidatedAuthenticationActionOutcomeKind[] = [
    RevalidatedAuthenticationActionOutcomeKind.Acted,
    RevalidatedAuthenticationActionOutcomeKind.Acted,
  ]
  answer: CodeDelivery = CodePageData.ready(
    '123456',
    CodePageData.now + 30_000,
  )
  now = CodePageData.now
  beforeCode: () => void = () => {}
  private readonly facts = CodePageData.approvedFacts()

  constructor() {
    Object.assign(globalThis, {
      window: this.browser,
      document: this.browser.document,
      location: this.browser.location,
      HTMLElement: this.browser.HTMLElement,
      HTMLInputElement: this.browser.HTMLInputElement,
      HTMLFormElement: this.browser.HTMLFormElement,
      chrome: { runtime: { id: 'nook-extension' } },
    })
    const form = document.createElement('form')
    form.id = 'totp'
    const input = document.createElement('input')
    input.id = 'code'
    input.inputMode = 'numeric'
    const submit = document.createElement('button')
    submit.type = 'submit'
    form.append(input, submit)
    document.body.append(form)
    form.addEventListener('submit', this.submits)
    submit.addEventListener('click', this.clicks)
    const observation: PasswordFormObservation = {
      root: document,
      formScope: { kind: PasswordFormScopeKind.Owned, owner: form },
      summary: emptyPasswordFormSummary,
    }
    this.page = {
      kind: SidePanelPageWorkflowKind.Selected,
      snapshot: CodePageData.snapshot(AuthenticationWorkflowAction.FillTotp),
      savedLoginCapability: 'unavailable',
      workflow: observation,
    }
  }

  value(): string {
    const input = document.querySelector('#code')
    if (!(input instanceof HTMLInputElement)) return 'absent'
    return input.value
  }

  collaborators(): SidePanelCodeFillCollaborators {
    return {
      pages: { pageWorkflow: async () => this.page },
      revalidate: async (request) => this.revalidate(request),
      code: async (message) => {
        this.codeRequests.push(message)
        this.beforeCode()
        return this.answer
      },
      fillCode: (request) => {
        this.writes.push({ ...request })
        const scope = request.kind === PasswordFormQueryKind.Scoped && request
        if (!scope || scope.formScope.kind !== PasswordFormScopeKind.Owned)
          throw new Error('unscoped write')
        const input = scope.formScope.owner.querySelector('input')
        if (!(input instanceof HTMLInputElement)) return false
        input.value = request.code
        return true
      },
      now: () => this.now,
    }
  }

  private revalidate(request: RevalidationRequest) {
    this.revalidations.push(request)
    const kind = this.verdicts.shift()
    if (!kind) throw new Error('unexpected revalidation')
    if (!request.approvalIsActive())
      return { kind: RevalidatedAuthenticationActionOutcomeKind.Rejected }
    const page = this.page
    if (page.kind !== SidePanelPageWorkflowKind.Selected)
      throw new Error('no workflow')
    const act: RevalidatedAuthenticationActRequest = {
      authenticatorSetupSnapshot: {
        metadataKey: 'fixture',
        observation: 'absent',
      },
      currentWorkflow: page.workflow,
      observationBindingToken: `token-${this.revalidations.length}`,
      approvedFacts: this.facts,
      revalidateCurrentWorkflow: () => page.workflow,
    }
    const acted = request.act(act)
    switch (acted.kind) {
      case RevalidatedAuthenticationActResultKind.Acted:
        return { kind }
      case RevalidatedAuthenticationActResultKind.Failed:
      case RevalidatedAuthenticationActResultKind.ControlMissing:
        return { kind: RevalidatedAuthenticationActionOutcomeKind.ActionFailed }
    }
  }

  action(): SidePanelCodeFillAction {
    return new SidePanelCodeFillAction(this.collaborators())
  }

  async receive(
    message: BrowserRuntimeMessageValue,
    sender: chrome.runtime.MessageSender = CodePageData.ownSender,
    receiver: SidePanelCodeFillReceiver = new SidePanelCodeFillReceiver(
      this.action(),
    ),
  ) {
    const replies = Promise.withResolvers<SidePanelPageCodeFillReply>()
    const reception = receiver.receive({
      message,
      sender,
      sendResponse: replies.resolve,
    })
    switch (reception) {
      case SidePanelCodeFillReception.Ignored:
        return { reception }
      case SidePanelCodeFillReception.Responding:
        return { reception, reply: await replies.promise }
    }
  }
}

afterEach(() => {
  widgetState.busy = false
  widgetState.credentialActuation = WidgetCredentialActuation.Idle
})

describe('side-panel Fill code trigger admission', () => {
  test('ignores foreign senders, subframes and other messages without answering', async () => {
    const foreign = new CodePageFixture()
    expect(
      await foreign.receive(CodePageData.trigger(), { id: 'other-extension' }),
    ).toEqual({ reception: SidePanelCodeFillReception.Ignored })

    const subframe = new CodePageFixture()
    const top = subframe.browser
    Object.assign(globalThis, { window: { top } })
    expect(await subframe.receive(CodePageData.trigger())).toEqual({
      reception: SidePanelCodeFillReception.Ignored,
    })

    const other = new CodePageFixture()
    expect(
      await other.receive({
        type: SidePanelPageFillMessageType.Fill,
        payload: {
          origin: CodePageData.pageOrigin,
          account: CodePageData.account,
        },
      }),
    ).toEqual({ reception: SidePanelCodeFillReception.Ignored })
    expect([
      ...foreign.codeRequests,
      ...subframe.codeRequests,
      ...other.codeRequests,
    ]).toEqual([])
  })

  test('answers tab-changed for another origin and fill-failed for a malformed trigger, asking for no code', async () => {
    const moved = new CodePageFixture()
    expect(
      (await moved.receive(CodePageData.trigger('https://other.example.test')))
        .reply,
    ).toEqual({ kind: SidePanelPageCodeFillReplyKind.TabChanged })

    const malformed = new CodePageFixture()
    const withCode = {
      type: SidePanelPageFillMessageType.FillCode,
      payload: {
        origin: CodePageData.pageOrigin,
        account: { ...CodePageData.account, code: '123456' },
      },
    }
    expect((await malformed.receive(withCode)).reply).toEqual({
      kind: SidePanelPageCodeFillReplyKind.FillFailed,
    })

    const busy = new CodePageFixture()
    widgetState.busy = true
    expect((await busy.receive(CodePageData.trigger())).reply).toEqual({
      kind: SidePanelPageCodeFillReplyKind.FillFailed,
    })
    expect([
      ...moved.codeRequests,
      ...malformed.codeRequests,
      ...busy.codeRequests,
    ]).toEqual([])
  })
})

describe('side-panel Fill code into the page', () => {
  test("asks the sender-bound route for the code, fills Rust's one-time-code field and never submits", async () => {
    const fixture = new CodePageFixture()

    const answer = await fixture.receive(CodePageData.trigger())

    expect(answer).toStrictEqual({
      reception: SidePanelCodeFillReception.Responding,
      reply: { kind: SidePanelPageCodeFillReplyKind.Filled },
    })
    expect(fixture.codeRequests).toEqual([
      {
        type: WebsiteAuthenticatorFillMessageType.NookWebsiteAuthenticatorFill,
        payload: { origin: CodePageData.pageOrigin, ...CodePageData.account },
      },
    ])
    expect(fixture.value()).toBe('123456')
    expect(fixture.submits).not.toHaveBeenCalled()
    expect(fixture.clicks).not.toHaveBeenCalled()
    expect(
      fixture.revalidations.map((request) => request.expectedAction),
    ).toEqual([
      AuthenticationWorkflowAction.FillTotp,
      AuthenticationWorkflowAction.FillTotp,
    ])
    expect(fixture.revalidations[1]?.observationBinding).toEqual({
      kind: AuthenticationObservationBindingKind.Required,
      token: 'token-1',
    })
    // The code answer is cleared once the write owns its copy.
    const delivered = fixture.answer
    expect(
      delivered.kind === RuntimeMessageDeliveryKind.Delivered &&
        'code' in delivered.response &&
        delivered.response.code,
    ).toBe('')
    expect(widgetState.credentialActuation).toBe(WidgetCredentialActuation.Idle)
  })

  test('without a Rust one-time-code challenge it answers no-code-field and asks for no code', async () => {
    const login = new CodePageFixture()
    const page = login.page
    if (page.kind !== SidePanelPageWorkflowKind.Selected) throw new Error('page')
    login.page = {
      ...page,
      snapshot: CodePageData.snapshot(
        AuthenticationWorkflowAction.ContinueWithNook,
      ),
    }
    expect((await login.receive(CodePageData.trigger())).reply).toEqual({
      kind: SidePanelPageCodeFillReplyKind.NoCodeField,
    })

    const none = new CodePageFixture()
    none.page = { kind: SidePanelPageWorkflowKind.None }
    expect((await none.receive(CodePageData.trigger())).reply).toEqual({
      kind: SidePanelPageCodeFillReplyKind.NoCodeField,
    })

    const rejected = new CodePageFixture()
    rejected.verdicts = [RevalidatedAuthenticationActionOutcomeKind.Rejected]
    expect((await rejected.receive(CodePageData.trigger())).reply).toEqual({
      kind: SidePanelPageCodeFillReplyKind.NoCodeField,
    })

    const unavailable = new CodePageFixture()
    unavailable.page = { kind: SidePanelPageWorkflowKind.Unavailable }
    expect((await unavailable.receive(CodePageData.trigger())).reply).toEqual({
      kind: SidePanelPageCodeFillReplyKind.FillFailed,
    })
    for (const fixture of [login, none, rejected, unavailable]) {
      expect(fixture.codeRequests).toEqual([])
      expect(fixture.value()).toBe('')
    }
  })

  test('a locked or failed code answer leaves the field untouched', async () => {
    const cases: Array<[CodeDelivery, SidePanelPageCodeFillReplyKind]> = [
      [
        CodePageData.rejected('authenticator-locked'),
        SidePanelPageCodeFillReplyKind.Locked,
      ],
      [
        CodePageData.rejected('authenticator-vault-not-granted'),
        SidePanelPageCodeFillReplyKind.FillFailed,
      ],
      [
        { kind: RuntimeMessageDeliveryKind.Unavailable },
        SidePanelPageCodeFillReplyKind.FillFailed,
      ],
    ]
    for (const [answer, kind] of cases) {
      const fixture = new CodePageFixture()
      fixture.answer = answer
      expect((await fixture.receive(CodePageData.trigger())).reply).toEqual({
        kind,
      })
      expect(fixture.writes).toEqual([])
      expect(fixture.value()).toBe('')
    }
  })

  test('an expired code or a withdrawn Fill code writes nothing', async () => {
    const expired = new CodePageFixture()
    expired.answer = CodePageData.ready('123456', CodePageData.now)
    expect((await expired.receive(CodePageData.trigger())).reply).toEqual({
      kind: SidePanelPageCodeFillReplyKind.FillFailed,
    })

    const withdrawn = new CodePageFixture()
    const action = withdrawn.action()
    withdrawn.beforeCode = () => action.withdraw()
    const receiver = new SidePanelCodeFillReceiver(action)
    expect(
      (
        await withdrawn.receive(
          CodePageData.trigger(),
          CodePageData.ownSender,
          receiver,
        )
      ).reply,
    ).toEqual({ kind: SidePanelPageCodeFillReplyKind.FillFailed })
    for (const fixture of [expired, withdrawn]) {
      expect(fixture.writes).toEqual([])
      expect(fixture.value()).toBe('')
    }
  })
})
