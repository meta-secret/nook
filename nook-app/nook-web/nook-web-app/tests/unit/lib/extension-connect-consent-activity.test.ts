import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const grantPort = vi.hoisted(() => ({
  authorize: vi.fn(),
  prepareAuthorizedGrant: vi.fn(),
  deliver: vi.fn(),
  admitCompletion: vi.fn(),
  releaseAuthorization: vi.fn(),
}))

vi.mock('$lib/extension/vault-approval', () => ({
  ExtensionVaultApproval: vi.fn(function GrantPortDouble() {
    return grantPort
  }),
}))

import { ExtensionConnectFollowKind } from '$web-shared/extension/extension-connect-progress'
import {
  ExtensionConsentActivityKind,
  ExtensionConsentActivityPresentation,
  ExtensionConsentActivitySegment,
  type ExtensionConsentActivity,
} from '$lib/components/extension-connect-consent-activity'
import {
  ExtensionConnectConsentWorkflow,
  type ExtensionConsentWorkflowState,
} from '$lib/components/extension-connect-consent-workflow'
import {
  ExtensionConnectScope,
  type ExtensionConnectRequest,
} from '$lib/extension/connect'
import { ExtensionPairingDeliveryKind } from '$lib/extension/extension-pairing-delivery'
import { I18N_KEYS } from '$web-shared/generated/i18n-keys'
import { NookVaultManager } from '$app-wasm'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

const idle: ExtensionConsentActivity = {
  kind: ExtensionConsentActivityKind.Idle,
}

/** Drives a real consent workflow and records what the consent shows. */
class ConsentActivity {
  readonly shown: ExtensionConsentActivity[] = []
  readonly workflow: ExtensionConnectConsentWorkflow

  constructor() {
    const vault = VaultStateTestFixture.create()
    vault.openManager(new NookVaultManager())
    vault.isAuthenticated = true
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
    this.shown.push(ExtensionConsentActivityPresentation.of(initial))
    return this.workflow.approve({
      state: initial,
      publish: (next) => {
        this.shown.push(ExtensionConsentActivityPresentation.of(next))
      },
    })
  }

  steps(): number[] {
    return this.shown.flatMap((activity) =>
      activity.kind === ExtensionConsentActivityKind.Working
        ? [activity.step]
        : [],
    )
  }
}

describe('consent activity while an approval runs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    grantPort.authorize.mockResolvedValue(ok())
    grantPort.prepareAuthorizedGrant.mockResolvedValue(ok({}))
    grantPort.admitCompletion.mockReturnValue(ok())
    grantPort.releaseAuthorization.mockImplementation(() => {})
  })

  test('shows progress from the click and keeps it until the delivered approval closes', async () => {
    let deliver: (delivered: unknown) => void = () => {}
    grantPort.deliver.mockReturnValue(
      new Promise((resolve) => {
        deliver = resolve
      }),
    )
    const consent = new ConsentActivity()
    const approving = consent.approve()
    await vi.waitFor(() => expect(grantPort.deliver).toHaveBeenCalled())
    expect(consent.shown.at(-1)).toEqual({
      kind: ExtensionConsentActivityKind.Working,
      step: 3,
      total: ExtensionConsentActivityPresentation.total,
      translationKey: I18N_KEYS.ExtensionConsentProgressDelivering,
    })

    deliver(ok({ kind: ExtensionPairingDeliveryKind.Delivered, eventCount: 1 }))
    await approving

    expect(consent.shown[0]).toEqual(idle)
    // Once working, the consent never drops back to its actions.
    expect(consent.shown.slice(1)).not.toContainEqual(idle)
    const steps = consent.steps()
    expect(steps[0]).toBe(1)
    expect(steps).toEqual([...steps].sort((a, b) => a - b))
    expect(new Set(steps)).toEqual(new Set([1, 2, 3, 4]))
    expect(consent.shown.at(-1)).toEqual({
      kind: ExtensionConsentActivityKind.Working,
      step: 4,
      total: ExtensionConsentActivityPresentation.total,
      translationKey: I18N_KEYS.ExtensionConsentProgressFinishing,
    })
    consent.workflow.dispose()
  })

  test('a grant the extension refused returns the consent to its actions', async () => {
    grantPort.deliver.mockResolvedValue(
      ok({ kind: ExtensionPairingDeliveryKind.MessagingUnavailable }),
    )
    const consent = new ConsentActivity()
    await consent.approve()
    expect(consent.steps()).toContain(3)
    expect(consent.shown.at(-1)).toEqual(idle)
    consent.workflow.dispose()
  })

  test('an authorization the vault refused returns the consent to its actions', async () => {
    grantPort.authorize.mockResolvedValue(err(new Error('refused')))
    const consent = new ConsentActivity()
    await consent.approve()
    expect(consent.steps()).toEqual([1])
    expect(consent.shown.at(-1)).toEqual(idle)
    consent.workflow.dispose()
  })
})

describe('consent activity segments', () => {
  test('marks finished steps, the running step, and the rest', () => {
    const preparing: ExtensionConsentActivity = {
      kind: ExtensionConsentActivityKind.Working,
      step: 2,
      total: ExtensionConsentActivityPresentation.total,
      translationKey: I18N_KEYS.ExtensionConsentProgressPreparing,
    }
    expect(ExtensionConsentActivityPresentation.segments(preparing)).toEqual([
      ExtensionConsentActivitySegment.Done,
      ExtensionConsentActivitySegment.Current,
      ExtensionConsentActivitySegment.Pending,
      ExtensionConsentActivitySegment.Pending,
    ])
  })

  test('an idle consent shows no progress', () => {
    expect(ExtensionConsentActivityPresentation.segments(idle)).toEqual(
      Array(ExtensionConsentActivityPresentation.total).fill(
        ExtensionConsentActivitySegment.Pending,
      ),
    )
  })
})
