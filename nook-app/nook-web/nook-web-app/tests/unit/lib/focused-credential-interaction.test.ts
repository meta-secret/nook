import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  LoginPickerOpenResponseKind,
  NookPageInputFieldObservation,
  classify_companion_focused_credential_field,
  parse_page_input_type,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  CompanionWasmSessionMessageType,
  type CompanionWasmSessionMessage,
} from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import {
  WebsiteLoginSelectedMessageType,
  type WebsiteLoginSelectedMessage,
} from '../../../../nook-web-extension/src/lib/login-picker-messages'
import {
  FocusedCredentialTargetSensor,
  FocusedCredentialTargetKind,
} from '../../../../nook-web-extension/src/content/autofill/focused-credential-target'
import { PilotVaultConnectionKind } from '../../../../nook-web-extension/src/content/autofill/widget-presentation-state'
import { widgetState } from '../../../../nook-web-extension/src/content/autofill/state'
import {
  authenticationRuntimeTransport,
  RuntimeMessageDeliveryKind,
} from '../../../../nook-web-extension/src/content/autofill/runtime-message-adapter'
import { workflowUi } from '../../../../nook-web-extension/src/content/autofill/workflow-ui'
import {
  FocusedCredentialInteraction,
  FocusedUiDisposition,
} from '../../../../nook-web-extension/src/content/autofill/focused-credential-interaction'
import type { FocusedCredentialWidget } from '../../../../nook-web-extension/src/content/autofill/focused-credential-widget'
import { passwordFormCredentialInteraction } from '../../../../nook-web-shared/src/extension/password-forms'

import { FocusedFieldRecognitionOperation } from '../../../../nook-web-extension/src/offscreen/session-focused-field-recognition'
import type { WebsiteFocusedLoginFillResponse } from '../../../../nook-web-extension/src/lib/focused-login-fill-messages'

class FocusedInteractionFixture {
  private recognition(
    message: CompanionWasmSessionMessage,
  ): Awaited<
    ReturnType<
      typeof authenticationRuntimeTransport.sendCompanionWasmRuntimeMessage
    >
  > {
    switch (message.type) {
      case CompanionWasmSessionMessageType.ClassifyFocusedCredentialField:
      case CompanionWasmSessionMessageType.RevalidateFocusedCredentialField:
        return {
          kind: RuntimeMessageDeliveryKind.Delivered,
          response: new FocusedFieldRecognitionOperation(message).run(),
        }
      default:
        return { kind: RuntimeMessageDeliveryKind.Unavailable }
    }
  }
  private deliver(message: CompanionWasmSessionMessage) {
    return Effect.runPromise(Effect.sync(() => this.recognition(message)))
  }
  selection() {
    const field = new NookPageInputFieldObservation(
      parse_page_input_type(this.input.type),
      this.input.disabled,
      this.input.readOnly,
      [this.input.autocomplete],
      this.input.name,
      false,
    )
    const recognition = classify_companion_focused_credential_field(field)
    try {
      return recognition.credential_selection()
    } finally {
      recognition.free()
      field.free()
    }
  }
  readonly input = document.createElement('input')
  readonly other = document.createElement('input')
  readonly submit = vi.fn<() => void>()
  readonly release = vi.fn<() => void>()
  readonly reveal = vi.spyOn(
    authenticationRuntimeTransport,
    'sendDecodedRuntimeMessage',
  )
  readonly sensor: FocusedCredentialTargetSensor
  readonly interaction: FocusedCredentialInteraction
  readonly mounts: FocusedCredentialWidget[] = []

  constructor() {
    this.input.autocomplete = 'username'
    this.other.type = 'password'
    const form = document.createElement('form')
    form.addEventListener('submit', this.submit)
    form.append(this.input, this.other)
    document.body.append(form)
    const sensorRequest: ConstructorParameters<
      typeof FocusedCredentialTargetSensor
    >[0] = { document, schedule: () => {} }
    this.sensor = new FocusedCredentialTargetSensor(sensorRequest)
    this.input.addEventListener('click', this.sensor.observe.bind(this.sensor))
    this.input.addEventListener(
      'focusin',
      this.sensor.observe.bind(this.sensor),
    )
    vi.spyOn(
      authenticationRuntimeTransport,
      'sendCompanionWasmRuntimeMessage',
    ).mockImplementation(this.deliver.bind(this))
    vi.spyOn(
      authenticationRuntimeTransport,
      'sendLoginPickerOpenRuntimeMessage',
    ).mockImplementation(() => {
      const response: Awaited<
        ReturnType<
          typeof authenticationRuntimeTransport.sendLoginPickerOpenRuntimeMessage
        >
      > = {
        kind: RuntimeMessageDeliveryKind.Delivered,
        response: {
          kind: LoginPickerOpenResponseKind.Ready,
          requestId: 'focused-request',
          expiresAt: Date.now() + 10000,
        },
      }
      return Effect.runPromise(Effect.succeed(response))
    })
    vi.spyOn(
      authenticationRuntimeTransport,
      'sendRuntimeMessageWithoutResponse',
    ).mockImplementation(() => {})
    this.reveal.mockImplementation(() => {
      const response: Awaited<
        ReturnType<
          typeof authenticationRuntimeTransport.sendDecodedRuntimeMessage<WebsiteFocusedLoginFillResponse>
        >
      > = {
        kind: RuntimeMessageDeliveryKind.Delivered,
        response: { ok: true, value: 'chosen-username' },
      }
      return Effect.runPromise(Effect.succeed(response))
    })
    vi.spyOn(workflowUi, 'loadPilotVaultConnection').mockImplementation(() => {
      const response: Awaited<
        ReturnType<typeof workflowUi.loadPilotVaultConnection>
      > = { kind: PilotVaultConnectionKind.Connected }
      return Effect.runPromise(Effect.succeed(response))
    })
    vi.spyOn(workflowUi, 'translatedMessage').mockReturnValue(
      'Translated fixture',
    )
    const request: ConstructorParameters<
      typeof FocusedCredentialInteraction
    >[0] = {
      scanSequence: () => 0,
      sensor: this.sensor,
      transport: authenticationRuntimeTransport,
      ui: workflowUi,
      mount: (request) => {
        const shell: FocusedCredentialWidget['shell'] = {
          host: document.createElement('aside'),
          panel: document.createElement('div'),
          toolbar: document.createElement('div'),
          body: document.createElement('div'),
          step: document.createElement('p'),
          title: document.createElement('h2'),
          description: document.createElement('p'),
          continueButton: document.createElement('button'),
          openVaultButton: document.createElement('button'),
          collapseButton: document.createElement('button'),
          collapsedLaunch: document.createElement('button'),
        }
        shell.continueButton.addEventListener('click', request.choose)
        shell.host.append(shell.description, shell.continueButton)
        document.body.append(shell.host)
        widgetState.attachHost(shell.host)
        const widget = { shell }
        this.mounts.push(widget)
        return widget
      },
      mountPicker: () => ({ close: this.release }),
      fill: passwordFormCredentialInteraction.setNativeInputValue.bind(
        passwordFormCredentialInteraction,
      ),
    }
    this.interaction = new FocusedCredentialInteraction(request)
  }

  selected(): WebsiteLoginSelectedMessage {
    return {
      type: WebsiteLoginSelectedMessageType.NookWebsiteLoginSelected,
      payload: {
        origin: location.origin,
        requestId: 'focused-request',
        account: {
          vaultStoreId: 'vault',
          secretId: 'secret',
          authorizationGeneration: 'generation',
        },
      },
    }
  }
}

beforeEach(() => {
  widgetState.dismissed = false
})
afterEach(() => {
  workflowUi.removeWidget()
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('focused credential explicit chooser flow', () => {
  test.each(['click', 'focusin'])(
    'renders for %s recognized credential without filling',
    (event) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const fixture = new FocusedInteractionFixture()
          fixture.input.dispatchEvent(new Event(event))
          expect(
            yield* Effect.tryPromise(() => fixture.interaction.tryRender()),
          ).toBe(FocusedUiDisposition.Ready)
          expect(fixture.mounts).toHaveLength(1)
          expect(fixture.reveal).not.toHaveBeenCalled()
          expect(fixture.input.value).toBe('')
        }),
      ),
  )

  test.each([
    'search',
    'newsletter',
    'one-time-code',
    'new-password',
    'unrelated',
  ])('does not render for %s', (role) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fixture = new FocusedInteractionFixture()
        fixture.input.setAttribute('autocomplete', role)
        fixture.input.name = role
        fixture.input.click()
        expect(
          yield* Effect.tryPromise(() => fixture.interaction.tryRender()),
        ).toBe(FocusedUiDisposition.Unavailable)
        expect(fixture.mounts).toHaveLength(0)
      }),
    ),
  )

  test('retains picker target and fills only the explicitly selected field without submit', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fixture = new FocusedInteractionFixture()
        fixture.input.click()
        yield* Effect.tryPromise(() => fixture.interaction.tryRender())
        yield* Effect.tryPromise(() => fixture.interaction.choose())
        fixture.mounts[0]?.shell.continueButton.focus()
        expect(
          yield* Effect.tryPromise(() =>
            fixture.interaction.verifyPicker('focused-request'),
          ),
        ).toBe(FocusedUiDisposition.Ready)
        expect(
          yield* Effect.tryPromise(() => fixture.interaction.tryRender()),
        ).toBe(FocusedUiDisposition.Ready)
        yield* Effect.tryPromise(() =>
          fixture.interaction.select(fixture.selected()),
        )
        expect(fixture.input.value).toBe('chosen-username')
        expect(fixture.other.value).toBe('')
        expect(fixture.submit).not.toHaveBeenCalled()
        expect(fixture.reveal).toHaveBeenCalledOnce()
        const expected: {
          payload: {
            credential: ReturnType<
              FocusedInteractionFixture['selection']
            >['credential']
          }
        } = { payload: { credential: fixture.selection().credential } }
        expect(fixture.reveal.mock.calls[0]?.[0].message).toMatchObject(
          expected,
        )
      }),
    ))

  test('fills only the selected current-password field and clears the returned value', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fixture = new FocusedInteractionFixture()
        fixture.input.type = 'password'
        fixture.input.autocomplete = 'current-password'
        fixture.input.click()
        yield* Effect.tryPromise(() => fixture.interaction.tryRender())
        yield* Effect.tryPromise(() => fixture.interaction.choose())
        const released = { ok: true as const, value: 'chosen-password' }
        const response: Awaited<
          ReturnType<
            typeof authenticationRuntimeTransport.sendDecodedRuntimeMessage<WebsiteFocusedLoginFillResponse>
          >
        > = { kind: RuntimeMessageDeliveryKind.Delivered, response: released }
        fixture.reveal.mockImplementation(() =>
          Effect.runPromise(Effect.succeed(response)),
        )
        yield* Effect.tryPromise(() =>
          fixture.interaction.select(fixture.selected()),
        )
        expect(fixture.input.value).toBe('chosen-password')
        expect(fixture.other.value).toBe('')
        expect(released.value).toBe('')
        expect(fixture.submit).not.toHaveBeenCalled()
        const expected: {
          payload: {
            credential: ReturnType<
              FocusedInteractionFixture['selection']
            >['credential']
          }
        } = { payload: { credential: fixture.selection().credential } }
        expect(fixture.reveal.mock.calls[0]?.[0].message).toMatchObject(
          expected,
        )
      }),
    ))

  test('rejects role drift after release and clears the value without fill or submit', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fixture = new FocusedInteractionFixture()
        fixture.input.click()
        yield* Effect.tryPromise(() => fixture.interaction.tryRender())
        yield* Effect.tryPromise(() => fixture.interaction.choose())
        const released = { ok: true as const, value: 'must-be-cleared' }
        fixture.reveal.mockImplementation(() =>
          Effect.runPromise(
            Effect.sync(() => {
              fixture.input.autocomplete = 'one-time-code'
              return {
                kind: RuntimeMessageDeliveryKind.Delivered,
                response: released,
              }
            }),
          ),
        )
        yield* Effect.tryPromise(() =>
          fixture.interaction.select(fixture.selected()),
        )
        expect(fixture.input.value).toBe('')
        expect(released.value).toBe('')
        expect(fixture.submit).not.toHaveBeenCalled()
      }),
    ))

  test.each(['removed', 'disabled', 'readonly', 'role', 'origin'])(
    'rejects %s mutation before selected disclosure',
    (mutation) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const fixture = new FocusedInteractionFixture()
          fixture.input.click()
          yield* Effect.tryPromise(() => fixture.interaction.tryRender())
          yield* Effect.tryPromise(() => fixture.interaction.choose())
          const message = fixture.selected()
          switch (mutation) {
            case 'removed':
              fixture.input.remove()
              break
            case 'disabled':
              fixture.input.disabled = true
              break
            case 'readonly':
              fixture.input.readOnly = true
              break
            case 'role':
              fixture.input.autocomplete = 'one-time-code'
              break
            case 'origin':
              message.payload.origin = 'https://other.example'
              break
          }
          yield* Effect.tryPromise(() => fixture.interaction.select(message))
          expect(fixture.reveal).not.toHaveBeenCalled()
          expect(fixture.input.value).toBe('')
        }),
      ),
  )

  test.each(['cancel', 'expiry', 'lock', 'teardown'])(
    'requires a fresh interaction after %s',
    async (lifecycle) => {
      vi.useFakeTimers()
      const fixture = new FocusedInteractionFixture()
      fixture.input.click()
      await fixture.interaction.tryRender()
      await fixture.interaction.choose()
      switch (lifecycle) {
        case 'cancel':
          fixture.interaction.cancelPicker()
          break
        case 'expiry':
          vi.advanceTimersByTime(10001)
          break
        case 'lock':
          fixture.interaction.clear()
          workflowUi.removeWidget()
          break
        case 'teardown':
          workflowUi.removeWidget()
          break
      }
      expect(fixture.sensor.target.kind).toBe(FocusedCredentialTargetKind.Empty)
      expect(await fixture.interaction.tryRender()).toBe(
        FocusedUiDisposition.Unavailable,
      )
      const selected = fixture.selected()
      await fixture.interaction.select(selected)
      expect(fixture.reveal).not.toHaveBeenCalled()
      fixture.input.dispatchEvent(new Event('focusin'))
      expect(await fixture.interaction.tryRender()).toBe(
        FocusedUiDisposition.Ready,
      )
    },
  )
  test('does not render when recognition transport is unavailable', async () => {
    const fixture = new FocusedInteractionFixture()
    const unavailable: Awaited<
      ReturnType<
        typeof authenticationRuntimeTransport.sendCompanionWasmRuntimeMessage
      >
    > = { kind: RuntimeMessageDeliveryKind.Unavailable }
    vi.mocked(
      authenticationRuntimeTransport.sendCompanionWasmRuntimeMessage,
    ).mockImplementation(() => Effect.runPromise(Effect.succeed(unavailable)))
    fixture.input.click()
    expect(await fixture.interaction.tryRender()).toBe(
      FocusedUiDisposition.Unavailable,
    )
    expect(fixture.mounts).toHaveLength(0)
    expect(fixture.sensor.target.kind).toBe(FocusedCredentialTargetKind.Empty)
  })
})
