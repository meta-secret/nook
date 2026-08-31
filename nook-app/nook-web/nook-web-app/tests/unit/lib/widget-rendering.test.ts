import '../../../../nook-web-extension/src/chrome.d.ts'

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AuthenticationWorkflowAction } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type { WidgetWorkflowKeyKind } from '../../../../nook-web-extension/src/content/autofill/state'

type TestPresentationScope =
  | { kind: `${WidgetWorkflowKeyKind.Unassigned}` }
  | { kind: `${WidgetWorkflowKeyKind.Assigned}`; key: string }

const actions = vi.hoisted(() => ({
  cancelLoginPicker: vi.fn(),
  continueWithNook: vi.fn(),
  enrollmentCopy: vi.fn(),
  proposePasskeyWithNook: vi.fn(),
  revalidateEnrollment: vi.fn(),
  remountWidget: vi.fn(),
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
  },
  widgetState: {
    dismissed: false,
    host: { kind: 'detached' },
    workflowKey: { kind: 'unassigned' } as TestPresentationScope,
    renderedWorkflowRoot: { kind: 'unassigned' },
    presentationScope: { kind: 'unassigned' } as TestPresentationScope,
    collapsed: false,
    userSelectedCollapse: false,
    applyAutomaticCollapse(value: boolean) {
      if (!this.userSelectedCollapse) this.collapsed = value
    },
    assignPresentationScope(value: string) {
      this.presentationScope = { kind: 'assigned', key: value }
    },
    beginEnrollmentWorkflow(value: string) {
      if (
        this.presentationScope.kind !== 'assigned' ||
        this.presentationScope.key !== value
      ) {
        this.collapsed = false
        this.userSelectedCollapse = false
      }
      this.assignPresentationScope(value)
    },
    setRenderedWorkflowRoot: vi.fn(),
  },
}))

type MountTestWidgetShellArgs = {
  shell: { host: HTMLElement }
  workflowKey: string
}
type RevalidatedEnrollmentRequest = { start: () => void }
type AuthWidgetTestInput = { loginMatches: { kind: string } }

vi.mock('../../../../nook-web-extension/src/lib/auth-widget-policy', () => ({
  authWidgetStartsCollapsed: ({ loginMatches }: AuthWidgetTestInput) =>
    loginMatches.kind !== 'ready',
  isTrustedAuthAction: () => true,
}))

vi.mock(
  '../../../../nook-web-extension/src/lib/auth-workflow-messages',
  () => ({ authenticationWorkflowApprovalsMatch: () => true }),
)

vi.mock('../../../../nook-web-extension/src/content/enrollment-flow', () => ({
  detectEnrollmentHints: () => ({ qr: false, backupCodes: false }),
  renderEnrollmentActions: vi.fn(),
  startQrEnrollment: () => actions.startQrEnrollment(),
}))

vi.mock(
  '../../../../nook-web-extension/src/content/autofill/backup-code-workflow-action',
  () => ({
    startRevalidatedEnrollmentAction: async (
      request: RevalidatedEnrollmentRequest,
    ) => {
      actions.revalidateEnrollment(request)
      request.start()
      return true
    },
  }),
)

vi.mock(
  '../../../../nook-web-extension/src/content/autofill/authenticator-actions',
  () => ({
    cancelPendingAuthenticatorPickerRequest: vi.fn(),
    continueWithAuthenticator: vi.fn(),
  }),
)

vi.mock(
  '../../../../nook-web-extension/src/content/autofill/login-passkey-actions',
  () => ({
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
  }),
)

vi.mock('../../../../nook-web-extension/src/content/autofill/state', () => ({
  AuthenticatorPickerKind: { Closed: 'closed', Open: 'open' },
  LoginPickerKind: { Closed: 'closed', Open: 'open' },
  WidgetHostKind: { Detached: 'detached', Attached: 'attached' },
  WidgetWorkflowKeyKind: {
    Unassigned: 'unassigned',
    Assigned: 'assigned',
  },
  WidgetWorkflowRootKind: {
    Unassigned: 'unassigned',
    Assigned: 'assigned',
  },
  pickerState: renderState.pickerState,
  scanState: { schedule: vi.fn() },
  widgetState: renderState.widgetState,
}))

vi.mock(
  '../../../../nook-web-extension/src/content/autofill/widget-shell',
  () => ({
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
    mountWidgetShell: ({ shell, workflowKey }: MountTestWidgetShellArgs) => {
      renderState.widgetState.host = { kind: 'attached' }
      renderState.widgetState.workflowKey = {
        kind: 'assigned',
        key: workflowKey,
      }
      document.body.append(shell.host)
    },
  }),
)

vi.mock(
  '../../../../nook-web-extension/src/content/autofill/workflow-ui',
  () => ({
    remountWidget: actions.remountWidget,
    removeWidget: vi.fn(),
    translatedMessage: (key: string) => key,
    workflowCopy: () => ({
      titleKey: 'widgetLoginTitle',
      descriptionKey: 'widgetLoginDescription',
    }),
  }),
)

import {
  renderEnrollmentWidget,
  renderWidget,
} from '../../../../nook-web-extension/src/content/autofill/widget-rendering'

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
} as Parameters<typeof renderWidget>[0]['workflow']

const snapshot = {
  kind: 0,
  stage: 0,
  action: AuthenticationWorkflowAction.UsePasskey,
  currentStep: 1,
  totalSteps: 3,
  approvalRequirement: 'explicit-user-approval',
  savedLoginCapability: 'fill-saved-login',
  observationIndex: 0,
} as Parameters<typeof renderWidget>[0]['snapshot']

type RenderPasskeyWidgetArgs = {
  loginMatches: Parameters<typeof renderWidget>[0]['loginMatches']
}

function renderPasskeyWidget({ loginMatches }: RenderPasskeyWidgetArgs): void {
  const args = {
    snapshot,
    workflow,
    facts: {},
    loginMatches,
    vaultConnection: { connected: true, vaultName: 'Personal' },
  } as Parameters<typeof renderWidget>[0]
  renderWidget(args)
}

function savedLoginButton(): HTMLButtonElement | false {
  return (
    Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'widgetFillLogin',
    ) ?? false
  )
}

beforeEach(() => {
  document.body.replaceChildren()
  vi.clearAllMocks()
  actions.events.length = 0
  renderState.pickerState.login = { kind: 'closed' }
  renderState.pickerState.authenticator = { kind: 'closed' }
  renderState.widgetState.host = { kind: 'detached' }
  renderState.widgetState.presentationScope = { kind: 'unassigned' }
  renderState.widgetState.collapsed = false
  renderState.widgetState.userSelectedCollapse = false
})

test('preserves enrollment collapse only within one presentation', () => {
  const enrollmentSnapshot = {
    ...snapshot,
    action: AuthenticationWorkflowAction.EnrollAuthenticator,
  }
  const hints = { qr: true, backupCodes: false }
  renderEnrollmentWidget({
    hints,
    snapshot: enrollmentSnapshot,
    vaultConnection: { connected: false },
  })
  renderState.widgetState.collapsed = true
  renderState.widgetState.userSelectedCollapse = true

  renderEnrollmentWidget({
    hints,
    snapshot: enrollmentSnapshot,
    vaultConnection: { connected: true, vaultName: 'Personal' },
  })
  expect(actions.remountWidget).toHaveBeenCalledOnce()
  expect(renderState.widgetState.collapsed).toBe(true)

  renderEnrollmentWidget({
    hints,
    snapshot: { ...enrollmentSnapshot, currentStep: 2 },
    vaultConnection: { connected: true, vaultName: 'Personal' },
  })
  expect(renderState.widgetState.collapsed).toBe(false)
})

describe('passkey workflow saved-login fallback', () => {
  test('keeps saved-login markup indistinguishable across availability', () => {
    const availabilityStates: Array<
      Parameters<typeof renderWidget>[0]['loginMatches']
    > = [
      { kind: 'ready', count: 2 },
      { kind: 'ready', count: 0 },
      { kind: 'locked' },
      { kind: 'unavailable' },
    ]
    for (const loginMatches of availabilityStates) {
      document.body.replaceChildren()
      renderPasskeyWidget({ loginMatches })
      expect(savedLoginButton()).not.toBe(false)
    }
  })

  test('preserves an explicit collapse choice across availability remounts', () => {
    renderPasskeyWidget({ loginMatches: { kind: 'locked' } })
    renderState.widgetState.host = { kind: 'attached' }
    renderState.widgetState.collapsed = true
    renderState.widgetState.userSelectedCollapse = true

    renderPasskeyWidget({ loginMatches: { kind: 'ready', count: 1 } })

    expect(actions.remountWidget).toHaveBeenCalledOnce()
    expect(renderState.widgetState.collapsed).toBe(true)
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
    } as Parameters<typeof renderWidget>[0]

    renderWidget(args)
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
