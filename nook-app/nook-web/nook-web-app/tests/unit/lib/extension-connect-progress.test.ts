import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const grantPort = vi.hoisted(() => ({
  authorize: vi.fn(),
  prepareAuthorizedGrant: vi.fn(),
  deliver: vi.fn(),
  admitCompletion: vi.fn(),
  releaseAuthorization: vi.fn(),
}))

vi.mock('$lib/extension/keyring-approval', () => ({
  ExtensionKeyringApproval: vi.fn(function GrantPortDouble() {
    return grantPort
  }),
}))

import {
  ExtensionConnectFailureReason,
  ExtensionConnectFollowKind,
  ExtensionConnectStepKind,
  type ExtensionConnectStep,
} from '$web-shared/extension/extension-connect-progress'
import {
  ExtensionConnectProgress,
  type ExtensionConnectProgressBegin,
  type ExtensionConnectProgressHost,
} from '$lib/extension/connect-progress'
import {
  ExtensionConnectBrowserVaults,
  ExtensionConnectPageReportKind,
  ExtensionConnectPageSteps,
  ExtensionConnectVaultCreation,
  type ExtensionConnectPageView,
} from '$lib/components/extension-connect-progress-steps'
import { ExtensionConnectConsentSteps } from '$lib/components/extension-connect-consent-progress'
import { ExtensionConnectIntentKind } from '$lib/app/route-state'
import { FirstRunStage, NewIdentityStage } from '$lib/vault/state/ui.svelte'
import {
  ExtensionConnectConsentWorkflow,
  type ExtensionConsentWorkflowState,
} from '$lib/components/extension-connect-consent-workflow'
import {
  ExtensionConnectScope,
  type ExtensionConnectRequest,
} from '$lib/extension/connect'
import { ExtensionPairingDeliveryKind } from '$lib/extension/extension-pairing-delivery'
import { DeviceProtectionStatus, NookVaultManager } from '$app-wasm'
import { IdentityActionOutcome } from '$lib/vault/identity-control.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

/** A page port to the extension, recording what the page posts. */
class RecordingPort {
  readonly posted: ExtensionConnectStep[] = []
  readonly disconnectListeners: Array<() => void> = []
  disconnects = 0

  readonly postMessage = (step: ExtensionConnectStep): void => {
    this.posted.push(step)
  }
  readonly disconnect = (): void => {
    this.disconnects += 1
  }
  readonly onDisconnect = {
    addListener: (listener: () => void) =>
      this.disconnectListeners.push(listener),
  }

  /** No side panel listened, or it closed the port. */
  dropByExtension(): void {
    for (const listener of this.disconnectListeners) listener()
  }
}

class RecordingHost {
  readonly connectedTo: string[] = []
  readonly portNames: string[] = []
  readonly port = new RecordingPort()

  host(): ExtensionConnectProgressHost {
    const runtime = {
      connect: (extensionId: string, info: { readonly name: string }) => {
        this.connectedTo.push(extensionId)
        this.portNames.push(info.name)
        return this.port
      },
    }
    return { chrome: { runtime } }
  }
}

/** The connect id the side panel named for this page. */
const followed: ExtensionConnectProgressBegin = {
  extensionRuntimeId: 'extension-1',
  follow: { kind: ExtensionConnectFollowKind.Named, connectId: 'connect-1' },
}

const unlock: ExtensionConnectStep = { kind: ExtensionConnectStepKind.Unlock }
const consent: ExtensionConnectStep = { kind: ExtensionConnectStepKind.Consent }
const opened: ExtensionConnectStep = { kind: ExtensionConnectStepKind.Opened }
const approved: ExtensionConnectStep = {
  kind: ExtensionConnectStepKind.Approved,
}

describe('connect page progress port', () => {
  test('opens one port to the named extension and reports where the page is', () => {
    const recording = new RecordingHost()
    const progress = new ExtensionConnectProgress(recording.host())
    // A step known before the port opens follows the opened step.
    progress.report(unlock)
    progress.begin(followed)
    progress.begin(followed)
    progress.report(unlock)
    progress.report(consent)
    expect(recording.connectedTo).toEqual(['extension-1'])
    // The port carries the connect id, so the panel that named it can
    // tell it from other pages' ports.
    expect(recording.portNames).toEqual(['connect-1'])
    // The step just sent is not sent again.
    expect(recording.port.posted).toEqual([opened, unlock, consent])
  })

  test('a port nobody listens to ends quietly: no retry, and the page goes on', () => {
    const recording = new RecordingHost()
    const progress = new ExtensionConnectProgress(recording.host())
    progress.begin(followed)
    recording.port.dropByExtension()
    progress.report(consent)
    progress.begin(followed)
    progress.report(approved)
    expect(recording.connectedTo).toEqual(['extension-1'])
    expect(recording.port.posted).toEqual([opened])
    expect(recording.port.disconnects).toBe(0)
  })

  test('leaving the connect route closes the port once', () => {
    const recording = new RecordingHost()
    const progress = new ExtensionConnectProgress(recording.host())
    progress.begin(followed)
    progress.end()
    progress.end()
    progress.report(consent)
    expect(recording.port.disconnects).toBe(1)
    expect(recording.port.posted).toEqual([opened])
  })

  test('a connect URL without a connect id opens no port, and the page goes on', () => {
    const recording = new RecordingHost()
    const progress = new ExtensionConnectProgress(recording.host())
    progress.begin({
      extensionRuntimeId: 'extension-1',
      follow: { kind: ExtensionConnectFollowKind.Unnamed },
    })
    progress.report(consent)
    progress.begin(followed)
    progress.end()
    expect(recording.connectedTo).toEqual([])
    expect(recording.port.posted).toEqual([])
  })

  test('a browser without the extension runtime reports nothing and does not fail', () => {
    const bare: ExtensionConnectProgressHost = {}
    const progress = new ExtensionConnectProgress(bare)
    expect(() => {
      progress.begin(followed)
      progress.report(consent)
      progress.end()
    }).not.toThrow()
  })
})

describe('connect page steps before a vault is open', () => {
  test('a browser holding a vault unlocks it; one without creates or joins', () => {
    const access = ExtensionConnectPageSteps.access
    expect(
      access({
        vaults: ExtensionConnectBrowserVaults.Held,
        creation: ExtensionConnectVaultCreation.None,
      }),
    ).toEqual(unlock)
    expect(
      access({
        vaults: ExtensionConnectBrowserVaults.None,
        creation: ExtensionConnectVaultCreation.None,
      }),
    ).toEqual({ kind: ExtensionConnectStepKind.Choosing })
    expect(
      access({
        vaults: ExtensionConnectBrowserVaults.None,
        creation: ExtensionConnectVaultCreation.Underway,
      }),
    ).toEqual({ kind: ExtensionConnectStepKind.Creating })
  })
})

describe('connect page steps read from the shell', () => {
  const lockedHolder: ExtensionConnectPageView = {
    connectRoute: true,
    intent: ExtensionConnectIntentKind.Requested,
    preserveAccessGate: false,
    localVaultCount: 0,
    vault: {
      newIdentity: NewIdentityStage.Off,
      isAuthenticated: false,
      localVaultPresent: true,
      isInitializing: false,
      firstRun: FirstRunStage.Off,
    },
  }
  const freshBrowser: ExtensionConnectPageView = {
    ...lockedHolder,
    vault: { ...lockedHolder.vault, localVaultPresent: false },
  }
  const report = (step: ExtensionConnectStep) => ({
    kind: ExtensionConnectPageReportKind.Report,
    step,
  })
  const silent = { kind: ExtensionConnectPageReportKind.Silent }
  const choosing: ExtensionConnectStep = {
    kind: ExtensionConnectStepKind.Choosing,
  }
  const creating: ExtensionConnectStep = {
    kind: ExtensionConnectStepKind.Creating,
  }

  test('only the connect route of a valid request reports', () => {
    expect(
      ExtensionConnectPageSteps.page({ ...lockedHolder, connectRoute: false }),
    ).toEqual(silent)
    expect(
      ExtensionConnectPageSteps.page({
        ...lockedHolder,
        intent: ExtensionConnectIntentKind.Absent,
      }),
    ).toEqual(silent)
  })

  test('a held vault unlocks; a fresh browser chooses, and creates only once a vault is being created', () => {
    expect(ExtensionConnectPageSteps.page(lockedHolder)).toEqual(report(unlock))
    expect(
      ExtensionConnectPageSteps.page({ ...freshBrowser, localVaultCount: 1 }),
    ).toEqual(report(unlock))
    expect(ExtensionConnectPageSteps.page(freshBrowser)).toEqual(
      report(choosing),
    )
    // The app still starting is not creating anything: no step yet.
    expect(
      ExtensionConnectPageSteps.page({
        ...freshBrowser,
        vault: { ...freshBrowser.vault, isInitializing: true },
      }),
    ).toEqual(silent)
    const creatingViews: ExtensionConnectPageView[] = [
      {
        ...freshBrowser,
        vault: { ...freshBrowser.vault, firstRun: FirstRunStage.Protect },
      },
      { ...freshBrowser, preserveAccessGate: true },
    ]
    for (const view of creatingViews) {
      expect(ExtensionConnectPageSteps.page(view)).toEqual(report(creating))
    }
  })

  test('a new identity is creating; an open vault leaves the step to the consent', () => {
    expect(
      ExtensionConnectPageSteps.page({
        ...lockedHolder,
        vault: { ...lockedHolder.vault, newIdentity: NewIdentityStage.Name },
      }),
    ).toEqual(report(creating))
    const open: ExtensionConnectPageView = {
      ...lockedHolder,
      vault: { ...lockedHolder.vault, isAuthenticated: true },
    }
    expect(ExtensionConnectPageSteps.page(open)).toEqual(silent)
    // A vault waiting for this device keeps the access gate up: creating.
    expect(
      ExtensionConnectPageSteps.page({ ...open, preserveAccessGate: true }),
    ).toEqual(report(creating))
  })

  test('a first run reports opened then choosing while the app starts and checks the browser', () => {
    const recording = new RecordingHost()
    const progress = new ExtensionConnectProgress(recording.host())
    progress.begin(followed)
    // The shell re-reads the page on every state change of the first run:
    // initializing, then settled with no vault, then unrelated changes.
    const firstRun: ExtensionConnectPageView[] = [
      {
        ...freshBrowser,
        vault: { ...freshBrowser.vault, isInitializing: true },
      },
      {
        ...freshBrowser,
        vault: { ...freshBrowser.vault, isInitializing: true },
      },
      freshBrowser,
      freshBrowser,
    ]
    for (const view of firstRun) {
      const shown = ExtensionConnectPageSteps.page(view)
      switch (shown.kind) {
        case ExtensionConnectPageReportKind.Silent:
          break
        case ExtensionConnectPageReportKind.Report:
          progress.report(shown.step)
      }
    }
    expect(recording.port.posted).toEqual([opened, choosing])
  })
})

class ConsentSteps {
  readonly steps: ExtensionConnectStep[] = []
  readonly workflow: ExtensionConnectConsentWorkflow

  constructor() {
    const vault = VaultStateTestFixture.create()
    vault.openManager(new NookVaultManager())
    // Only the keyring has to be unlocked; no vault is open.
    vault.deviceProtectionStatus = DeviceProtectionStatus.Unlocked
    vi.spyOn(vault.identityControl, 'loadSnapshot').mockResolvedValue(
      ok(IdentityActionOutcome.Completed),
    )
    const request: ExtensionConnectRequest = {
      follow: { kind: ExtensionConnectFollowKind.Unnamed },
      deviceId: 'device-1',
      devicePublicKey: 'device-key',
      deviceSigningPublicKey: 'signing-key',
      extensionRuntimeId: 'extension-1',
      deviceLabel: 'Nook Extension',
      scopes: [ExtensionConnectScope.VaultAccess],
    }
    this.workflow = new ExtensionConnectConsentWorkflow({ vault, request })
  }

  approve(): Promise<void> {
    const initial: ExtensionConsentWorkflowState = this.workflow.initialState()
    this.steps.push(ExtensionConnectConsentSteps.consent(initial))
    return this.workflow.approve({
      state: initial,
      publish: (next) => {
        this.steps.push(ExtensionConnectConsentSteps.consent(next))
      },
    })
  }
}

describe('connect page steps of the consent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    grantPort.authorize.mockResolvedValue(ok({ identityId: 'identity-1' }))
    grantPort.prepareAuthorizedGrant.mockResolvedValue(ok({}))
    grantPort.admitCompletion.mockReturnValue(ok())
    grantPort.releaseAuthorization.mockImplementation(() => {})
  })

  test('approved is reported only after the extension took the grant', async () => {
    let deliver: (delivered: unknown) => void = () => {}
    grantPort.deliver.mockReturnValue(
      new Promise((resolve) => {
        deliver = resolve
      }),
    )
    const consentSteps = new ConsentSteps()
    const approving = consentSteps.approve()
    await vi.waitFor(() => expect(grantPort.deliver).toHaveBeenCalled())
    expect(consentSteps.steps).not.toContainEqual(approved)
    expect(new Set(consentSteps.steps.map((step) => step.kind))).toEqual(
      new Set([ExtensionConnectStepKind.Consent]),
    )
    deliver(ok({ kind: ExtensionPairingDeliveryKind.Delivered, eventCount: 1 }))
    await approving
    expect(consentSteps.steps.at(-1)).toEqual(approved)
    consentSteps.workflow.dispose()
  })

  test('a grant the extension refused reports a delivery failure, never approved', async () => {
    grantPort.deliver.mockResolvedValue(
      ok({ kind: ExtensionPairingDeliveryKind.MessagingUnavailable }),
    )
    const consentSteps = new ConsentSteps()
    await consentSteps.approve()
    expect(consentSteps.steps).not.toContainEqual(approved)
    expect(consentSteps.steps.at(-1)).toEqual({
      kind: ExtensionConnectStepKind.Failed,
      reason: ExtensionConnectFailureReason.Delivery,
    })
    consentSteps.workflow.dispose()
  })

  test('an authorization the keyring refused reports an authorization failure', async () => {
    grantPort.authorize.mockResolvedValue(err(new Error('refused')))
    const consentSteps = new ConsentSteps()
    await consentSteps.approve()
    expect(consentSteps.steps).not.toContainEqual(approved)
    consentSteps.workflow.dispose()
  })
})
