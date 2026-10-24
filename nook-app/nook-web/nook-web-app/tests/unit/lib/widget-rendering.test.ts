/// <reference types="chrome" />

import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  AuthenticationWorkflowAction,
  classify_authentication_authenticator_setup_batch,
  type AuthenticationAuthenticatorSetupBatch,
  type AuthenticationPageObservationFacts,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import { PasswordFormScopeKind } from '../../../../nook-web-shared/src/extension/password-form-fields'
import { PilotVaultConnectionKind } from '../../../../nook-web-extension/src/content/autofill/widget-presentation-state'
import type { AuthenticationWorkflowSnapshotView } from '../../../../nook-web-extension/src/lib/auth-workflow-messages'

const actions = vi.hoisted(() => ({
  cancelLoginPicker: vi.fn<() => void>(),
  continueWithNook: vi.fn<() => void>(),
  enrollmentCopy: vi.fn(),
  proposePasskeyWithNook: vi.fn<() => void>(),
  revalidateEnrollment:
    vi.fn<(request: RevalidatedEnrollmentRequest) => void>(),
  startQrEnrollment: vi.fn<() => void>(),
  initializeChecklist: vi.fn<() => void>(),
  openSidePanel: vi.fn<() => void>(),
  sendMessage: vi.fn<() => Promise<WidgetOpeningAcknowledgement>>(),
  events: [] as string[],
}))

const renderState = vi.hoisted(() => ({
  pickerState: {
    login: { kind: 'closed' } as {
      kind: string
      request?: { approval: Record<string, never> }
    },
    authenticator: { kind: 'closed' },
    loginApprovalDisposition: () => 'current',
    authenticatorApprovalDisposition: () => 'closed',
  },
  widgetState: {
    dismissed: false,
    host: { kind: 'detached' },
    workflowKey: { kind: 'unassigned' },
    renderedWorkflowRoot: { kind: 'unassigned' },
    setRenderedWorkflowRoot: vi.fn(),
    enrollmentRenderDisposition: () => 'replace',
    workflowRenderDisposition: () => 'replace',
  },
  saveOfferState: {
    clearActiveOffer: vi.fn(),
    confirmationActive: false,
  },
}))

vi.mock(
  '../../../../nook-web-extension/src/content/autofill/widget-workflow-key',
  () => ({
    authenticationWidgetWorkflowKey: vi.fn(() =>
      Promise.resolve('login:credentials'),
    ),
  }),
)

type MountTestWidgetShellArgs = {
  shell: {
    host: HTMLElement
    body: HTMLElement
    toolbar: HTMLElement
    collapsedLaunch: HTMLElement
  }
}
type RevalidatedEnrollmentRequest = { start: () => void }
type WidgetProgressFixture = { currentStep: number; totalSteps: number }
type WidgetChromeFixture = {
  runtime: {
    getURL: (path: string) => string
    sendMessage: typeof actions.sendMessage
  }
}
type WidgetOpeningAcknowledgement = { readonly ok: boolean }
type WidgetCopyFixture = {
  readonly titleKey: string
  readonly descriptionKey: string
}
type WidgetOpenMessageFixture = { readonly type: string }
enum WidgetOpeningFailureFixture {
  Rejected = 'rejected',
  TransportError = 'transport-error',
}
type WidgetMatchFixture = Parameters<
  typeof authenticationWidgetRenderer.renderWidget
>[0]['loginMatches']
class SavedLoginWidgetFixture {
  static readonly failures: ReadonlyArray<WidgetOpeningFailureFixture> = [
    WidgetOpeningFailureFixture.Rejected,
    WidgetOpeningFailureFixture.TransportError,
  ]
  static readonly existingMatches: ReadonlyArray<WidgetMatchFixture> = [
    { kind: 'ready', count: 1 },
    { kind: 'locked' },
    { kind: 'unavailable' },
  ]
}

vi.mock('../../../../nook-web-extension/src/lib/auth-widget-policy', () => ({
  AuthenticationGesture: class AuthenticationGestureFixture {
    get trusted() {
      return true
    }
  },
}))

vi.mock(
  '../../../../nook-web-extension/src/lib/auth-workflow-messages',
  () => ({
    AuthenticationWorkflowApproval: {
      compare: () => 'current',
    },
  }),
)

vi.mock('../../../../nook-web-extension/src/content/enrollment-flow', () => ({
  authenticatorEnrollmentInteraction: {
    detectEnrollmentHints: () => ({
      qr: 'absent',
      backupCodes: false,
    }),
    renderEnrollmentActions: vi.fn(),
    startQrEnrollment: () => actions.startQrEnrollment(),
  },
}))

vi.mock(
  '../../../../nook-web-extension/src/content/autofill/backup-code-workflow-action',
  () => ({
    RevalidatedEnrollmentAction: class {
      constructor(private readonly request: RevalidatedEnrollmentRequest) {}
      async execute() {
        actions.revalidateEnrollment(this.request)
        this.request.start()
        return true
      }
    },
  }),
)

vi.mock(
  '../../../../nook-web-extension/src/content/autofill/authenticator-actions',
  () => ({
    authenticatorInteraction: {
      cancelPendingAuthenticatorPickerRequest: vi.fn(),
      continueWithAuthenticator: vi.fn(),
    },
  }),
)

vi.mock(
  '../../../../nook-web-extension/src/content/autofill/login-passkey-actions',
  () => ({
    loginPasskeyInteraction: {
      cancelPendingLoginPickerRequest: () => {
        actions.events.push('cancel-login-picker')
        actions.cancelLoginPicker()
      },
      continueWithNook: () => actions.continueWithNook(),
      generatePasswordWithNook: vi.fn(),
      proposePasskeyWithNook: () => {
        actions.events.push('propose-passkey')
        actions.proposePasskeyWithNook()
      },
    },
  }),
)

vi.mock('../../../../nook-web-extension/src/content/autofill/state', () => ({
  LoginChecklistMountKind: { Mounted: 'mounted' },
  AuthenticatorPickerKind: { Closed: 'closed', Open: 'open' },
  LoginPickerKind: { Closed: 'closed', Open: 'open' },
  WidgetHostKind: { Detached: 'detached', Attached: 'attached' },
  WidgetRenderDisposition: { Reuse: 'reuse', Replace: 'replace' },
  PendingPickerApprovalDisposition: {
    Closed: 'closed',
    Current: 'current',
    Changed: 'changed',
  },
  WidgetWorkflowKeyKind: {
    Unassigned: 'unassigned',
    Assigned: 'assigned',
  },
  WidgetWorkflowRootKind: {
    Unassigned: 'unassigned',
    Assigned: 'assigned',
  },
  pickerState: renderState.pickerState,
  saveOfferState: renderState.saveOfferState,
  widgetState: renderState.widgetState,
}))

vi.mock(
  '../../../../nook-web-extension/src/content/autofill/widget-shell',
  async (importOriginal) => {
    const { authenticationWidgetShell: shell } =
      await importOriginal<
        typeof import('../../../../nook-web-extension/src/content/autofill/widget-shell')
      >()
    return {
      authenticationWidgetShell: {
        buildEnrollmentFlowHost: () => ({ isBusy: () => false }),
        enrollmentCopy: actions.enrollmentCopy,
        createWidgetShell: shell.createWidgetShell.bind(shell),
        mountWidgetShell: ({ shell }: MountTestWidgetShellArgs) => {
          shell.body
            .querySelector('button')
            ?.setAttribute('data-primary', 'true')
          shell.host.append(shell.toolbar, shell.body, shell.collapsedLaunch)
          document.body.append(shell.host)
        },
      },
    }
  },
)

vi.mock(
  '../../../../nook-web-extension/src/content/autofill/workflow-ui',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../../../../nook-web-extension/src/content/autofill/workflow-ui')
    >()),
    workflowUi: {
      removeWidget: vi.fn(),
      translatedMessage: (key: string) => key,
      progressLabel: ({ currentStep, totalSteps }: WidgetProgressFixture) =>
        `widgetPilotLabel · ${currentStep}/${totalSteps}`,
      vaultConnectionLabel: () => 'vault-status',
    },
  }),
)

vi.mock(
  '../../../../nook-web-extension/src/content/autofill/login-checklist-progress',
  () => ({
    LoginChecklistProgress: class {
      initialize() {
        actions.initializeChecklist()
      }
    },
  }),
)
vi.mock(
  '../../../../nook-web-extension/src/content/autofill/site-side-panel',
  () => ({
    SiteSidePanel: { open: () => actions.openSidePanel() },
  }),
)

import { authenticationWidgetRenderer } from '../../../../nook-web-extension/src/content/autofill/widget-rendering'

const workflow: PasswordFormObservation = {
  root: document,
  formScope: { kind: PasswordFormScopeKind.Unowned },
  summary: {
    passwordFieldCount: 0,
    currentPasswordFieldCount: 0,
    newPasswordFieldCount: 0,
    genericPasswordFieldCount: 0,
    usernameFieldCount: 0,
    oneTimeCodeFieldCount: 0,
    manualCheckpointPresent: false,
    passkeyControlPresent: true,
    formCount: 0,
    observedAt: 0,
  },
}

const snapshot: AuthenticationWorkflowSnapshotView = {
  kind: 0,
  stage: 0,
  action: AuthenticationWorkflowAction.UsePasskey,
  currentStep: 1,
  totalSteps: 3,
  approvalRequirement: 'explicit-user-approval',
  savedLoginCapability: 'fill-saved-login',
  observationIndex: 0,
}

const facts: AuthenticationPageObservationFacts = {
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
    manualCheckpoint: 'absent',
    advanceControl: 'present',
  },
  authenticator: {
    authenticatorSetup: 'absent',
    backupCodesCopy: '',
    passkeyControl: 'absent',
    passkeyAccountAvailability: 'unavailable',
    matchingPasskeyAccountCount: 0,
  },
  credentialSubmission: { kind: 'absent' },
}

type RenderPasskeyWidgetArgs = {
  loginMatches: Parameters<
    typeof authenticationWidgetRenderer.renderWidget
  >[0]['loginMatches']
}

async function renderPasskeyWidget({
  loginMatches,
}: RenderPasskeyWidgetArgs): Promise<void> {
  const args: Parameters<typeof authenticationWidgetRenderer.renderWidget>[0] =
    {
      authenticatorSetupSnapshot,
      snapshot,
      workflow,
      facts,
      factsBindingToken: 'approved-observation',
      loginMatches,
      savedLoginActionAvailable:
        loginMatches.kind === 'locked' ||
        (loginMatches.kind === 'ready' && loginMatches.count > 0),
      vaultConnection: {
        kind: PilotVaultConnectionKind.Connected,
      },
    }
  await authenticationWidgetRenderer.renderWidget(args)
}

function savedLoginButton(): HTMLButtonElement | false {
  return ((v) => (v ? v : false))(
    Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'widgetContinue',
    ),
  )
}

const emptySetupMetadata: AuthenticationAuthenticatorSetupBatch = {
  visibleInstructionCopies: [],
  qrMedia: 'absent',
}
const authenticatorSetupSnapshot = {
  metadataKey: JSON.stringify(emptySetupMetadata),
  observation:
    classify_authentication_authenticator_setup_batch(emptySetupMetadata),
}
beforeEach(() => {
  document.body.replaceChildren()
  vi.clearAllMocks()
  const enrollmentCopy: WidgetCopyFixture = {
    titleKey: 'widgetEnrollTitle',
    descriptionKey: 'widgetEnrollDescription',
  }
  actions.enrollmentCopy.mockReturnValue(enrollmentCopy)
  const opened: WidgetOpeningAcknowledgement = { ok: true }
  actions.sendMessage.mockResolvedValue(opened)
  const chromeFixture: WidgetChromeFixture = {
    runtime: {
      getURL: (path: string) => path,
      sendMessage: actions.sendMessage,
    },
  }
  vi.stubGlobal('chrome', chromeFixture)
  actions.events.length = 0
  renderState.pickerState.login = { kind: 'closed' }
  renderState.pickerState.authenticator = { kind: 'closed' }
})

describe('saved-login empty state', () => {
  test('offers Open Nook without sign-in progress for confirmed zero matches', async () => {
    const args: Parameters<
      typeof authenticationWidgetRenderer.renderWidget
    >[0] = {
      authenticatorSetupSnapshot,
      snapshot: {
        ...snapshot,
        action: AuthenticationWorkflowAction.ContinueWithNook,
      },
      workflow,
      facts,
      factsBindingToken: 'approved-observation',
      loginMatches: { kind: 'ready', count: 0 },
      savedLoginActionAvailable: false,
      vaultConnection: { kind: PilotVaultConnectionKind.Connected },
    }
    await authenticationWidgetRenderer.renderWidget(args)
    expect(document.querySelector('h1')?.textContent).toBe(
      'widgetLoginNoMatchTitle',
    )
    expect(document.querySelector('.description')?.textContent).toBe(
      'widgetLoginNoMatchDescription',
    )
    expect(document.querySelector('.step-label')?.textContent).toBe(
      'widgetPilotLabel',
    )
    expect(document.querySelector('.collapsed-progress')?.textContent).toBe(
      'widgetPilotLabel',
    )
    expect(
      document.querySelector('.collapsed-launch')?.getAttribute('aria-label'),
    ).not.toContain('1/3')
    expect(actions.initializeChecklist).not.toHaveBeenCalled()
    const button = document.querySelector<HTMLButtonElement>('.primary-button')
    expect(button?.textContent).toBe('widgetOpenNook')
    button?.click()
    const openMessage: WidgetOpenMessageFixture = {
      type: 'nook:open-simple-vault',
    }
    await vi.waitFor(() =>
      expect(actions.sendMessage).toHaveBeenCalledWith(openMessage),
    )
    await vi.waitFor(() => expect(button?.disabled).toBe(false))
    expect(actions.continueWithNook).not.toHaveBeenCalled()
  })

  test.each(SavedLoginWidgetFixture.failures)(
    'keeps failed opening visible: %j',
    async (response) => {
      switch (response) {
        case WidgetOpeningFailureFixture.TransportError:
          actions.sendMessage.mockRejectedValue(new Error('closed'))
          break
        case WidgetOpeningFailureFixture.Rejected: {
          const rejected: WidgetOpeningAcknowledgement = { ok: false }
          actions.sendMessage.mockResolvedValue(rejected)
          break
        }
      }
      const args: Parameters<
        typeof authenticationWidgetRenderer.renderWidget
      >[0] = {
        authenticatorSetupSnapshot,
        snapshot: {
          ...snapshot,
          action: AuthenticationWorkflowAction.ContinueWithNook,
        },
        workflow,
        facts,
        factsBindingToken: 'approved-observation',
        loginMatches: { kind: 'ready', count: 0 },
        savedLoginActionAvailable: false,
        vaultConnection: { kind: PilotVaultConnectionKind.Connected },
      }
      await authenticationWidgetRenderer.renderWidget(args)
      const button =
        document.querySelector<HTMLButtonElement>('.primary-button')
      button?.click()
      await vi.waitFor(() =>
        expect(document.querySelector('[role="alert"]')?.textContent).toBe(
          'widgetOpenNookFailed',
        ),
      )
      expect(button?.disabled).toBe(false)
      expect(actions.continueWithNook).not.toHaveBeenCalled()
    },
  )

  test.each(SavedLoginWidgetFixture.existingMatches)(
    'preserves sign-in workflow for %j',
    async (loginMatches) => {
      const args: Parameters<
        typeof authenticationWidgetRenderer.renderWidget
      >[0] = {
        authenticatorSetupSnapshot,
        snapshot: {
          ...snapshot,
          action: AuthenticationWorkflowAction.ContinueWithNook,
        },
        workflow,
        facts,
        factsBindingToken: 'approved-observation',
        loginMatches,
        savedLoginActionAvailable: false,
        vaultConnection: { kind: PilotVaultConnectionKind.Connected },
      }
      await authenticationWidgetRenderer.renderWidget(args)
      switch (loginMatches.kind) {
        case 'locked':
          // A locked vault offers Unlock in place of Sign in, with no checklist.
          expect(document.querySelector('.step-label')?.textContent).toBe(
            'widgetPilotLabel',
          )
          expect(document.querySelector('.primary-button')?.textContent).toBe(
            'widgetUnlock',
          )
          expect(document.querySelector('h1')?.textContent).toBe(
            'widgetUnlockFirstTitle',
          )
          expect(actions.initializeChecklist).not.toHaveBeenCalled()
          break
        case 'ready':
        case 'unavailable':
          expect(document.querySelector('.step-label')?.textContent).toContain(
            '1/3',
          )
          expect(document.querySelector('.primary-button')?.textContent).toBe(
            'widgetContinue',
          )
          expect(actions.initializeChecklist).toHaveBeenCalledOnce()
          break
      }
    },
  )

  test('offers Connect vault instead of Sign in when no vault is connected', async () => {
    const args: Parameters<
      typeof authenticationWidgetRenderer.renderWidget
    >[0] = {
      authenticatorSetupSnapshot,
      snapshot: {
        ...snapshot,
        action: AuthenticationWorkflowAction.ContinueWithNook,
      },
      workflow,
      facts,
      factsBindingToken: 'approved-observation',
      loginMatches: { kind: 'unavailable' },
      savedLoginActionAvailable: true,
      vaultConnection: { kind: PilotVaultConnectionKind.NotConnected },
    }
    await authenticationWidgetRenderer.renderWidget(args)
    expect(document.querySelector('h1')?.textContent).toBe(
      'widgetConnectFirstTitle',
    )
    expect(document.querySelector('.primary-button')?.textContent).toBe(
      'widgetConnectFirstAction',
    )
    expect(savedLoginButton()).toBe(false)
    expect(actions.initializeChecklist).not.toHaveBeenCalled()
    expect(actions.continueWithNook).not.toHaveBeenCalled()
  })
})

describe('passkey workflow saved-login fallback', () => {
  test('renders and invokes saved login for ready matches', async () => {
    await renderPasskeyWidget({ loginMatches: { kind: 'ready', count: 2 } })

    const savedLogin = savedLoginButton()
    if (savedLogin) savedLogin.click()

    expect(savedLoginButton()).not.toBe(false)
    expect(actions.continueWithNook).toHaveBeenCalledOnce()
  })

  test('offers Unlock instead of passkey and saved-login actions for a locked vault', async () => {
    await renderPasskeyWidget({ loginMatches: { kind: 'locked' } })

    expect(savedLoginButton()).toBe(false)
    expect(document.querySelector('.primary-button')?.textContent).toBe(
      'widgetUnlock',
    )
    expect(actions.continueWithNook).not.toHaveBeenCalled()
    expect(actions.proposePasskeyWithNook).not.toHaveBeenCalled()
  })

  test('omits saved login for empty and unavailable matches', async () => {
    const unavailableMatches: Array<
      Parameters<
        typeof authenticationWidgetRenderer.renderWidget
      >[0]['loginMatches']
    > = [{ kind: 'ready', count: 0 }, { kind: 'unavailable' }]
    for (const loginMatches of unavailableMatches) {
      document.body.replaceChildren()
      await renderPasskeyWidget({ loginMatches })
      expect(savedLoginButton()).toBe(false)
    }
  })

  test('cancels a pending login picker before primary passkey activation', async () => {
    renderState.pickerState.login = {
      kind: 'open',
      request: { approval: {} },
    }
    await renderPasskeyWidget({ loginMatches: { kind: 'ready', count: 2 } })
    const primary = document.querySelector<HTMLButtonElement>(
      'button[data-primary="true"]',
    )

    primary?.click()

    expect(actions.events).toEqual(['cancel-login-picker', 'propose-passkey'])
    expect(actions.cancelLoginPicker).toHaveBeenCalledOnce()
    expect(actions.proposePasskeyWithNook).toHaveBeenCalledOnce()
  })
})

describe('authenticator enrollment workflow', () => {
  test('renders and dispatches the Rust-selected enrollment action', async () => {
    const enrollmentSnapshot: AuthenticationWorkflowSnapshotView = {
      ...snapshot,
      action: AuthenticationWorkflowAction.EnrollAuthenticator,
    }
    const args: Parameters<
      typeof authenticationWidgetRenderer.renderWidget
    >[0] = {
      authenticatorSetupSnapshot,
      snapshot: enrollmentSnapshot,
      workflow,
      facts,
      factsBindingToken: 'approved-observation',
      loginMatches: { kind: 'unavailable' },
      savedLoginActionAvailable: false,
      vaultConnection: {
        kind: PilotVaultConnectionKind.Connected,
      },
    }

    await authenticationWidgetRenderer.renderWidget(args)
    const primary = document.querySelector<HTMLButtonElement>(
      'button[data-primary="true"]',
    )
    primary?.click()

    expect(primary?.textContent).toBe('widgetAddFromPage')
    expect(actions.enrollmentCopy).toHaveBeenCalledOnce()
    expect(actions.revalidateEnrollment).toHaveBeenCalledOnce()
    expect(actions.startQrEnrollment).toHaveBeenCalledOnce()
  })
})
