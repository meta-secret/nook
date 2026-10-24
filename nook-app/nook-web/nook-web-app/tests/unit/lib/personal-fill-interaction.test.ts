import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
vi.hoisted(() => {
  type PersonalChromePlatformFixture = {
    readonly runtime: Pick<typeof chrome.runtime, 'id'> & {
      readonly onMessage: Pick<typeof chrome.runtime.onMessage, 'addListener'>
    }
  }
  const chromeFixture: PersonalChromePlatformFixture = {
    runtime: { id: 'nook-extension', onMessage: { addListener: () => {} } },
  }
  vi.stubGlobal('chrome', chromeFixture)
  vi.stubGlobal('__NOOK_EXTENSION_DIAGNOSTICS_ENABLED__', false)
})
vi.mock(
  '../../../../nook-web-extension/src/content/autofill/companion-wasm-gate',
  () => ({
    queueSubmitCaptureUntilCompanionWasmReady: () => ({
      capture: () => {},
      discard: () => {},
      enable: () => {},
    }),
    runAfterCompanionWasmReady: async () => {},
  }),
)
vi.mock(
  '../../../../nook-web-extension/src/content/autofill/companion-wasm-readiness',
  () => ({
    companionWasmReadiness: { waitForExtensionClassification: async () => {} },
  }),
)
import {
  CompanionWasmSessionMessageType,
  type CompanionWasmSessionMessage,
} from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import { PersonalFieldGroup } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { PersonalFieldFillOperation } from '../../../../nook-web-extension/src/offscreen/session-personal-field-fill'
import { FocusedCredentialTargetSensor } from '../../../../nook-web-extension/src/content/autofill/focused-credential-target'
import {
  PersonalFillDisposition,
  PersonalFillInteraction,
  PersonalFillPickerOwnership,
  PersonalFillSurfaceKind,
} from '../../../../nook-web-extension/src/content/autofill/personal-fill-interaction'
import {
  PersonalFillPageReceiver,
  PersonalFillReception,
  type PersonalFillPageDelivery,
  type PersonalFillPageInteraction,
} from '../../../../nook-web-extension/src/content/autofill/personal-fill-reception'
import type { PersonalFillWidget } from '../../../../nook-web-extension/src/content/autofill/personal-fill-widget'
import type { PersonalPickerFrameMount } from '../../../../nook-web-extension/src/content/autofill/personal-picker-frame'
import { PilotVaultConnectionKind } from '../../../../nook-web-extension/src/content/autofill/widget-presentation-state'
import {
  scanState,
  widgetState,
  WidgetCredentialActuation,
} from '../../../../nook-web-extension/src/content/autofill/state'
import {
  authenticationRuntimeTransport,
  RuntimeMessageDeliveryKind,
  type ExtensionRuntimeRequest,
} from '../../../../nook-web-extension/src/content/autofill/runtime-message-adapter'
import { workflowUi } from '../../../../nook-web-extension/src/content/autofill/workflow-ui'
import { AuthenticationScanRenderLifecycle } from '../../../../nook-web-extension/src/content/autofill'
import {
  FocusedUiDisposition,
  focusedCredentialInteraction,
} from '../../../../nook-web-extension/src/content/autofill/focused-credential-interaction'
import { personalFillInteraction } from '../../../../nook-web-extension/src/content/autofill/personal-fill-interaction'
import {
  passwordFieldDiscovery,
  passwordFormCredentialInteraction,
  passwordFormInteraction,
} from '../../../../nook-web-shared/src/extension/password-forms'
import {
  loginSaveInteraction,
  PendingSaveOfferLoadKind,
} from '../../../../nook-web-extension/src/content/autofill/login-save'
import { recoveryCopyObservation } from '../../../../nook-web-extension/src/lib/backup-code-candidates'
import { pageQrCapture } from '../../../../nook-web-extension/src/lib/page-qr-capture'
import { authenticatorEnrollmentInteraction } from '../../../../nook-web-extension/src/content/enrollment-flow'
import {
  PersonalFillMessageType,
  PersonalFillPageResponseKind,
  PersonalFillOpenResponseKind,
  PersonalFillRevealResponseKind,
  type PersonalFillRevealedValues,
  type PersonalFillSelectedMessage,
} from '../../../../nook-web-extension/src/lib/personal-fill-messages'

enum FieldConcealment {
  Visible = 'visible',
  HiddenType = 'hidden-type',
  DisplayNone = 'display-none',
  HiddenWrapper = 'hidden-wrapper',
}
type PersonalFixtureField = {
  readonly autocomplete: string
  readonly type: string
  readonly concealment: FieldConcealment
}
type CompanionDelivery = Awaited<
  ReturnType<
    typeof authenticationRuntimeTransport.sendCompanionWasmRuntimeMessage
  >
>
type DecodedRequest = Parameters<
  typeof authenticationRuntimeTransport.sendDecodedRuntimeMessage
>[0]

/** A contact form with an address section; Rust plans the focused field's group. */
class PersonalInteractionFixture {
  static readonly FIELDS: readonly PersonalFixtureField[] = [
    PersonalInteractionFixture.field('given-name', 'text'),
    PersonalInteractionFixture.field('family-name', 'text'),
    PersonalInteractionFixture.field('tel', 'tel'),
    PersonalInteractionFixture.field('email', 'email'),
    PersonalInteractionFixture.field('address-line1', 'text'),
  ]

  static field(
    autocomplete: string,
    type: string,
    concealment = FieldConcealment.Visible,
  ): PersonalFixtureField {
    return { autocomplete, type, concealment }
  }
  readonly inputs: HTMLInputElement[] = []
  readonly submit = vi.fn<() => void>()
  readonly events = vi.fn<(type: string) => void>()
  readonly release = vi.fn<() => void>()
  readonly sensor: FocusedCredentialTargetSensor
  readonly interaction: PersonalFillInteraction
  readonly mounts: PersonalFillWidget[] = []
  readonly groups: (keyof typeof PersonalFieldGroup)[] = []
  readonly pickers: PersonalPickerFrameMount[] = []
  readonly requests: ExtensionRuntimeRequest[] = []
  revealed: PersonalFillRevealedValues = [
    { kind: 'GivenName', value: 'Ada' },
    { kind: 'FamilyName', value: 'Lovelace' },
    { kind: 'Phone', value: '+44 20 7946 0000' },
    { kind: 'Email', value: 'ada@nook.test' },
  ]
  readonly classifications = vi.spyOn(
    authenticationRuntimeTransport,
    'sendCompanionWasmRuntimeMessage',
  )
  readonly decoded = vi.spyOn(
    authenticationRuntimeTransport,
    'sendDecodedRuntimeMessage',
  )

  constructor(fields: readonly PersonalFixtureField[]) {
    const form = document.createElement('form')
    form.addEventListener('submit', this.submit)
    for (const field of fields) {
      const input = document.createElement('input')
      input.type = field.type
      input.setAttribute('autocomplete', field.autocomplete)
      input.addEventListener('input', () => this.events('input'))
      input.addEventListener('change', () => this.events('change'))
      this.inputs.push(input)
      form.append(PersonalInteractionFixture.conceal(input, field.concealment))
    }
    document.body.append(form)
    const sensorRequest: ConstructorParameters<
      typeof FocusedCredentialTargetSensor
    >[0] = { document, schedule: () => {} }
    this.sensor = new FocusedCredentialTargetSensor(sensorRequest)
    form.addEventListener('focusin', this.sensor.observe.bind(this.sensor))
    this.classifications.mockImplementation(this.classify.bind(this))
    this.decoded.mockImplementation(this.respond.bind(this))
    vi.spyOn(
      authenticationRuntimeTransport,
      'sendRuntimeMessageWithoutResponse',
    ).mockImplementation((message) => {
      this.requests.push(message)
    })
    vi.spyOn(workflowUi, 'loadPilotVaultConnection').mockImplementation(() => {
      const connection: Awaited<
        ReturnType<typeof workflowUi.loadPilotVaultConnection>
      > = { kind: PilotVaultConnectionKind.Connected }
      return Effect.runPromise(Effect.succeed(connection))
    })
    vi.spyOn(workflowUi, 'translatedMessage').mockReturnValue(
      'Translated fixture',
    )
    const request: ConstructorParameters<typeof PersonalFillInteraction>[0] = {
      sensor: this.sensor,
      transport: authenticationRuntimeTransport,
      ui: workflowUi,
      mount: (mount) => {
        const shell: PersonalFillWidget['shell'] = {
          host: document.createElement('aside'),
          panel: document.createElement('div'),
          toolbar: document.createElement('div'),
          body: document.createElement('div'),
          step: document.createElement('p'),
          title: document.createElement('h2'),
          description: document.createElement('p'),
          continueButton: document.createElement('button'),
          collapseButton: document.createElement('button'),
          collapsedLaunch: document.createElement('button'),
        }
        shell.host.append(shell.description, shell.continueButton)
        document.body.append(shell.host)
        widgetState.attachHost(shell.host)
        this.groups.push(mount.group)
        const widget = { shell }
        this.mounts.push(widget)
        return widget
      },
      mountPicker: (picker) => {
        this.pickers.push(picker)
        return { close: this.release }
      },
      fill: passwordFormCredentialInteraction.setNativeInputValue.bind(
        passwordFormCredentialInteraction,
      ),
      openSidePanel: () => {},
    }
    this.interaction = new PersonalFillInteraction(request)
  }

  /** The real Rust classifier and planner answer through the offscreen operation. */
  private classify(
    message: CompanionWasmSessionMessage,
  ): Promise<CompanionDelivery> {
    const unavailable: CompanionDelivery = {
      kind: RuntimeMessageDeliveryKind.Unavailable,
    }
    switch (true) {
      case message.type ===
        CompanionWasmSessionMessageType.ClassifyPersonalField:
        return this.delivered(new PersonalFieldFillOperation(message).run())
      case message.type === CompanionWasmSessionMessageType.PlanPersonalFill:
        return this.delivered(new PersonalFieldFillOperation(message).run())
      case true:
        return Effect.runPromise(Effect.succeed(unavailable))
    }
    return Effect.runPromise(Effect.succeed(unavailable))
  }

  private delivered(
    response: ReturnType<PersonalFieldFillOperation['run']>,
  ): Promise<CompanionDelivery> {
    const delivery: CompanionDelivery = {
      kind: RuntimeMessageDeliveryKind.Delivered,
      response,
    }
    return Effect.runPromise(Effect.succeed(delivery))
  }

  private respond(request: DecodedRequest) {
    this.requests.push(request.message)
    const type = request.message.type
    switch (true) {
      case type === PersonalFillMessageType.Open: {
        const delivery = {
          kind: RuntimeMessageDeliveryKind.Delivered,
          response: {
            kind: PersonalFillOpenResponseKind.Ready,
            requestId: 'personal-request',
            expiresAt: Date.now() + 10_000,
          },
        } as const
        return Effect.runPromise(Effect.succeed(delivery))
      }
      case type === PersonalFillMessageType.Reveal: {
        const delivery = {
          kind: RuntimeMessageDeliveryKind.Delivered,
          response: {
            kind: PersonalFillRevealResponseKind.Revealed,
            values: this.revealed,
          },
        } as const
        return Effect.runPromise(Effect.succeed(delivery))
      }
      case true: {
        const unavailable = {
          kind: RuntimeMessageDeliveryKind.Unavailable,
        } as const
        return Effect.runPromise(Effect.succeed(unavailable))
      }
    }
    throw new Error('unreachable fixture request')
  }

  private static conceal(
    input: HTMLInputElement,
    concealment: FieldConcealment,
  ): HTMLElement {
    switch (concealment) {
      case FieldConcealment.Visible:
        return input
      case FieldConcealment.HiddenType:
        input.type = 'hidden'
        return input
      case FieldConcealment.DisplayNone:
        input.style.display = 'none'
        return input
      case FieldConcealment.HiddenWrapper: {
        const wrapper = document.createElement('div')
        wrapper.hidden = true
        wrapper.append(input)
        return wrapper
      }
    }
  }

  values(): string[] {
    return this.inputs.map((input) => input.value)
  }

  focus(position: number): void {
    this.inputs[position]?.focus()
  }

  selected(): PersonalFillSelectedMessage {
    return {
      type: PersonalFillMessageType.Selected,
      payload: { origin: location.origin, requestId: 'personal-request' },
    }
  }

  requestTypes(): string[] {
    return this.requests.map((request) => request.type)
  }
}

beforeEach(() => {
  widgetState.dismissed = false
  widgetState.busy = false
  widgetState.credentialActuation = WidgetCredentialActuation.Idle
  vi.spyOn(scanState, 'schedule').mockImplementation(() => {})
})
afterEach(() => {
  workflowUi.removeWidget()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('personal-data fill from a focused form field', () => {
  test('offers the Person group, then fills the planned fields by position after an explicit selection', async () => {
    const fixture = new PersonalInteractionFixture(
      PersonalInteractionFixture.FIELDS,
    )
    fixture.focus(0)
    expect(await fixture.interaction.tryRender()).toBe(
      PersonalFillDisposition.Ready,
    )
    expect(fixture.groups).toEqual(['Person'])
    expect(fixture.interaction.hasSurface).toBe(PersonalFillSurfaceKind.Visible)

    await fixture.interaction.choose()
    expect(fixture.pickers.map((picker) => picker.requestId)).toEqual([
      'personal-request',
    ])
    expect(fixture.interaction.ownsPicker('personal-request')).toBe(
      PersonalFillPickerOwnership.Owned,
    )
    // Nothing is revealed or written before the selection.
    expect(fixture.requestTypes()).toEqual([PersonalFillMessageType.Open])
    expect(fixture.inputs.map((input) => input.value)).toEqual([
      '',
      '',
      '',
      '',
      '',
    ])

    await fixture.interaction.selected(fixture.selected())

    expect(fixture.requestTypes()).toEqual([
      PersonalFillMessageType.Open,
      PersonalFillMessageType.Reveal,
    ])
    const reveal = fixture.requests[1]
    expect(reveal).toMatchObject({
      payload: {
        origin: location.origin,
        requestId: 'personal-request',
        kinds: ['GivenName', 'FamilyName', 'Phone', 'Email'],
      },
    })
    expect(fixture.inputs.map((input) => input.value)).toEqual([
      'Ada',
      'Lovelace',
      '+44 20 7946 0000',
      'ada@nook.test',
      '',
    ])
    expect(fixture.events).toHaveBeenCalledTimes(8)
    expect(fixture.submit).not.toHaveBeenCalled()
    // The page keeps no revealed value after the fill.
    expect(fixture.revealed.map((value) => value.value)).toEqual([
      '',
      '',
      '',
      '',
    ])
    expect(fixture.interaction.hasSurface).toBe(PersonalFillSurfaceKind.Empty)
    expect(widgetState.credentialActuation).toBe(WidgetCredentialActuation.Idle)
  })

  test('offers the Address group for an address field of the same form', async () => {
    const fixture = new PersonalInteractionFixture(
      PersonalInteractionFixture.FIELDS,
    )
    fixture.focus(4)
    expect(await fixture.interaction.tryRender()).toBe(
      PersonalFillDisposition.Ready,
    )
    expect(fixture.groups).toEqual(['Address'])
  })

  test('offers nothing for a login username field', async () => {
    const fixture = new PersonalInteractionFixture([
      PersonalInteractionFixture.field('username', 'text'),
      PersonalInteractionFixture.field('current-password', 'password'),
    ])
    fixture.focus(0)
    expect(await fixture.interaction.tryRender()).toBe(
      PersonalFillDisposition.Unavailable,
    )
    expect(fixture.mounts).toEqual([])
    expect(fixture.requestTypes()).toEqual([])
  })

  test('does not reveal when the planned scope changed before the selection', async () => {
    const fixture = new PersonalInteractionFixture(
      PersonalInteractionFixture.FIELDS,
    )
    fixture.focus(0)
    await fixture.interaction.tryRender()
    await fixture.interaction.choose()
    fixture.inputs[2]?.remove()

    await fixture.interaction.selected(fixture.selected())

    expect(fixture.requestTypes()).toEqual([
      PersonalFillMessageType.Open,
      PersonalFillMessageType.Cancel,
    ])
    expect(fixture.inputs.map((input) => input.value)).toEqual([
      '',
      '',
      '',
      '',
      '',
    ])
    expect(fixture.interaction.hasSurface).toBe(PersonalFillSurfaceKind.Empty)
  })

  test('ignores a selection for a request the page does not own', async () => {
    const fixture = new PersonalInteractionFixture(
      PersonalInteractionFixture.FIELDS,
    )
    fixture.focus(0)
    await fixture.interaction.tryRender()
    await fixture.interaction.choose()
    const foreign: PersonalFillSelectedMessage = {
      type: PersonalFillMessageType.Selected,
      payload: {
        origin: 'https://other.example',
        requestId: 'personal-request',
      },
    }

    await fixture.interaction.selected(foreign)

    expect(fixture.requestTypes()).toEqual([PersonalFillMessageType.Open])
    expect(fixture.inputs.every((input) => input.value === '')).toBe(true)
  })
})

describe('personal fill never reaches inputs the person cannot see', () => {
  test('hidden telephone and birthday inputs of the Person form are never planned or filled', async () => {
    const fixture = new PersonalInteractionFixture([
      PersonalInteractionFixture.field('given-name', 'text'),
      PersonalInteractionFixture.field('family-name', 'text'),
      PersonalInteractionFixture.field(
        'tel',
        'tel',
        FieldConcealment.HiddenType,
      ),
      PersonalInteractionFixture.field(
        'bday',
        'text',
        FieldConcealment.DisplayNone,
      ),
      PersonalInteractionFixture.field('email', 'email'),
    ])
    fixture.revealed = [
      { kind: 'GivenName', value: 'Ada' },
      { kind: 'FamilyName', value: 'Lovelace' },
      { kind: 'Phone', value: '+44 20 7946 0000' },
      { kind: 'BirthDate', value: '1815-12-10' },
      { kind: 'Email', value: 'ada@nook.test' },
    ]
    fixture.focus(0)
    expect(await fixture.interaction.tryRender()).toBe(
      PersonalFillDisposition.Ready,
    )
    await fixture.interaction.choose()
    await fixture.interaction.selected(fixture.selected())

    expect(fixture.requests[1]).toMatchObject({
      payload: { kinds: ['GivenName', 'FamilyName', 'Email'] },
    })
    expect(fixture.values()).toEqual([
      'Ada',
      'Lovelace',
      '',
      '',
      'ada@nook.test',
    ])
  })

  test('a security code inside a hidden wrapper is never planned for a card form', async () => {
    const fixture = new PersonalInteractionFixture([
      PersonalInteractionFixture.field('cc-name', 'text'),
      PersonalInteractionFixture.field('cc-number', 'text'),
      PersonalInteractionFixture.field('cc-exp', 'text'),
      PersonalInteractionFixture.field(
        'cc-csc',
        'text',
        FieldConcealment.HiddenWrapper,
      ),
    ])
    fixture.revealed = [
      { kind: 'CardholderName', value: 'Ada Lovelace' },
      { kind: 'CardNumber', value: '4111111111111111' },
      { kind: 'CardExpiration', value: '12/30' },
      { kind: 'CardSecurityCode', value: '123' },
    ]
    fixture.focus(1)
    expect(await fixture.interaction.tryRender()).toBe(
      PersonalFillDisposition.Ready,
    )
    expect(fixture.groups).toEqual(['Card'])
    await fixture.interaction.choose()
    await fixture.interaction.selected(fixture.selected())

    expect(fixture.requests[1]).toMatchObject({
      payload: { kinds: ['CardholderName', 'CardNumber', 'CardExpiration'] },
    })
    expect(fixture.values()).toEqual([
      'Ada Lovelace',
      '4111111111111111',
      '12/30',
      '',
    ])
  })

  test('a focused field that is no longer rendered offers nothing', async () => {
    const fixture = new PersonalInteractionFixture(
      PersonalInteractionFixture.FIELDS,
    )
    fixture.focus(0)
    const focused = fixture.inputs[0]
    switch (true) {
      case focused instanceof HTMLInputElement:
        focused.style.visibility = 'hidden'
        break
      case true:
        throw new Error('fixture lacks its focused field')
    }

    expect(await fixture.interaction.tryRender()).toBe(
      PersonalFillDisposition.Unavailable,
    )
    expect(fixture.mounts).toEqual([])
  })
})

/** A scan of a page without an authentication form ends inconclusive. */
class InconclusiveScanFixture {
  readonly focused = vi.spyOn(focusedCredentialInteraction, 'tryRender')
  readonly personal = vi
    .spyOn(personalFillInteraction, 'tryRender')
    .mockImplementation(() =>
      Effect.runPromise(Effect.succeed(PersonalFillDisposition.Unavailable)),
    )
  readonly lifecycle: AuthenticationScanRenderLifecycle

  constructor() {
    vi.spyOn(
      authenticatorEnrollmentInteraction,
      'enrollmentScanBlocked',
    ).mockReturnValue(false)
    vi.spyOn(
      passwordFieldDiscovery,
      'prepareCompanionClassification',
    ).mockImplementation(() => Effect.runPromise(Effect.void))
    vi.spyOn(
      passwordFormInteraction,
      'prepareCompanionWorkflowPolicies',
    ).mockImplementation(() => Effect.runPromise(Effect.void))
    vi.spyOn(
      passwordFormInteraction,
      'summarizeAuthenticationWorkflowForms',
    ).mockReturnValue([])
    const absentOffer: Awaited<
      ReturnType<typeof loginSaveInteraction.loadPendingSaveOffer>
    > = { kind: PendingSaveOfferLoadKind.Absent }
    vi.spyOn(loginSaveInteraction, 'loadPendingSaveOffer').mockImplementation(
      () => Effect.runPromise(Effect.succeed(absentOffer)),
    )
    vi.spyOn(
      recoveryCopyObservation,
      'prepareAuthenticationRecoveryEvidence',
    ).mockImplementation(() => Effect.runPromise(Effect.void))
    const absentAuthenticator: Awaited<
      ReturnType<
        typeof pageQrCapture.prepareAuthenticationAuthenticatorSetupObservation
      >
    > = { metadataKey: 'fixture', observation: 'absent' }
    vi.spyOn(
      pageQrCapture,
      'prepareAuthenticationAuthenticatorSetupObservation',
    ).mockImplementation(() =>
      Effect.runPromise(Effect.succeed(absentAuthenticator)),
    )
    vi.spyOn(
      pageQrCapture,
      'authenticationAuthenticatorSetupSnapshotIsCurrent',
    ).mockReturnValue(true)
    const lifecycleRequest: ConstructorParameters<
      typeof AuthenticationScanRenderLifecycle
    >[0] = { scanState }
    this.lifecycle = new AuthenticationScanRenderLifecycle(lifecycleRequest)
  }

  focusedDisposition(disposition: FocusedUiDisposition): void {
    this.focused.mockImplementation(() =>
      Effect.runPromise(Effect.succeed(disposition)),
    )
  }
}

describe('personal fill only when the credential path has nothing to offer', () => {
  test('a recognized credential field keeps the credential path and never asks for a personal plan', async () => {
    const fixture = new InconclusiveScanFixture()
    fixture.focusedDisposition(FocusedUiDisposition.Ready)

    await fixture.lifecycle.scanAndRender()

    expect(fixture.focused).toHaveBeenCalledOnce()
    expect(fixture.personal).not.toHaveBeenCalled()
  })

  test('a field without a credential opportunity asks Rust for a personal plan', async () => {
    const fixture = new InconclusiveScanFixture()
    fixture.focusedDisposition(FocusedUiDisposition.Unavailable)

    await fixture.lifecycle.scanAndRender()

    expect(fixture.focused).toHaveBeenCalledOnce()
    expect(fixture.personal).toHaveBeenCalledOnce()
  })
})

/** Delivers the worker's page notices to a stubbed owning interaction. */
class PersonalReceptionFixture {
  readonly selected = vi.fn<PersonalFillPageInteraction['selected']>(() =>
    Effect.runPromise(Effect.void),
  )
  readonly canceled = vi.fn<PersonalFillPageInteraction['canceled']>()
  readonly responses = vi.fn<PersonalFillPageDelivery['sendResponse']>()
  readonly receiver = new PersonalFillPageReceiver({
    ownsPicker: (requestId) =>
      requestId === 'personal-request'
        ? PersonalFillPickerOwnership.Owned
        : PersonalFillPickerOwnership.Unowned,
    selected: this.selected,
    canceled: this.canceled,
  })

  deliver(
    type: PersonalFillMessageType,
    senderId: string,
    requestId = 'personal-request',
    origin = location.origin,
  ) {
    const delivery: PersonalFillPageDelivery = {
      message: { type, payload: { origin, requestId } },
      sender: { id: senderId },
      sendResponse: this.responses,
    }
    return this.receiver.receive(delivery)
  }
}

describe('personal-fill page notices', () => {
  test('an owned selection from this extension starts the fill and is acknowledged', () => {
    const fixture = new PersonalReceptionFixture()
    expect(
      fixture.deliver(PersonalFillMessageType.Selected, 'nook-extension'),
    ).toBe(PersonalFillReception.Responded)
    expect(fixture.selected).toHaveBeenCalledOnce()
    expect(fixture.responses).toHaveBeenCalledWith({
      kind: PersonalFillPageResponseKind.Acknowledged,
    })
  })

  test('an owned cancellation returns control to the person', () => {
    const fixture = new PersonalReceptionFixture()
    expect(
      fixture.deliver(PersonalFillMessageType.Canceled, 'nook-extension'),
    ).toBe(PersonalFillReception.Responded)
    expect(fixture.canceled).toHaveBeenCalledOnce()
    expect(fixture.selected).not.toHaveBeenCalled()
  })

  test.each([
    [
      'another extension',
      'other-extension',
      'personal-request',
      location.origin,
    ],
    ['another request', 'nook-extension', 'foreign-request', location.origin],
    [
      'another origin',
      'nook-extension',
      'personal-request',
      'https://other.example',
    ],
  ])('ignores a selection from %s', (_, sender, requestId, origin) => {
    const fixture = new PersonalReceptionFixture()
    expect(
      fixture.deliver(
        PersonalFillMessageType.Selected,
        sender,
        requestId,
        origin,
      ),
    ).toBe(PersonalFillReception.Ignored)
    expect(fixture.selected).not.toHaveBeenCalled()
    expect(fixture.responses).not.toHaveBeenCalled()
  })
})
