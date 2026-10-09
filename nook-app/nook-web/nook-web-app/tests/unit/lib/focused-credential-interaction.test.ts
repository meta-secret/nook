import { Deferred, Effect, Fiber } from 'effect'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
vi.hoisted(() => {
  type FocusedChromePlatformFixture = {
    readonly runtime: Pick<typeof chrome.runtime, 'id'> & {
      readonly onMessage: Pick<typeof chrome.runtime.onMessage, 'addListener'>
    }
  }
  const chromeFixture: FocusedChromePlatformFixture = {
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
  AuthenticationWorkflowAction,
  AuthenticationWorkflowKind,
  AuthenticationWorkflowSnapshotResponseKind,
  AuthenticationWorkflowStage,
  LoginPickerOpenResponseKind,
  NookPageInputFieldObservation,
  classify_companion_focused_credential_field,
  parse_page_input_type,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  CompanionWasmSessionMessageType,
  type CompanionWasmSessionMessage,
} from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import { GoogleLoginContinuationMessageType } from '../../../../nook-web-shared/src/extension/google-login-continuation-messages'
import {
  WebsiteLoginSelectedMessageType,
  type WebsiteLoginSelectedMessage,
} from '../../../../nook-web-extension/src/lib/login-picker-messages'
import {
  FocusedCredentialTargetSensor,
  FocusedCredentialTargetKind,
} from '../../../../nook-web-extension/src/content/autofill/focused-credential-target'
import { PilotVaultConnectionKind } from '../../../../nook-web-extension/src/content/autofill/widget-presentation-state'
import {
  scanState,
  widgetState,
  WidgetCredentialActuation,
  WidgetSelectionAdmission,
} from '../../../../nook-web-extension/src/content/autofill/state'
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
import {
  passwordFieldDiscovery,
  passwordFormInteraction,
  passwordFormCredentialInteraction,
} from '../../../../nook-web-shared/src/extension/password-forms'
import { AuthenticationScanRenderLifecycle } from '../../../../nook-web-extension/src/content/autofill'
import { authenticationWidgetRenderer } from '../../../../nook-web-extension/src/content/autofill/widget-rendering'
import {
  loginSaveInteraction,
  PendingSaveOfferLoadKind,
} from '../../../../nook-web-extension/src/content/autofill/login-save'
import { recoveryCopyObservation } from '../../../../nook-web-extension/src/lib/backup-code-candidates'
import { pageQrCapture } from '../../../../nook-web-extension/src/lib/page-qr-capture'
import { authenticatorEnrollmentInteraction } from '../../../../nook-web-extension/src/content/enrollment-flow'

import { FocusedFieldRecognitionOperation } from '../../../../nook-web-extension/src/offscreen/session-focused-field-recognition'
import type { WebsiteFocusedLoginFillResponse } from '../../../../nook-web-extension/src/lib/focused-login-fill-messages'

enum FocusedFixtureSignal {
  Entered = 'entered',
  Released = 'released',
}
enum FocusedRevealFailure {
  Unavailable = 'unavailable',
  Rejected = 'rejected',
  Failed = 'failed',
}
enum VkPasswordTargetMutation {
  Removed = 'removed',
  Disabled = 'disabled',
  Readonly = 'readonly',
  Role = 'role',
  MessageOrigin = 'origin',
  PageOrigin = 'page-origin',
}
type VkPasswordTargetMutationRequest = {
  readonly mutation: VkPasswordTargetMutation
}
type FocusedRevealDelivery = Awaited<
  ReturnType<
    typeof authenticationRuntimeTransport.sendDecodedRuntimeMessage<WebsiteFocusedLoginFillResponse>
  >
>
type FocusedSnapshotMessage = Parameters<
  typeof authenticationRuntimeTransport.sendAuthenticationWorkflowSnapshotRuntimeMessage
>[0]
type FocusedFixtureLogin = {
  readonly secretId: string
  readonly username: string
}
type FocusedScanBrowser = { readonly runtime: { readonly id: string } }
type FocusedInteractionFixtureContext = {
  readonly self: FocusedInteractionFixture
}

class FocusedInteractionFixture {
  static readonly FAILURE_SCENARIOS: readonly FocusedRevealFailure[] = [
    FocusedRevealFailure.Unavailable,
    FocusedRevealFailure.Rejected,
    FocusedRevealFailure.Failed,
  ]
  static readonly SCAN_BURSTS: readonly number[] = [0, 4]
  private readonly generatorContext: FocusedInteractionFixtureContext = {
    self: this,
  }
  readonly classificationStarted = Effect.runSync(
    Deferred.make<FocusedFixtureSignal>(),
  )
  readonly classificationReleased = Effect.runSync(
    Deferred.make<FocusedFixtureSignal>(),
  )
  readonly connectionStarted = Effect.runSync(
    Deferred.make<FocusedFixtureSignal>(),
  )
  readonly connectionReleased = Effect.runSync(
    Deferred.make<FocusedFixtureSignal>(),
  )
  readonly revealStarted = Effect.runSync(Deferred.make<FocusedFixtureSignal>())
  readonly revealReleased = Effect.runSync(
    Deferred.make<FocusedFixtureSignal>(),
  )
  activeAtReveal = WidgetCredentialActuation.Idle

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
      case CompanionWasmSessionMessageType.GetAuthenticationActivityProgress:
      case GoogleLoginContinuationMessageType.Session:
      case CompanionWasmSessionMessageType.ProjectAuthenticationLoginChecklist:
      case CompanionWasmSessionMessageType.ExtractAuthenticationBackupCodeCandidates:
      case CompanionWasmSessionMessageType.ProjectAuthenticationNavigationPath:
      case CompanionWasmSessionMessageType.AuthenticationAuthenticatorSetupObservation:
      case CompanionWasmSessionMessageType.AuthenticationWorkflowPilotPresentationCapability:
      case CompanionWasmSessionMessageType.PasswordWorkflowActivity:
      case CompanionWasmSessionMessageType.BindAuthenticationPageObservationFacts:
      case CompanionWasmSessionMessageType.AuthenticationPageObservationFactsMatchBinding:
      case CompanionWasmSessionMessageType.AuthenticationEnrollmentWorkflowMatch:
      case CompanionWasmSessionMessageType.HasLoginContext:
      case CompanionWasmSessionMessageType.ClassifyPageInputField:
      case CompanionWasmSessionMessageType.ClassifyPageInputs:
      case CompanionWasmSessionMessageType.LooksLikeLoginAdvanceControlLabel:
      case CompanionWasmSessionMessageType.LooksLikeManualCheckpointLabel:
      case CompanionWasmSessionMessageType.LooksLikePasskeyControlLabel:
      case CompanionWasmSessionMessageType.LooksLikeEmailVerificationBody:
      case CompanionWasmSessionMessageType.LooksLikeOneTimeCodeAutoSubmitSignal:
      case CompanionWasmSessionMessageType.AuthenticationRecoveryCopyEvidence:
      case CompanionWasmSessionMessageType.IsNookVaultAppUrl:
      case CompanionWasmSessionMessageType.DecodeAuthenticationWorkflowRuntimeResponse:
      case CompanionWasmSessionMessageType.DecodeContentRuntimeResponse:
      case CompanionWasmSessionMessageType.EvaluateAuthenticationPolicies:
      case CompanionWasmSessionMessageType.RevalidateApprovedAuthenticationWorkflow:
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
      scanSequence: () => scanState.sequence,
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

  pauseClassification(): void {
    vi.mocked(
      authenticationRuntimeTransport.sendCompanionWasmRuntimeMessage,
    ).mockImplementationOnce(this.delayedClassification.bind(this))
  }
  private delayedClassification() {
    return Effect.runPromise(
      Effect.gen(this.generatorContext, function* () {
        yield* Deferred.succeed(
          this.classificationStarted,
          FocusedFixtureSignal.Entered,
        )
        yield* Deferred.await(this.classificationReleased)
        const unavailable: Awaited<
          ReturnType<
            typeof authenticationRuntimeTransport.sendCompanionWasmRuntimeMessage
          >
        > = { kind: RuntimeMessageDeliveryKind.Unavailable }
        return unavailable
      }),
    )
  }
  pauseReveal(): void {
    this.reveal.mockImplementation(this.delayedReveal.bind(this))
  }
  private delayedReveal() {
    return Effect.runPromise(
      Effect.gen(this.generatorContext, function* () {
        yield* Deferred.succeed(
          this.revealStarted,
          FocusedFixtureSignal.Entered,
        )
        yield* Deferred.await(this.revealReleased)
        const response: FocusedRevealDelivery = {
          kind: RuntimeMessageDeliveryKind.Delivered,
          response: { ok: true, value: 'chosen-username' },
        }
        return response
      }),
    )
  }
  private delayedConnection() {
    return Effect.runPromise(
      Effect.gen(this.generatorContext, function* () {
        yield* Deferred.succeed(
          this.connectionStarted,
          FocusedFixtureSignal.Entered,
        )
        yield* Deferred.await(this.connectionReleased)
        const connection: Awaited<
          ReturnType<typeof workflowUi.loadPilotVaultConnection>
        > = { kind: PilotVaultConnectionKind.Connected }
        return connection
      }),
    )
  }
  preparePendingScan() {
    vi.mocked(workflowUi.loadPilotVaultConnection).mockImplementationOnce(
      this.delayedConnection.bind(this),
    )
    this.pauseReveal()
    vi.spyOn(
      authenticatorEnrollmentInteraction,
      'enrollmentScanBlocked',
    ).mockReturnValue(false)
    const classifications = vi
      .spyOn(passwordFieldDiscovery, 'prepareCompanionClassification')
      .mockImplementation(() => Effect.runPromise(Effect.void))
    vi.spyOn(
      passwordFormInteraction,
      'prepareCompanionWorkflowPolicies',
    ).mockImplementation(() => Effect.runPromise(Effect.void))
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
    const snapshots = vi
      .spyOn(
        authenticationRuntimeTransport,
        'sendAuthenticationWorkflowSnapshotRuntimeMessage',
      )
      .mockImplementation(this.snapshot.bind(this))
    const publications = vi
      .spyOn(authenticationWidgetRenderer, 'renderWidget')
      .mockImplementation(() =>
        Effect.runPromise(
          Effect.sync(workflowUi.removeWidget.bind(workflowUi)),
        ),
      )
    return { classifications, snapshots, publications }
  }
  private snapshot(message: FocusedSnapshotMessage) {
    // Browser snapshot carries the Rust-projected count, never credential material.
    const loginCapacity: ArrayLike<FocusedFixtureLogin> = { length: 1300 }
    const savedLogins = Array.from(loginCapacity, (_, index) => ({
      secretId: `fixture-${index}`,
      username: `account-${index}@nook.test`,
    }))
    const facts = message.payload.observations[0]
    switch (true) {
      case !facts:
        throw new Error('Expected workflow facts for the pending scan')
      case true:
        break
    }
    const response: Awaited<
      ReturnType<
        typeof authenticationRuntimeTransport.sendAuthenticationWorkflowSnapshotRuntimeMessage
      >
    > = {
      kind: RuntimeMessageDeliveryKind.Delivered,
      response: {
        verdict: {
          kind: AuthenticationWorkflowSnapshotResponseKind.Matched,
          snapshot: {
            kind: AuthenticationWorkflowKind.Login,
            stage: AuthenticationWorkflowStage.Credentials,
            action: AuthenticationWorkflowAction.ContinueWithNook,
            currentStep: 1,
            totalSteps: 3,
            approvalRequirement: 'explicit-user-approval',
            savedLoginCapability: 'fill-saved-login',
            observationIndex: 0,
          },
        },
        loginMatches: { kind: 'ready', count: savedLogins.length },
        selectedFacts: { state: 'selected', facts },
        pilotCapability: 'propose-action',
        factsBindingToken: 'fixture-binding',
        savedLoginActionAvailable: true,
      },
    }

    return Effect.runPromise(Effect.succeed(response))
  }
  failReveal(outcome: FocusedRevealFailure): void {
    this.reveal.mockImplementation(this.failureDelivery.bind(this, outcome))
  }
  private failureDelivery(outcome: FocusedRevealFailure) {
    return Effect.runPromise(
      Effect.gen(this.generatorContext, function* () {
        this.activeAtReveal = widgetState.credentialActuation
        switch (outcome) {
          case FocusedRevealFailure.Unavailable: {
            const unavailable: FocusedRevealDelivery = {
              kind: RuntimeMessageDeliveryKind.Unavailable,
            }
            return unavailable
          }
          case FocusedRevealFailure.Rejected: {
            const rejected: FocusedRevealDelivery = {
              kind: RuntimeMessageDeliveryKind.Delivered,
              response: { ok: false, reason: 'login-locked' },
            }
            return rejected
          }
          case FocusedRevealFailure.Failed:
            return yield* Effect.fail(new Error('Fixture transport failed'))
        }
      }),
    )
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

  readonly verifyVkPasswordSelection = Effect.fn(
    this.generatorContext,
    function* () {
      vi.spyOn(location, 'origin', 'get').mockReturnValue('https://id.vk.ru')
      vi.spyOn(location, 'href', 'get').mockReturnValue('https://id.vk.ru/auth')
      this.input.type = 'password'
      this.input.autocomplete = 'current-password'
      this.other.type = 'hidden'
      this.other.autocomplete = 'username'
      this.other.value = 'already-selected-vk-user'
      this.input.click()
      expect(yield* Effect.tryPromise(() => this.interaction.tryRender())).toBe(
        FocusedUiDisposition.Ready,
      )
      expect(this.input.value).toBe('')
      expect(this.reveal).not.toHaveBeenCalled()
      yield* Effect.tryPromise(() => this.interaction.choose())
      this.mounts[0]?.shell.continueButton.focus()
      expect(
        yield* Effect.tryPromise(() =>
          this.interaction.verifyPicker('focused-request'),
        ),
      ).toBe(FocusedUiDisposition.Ready)
      expect(this.reveal).not.toHaveBeenCalled()
      const released = { ok: true as const, value: 'chosen-password' }
      const response: Awaited<
        ReturnType<
          typeof authenticationRuntimeTransport.sendDecodedRuntimeMessage<WebsiteFocusedLoginFillResponse>
        >
      > = { kind: RuntimeMessageDeliveryKind.Delivered, response: released }
      this.reveal.mockImplementation(() =>
        Effect.runPromise(Effect.succeed(response)),
      )
      yield* Effect.tryPromise(() => this.interaction.select(this.selected()))
      expect(this.input.value).toBe('chosen-password')
      expect(this.other.value).toBe('already-selected-vk-user')
      expect(released.value).toBe('')
      expect(this.submit).not.toHaveBeenCalled()
      const expected: {
        payload: {
          origin: string
          credential: ReturnType<
            FocusedInteractionFixture['selection']
          >['credential']
        }
      } = {
        payload: {
          origin: 'https://id.vk.ru',
          credential: this.selection().credential,
        },
      }
      expect(this.reveal.mock.calls[0]?.[0].message).toMatchObject(expected)
    },
  )

  readonly verifyVkTargetMutation = Effect.fn(
    this.generatorContext,
    function* ({ mutation }: VkPasswordTargetMutationRequest) {
      vi.spyOn(location, 'origin', 'get').mockReturnValue('https://id.vk.ru')
      this.input.type = 'password'
      this.input.autocomplete = 'current-password'
      this.input.click()
      yield* Effect.tryPromise(() => this.interaction.tryRender())
      yield* Effect.tryPromise(() => this.interaction.choose())
      const message = this.selected()
      switch (mutation) {
        case VkPasswordTargetMutation.Removed:
          this.input.remove()
          break
        case VkPasswordTargetMutation.Disabled:
          this.input.disabled = true
          break
        case VkPasswordTargetMutation.Readonly:
          this.input.readOnly = true
          break
        case VkPasswordTargetMutation.Role:
          this.input.autocomplete = 'one-time-code'
          break
        case VkPasswordTargetMutation.MessageOrigin:
          message.payload.origin = 'https://other.example'
          break
        case VkPasswordTargetMutation.PageOrigin:
          vi.spyOn(location, 'origin', 'get').mockReturnValue('https://vk.com')
          break
      }
      yield* Effect.tryPromise(() => this.interaction.select(message))
      expect(this.reveal).not.toHaveBeenCalled()
      expect(this.input.value).toBe('')
      expect(this.other.value).toBe('')
      expect(this.submit).not.toHaveBeenCalled()
    },
  )
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
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('focused credential explicit chooser flow', () => {
  test('an unavailable pending focused classification cannot clear an approved selected target', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fixture = new FocusedInteractionFixture()
        fixture.input.click()
        yield* Effect.tryPromise(() => fixture.interaction.tryRender())
        yield* Effect.tryPromise(() => fixture.interaction.choose())
        fixture.pauseClassification()
        fixture.pauseReveal()
        const pendingRender = yield* Effect.forkChild(
          Effect.tryPromise(() => fixture.interaction.tryRender()),
        )
        yield* Deferred.await(fixture.classificationStarted)
        const selected = yield* Effect.forkChild(
          Effect.tryPromise(() =>
            fixture.interaction.select(fixture.selected()),
          ),
        )
        yield* Deferred.await(fixture.revealStarted)
        yield* Deferred.succeed(
          fixture.classificationReleased,
          FocusedFixtureSignal.Released,
        )
        yield* Fiber.join(pendingRender)
        yield* Deferred.succeed(
          fixture.revealReleased,
          FocusedFixtureSignal.Released,
        )
        yield* Fiber.join(selected)
        expect(fixture.input.value).toBe('chosen-username')
        expect(fixture.other.value).toBe('')
        expect(fixture.submit).not.toHaveBeenCalled()
      }),
    ))
  test.each(FocusedInteractionFixture.SCAN_BURSTS)(
    'keeps the selected field through delayed reveal, a pending scan and %i new scans for 1300 saved logins',
    (newScans) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const fixture = new FocusedInteractionFixture()
          const browserFixture: FocusedScanBrowser = { runtime: { id: '' } }
          vi.stubGlobal('chrome', browserFixture)
          fixture.input.click()
          yield* Effect.tryPromise(() => fixture.interaction.tryRender())
          yield* Effect.tryPromise(() => fixture.interaction.choose())
          const advance = document.createElement('button')
          advance.type = 'submit'
          advance.textContent = 'Sign in'
          fixture.input.closest('form')?.append(advance)
          const { classifications, snapshots, publications } =
            fixture.preparePendingScan()
          const lifecycleRequest: ConstructorParameters<
            typeof AuthenticationScanRenderLifecycle
          >[0] = { scanState }
          const lifecycle = new AuthenticationScanRenderLifecycle(
            lifecycleRequest,
          )
          const pendingScan = yield* Effect.forkChild(
            Effect.tryPromise(() => lifecycle.scanAndRender()),
          )
          yield* Effect.raceFirst(
            Deferred.await(fixture.connectionStarted),
            Fiber.join(pendingScan).pipe(
              Effect.andThen(
                Effect.fail(
                  new Error(
                    'Pending scan ended before the vault connection pause',
                  ),
                ),
              ),
            ),
          )
          const selected = yield* Effect.forkChild(
            Effect.tryPromise(() =>
              fixture.interaction.select(fixture.selected()),
            ),
          )
          yield* Deferred.await(fixture.revealStarted)
          const activeDuringReveal = widgetState.credentialActuation
          for (let index = 0; index < newScans; index += 1) {
            yield* Effect.tryPromise(lifecycle.scanAndRender.bind(lifecycle))
          }
          yield* Deferred.succeed(
            fixture.connectionReleased,
            FocusedFixtureSignal.Released,
          )
          yield* Fiber.join(pendingScan)
          yield* Deferred.succeed(
            fixture.revealReleased,
            FocusedFixtureSignal.Released,
          )
          yield* Fiber.join(selected)
          expect
            .soft(activeDuringReveal)
            .toBe(WidgetCredentialActuation.FocusedSelection)
          expect.soft(fixture.input.value).toBe('chosen-username')
          expect.soft(fixture.other.value).toBe('')
          expect.soft(fixture.submit).not.toHaveBeenCalled()
          expect.soft(classifications).toHaveBeenCalledTimes(1)
          expect.soft(snapshots).toHaveBeenCalledTimes(1)
          expect.soft(publications).not.toHaveBeenCalled()
          expect(widgetState.credentialActuation).toBe(
            WidgetCredentialActuation.Idle,
          )
          expect(widgetState.selectionAdmission()).toBe(
            WidgetSelectionAdmission.Available,
          )
          expect(scanState.schedule).toHaveBeenCalledOnce()
        }),
      ),
  )

  test.each(FocusedInteractionFixture.FAILURE_SCENARIOS)(
    'releases selected actuation ownership after %s reveal',
    (outcome) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const fixture = new FocusedInteractionFixture()
          fixture.input.click()
          yield* Effect.tryPromise(() => fixture.interaction.tryRender())
          yield* Effect.tryPromise(() => fixture.interaction.choose())
          fixture.failReveal(outcome)
          yield* Effect.tryPromise(() =>
            fixture.interaction.select(fixture.selected()),
          )
          expect(fixture.activeAtReveal).toBe(
            WidgetCredentialActuation.FocusedSelection,
          )
          expect(widgetState.credentialActuation).toBe(
            WidgetCredentialActuation.Idle,
          )
          expect(widgetState.selectionAdmission()).toBe(
            WidgetSelectionAdmission.Available,
          )
          expect(fixture.input.value).toBe('')
        }),
      ),
  )
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

  test('fills only the explicitly selected VK password-step field and clears the returned value', () => {
    const fixture = new FocusedInteractionFixture()
    return Effect.runPromise(fixture.verifyVkPasswordSelection())
  })

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

  test.each([
    VkPasswordTargetMutation.Removed,
    VkPasswordTargetMutation.Disabled,
    VkPasswordTargetMutation.Readonly,
    VkPasswordTargetMutation.Role,
    VkPasswordTargetMutation.MessageOrigin,
    VkPasswordTargetMutation.PageOrigin,
  ])(
    'rejects VK current-password %s mutation before selected disclosure',
    (mutation) => {
      const fixture = new FocusedInteractionFixture()
      const request: VkPasswordTargetMutationRequest = { mutation }
      return Effect.runPromise(fixture.verifyVkTargetMutation(request))
    },
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
