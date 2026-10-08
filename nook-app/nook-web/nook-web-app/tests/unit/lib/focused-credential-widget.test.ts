import { afterEach, describe, expect, test, vi } from 'vitest'
import { PilotVaultConnectionKind } from '../../../../nook-web-extension/src/content/autofill/widget-presentation-state'
import {
  BROWSER_MESSAGE_KEYS,
  type BrowserMessageKey,
} from '../../../../nook-web-extension/src/lib/browser-message-keys'

const shellFixture = vi.hoisted(() => ({ mount: vi.fn(), trusted: true }))
vi.mock('../../../../nook-web-extension/src/lib/auth-widget-policy', () => ({
  AuthenticationGesture: class {
    get trusted() {
      return shellFixture.trusted
    }
  },
}))
vi.mock(
  '../../../../nook-web-extension/src/content/autofill/widget-shell',
  () => ({
    authenticationWidgetShell: {
      createWidgetShell: () => ({
        host: document.createElement('aside'),
        continueButton: document.createElement('button'),
      }),
      mountWidgetShell: shellFixture.mount,
    },
  }),
)
vi.mock(
  '../../../../nook-web-extension/src/content/autofill/workflow-ui',
  () => ({
    workflowUi: {
      translatedMessage: (key: BrowserMessageKey) => `localized:${key}`,
    },
    WorkflowCopy: {
      forKind: () => ({
        titleKey: 'login-title',
        descriptionKey: 'login-description',
      }),
    },
  }),
)

import { FocusedCredentialWidget } from '../../../../nook-web-extension/src/content/autofill/focused-credential-widget'

afterEach(() => {
  vi.clearAllMocks()
  shellFixture.trusted = true
})

describe('focused credential widget surface', () => {
  test('uses the existing widget shell and requires an explicit chooser click', () => {
    const choose = vi.fn<() => void>()
    const request: Parameters<typeof FocusedCredentialWidget.mount>[0] = {
      vaultConnection: { kind: PilotVaultConnectionKind.Connected },
      choose,
    }
    const widget = FocusedCredentialWidget.mount(request)
    expect(shellFixture.mount).toHaveBeenCalledOnce()
    expect(widget.shell.host.getAttribute('data-nook-credential-mode')).toBe(
      'focused',
    )
    expect(choose).not.toHaveBeenCalled()
    const label = `localized:${BROWSER_MESSAGE_KEYS.WidgetContinue}`
    expect(widget.shell.continueButton.textContent).toBe(label)
    expect(widget.shell.continueButton.getAttribute('aria-label')).toBe(label)
    widget.shell.continueButton.click()
    expect(choose).toHaveBeenCalledOnce()
  })
  test('rejects a synthetic chooser gesture', () => {
    shellFixture.trusted = false
    const choose = vi.fn<() => void>()
    const request: Parameters<typeof FocusedCredentialWidget.mount>[0] = {
      vaultConnection: { kind: PilotVaultConnectionKind.Connected },
      choose,
    }
    FocusedCredentialWidget.mount(request).shell.continueButton.click()
    expect(choose).not.toHaveBeenCalled()
  })
})
