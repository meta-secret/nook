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
        title: document.createElement('h2'),
        description: document.createElement('p'),
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

import {
  FocusedFieldKind,
  FocusedFieldWidget,
} from '../../../../nook-web-extension/src/content/autofill/focused-field-widget'

afterEach(() => {
  vi.clearAllMocks()
  shellFixture.trusted = true
})

describe('focused field widget surface', () => {
  test('uses the existing widget shell and requires an explicit chooser click', () => {
    const choose = vi.fn<() => void>()
    const request: Parameters<typeof FocusedFieldWidget.mount>[0] = {
      kind: FocusedFieldKind.Credential,
      vaultConnection: { kind: PilotVaultConnectionKind.Connected },
      field: document.createElement('input'),
      choose,
    }
    const widget = FocusedFieldWidget.mount(request)
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
  test('keeps the personal group copy and field workflow when choosing a record', () => {
    const choose = vi.fn<() => void>()
    const request: Parameters<typeof FocusedFieldWidget.mount>[0] = {
      kind: FocusedFieldKind.Personal,
      vaultConnection: { kind: PilotVaultConnectionKind.Connected },
      field: document.createElement('input'),
      group: 'Address',
      choose,
    }
    const { shell } = FocusedFieldWidget.mount(request)
    expect(shell.host.getAttribute('data-nook-credential-mode')).toBe(
      'personal',
    )
    expect(shell.title.textContent).toBe(
      `localized:${BROWSER_MESSAGE_KEYS.WidgetPersonalAddressTitle}`,
    )
    expect(shell.description.textContent).toBe(
      `localized:${BROWSER_MESSAGE_KEYS.WidgetPersonalDescription}`,
    )
    expect(shellFixture.mount).toHaveBeenCalledWith(
      expect.objectContaining({ workflowKey: 'personal-fill' }),
    )
    expect(choose).not.toHaveBeenCalled()
    shell.continueButton.click()
    expect(choose).toHaveBeenCalledOnce()
  })

  test('rejects a synthetic chooser gesture', () => {
    shellFixture.trusted = false
    const choose = vi.fn<() => void>()
    const request: Parameters<typeof FocusedFieldWidget.mount>[0] = {
      kind: FocusedFieldKind.Credential,
      vaultConnection: { kind: PilotVaultConnectionKind.Connected },
      field: document.createElement('input'),
      choose,
    }
    FocusedFieldWidget.mount(request).shell.continueButton.click()
    expect(choose).not.toHaveBeenCalled()
  })
})
