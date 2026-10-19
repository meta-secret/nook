import { describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import {
  type CompanionWasmRuntimeMessage,
  type CompanionWasmSessionResponse,
} from '../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import {
  AuthenticationWorkflowAction,
  AuthenticationWorkflowKind,
  AuthenticationWorkflowStage,
  SitePageNeed,
  type AuthenticationWorkflowSnapshot,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  authenticationPasskeyEvidenceIsSafe,
  authenticationWorkflowMessageResponse,
  authenticationWorkflowPilotPresentationCapability,
  authenticationWorkflowRequiresLoginMatchAvailability,
  authenticationWorkflowSavedLoginCapability,
  type AuthenticationWorkflowRoutingDependencies,
  type AuthenticationWorkflowRoutingResponse,
} from '../src/background/service-worker/authentication-workflow-routing'
import { MatchingPasskeyAvailabilityKind } from '../src/background/service-worker/passkey-availability'
import {
  AuthenticationWorkflowSnapshotKind,
  backgroundVaultRuntime,
} from '../src/background/vault-runtime'
import {
  SidePanelLoginWorkflowDiscovery,
  SidePanelLoginWorkflowKind,
} from '../src/content/autofill/side-panel-login-workflow'
import {
  AuthenticationWorkflowSnapshotMessageType,
  type AuthenticationWorkflowSnapshotMessage,
} from '../src/lib/auth-workflow-messages'
import { PasswordFormScopeKind } from '../../nook-web-shared/src/extension/password-forms'
import {
  SidePanelPageNeedMessageType,
  SidePanelPageNeedReplyKind,
  type SidePanelPageNeedReply,
} from '../src/lib/side-panel-page-need'
import {
  CompanionSidePanelPageNeed,
  SidePanelPageNeedReception,
  SidePanelPageNeedReceiver,
  type SidePanelPageNeedCollaborators,
} from '../src/content/autofill/side-panel-page-need'
import { SidePanelPageWorkflowDiscovery } from '../src/content/autofill/side-panel-page-workflow'
import { handleCompanionWasmMessage } from '../src/offscreen/session-companion-wasm-operations'

await companionWasmReady

type PageRuntimeMessage =
  CompanionWasmRuntimeMessage | AuthenticationWorkflowSnapshotMessage
type PageRuntimeResponse =
  | AuthenticationWorkflowRoutingResponse
  | { readonly ok: true; readonly result: CompanionWasmSessionResponse }
  | { readonly ok: false }
type PageRuntimeCallback = (response: PageRuntimeResponse) => void
type WorkflowClassification = Awaited<
  ReturnType<
    AuthenticationWorkflowRoutingDependencies['authenticationWorkflowSnapshot']
  >
>
type WorkflowClassifier =
  AuthenticationWorkflowRoutingDependencies['authenticationWorkflowSnapshot']

type SnapshotAnswer = {
  readonly response: PageRuntimeResponse
  readonly callback: PageRuntimeCallback
}

enum SnapshotTransport {
  Delivered = 'delivered',
  Unavailable = 'unavailable',
}

/**
 * A top document whose runtime reaches the real companion WASM handlers and
 * the real service-worker workflow route. Rust classifies the observed forms
 * unless a scenario substitutes the classifier's snapshot.
 */
class ContentPageHarness {
  readonly browser = new Window({ url: 'https://login.example.test/login' })
  readonly snapshotRequests: AuthenticationWorkflowSnapshotMessage[] = []
  classifier: WorkflowClassifier =
    backgroundVaultRuntime.authenticationWorkflowSnapshot.bind(
      backgroundVaultRuntime,
    )
  transport = SnapshotTransport.Delivered
  private readonly runtime = {
    id: 'nook-extension',
    lastError: false,
    getURL: (path: string) => `chrome-extension://nook-extension/${path}`,
    sendMessage: (
      message: PageRuntimeMessage,
      callback: PageRuntimeCallback,
    ) => {
      this.route(message, callback)
    },
  }

  constructor(markup: string) {
    const browser = this.browser
    Object.assign(globalThis, {
      window: browser,
      document: browser.document,
      location: browser.location,
      Element: browser.Element,
      Node: browser.Node,
      HTMLElement: browser.HTMLElement,
      HTMLInputElement: browser.HTMLInputElement,
      HTMLFormElement: browser.HTMLFormElement,
      HTMLButtonElement: browser.HTMLButtonElement,
      MutationObserver: browser.MutationObserver,
      NodeFilter: browser.NodeFilter,
      getComputedStyle: browser.getComputedStyle.bind(browser),
      chrome: { runtime: this.runtime },
    })
    const parsed = new browser.DOMParser().parseFromString(markup, 'text/html')
    browser.document.body.append(...parsed.body.childNodes)
  }

  substitute(snapshot: AuthenticationWorkflowSnapshot): this {
    const classification: WorkflowClassification = {
      kind: AuthenticationWorkflowSnapshotKind.Matched,
      snapshot,
    }
    this.classifier = async () => classification
    return this
  }

  discover() {
    return new SidePanelLoginWorkflowDiscovery().loginWorkflow()
  }

  /** Sends the worker's page-need query to this top document. */
  async need(
    origin = 'https://login.example.test',
    sender: chrome.runtime.MessageSender = { id: 'nook-extension' },
  ) {
    const collaborators: SidePanelPageNeedCollaborators = {
      pages: new SidePanelPageWorkflowDiscovery(),
      needs: new CompanionSidePanelPageNeed(),
    }
    const receiver = new SidePanelPageNeedReceiver(collaborators)
    const replies = Promise.withResolvers<SidePanelPageNeedReply>()
    const reception = receiver.receive({
      message: {
        type: SidePanelPageNeedMessageType.Query,
        payload: { origin },
      },
      sender,
      sendResponse: replies.resolve,
    })
    switch (reception) {
      case SidePanelPageNeedReception.Ignored:
        return { reception }
      case SidePanelPageNeedReception.Responding:
        return { reception, reply: await replies.promise }
    }
  }

  private route(message: PageRuntimeMessage, callback: PageRuntimeCallback) {
    switch (true) {
      case message.type ===
        AuthenticationWorkflowSnapshotMessageType.NookAuthenticationWorkflowSnapshot:
        this.snapshotRequests.push(message)
        void this.snapshot(message).then((response) =>
          this.answer({ response, callback }),
        )
        return
      case message.type !==
        AuthenticationWorkflowSnapshotMessageType.NookAuthenticationWorkflowSnapshot:
        void handleCompanionWasmMessage(message).then((result) =>
          result.match(
            (value) => callback({ ok: true, result: value }),
            () => callback({ ok: false }),
          ),
        )
        return
      case true:
      default:
        throw new Error('unexpected page runtime message')
    }
  }

  private async snapshot(
    message: AuthenticationWorkflowSnapshotMessage,
  ): Promise<PageRuntimeResponse> {
    const dependencies: AuthenticationWorkflowRoutingDependencies = {
      companionWasmReady,
      authenticationPasskeyEvidenceIsSafe,
      authenticationWorkflowSnapshot: this.classifier,
      authenticationWorkflowSavedLoginCapability,
      authenticationWorkflowRequiresLoginMatchAvailability,
      authenticationWorkflowPilotPresentationCapability,
      matchingPasskeyAvailabilityForOriginSafe: async () => ({
        kind: MatchingPasskeyAvailabilityKind.Unavailable,
      }),
      websiteLoginMatchAvailability: async () => ({ kind: 'ready', count: 1 }),
    }
    const response = await authenticationWorkflowMessageResponse({
      message,
      sender: { id: 'nook-extension', url: 'https://login.example.test/login' },
      dependencies,
    })
    return response
  }

  /** Chrome reports a missing receiver through lastError during the callback. */
  private answer({ response, callback }: SnapshotAnswer): void {
    switch (this.transport) {
      case SnapshotTransport.Delivered:
        callback(response)
        return
      case SnapshotTransport.Unavailable:
        this.runtime.lastError = true
        callback(response)
        this.runtime.lastError = false
    }
  }
}

const loginForm =
  '<form method="post" action="/session"><label for="u">Email</label><input id="u" type="email" name="email" autocomplete="username"><label for="p">Password</label><input id="p" type="password" name="password" autocomplete="current-password"><button type="submit">Sign in</button></form>'
// Stripe: no form action and an in-form type="button" Sign in that stays
// aria-disabled until the email and password are typed.
const buttonSignInForm =
  '<form novalidate><label for="email">Email</label><input id="email" type="email" name="email" autocomplete="username email" required><label for="old-password">Password</label><input id="old-password" type="password" name="password" autocomplete="current-password"><a href="/reset">Forgot your password?</a><label for="remember">Remember me on this device</label><input id="remember" type="checkbox" checked><button type="button" aria-disabled="true">Sign in</button><a id="toggle_passkey_mode" role="button">Passkey</a><a id="toggle_sso_mode" role="button">SSO</a></form>'
const googleIdentifier =
  '<main><h1>Sign in</h1><p>Use your Google Account</p><label for="identifierId">Email or phone</label><input id="identifierId" name="identifier" autocomplete="username webauthn" aria-label="Email or phone"><input name="hiddenPassword" type="password" tabindex="-1" aria-hidden="true" hidden><button type="button">Create account</button><button id="identifierNext" type="button">Next</button></main>'
const emailFirst =
  '<main><h1>Sign in</h1><form method="post" action="/login"><label for="e">Email</label><input id="e" type="email" name="loginfmt" autocomplete="username"><button type="submit">Next</button></form></main>'
const signupForm =
  '<form method="post" action="/signup"><label for="u">Email</label><input id="u" type="email" name="email" autocomplete="username"><label for="p">Create password</label><input id="p" type="password" autocomplete="new-password"><label for="c">Confirm password</label><input id="c" type="password" autocomplete="new-password"><button type="submit">Create account</button></form>'
const passwordChangeForm =
  '<form method="post" action="/password"><label for="o">Current password</label><input id="o" type="password" autocomplete="current-password"><label for="n">New password</label><input id="n" type="password" autocomplete="new-password"><label for="c">Confirm new password</label><input id="c" type="password" autocomplete="new-password"><button type="submit">Change password</button></form>'

class WorkflowSnapshots {
  static totpChallenge(): AuthenticationWorkflowSnapshot {
    return {
      kind: AuthenticationWorkflowKind.TotpChallenge,
      stage: AuthenticationWorkflowStage.SecondFactor,
      action: AuthenticationWorkflowAction.FillTotp,
      currentStep: 2,
      totalSteps: 3,
      approvalRequirement: 'explicit-user-approval',
      savedLoginCapability: 'unavailable',
      observationIndex: 0,
    }
  }

  static manual(): AuthenticationWorkflowSnapshot {
    return {
      kind: AuthenticationWorkflowKind.Manual,
      stage: AuthenticationWorkflowStage.Manual,
      action: AuthenticationWorkflowAction.TakeOver,
      currentStep: 1,
      totalSteps: 1,
      approvalRequirement: 'takeover-required',
      savedLoginCapability: 'unavailable',
      observationIndex: 0,
    }
  }

  /** A Login passkey step: a Login workflow Rust gives no saved-login fill. */
  static loginPasskey(): AuthenticationWorkflowSnapshot {
    return {
      kind: AuthenticationWorkflowKind.Login,
      stage: AuthenticationWorkflowStage.Credentials,
      action: AuthenticationWorkflowAction.UsePasskey,
      currentStep: 1,
      totalSteps: 3,
      approvalRequirement: 'explicit-user-approval',
      savedLoginCapability: 'unavailable',
      observationIndex: 0,
    }
  }

  /** A Login tuple whose saved-login field breaks the classifier contract. */
  static loginWithoutSavedLoginCapability(): AuthenticationWorkflowSnapshot {
    return {
      kind: AuthenticationWorkflowKind.Login,
      stage: AuthenticationWorkflowStage.Credentials,
      action: AuthenticationWorkflowAction.ContinueWithNook,
      currentStep: 1,
      totalSteps: 3,
      approvalRequirement: 'explicit-user-approval',
      savedLoginCapability: 'unavailable',
      observationIndex: 0,
    }
  }
}

describe('side-panel Login workflow discovery (real Rust classification)', () => {
  test('a password login form is fillable', async () => {
    const page = new ContentPageHarness(loginForm)
    const discovered = await page.discover()
    expect(discovered.kind).toBe(SidePanelLoginWorkflowKind.Found)
    if (discovered.kind !== SidePanelLoginWorkflowKind.Found) return
    const scope = discovered.workflow.formScope
    expect(scope.kind).toBe(PasswordFormScopeKind.Owned)
    if (scope.kind !== PasswordFormScopeKind.Owned) return
    expect(scope.owner.getAttribute('action')).toBe('/session')
  })

  test('a login form whose Sign in is a disabled in-form button is fillable', async () => {
    for (const markup of [
      buttonSignInForm,
      buttonSignInForm.replace(' aria-disabled="true"', ''),
    ]) {
      const page = new ContentPageHarness(markup)
      expect((await page.discover()).kind).toBe(
        SidePanelLoginWorkflowKind.Found,
      )
    }
  })

  test('username-only login steps are fillable', async () => {
    for (const markup of [googleIdentifier, emailFirst]) {
      const page = new ContentPageHarness(markup)
      expect((await page.discover()).kind).toBe(
        SidePanelLoginWorkflowKind.Found,
      )
    }
  })

  test('signup and password-change workflows are not fillable', async () => {
    for (const markup of [signupForm, passwordChangeForm]) {
      const page = new ContentPageHarness(markup)
      expect((await page.discover()).kind).toBe(
        SidePanelLoginWorkflowKind.Absent,
      )
      expect(page.snapshotRequests).toHaveLength(1)
    }
  })

  test('a page without authentication forms is not fillable and asks nothing', async () => {
    const page = new ContentPageHarness('<main><p>Welcome back</p></main>')
    expect((await page.discover()).kind).toBe(SidePanelLoginWorkflowKind.Absent)
    expect(page.snapshotRequests).toEqual([])
  })
})

describe('side-panel Login workflow discovery (substituted classifier snapshots)', () => {
  test('TOTP and manual workflows are not fillable', async () => {
    for (const snapshot of [
      WorkflowSnapshots.totpChallenge(),
      WorkflowSnapshots.manual(),
    ]) {
      const page = new ContentPageHarness(loginForm).substitute(snapshot)
      expect((await page.discover()).kind).toBe(
        SidePanelLoginWorkflowKind.Absent,
      )
    }
  })

  test("Rust's saved-login decision, not the workflow kind, makes a form fillable", async () => {
    const page = new ContentPageHarness(loginForm).substitute(
      WorkflowSnapshots.loginPasskey(),
    )
    expect((await page.discover()).kind).toBe(SidePanelLoginWorkflowKind.Absent)
    expect(page.snapshotRequests).toHaveLength(1)
  })

  test('a snapshot that contradicts the saved-login contract is rejected, never filled', async () => {
    const page = new ContentPageHarness(loginForm).substitute(
      WorkflowSnapshots.loginWithoutSavedLoginCapability(),
    )
    expect((await page.discover()).kind).toBe(
      SidePanelLoginWorkflowKind.Unavailable,
    )
  })

  test('no Rust match is not fillable', async () => {
    const page = new ContentPageHarness(loginForm)
    const noMatch: WorkflowClassification = {
      kind: AuthenticationWorkflowSnapshotKind.NoMatch,
    }
    page.classifier = async () => noMatch
    expect((await page.discover()).kind).toBe(SidePanelLoginWorkflowKind.Absent)

    const rejected = new ContentPageHarness(loginForm)
    rejected.classifier = async () => {
      throw new Error('authentication workflow observations were rejected')
    }
    expect((await rejected.discover()).kind).toBe(
      SidePanelLoginWorkflowKind.Absent,
    )
  })

  test('an unavailable snapshot transport is a failure, not a missing form', async () => {
    const page = new ContentPageHarness(loginForm)
    page.transport = SnapshotTransport.Unavailable
    expect((await page.discover()).kind).toBe(
      SidePanelLoginWorkflowKind.Unavailable,
    )
  })
})

const totpForm =
  '<form method="post" action="/twofa/totp/"><label for="otp">Authentication code</label><input id="otp" name="otp" autocomplete="one-time-code" inputmode="numeric" maxlength="6"><button type="submit">Verify</button></form>'

describe('side-panel page need (real Rust classification)', () => {
  test("answers Rust's page need for the workflow it classifies in the top document", async () => {
    const cases: Array<[string, SitePageNeed]> = [
      [loginForm, SitePageNeed.Credentials],
      [signupForm, SitePageNeed.Credentials],
      [totpForm, SitePageNeed.OneTimeCode],
    ]
    for (const [markup, need] of cases) {
      const page = new ContentPageHarness(markup)
      expect(await page.need()).toEqual({
        reception: SidePanelPageNeedReception.Responding,
        reply: { kind: SidePanelPageNeedReplyKind.Needed, need },
      })
      expect(page.snapshotRequests).toHaveLength(1)
    }
  })

  test('a page without authentication forms needs any site secret and classifies nothing', async () => {
    const page = new ContentPageHarness('<main><p>Welcome back</p></main>')
    expect((await page.need()).reply).toEqual({
      kind: SidePanelPageNeedReplyKind.Needed,
      need: SitePageNeed.AnySiteSecret,
    })
    expect(page.snapshotRequests).toEqual([])
  })

  test('an unavailable snapshot transport is unavailable, not unrecognized', async () => {
    const page = new ContentPageHarness(loginForm)
    page.transport = SnapshotTransport.Unavailable
    expect((await page.need()).reply).toEqual({
      kind: SidePanelPageNeedReplyKind.Unavailable,
    })
  })

  test('another origin answers tab-changed and classifies nothing', async () => {
    const page = new ContentPageHarness(loginForm)
    expect((await page.need('https://other.example.test')).reply).toEqual({
      kind: SidePanelPageNeedReplyKind.TabChanged,
    })
    expect(page.snapshotRequests).toEqual([])
  })

  test('a foreign sender is ignored without an answer', async () => {
    const page = new ContentPageHarness(loginForm)
    expect(
      await page.need('https://login.example.test', { id: 'other-extension' }),
    ).toEqual({ reception: SidePanelPageNeedReception.Ignored })
    expect(page.snapshotRequests).toEqual([])
  })
})
