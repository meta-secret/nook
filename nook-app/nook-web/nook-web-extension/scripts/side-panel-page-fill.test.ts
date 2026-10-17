import { afterEach, describe, expect, mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import {
  AuthenticationWorkflowAction,
  type AuthenticationPageObservationFacts,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  PasswordFormQueryKind,
  PasswordFormScopeKind,
  type LoginCredentialsFillRequest,
  type PasswordFormObservation,
  type PasswordFormScopeQuery,
} from '../../nook-web-shared/src/extension/password-forms'
import { emptyPasswordFormSummary } from '../../nook-web-shared/src/extension/password-form-summary-state'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import {
  AuthenticationWorkflowSnapshotIngress,
  AuthenticationWorkflowSnapshotMessageType,
} from '../src/lib/auth-workflow-messages'
import type { BrowserRuntimeMessageValue } from '../src/lib/browser-runtime-message'
import {
  WebsiteLoginRevealMessageType,
  type WebsiteLoginRevealMessage,
} from '../src/lib/login-fill-messages'
import {
  SidePanelPageFillMessageType,
  SidePanelPageFillReplyKind,
  type SidePanelPageFillReply,
} from '../src/lib/side-panel-page-fill'
import {
  LoginFillDeliveryKind,
  type LoginFillDelivery,
} from '../src/content/autofill/login-fill-runtime-adapter'
import {
  SidePanelLoginFillAction,
  SidePanelLoginFillReception,
  SidePanelLoginFillReceiver,
  type SidePanelLoginFillCollaborators,
} from '../src/content/autofill/side-panel-login-fill'
import {
  SidePanelLoginWorkflowKind,
  type SidePanelLoginWorkflow,
} from '../src/content/autofill/side-panel-login-workflow'
import {
  WidgetCredentialActuation,
  widgetState,
} from '../src/content/autofill/state'
import {
  AuthenticationObservationBindingKind,
  RevalidatedAuthenticationActionOutcomeKind,
  type RevalidatedAuthenticationActRequest,
} from '../src/content/autofill/workflow-revalidation'

type RevalidationRequest = Parameters<
  SidePanelLoginFillCollaborators['revalidate']
>[0]
type RevalidationOutcomeKind = RevalidatedAuthenticationActionOutcomeKind
type ScopedCredential = {
  readonly input: HTMLInputElement
  readonly request: LoginCredentialsFillRequest
}

await companionWasmReady

enum PageMarkup {
  Login = 'login',
  GoogleIdentifier = 'google-identifier',
}

/** Values the page scenarios share. */
class PageData {
  static readonly pageOrigin = 'https://login.example.test'
  static readonly account = {
    vaultStoreId: 'store_work',
    secretId: 'secret_two',
    authorizationGeneration: 'generation-1',
  }
  static readonly ownSender: chrome.runtime.MessageSender = {
    id: 'nook-extension',
  }

  static trigger(origin = PageData.pageOrigin): BrowserRuntimeMessageValue {
    return {
      type: SidePanelPageFillMessageType.Fill,
      payload: { origin, account: PageData.account },
    }
  }

  /** Login facts admitted by the Rust snapshot ingress, as revalidation approves them. */
  static approvedFacts(): AuthenticationPageObservationFacts {
    const admission = AuthenticationWorkflowSnapshotIngress.admit({
      type: AuthenticationWorkflowSnapshotMessageType.NookAuthenticationWorkflowSnapshot,
      payload: {
        origin: PageData.pageOrigin,
        observations: [
          {
            fields: {
              usernameFieldCount: 1,
              currentPasswordFieldCount: 1,
              newPasswordFieldCount: 0,
              genericPasswordFieldCount: 0,
              oneTimeCodeFieldCount: 0,
              actionablePasswordFieldCount: 1,
              readonlyPasswordFieldCount: 0,
            },
            ceremony: {
              oneTimeCodeProgression: 'advance-control-required',
              oneTimeCodeHandlerSignal: '',
              authenticationContext: {
                authenticationUsername: 'explicit',
                sourceOrigin: PageData.pageOrigin,
                formIdentity: 'login',
                destinationIdentity: '/session',
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
 * A top document with a login form, and page collaborators that stand in for
 * Rust: the classifier decision, revalidation verdicts and the reveal answer.
 * Field writes go into the scoped form only.
 */
class SidePanelPageFixture {
  readonly browser = new Window({ url: `${PageData.pageOrigin}/login` })
  readonly revalidations: RevalidationRequest[] = []
  readonly reveals: WebsiteLoginRevealMessage[] = []
  readonly fills: LoginCredentialsFillRequest[] = []
  readonly clears: PasswordFormScopeQuery[] = []
  readonly submits = mock(() => {})
  readonly clicks = mock(() => {})
  workflow: SidePanelLoginWorkflow = { kind: SidePanelLoginWorkflowKind.Absent }
  verdicts: RevalidationOutcomeKind[] = [
    RevalidatedAuthenticationActionOutcomeKind.Acted,
    RevalidatedAuthenticationActionOutcomeKind.Acted,
  ]
  revealed: LoginFillDelivery = {
    kind: LoginFillDeliveryKind.Delivered,
    response: {
      ok: true,
      username: 'work@example.com',
      password: 'correct horse',
    },
  }
  beforeReveal: () => void = () => {}
  private readonly facts = PageData.approvedFacts()

  constructor(markup: PageMarkup) {
    Object.assign(globalThis, {
      window: this.browser,
      document: this.browser.document,
      location: this.browser.location,
      HTMLElement: this.browser.HTMLElement,
      HTMLInputElement: this.browser.HTMLInputElement,
      HTMLFormElement: this.browser.HTMLFormElement,
      chrome: { runtime: { id: 'nook-extension' } },
    })
    const form = this.build(markup)
    form.addEventListener('submit', this.submits)
    for (const button of document.querySelectorAll('button'))
      button.addEventListener('click', this.clicks)
    const observation: PasswordFormObservation = {
      root: document,
      formScope: { kind: PasswordFormScopeKind.Owned, owner: form },
      summary: emptyPasswordFormSummary,
    }
    this.workflow = {
      kind: SidePanelLoginWorkflowKind.Found,
      workflow: observation,
    }
  }

  private build(markup: PageMarkup): HTMLFormElement {
    const form = document.createElement('form')
    form.id = 'login'
    const input = (id: string, type: string) => {
      const field = document.createElement('input')
      field.id = id
      field.type = type
      return field
    }
    const button = (id: string, type: 'submit' | 'button') => {
      const control = document.createElement('button')
      control.id = id
      control.type = type
      return control
    }
    switch (markup) {
      case PageMarkup.Login:
        form.method = 'post'
        form.append(input('user', 'email'), input('pass', 'password'))
        form.append(button('submit', 'submit'))
        break
      case PageMarkup.GoogleIdentifier:
        form.append(input('identifierId', 'email'), button('next', 'button'))
        break
    }
    document.body.append(form)
    return form
  }

  form(): HTMLFormElement {
    const form = document.querySelector('#login')
    if (!(form instanceof HTMLFormElement)) throw new Error('fixture form')
    return form
  }

  value(selector: string): string {
    const input = document.querySelector(selector)
    if (!(input instanceof HTMLInputElement)) return 'absent'
    return input.value
  }

  collaborators(): SidePanelLoginFillCollaborators {
    return {
      workflows: { loginWorkflow: async () => this.workflow },
      revalidate: async (request) => this.revalidate(request),
      reveal: async (message) => {
        this.reveals.push(message)
        this.beforeReveal()
        return this.revealed
      },
      fillCredentials: (request) => {
        this.fills.push(request)
        for (const input of this.scopedInputs(request))
          input.value = this.credentialFor({ input, request })
        return true
      },
      clearCredentials: (request) => {
        this.clears.push(request)
        this.clearing()
        for (const input of this.form().querySelectorAll('input'))
          input.value = ''
      },
    }
  }

  clearing: () => void = () => {}

  /** The fields inside the scope the action asked to fill. */
  private scopedInputs(request: LoginCredentialsFillRequest) {
    switch (true) {
      case request.kind === PasswordFormQueryKind.Scoped &&
        request.formScope.kind === PasswordFormScopeKind.Owned:
        return request.formScope.owner.querySelectorAll('input')
      case true:
      default:
        return this.form().querySelectorAll('input')
    }
  }

  private credentialFor({ input, request }: ScopedCredential): string {
    switch (input.type) {
      case 'password':
        return request.credentials.password
      default:
        return request.credentials.username
    }
  }

  private revalidate(request: RevalidationRequest) {
    this.revalidations.push(request)
    const kind = this.verdicts.shift()
    if (!kind) throw new Error('unexpected revalidation')
    if (!request.approvalIsActive())
      return { kind: RevalidatedAuthenticationActionOutcomeKind.Rejected }
    const workflow = this.workflow
    if (workflow.kind !== SidePanelLoginWorkflowKind.Found)
      throw new Error('no workflow')
    const act: RevalidatedAuthenticationActRequest = {
      authenticatorSetupSnapshot: {
        metadataKey: 'fixture',
        observation: 'absent',
      },
      currentWorkflow: workflow.workflow,
      observationBindingToken: `token-${this.revalidations.length}`,
      approvedFacts: this.facts,
      revalidateCurrentWorkflow: () => workflow.workflow,
    }
    request.act(act)
    return { kind }
  }

  action(): SidePanelLoginFillAction {
    return new SidePanelLoginFillAction(this.collaborators())
  }

  async receive(
    message: BrowserRuntimeMessageValue,
    sender: chrome.runtime.MessageSender = PageData.ownSender,
    receiver: SidePanelLoginFillReceiver = new SidePanelLoginFillReceiver(
      this.action(),
    ),
  ) {
    const replies = Promise.withResolvers<SidePanelPageFillReply>()
    const reception = receiver.receive({
      message,
      sender,
      sendResponse: replies.resolve,
    })
    switch (reception) {
      case SidePanelLoginFillReception.Ignored:
        return { reception }
      case SidePanelLoginFillReception.Responding:
        return { reception, reply: await replies.promise }
    }
  }
}

afterEach(() => {
  widgetState.busy = false
  widgetState.credentialActuation = WidgetCredentialActuation.Idle
})

describe('side-panel Fill trigger admission (T-4)', () => {
  test('ignores foreign senders and subframes without answering', async () => {
    const foreign = new SidePanelPageFixture(PageMarkup.Login)
    expect(
      await foreign.receive(PageData.trigger(), { id: 'other-extension' }),
    ).toEqual({
      reception: SidePanelLoginFillReception.Ignored,
    })

    const subframe = new SidePanelPageFixture(PageMarkup.Login)
    const top = subframe.browser
    Object.assign(globalThis, { window: { top } })
    expect(await subframe.receive(PageData.trigger())).toEqual({
      reception: SidePanelLoginFillReception.Ignored,
    })
    expect([...foreign.reveals, ...subframe.reveals]).toEqual([])
  })

  test('ignores other runtime messages', async () => {
    const fixture = new SidePanelPageFixture(PageMarkup.Login)
    expect(
      await fixture.receive({ type: 'nook:refresh-authentication-surfaces' }),
    ).toEqual({ reception: SidePanelLoginFillReception.Ignored })
  })

  test('answers tab-changed for another origin and sends no reveal', async () => {
    const fixture = new SidePanelPageFixture(PageMarkup.Login)
    const answer = await fixture.receive(
      PageData.trigger('https://other.example.test'),
    )
    expect(answer.reply).toEqual({
      kind: SidePanelPageFillReplyKind.TabChanged,
    })
    expect(fixture.revalidations).toEqual([])
    expect(fixture.reveals).toEqual([])
  })

  test('answers fill-failed for a malformed trigger or while Pilot is filling', async () => {
    const malformed = new SidePanelPageFixture(PageMarkup.Login)
    const withUsername = {
      type: SidePanelPageFillMessageType.Fill,
      payload: {
        origin: PageData.pageOrigin,
        account: { ...PageData.account, username: 'x' },
      },
    }
    expect((await malformed.receive(withUsername)).reply).toEqual({
      kind: SidePanelPageFillReplyKind.FillFailed,
    })

    const busy = new SidePanelPageFixture(PageMarkup.Login)
    widgetState.busy = true
    expect((await busy.receive(PageData.trigger())).reply).toEqual({
      kind: SidePanelPageFillReplyKind.FillFailed,
    })
    expect([...malformed.reveals, ...busy.reveals]).toEqual([])
  })
})

describe('side-panel Fill into the page (T-4)', () => {
  test('without a Rust Login workflow it answers no-login-form and reveals nothing', async () => {
    const absent = new SidePanelPageFixture(PageMarkup.Login)
    absent.workflow = { kind: SidePanelLoginWorkflowKind.Absent }
    expect((await absent.receive(PageData.trigger())).reply).toEqual({
      kind: SidePanelPageFillReplyKind.NoLoginForm,
    })

    const rejected = new SidePanelPageFixture(PageMarkup.Login)
    rejected.verdicts = [RevalidatedAuthenticationActionOutcomeKind.Rejected]
    expect((await rejected.receive(PageData.trigger())).reply).toEqual({
      kind: SidePanelPageFillReplyKind.NoLoginForm,
    })
    expect([...absent.reveals, ...rejected.reveals]).toEqual([])
  })

  test('reveals through the sender-bound route, fills the scoped form and never submits', async () => {
    const fixture = new SidePanelPageFixture(PageMarkup.Login)

    const answer = await fixture.receive(PageData.trigger())

    expect(answer.reply).toEqual({ kind: SidePanelPageFillReplyKind.Filled })
    expect(Object.keys(answer.reply ?? {})).toEqual(['kind'])
    expect(fixture.reveals).toEqual([
      {
        type: WebsiteLoginRevealMessageType.NookWebsiteLoginFill,
        payload: { origin: PageData.pageOrigin, ...PageData.account },
      },
    ])
    expect(fixture.value('#user')).toBe('work@example.com')
    expect(fixture.value('#pass')).toBe('correct horse')
    expect(fixture.submits).not.toHaveBeenCalled()
    expect(fixture.clicks).not.toHaveBeenCalled()
    expect(
      fixture.revalidations.map((request) => request.expectedAction),
    ).toEqual([
      AuthenticationWorkflowAction.ContinueWithNook,
      AuthenticationWorkflowAction.ContinueWithNook,
    ])
    expect(fixture.revalidations[1]?.observationBinding).toEqual({
      kind: AuthenticationObservationBindingKind.Required,
      token: 'token-1',
    })
    // Plaintext ends with the interaction: the reveal answer and the written copy.
    const revealed = fixture.revealed
    expect(
      revealed.kind === LoginFillDeliveryKind.Delivered && revealed.response,
    ).toEqual({
      ok: true,
      username: '',
      password: '',
    })
    expect(fixture.fills[0]?.credentials).toEqual({
      username: '',
      password: '',
    })
    expect(widgetState.credentialActuation).toBe(WidgetCredentialActuation.Idle)
  })

  test("fills only the username on Google's identifier step and never presses Next", async () => {
    const fixture = new SidePanelPageFixture(PageMarkup.GoogleIdentifier)

    const answer = await fixture.receive(PageData.trigger())

    expect(answer.reply).toEqual({ kind: SidePanelPageFillReplyKind.Filled })
    expect(fixture.value('#identifierId')).toBe('work@example.com')
    expect(fixture.clicks).not.toHaveBeenCalled()
    expect(fixture.submits).not.toHaveBeenCalled()
  })

  test('a refused or locked reveal leaves the fields untouched', async () => {
    const refused = new SidePanelPageFixture(PageMarkup.Login)
    refused.revealed = {
      kind: LoginFillDeliveryKind.Delivered,
      response: { ok: false, reason: 'login-fill-failed' },
    }
    expect((await refused.receive(PageData.trigger())).reply).toEqual({
      kind: SidePanelPageFillReplyKind.FillFailed,
    })
    expect(refused.value('#user')).toBe('')
    expect(refused.fills).toEqual([])

    const locked = new SidePanelPageFixture(PageMarkup.Login)
    locked.revealed = {
      kind: LoginFillDeliveryKind.Delivered,
      response: { ok: false, reason: 'login-locked' },
    }
    expect((await locked.receive(PageData.trigger())).reply).toEqual({
      kind: SidePanelPageFillReplyKind.Locked,
    })

    const unavailable = new SidePanelPageFixture(PageMarkup.Login)
    unavailable.revealed = { kind: LoginFillDeliveryKind.Unavailable }
    expect((await unavailable.receive(PageData.trigger())).reply).toEqual({
      kind: SidePanelPageFillReplyKind.FillFailed,
    })
    expect(unavailable.value('#pass')).toBe('')
  })

  test('a failed revalidation after the write clears the filled fields', async () => {
    const fixture = new SidePanelPageFixture(PageMarkup.Login)
    fixture.verdicts = [
      RevalidatedAuthenticationActionOutcomeKind.Acted,
      RevalidatedAuthenticationActionOutcomeKind.Rejected,
    ]

    const answer = await fixture.receive(PageData.trigger())

    expect(answer.reply).toEqual({
      kind: SidePanelPageFillReplyKind.FillFailed,
    })
    expect(fixture.clears).toHaveLength(1)
    expect(fixture.value('#user')).toBe('')
    expect(fixture.value('#pass')).toBe('')
    expect(fixture.fills[0]?.credentials).toEqual({
      username: '',
      password: '',
    })
  })

  test('a session change during the reveal withdraws the Fill before any write', async () => {
    const fixture = new SidePanelPageFixture(PageMarkup.Login)
    const receiver = new SidePanelLoginFillReceiver(fixture.action())
    fixture.beforeReveal = () => receiver.withdraw()

    const answer = await fixture.receive(
      PageData.trigger(),
      PageData.ownSender,
      receiver,
    )

    expect(answer.reply).toEqual({
      kind: SidePanelPageFillReplyKind.FillFailed,
    })
    expect(fixture.fills).toEqual([])
    expect(fixture.value('#pass')).toBe('')
    const revealed = fixture.revealed
    expect(
      revealed.kind === LoginFillDeliveryKind.Delivered && revealed.response,
    ).toEqual({
      ok: true,
      username: '',
      password: '',
    })
  })

  test('a Pilot fill that starts during the reveal is never overwritten', async () => {
    const fixture = new SidePanelPageFixture(PageMarkup.Login)
    fixture.beforeReveal = () => {
      widgetState.busy = true
    }

    const answer = await fixture.receive(PageData.trigger())

    expect(answer.reply).toEqual({
      kind: SidePanelPageFillReplyKind.FillFailed,
    })
    expect(fixture.fills).toEqual([])
    expect(fixture.revalidations).toHaveLength(1)
    expect(fixture.value('#user')).toBe('')
  })

  test('an unexpected defect still answers fill-failed and restores Pilot', async () => {
    const fixture = new SidePanelPageFixture(PageMarkup.Login)
    fixture.verdicts = [
      RevalidatedAuthenticationActionOutcomeKind.Acted,
      RevalidatedAuthenticationActionOutcomeKind.Rejected,
    ]
    fixture.clearing = () => {
      throw new Error('field clearing defect')
    }

    const answer = await fixture.receive(PageData.trigger())

    expect(answer.reply).toEqual({
      kind: SidePanelPageFillReplyKind.FillFailed,
    })
    expect(widgetState.credentialActuation).toBe(WidgetCredentialActuation.Idle)
    expect(fixture.fills[0]?.credentials).toEqual({
      username: '',
      password: '',
    })
  })
})
