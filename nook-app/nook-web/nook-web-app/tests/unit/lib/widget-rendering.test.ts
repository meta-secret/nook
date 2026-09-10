/// <reference types="chrome" />

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AuthenticationWorkflowAction } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

const actions = vi.hoisted(() => ({
  cancelLoginPicker: vi.fn(),
  continueWithNook: vi.fn(),
  enrollmentCopy: vi.fn(),
  proposePasskeyWithNook: vi.fn(),
  revalidateEnrollment: vi.fn(),
  startQrEnrollment: vi.fn(),
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
}))

type MountTestWidgetShellArgs = {
  shell: { host: HTMLElement }
}
type RevalidatedEnrollmentRequest = { start: () => void }

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
      qr: false,
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
  widgetState: renderState.widgetState,
}))

vi.mock(
  '../../../../nook-web-extension/src/content/autofill/widget-shell',
  () => ({
    authenticationWidgetShell: {
      buildEnrollmentFlowHost: () => ({ isBusy: () => false }),
      enrollmentCopy: actions.enrollmentCopy,
      createWidgetShell: () => {
        const host = document.createElement('aside')
        host.id = 'widget-host'
        const body = document.createElement('div')
        const continueButton = document.createElement('button')
        continueButton.dataset.primary = 'true'
        const openVaultButton = document.createElement('button')
        body.append(continueButton, openVaultButton)
        host.append(body)
        return {
          host,
          body,
          step: document.createElement('p'),
          title: document.createElement('h1'),
          description: document.createElement('p'),
          continueButton,
          openVaultButton,
        }
      },
      mountWidgetShell: ({ shell }: MountTestWidgetShellArgs) =>
        document.body.append(shell.host),
    },
  }),
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
    },
  }),
)

import { authenticationWidgetRenderer } from '../../../../nook-web-extension/src/content/autofill/widget-rendering'

const workflow = {
  root: document,
  formScope: { kind: 'unowned' },
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
} as Parameters<typeof authenticationWidgetRenderer.renderWidget>[0]['workflow']

const snapshot = {
  kind: 0,
  stage: 0,
  action: AuthenticationWorkflowAction.UsePasskey,
  currentStep: 1,
  totalSteps: 3,
  approvalRequirement: 'explicit-user-approval',
  savedLoginCapability: 'fill-saved-login',
  observationIndex: 0,
} as Parameters<typeof authenticationWidgetRenderer.renderWidget>[0]['snapshot']

type RenderPasskeyWidgetArgs = {
  loginMatches: Parameters<
    typeof authenticationWidgetRenderer.renderWidget
  >[0]['loginMatches']
}

function renderPasskeyWidget({ loginMatches }: RenderPasskeyWidgetArgs): void {
  const args = {
    snapshot,
    workflow,
    facts: {},
    loginMatches,
    vaultConnection: { connected: true, vaultName: 'Personal' },
  } as Parameters<typeof authenticationWidgetRenderer.renderWidget>[0]
  authenticationWidgetRenderer.renderWidget(args)
}

function savedLoginButton(): HTMLButtonElement | false {
  return ((v) => (v ? v : false))(
    Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'widgetContinue',
    ),
  )
}

beforeEach(() => {
  document.body.replaceChildren()
  vi.clearAllMocks()
  actions.events.length = 0
  renderState.pickerState.login = { kind: 'closed' }
  renderState.pickerState.authenticator = { kind: 'closed' }
})

describe('passkey workflow saved-login fallback', () => {
  test('renders and invokes saved login for ready matches', () => {
    renderPasskeyWidget({ loginMatches: { kind: 'ready', count: 2 } })

    const savedLogin = savedLoginButton()
    if (savedLogin) savedLogin.click()

    expect(savedLoginButton()).not.toBe(false)
    expect(actions.continueWithNook).toHaveBeenCalledOnce()
  })

  test('renders saved login for a locked vault', () => {
    renderPasskeyWidget({ loginMatches: { kind: 'locked' } })
    const savedLogin = savedLoginButton()
    if (savedLogin) savedLogin.click()

    expect(savedLoginButton()).not.toBe(false)
    expect(actions.continueWithNook).toHaveBeenCalledOnce()
  })

  test('omits saved login for empty and unavailable matches', () => {
    const unavailableMatches: Array<
      Parameters<
        typeof authenticationWidgetRenderer.renderWidget
      >[0]['loginMatches']
    > = [{ kind: 'ready', count: 0 }, { kind: 'unavailable' }]
    for (const loginMatches of unavailableMatches) {
      document.body.replaceChildren()
      renderPasskeyWidget({ loginMatches })
      expect(savedLoginButton()).toBe(false)
    }
  })

  test('cancels a pending login picker before primary passkey activation', () => {
    renderState.pickerState.login = {
      kind: 'open',
      request: { approval: {} },
    }
    renderPasskeyWidget({ loginMatches: { kind: 'ready', count: 2 } })
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
  test('renders and dispatches the Rust-selected enrollment action', () => {
    const enrollmentSnapshot = {
      ...snapshot,
      action: AuthenticationWorkflowAction.EnrollAuthenticator,
    }
    const args = {
      snapshot: enrollmentSnapshot,
      workflow,
      facts: {},
      loginMatches: { kind: 'unavailable' },
      vaultConnection: { connected: true, vaultName: 'Personal' },
    } as Parameters<typeof authenticationWidgetRenderer.renderWidget>[0]

    authenticationWidgetRenderer.renderWidget(args)
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
