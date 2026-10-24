import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
vi.hoisted(() => {
  type GateChromeFixture = {
    readonly runtime: Pick<typeof chrome.runtime, 'id' | 'getURL'> & {
      readonly onMessage: Pick<typeof chrome.runtime.onMessage, 'addListener'>
    }
  }
  const chromeFixture: GateChromeFixture = {
    runtime: {
      id: 'nook-extension',
      getURL: (path: string) => `chrome-extension://nook-extension/${path}`,
      onMessage: { addListener: () => {} },
    },
  }
  vi.stubGlobal('chrome', chromeFixture)
  vi.stubGlobal('__NOOK_EXTENSION_DIAGNOSTICS_ENABLED__', false)
})
import { AuthenticationGesture } from '../../../../nook-web-extension/src/lib/auth-widget-policy'
import { BROWSER_MESSAGE_KEYS } from '../../../../nook-web-extension/src/lib/browser-message-keys'
import {
  SiteVaultConnectMessageType,
  SiteVaultConnectResponseKind,
} from '../../../../nook-web-extension/src/lib/site-vault-connect-messages'
import { FocusedCredentialTargetSensor } from '../../../../nook-web-extension/src/content/autofill/focused-credential-target'
import { FocusedCredentialTargetKind } from '../../../../nook-web-extension/src/content/autofill/focused-credential-target'
import { FocusedCredentialWidget } from '../../../../nook-web-extension/src/content/autofill/focused-credential-widget'
import {
  authenticationRuntimeTransport,
  RuntimeMessageDeliveryKind,
} from '../../../../nook-web-extension/src/content/autofill/runtime-message-adapter'
import { SiteSidePanel } from '../../../../nook-web-extension/src/content/autofill/site-side-panel'
import { widgetState } from '../../../../nook-web-extension/src/content/autofill/state'
import {
  PilotVaultConnectionKind,
  WidgetVaultGateKind,
} from '../../../../nook-web-extension/src/content/autofill/widget-presentation-state'
import {
  VaultConnectResume,
  VaultConnectResumeKind,
  WidgetVaultGateSurface,
} from '../../../../nook-web-extension/src/content/autofill/widget-vault-gate'
import { workflowUi } from '../../../../nook-web-extension/src/content/autofill/workflow-ui'

/** A plain widget shell with the parts the vault gate fills in. */
class GateShellFixture {
  readonly step = document.createElement('p')
  readonly title = document.createElement('h2')
  readonly description = document.createElement('p')
  readonly continueButton = document.createElement('button')
  readonly body = document.createElement('div')
  readonly collapsedLaunch = document.createElement('button')
  readonly input = document.createElement('input')

  constructor() {
    this.body.append(this.title, this.description, this.continueButton)
    document.body.append(this.body, this.input)
  }

  click(): Promise<void> {
    this.continueButton.click()
    return Effect.runPromise(Effect.yieldNow)
  }

  dismissButtons(): HTMLButtonElement[] {
    return Array.from(
      this.body.querySelectorAll<HTMLButtonElement>(
        '[data-testid="nook-vault-gate-dismiss"]',
      ),
    )
  }
}

function connectAnswer(kind: SiteVaultConnectResponseKind) {
  return vi
    .spyOn(authenticationRuntimeTransport, 'sendDecodedRuntimeMessage')
    .mockImplementation(() => {
      const delivery = {
        kind: RuntimeMessageDeliveryKind.Delivered,
        response: { kind },
      } as const
      return Effect.runPromise(Effect.succeed(delivery))
    })
}

beforeEach(() => {
  widgetState.dismissed = false
  vi.spyOn(workflowUi, 'translatedMessage').mockImplementation((key) => key)
  vi.spyOn(AuthenticationGesture.prototype, 'trusted', 'get').mockReturnValue(
    true,
  )
})
afterEach(() => {
  workflowUi.removeWidget()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('connect-first widget state', () => {
  test('offers Connect vault instead of the blocked action and starts the connect flow', async () => {
    const shell = new GateShellFixture()
    const send = connectAnswer(SiteVaultConnectResponseKind.Opened)
    WidgetVaultGateSurface.render({
      shell,
      gate: WidgetVaultGateKind.Connect,
      resume: { kind: VaultConnectResumeKind.Page },
    })

    expect(shell.title.textContent).toBe(
      BROWSER_MESSAGE_KEYS.WidgetConnectFirstTitle,
    )
    expect(shell.description.textContent).toBe(
      BROWSER_MESSAGE_KEYS.WidgetConnectFirstDescription,
    )
    expect(shell.continueButton.textContent).toBe(
      BROWSER_MESSAGE_KEYS.WidgetConnectFirstAction,
    )
    expect(shell.dismissButtons().map((button) => button.textContent)).toEqual([
      BROWSER_MESSAGE_KEYS.WidgetGateDismiss,
    ])

    await shell.click()
    await vi.waitFor(() =>
      expect(shell.description.textContent).toBe(
        BROWSER_MESSAGE_KEYS.WidgetConnectFirstOpened,
      ),
    )
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0]?.[0].message).toEqual({
      type: SiteVaultConnectMessageType.Connect,
    })
  })

  test('a connect page that cannot open fails visibly', async () => {
    const shell = new GateShellFixture()
    connectAnswer(SiteVaultConnectResponseKind.Failed)
    WidgetVaultGateSurface.render({
      shell,
      gate: WidgetVaultGateKind.Connect,
      resume: { kind: VaultConnectResumeKind.Page },
    })

    await shell.click()
    await vi.waitFor(() =>
      expect(shell.description.textContent).toBe(
        BROWSER_MESSAGE_KEYS.WidgetConnectFirstFailed,
      ),
    )
    expect(shell.description.getAttribute('role')).toBe('alert')
  })

  test('a locked vault offers Unlock in the side panel, never a connect', async () => {
    const shell = new GateShellFixture()
    const send = connectAnswer(SiteVaultConnectResponseKind.Opened)
    const open = vi.spyOn(SiteSidePanel, 'open').mockImplementation(() => {})
    WidgetVaultGateSurface.render({
      shell,
      gate: WidgetVaultGateKind.Unlock,
      resume: { kind: VaultConnectResumeKind.Page },
    })

    expect(shell.title.textContent).toBe(
      BROWSER_MESSAGE_KEYS.WidgetUnlockFirstTitle,
    )
    expect(shell.continueButton.textContent).toBe(
      BROWSER_MESSAGE_KEYS.WidgetUnlock,
    )
    await shell.click()
    expect(open).toHaveBeenCalledOnce()
    expect(send).not.toHaveBeenCalled()
  })

  test('Not now dismisses the widget', () => {
    const shell = new GateShellFixture()
    WidgetVaultGateSurface.render({
      shell,
      gate: WidgetVaultGateKind.Connect,
      resume: { kind: VaultConnectResumeKind.Page },
    })
    for (const button of shell.dismissButtons()) button.click()
    expect(widgetState.dismissed).toBe(true)
  })

  test('a focused field without a connected vault never wires Sign in', async () => {
    const field = document.createElement('input')
    document.body.append(field)
    const choose = vi.fn<() => void>()
    const send = connectAnswer(SiteVaultConnectResponseKind.Opened)
    const widget = FocusedCredentialWidget.mount({
      vaultConnection: { kind: PilotVaultConnectionKind.NotConnected },
      field,
      choose,
    })

    expect(widget.shell.continueButton.textContent).toBe(
      BROWSER_MESSAGE_KEYS.WidgetConnectFirstAction,
    )
    widget.shell.continueButton.click()
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
    expect(choose).not.toHaveBeenCalled()
  })
})

describe('resume after a connect', () => {
  test('the field a connect started from is offered again once', () => {
    const shell = new GateShellFixture()
    const sensor = new FocusedCredentialTargetSensor({
      document,
      schedule: () => {},
    })
    const resume = new VaultConnectResume()
    resume.remember({ kind: VaultConnectResumeKind.Field, input: shell.input })

    resume.resume([sensor])
    expect(sensor.target).toMatchObject({
      kind: FocusedCredentialTargetKind.Retained,
      input: shell.input,
    })

    sensor.clear()
    resume.resume([sensor])
    expect(sensor.target.kind).toBe(FocusedCredentialTargetKind.Empty)
  })

  test('a removed field is not retained', () => {
    const shell = new GateShellFixture()
    const sensor = new FocusedCredentialTargetSensor({
      document,
      schedule: () => {},
    })
    const resume = new VaultConnectResume()
    resume.remember({ kind: VaultConnectResumeKind.Field, input: shell.input })
    shell.input.remove()

    resume.resume([sensor])
    expect(sensor.target.kind).toBe(FocusedCredentialTargetKind.Empty)
  })
})
