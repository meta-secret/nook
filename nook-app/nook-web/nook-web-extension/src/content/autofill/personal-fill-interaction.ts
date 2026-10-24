import { Effect } from 'effect'
import type {
  PersonalFieldClassification,
  PersonalFillPlan,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type {
  CompanionWasmRuntimeMessage,
  CompanionWasmSessionResponse,
} from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import { passwordFormCredentialInteraction } from '../../../../nook-web-shared/src/extension/password-forms'
import {
  PersonalFillMessageType,
  PersonalFillMessages,
  PersonalFillOpenResponseKind,
  PersonalFillRevealResponseKind,
  type PersonalFillCancelMessage,
  type PersonalFillOpenMessage,
  type PersonalFillOpenResponse,
  type PersonalFillPageMessage,
  type PersonalFillRevealMessage,
  type PersonalFillRevealResponse,
  type PersonalFillRevealedValues,
} from '../../lib/personal-fill-messages'
import { BROWSER_MESSAGE_KEYS } from '../../lib/browser-message-keys'
import {
  FocusedCredentialTargetKind,
  FocusedCredentialTargetRetention,
  FocusedCredentialTargetSensor,
  FocusedCredentialTargetValidity,
  type RetainedFocusedCredentialTarget,
} from './focused-credential-target'
import {
  PersonalFillPlanKind,
  PersonalFillScope,
  PersonalFillScopeCurrentness,
  type PersonalFillInputMutation,
  type PersonalFillPlanReading,
} from './personal-fill-scope'
import { PersonalFillWidget } from './personal-fill-widget'
import {
  PersonalPickerFrame,
  type PersonalPickerFrameMount,
  type PersonalPickerFrameSurface,
} from './personal-picker-frame'
import { SiteSidePanel } from './site-side-panel'
import {
  authenticationRuntimeTransport,
  RuntimeMessageDeliveryKind,
} from './runtime-message-adapter'
import {
  scanState,
  widgetState,
  WidgetCredentialActuation,
  WidgetSelectionAdmission,
} from './state'
import { workflowUi } from './workflow-ui'

export enum PersonalFillSurfaceKind {
  Empty = 'empty',
  Visible = 'visible',
}
export enum PersonalFillDisposition {
  Ready = 'ready',
  Unavailable = 'unavailable',
}
export enum PersonalFillPickerOwnership {
  Owned = 'owned',
  Unowned = 'unowned',
}
enum PersonalPickerKind {
  Closed = 'closed',
  Opening = 'opening',
  Open = 'open',
}
enum PersonalFillSurfaceReuse {
  Reuse = 'reuse',
  Replace = 'replace',
}
enum PersonalFieldRecognition {
  Personal = 'personal',
  Other = 'other',
}
enum PersonalFillEpochCurrentness {
  Current = 'current',
  Superseded = 'superseded',
}
type PersonalPicker =
  | { readonly kind: PersonalPickerKind.Closed }
  | { readonly kind: PersonalPickerKind.Opening }
  | {
      readonly kind: PersonalPickerKind.Open
      readonly requestId: string
      readonly timeout: number
      readonly surface: PersonalPickerFrameSurface
    }
type PersonalFillSurface =
  | { readonly kind: PersonalFillSurfaceKind.Empty }
  | {
      readonly kind: PersonalFillSurfaceKind.Visible
      readonly scope: PersonalFillScope
      readonly plan: PersonalFillPlan
      readonly widget: PersonalFillWidget
    }
type VisiblePersonalFillSurface = Extract<
  PersonalFillSurface,
  { kind: PersonalFillSurfaceKind.Visible }
>
type PersonalFillRenderRequest = {
  readonly scope: PersonalFillScope
  readonly plan: PersonalFillPlan
  readonly epoch: number
}
type PersonalPickerAcceptance = {
  readonly surface: VisiblePersonalFillSurface
  readonly response: PersonalFillOpenResponse
}
type PersonalPickerOpening = {
  readonly surface: VisiblePersonalFillSurface
  readonly requestId: string
  readonly expiresAt: number
}
type PersonalFillSelection = {
  readonly surface: VisiblePersonalFillSurface
  readonly requestId: string
}
type PersonalFillRevealed = {
  readonly surface: VisiblePersonalFillSurface
  readonly response: PersonalFillRevealResponse
}
type PersonalFillValuesWrite = {
  readonly surface: VisiblePersonalFillSurface
  readonly values: PersonalFillRevealedValues
}
type PersonalFillInteractionDependencies = {
  readonly sensor: FocusedCredentialTargetSensor
  readonly transport: typeof authenticationRuntimeTransport
  readonly ui: typeof workflowUi
  readonly mount: typeof PersonalFillWidget.mount
  readonly mountPicker: (
    request: PersonalPickerFrameMount,
  ) => PersonalPickerFrameSurface
  readonly fill: (mutation: PersonalFillInputMutation) => void
  readonly openSidePanel: () => void
}
type PersonalFillInteractionGeneratorContext = {
  readonly self: PersonalFillInteraction
}

/**
 * Offers a personal-data fill when the focused field has no credential
 * opportunity. Rust classifies the field and plans the form scope; the page
 * keeps only elements and the plan, and holds revealed values for one fill.
 */
export class PersonalFillInteraction {
  private readonly generatorContext: PersonalFillInteractionGeneratorContext = {
    self: this,
  }
  private surface: PersonalFillSurface = {
    kind: PersonalFillSurfaceKind.Empty,
  }
  private picker: PersonalPicker = { kind: PersonalPickerKind.Closed }
  private epoch = 0

  constructor(
    private readonly dependencies: PersonalFillInteractionDependencies,
  ) {}

  get hasSurface(): PersonalFillSurfaceKind {
    return this.surface.kind
  }

  private recognition(
    response: CompanionWasmSessionResponse,
  ): PersonalFieldRecognition {
    switch (true) {
      case typeof response === 'object' &&
        'personalFieldClassification' in response:
        return this.classificationRecognition(
          response.personalFieldClassification,
        )
      case true:
        return PersonalFieldRecognition.Other
    }
    return PersonalFieldRecognition.Other
  }

  private classificationRecognition(
    classification: PersonalFieldClassification,
  ): PersonalFieldRecognition {
    switch (typeof classification) {
      case 'object':
        return PersonalFieldRecognition.Personal
      case 'string':
      case 'number':
      case 'bigint':
      case 'boolean':
      case 'symbol':
      case 'undefined':
      case 'function':
        return PersonalFieldRecognition.Other
    }
  }

  private opportunity(
    response: CompanionWasmSessionResponse,
  ): PersonalFillPlanReading {
    switch (true) {
      case typeof response === 'object' &&
        'personalFillOpportunity' in response:
        return PersonalFillScope.reading(response.personalFillOpportunity)
      case true:
        return { kind: PersonalFillPlanKind.Unavailable }
    }
    return { kind: PersonalFillPlanKind.Unavailable }
  }

  private send(message: CompanionWasmRuntimeMessage) {
    return Effect.tryPromise(() =>
      this.dependencies.transport.sendCompanionWasmRuntimeMessage(message),
    )
  }

  /** Rust classifies the focused field first and plans its scope only when it is personal. */
  private planFor = Effect.fn(
    this.generatorContext,
    function* (scope: PersonalFillScope) {
      const unavailable: PersonalFillPlanReading = {
        kind: PersonalFillPlanKind.Unavailable,
      }
      const classification = yield* this.send(scope.classificationRequest)
      switch (classification.kind) {
        case RuntimeMessageDeliveryKind.Unavailable:
          return unavailable
        case RuntimeMessageDeliveryKind.Delivered:
          break
      }
      switch (this.recognition(classification.response)) {
        case PersonalFieldRecognition.Other:
          return unavailable
        case PersonalFieldRecognition.Personal:
          break
      }
      const planned = yield* this.send(scope.planRequest)
      switch (planned.kind) {
        case RuntimeMessageDeliveryKind.Unavailable:
          return unavailable
        case RuntimeMessageDeliveryKind.Delivered:
          return this.opportunity(planned.response)
      }
    },
  )

  private epochCurrentness(epoch: number): PersonalFillEpochCurrentness {
    switch (epoch === this.epoch) {
      case true:
        return PersonalFillEpochCurrentness.Current
      case false:
        return PersonalFillEpochCurrentness.Superseded
    }
  }

  private targetDisposition(
    target: RetainedFocusedCredentialTarget,
  ): PersonalFillDisposition {
    switch (
      this.dependencies.sensor.retains(target) ===
        FocusedCredentialTargetRetention.Retained &&
      this.dependencies.sensor.validity(target) ===
        FocusedCredentialTargetValidity.Current
    ) {
      case true:
        return PersonalFillDisposition.Ready
      case false:
        return PersonalFillDisposition.Unavailable
    }
  }

  private localDisposition(
    surface: VisiblePersonalFillSurface,
  ): PersonalFillDisposition {
    switch (
      this.surface === surface &&
      surface.widget.shell.host.isConnected &&
      !widgetState.dismissed &&
      this.targetDisposition(surface.scope.target) ===
        PersonalFillDisposition.Ready
    ) {
      case true:
        return PersonalFillDisposition.Ready
      case false:
        return PersonalFillDisposition.Unavailable
    }
  }

  /** Revalidates the target, the scope's elements and attributes, and Rust's plan. */
  private current = Effect.fn(
    this.generatorContext,
    function* (surface: VisiblePersonalFillSurface) {
      switch (this.localDisposition(surface)) {
        case PersonalFillDisposition.Unavailable:
          return PersonalFillDisposition.Unavailable
        case PersonalFillDisposition.Ready:
          break
      }
      const fresh = PersonalFillScope.observe(surface.scope.target)
      switch (surface.scope.currentness(fresh)) {
        case PersonalFillScopeCurrentness.Changed:
          return PersonalFillDisposition.Unavailable
        case PersonalFillScopeCurrentness.Current:
          break
      }
      const reading = yield* this.planFor(fresh)
      switch (reading.kind) {
        case PersonalFillPlanKind.Unavailable:
          return PersonalFillDisposition.Unavailable
        case PersonalFillPlanKind.Available:
          break
      }
      switch (
        this.localDisposition(surface) === PersonalFillDisposition.Ready &&
        JSON.stringify(reading.plan) === JSON.stringify(surface.plan)
      ) {
        case true:
          return PersonalFillDisposition.Ready
        case false:
          return PersonalFillDisposition.Unavailable
      }
    },
    Effect.catch(() => Effect.succeed(PersonalFillDisposition.Unavailable)),
  )

  private surfaceReuse(
    request: PersonalFillRenderRequest,
  ): PersonalFillSurfaceReuse {
    const surface = this.surface
    switch (surface.kind) {
      case PersonalFillSurfaceKind.Empty:
        return PersonalFillSurfaceReuse.Replace
      case PersonalFillSurfaceKind.Visible:
        break
    }
    switch (
      surface.scope.target.input === request.scope.target.input &&
      surface.widget.shell.host.isConnected &&
      JSON.stringify(surface.plan) === JSON.stringify(request.plan)
    ) {
      case true:
        return PersonalFillSurfaceReuse.Reuse
      case false:
        return PersonalFillSurfaceReuse.Replace
    }
  }

  private mount = Effect.fn(
    this.generatorContext,
    function* (request: PersonalFillRenderRequest) {
      const vaultConnection = yield* Effect.tryPromise(() =>
        this.dependencies.ui.loadPilotVaultConnection(),
      )
      switch (this.epochCurrentness(request.epoch)) {
        case PersonalFillEpochCurrentness.Superseded:
          return PersonalFillDisposition.Unavailable
        case PersonalFillEpochCurrentness.Current:
          break
      }
      // Replacing a mount keeps the observed field; ordinary teardown clears it.
      widgetState.setRenderedCleanup(() => {})
      this.closePicker()
      this.surface = { kind: PersonalFillSurfaceKind.Empty }
      this.dependencies.ui.removeWidget()
      const mountRequest: Parameters<typeof PersonalFillWidget.mount>[0] = {
        vaultConnection,
        group: request.plan.group,
        choose: () => {
          void this.choose()
        },
      }
      const widget = this.dependencies.mount(mountRequest)
      this.surface = {
        kind: PersonalFillSurfaceKind.Visible,
        scope: request.scope,
        plan: request.plan,
        widget,
      }
      widgetState.setRenderedCleanup(this.clear.bind(this))
      return PersonalFillDisposition.Ready
    },
  )

  tryRender(): Promise<PersonalFillDisposition> {
    const generatorContext: PersonalFillInteractionGeneratorContext = {
      self: this,
    }
    return Effect.runPromise(
      Effect.gen(generatorContext, function* () {
        const target = this.dependencies.sensor.target
        switch (target.kind) {
          case FocusedCredentialTargetKind.Empty:
            this.clear()
            return PersonalFillDisposition.Unavailable
          case FocusedCredentialTargetKind.Retained:
            break
        }
        switch (this.dependencies.sensor.validity(target)) {
          case FocusedCredentialTargetValidity.Changed:
            this.clear()
            return PersonalFillDisposition.Unavailable
          case FocusedCredentialTargetValidity.Current:
            break
        }
        const epoch = this.epoch
        const scope = PersonalFillScope.observe(target)
        const reading = yield* this.planFor(scope)
        switch (
          this.epochCurrentness(epoch) ===
            PersonalFillEpochCurrentness.Current &&
          this.targetDisposition(target) === PersonalFillDisposition.Ready
        ) {
          case false:
            return PersonalFillDisposition.Unavailable
          case true:
            break
        }
        switch (reading.kind) {
          case PersonalFillPlanKind.Unavailable:
            this.clear()
            return PersonalFillDisposition.Unavailable
          case PersonalFillPlanKind.Available:
            break
        }
        const request: PersonalFillRenderRequest = {
          scope,
          plan: reading.plan,
          epoch,
        }
        switch (this.surfaceReuse(request)) {
          case PersonalFillSurfaceReuse.Reuse:
            return PersonalFillDisposition.Ready
          case PersonalFillSurfaceReuse.Replace:
            return yield* this.mount(request)
        }
      }).pipe(Effect.catch(() => Effect.sync(this.failedRender.bind(this)))),
    )
  }

  private failedRender(): PersonalFillDisposition {
    this.clear()
    return PersonalFillDisposition.Unavailable
  }

  clear(): void {
    this.epoch += 1
    this.closePicker()
    this.surface = { kind: PersonalFillSurfaceKind.Empty }
    this.dependencies.sensor.clear()
  }

  /** Releases the frame and its timer; the worker request stays for the reveal. */
  private releasePickerFrame(): PersonalPicker {
    const pending = this.picker
    this.picker = { kind: PersonalPickerKind.Closed }
    switch (pending.kind) {
      case PersonalPickerKind.Closed:
      case PersonalPickerKind.Opening:
        return pending
      case PersonalPickerKind.Open:
        window.clearTimeout(pending.timeout)
        pending.surface.close()
        return pending
    }
  }

  private closePicker(): void {
    const pending = this.releasePickerFrame()
    switch (pending.kind) {
      case PersonalPickerKind.Closed:
      case PersonalPickerKind.Opening:
        return
      case PersonalPickerKind.Open:
        this.cancelRequest(pending.requestId)
    }
  }

  private cancelRequest(requestId: string): void {
    const request: PersonalFillCancelMessage = {
      type: PersonalFillMessageType.Cancel,
      payload: { requestId },
    }
    this.dependencies.transport.sendRuntimeMessageWithoutResponse(request)
  }

  cancelPicker(): void {
    this.clear()
    widgetState.setRenderedCleanup(() => {})
    this.dependencies.ui.removeWidget()
  }

  /** Nook is locked: the side panel unlocks it, and the widget waits for the next click. */
  private awaitUnlock(surface: VisiblePersonalFillSurface): void {
    this.picker = { kind: PersonalPickerKind.Closed }
    this.dependencies.openSidePanel()
    const { description, continueButton } = surface.widget.shell
    description.textContent = this.dependencies.ui.translatedMessage(
      BROWSER_MESSAGE_KEYS.WidgetUnlockThenContinue,
    )
    const unlockLabel = this.dependencies.ui.translatedMessage(
      BROWSER_MESSAGE_KEYS.WidgetUnlock,
    )
    continueButton.textContent = unlockLabel
    continueButton.setAttribute('aria-label', unlockLabel)
  }

  private openPicker = Effect.fn(
    this.generatorContext,
    function* (request: PersonalPickerOpening) {
      const disposition = yield* this.current(request.surface)
      switch (
        disposition === PersonalFillDisposition.Ready &&
        this.picker.kind === PersonalPickerKind.Opening &&
        request.expiresAt > Date.now()
      ) {
        case false:
          this.cancelRequest(request.requestId)
          this.cancelPicker()
          return
        case true:
          break
      }
      const pickerRequest: PersonalPickerFrameMount = {
        requestId: request.requestId,
        continueButton: request.surface.widget.shell.continueButton,
        description: request.surface.widget.shell.description,
        title: this.dependencies.ui.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetPersonalPickerTitle,
        ),
        cancelLabel: this.dependencies.ui.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetEnrollCancel,
        ),
        cancel: this.cancelPicker.bind(this),
      }
      const surface = this.dependencies.mountPicker(pickerRequest)
      const timeout = window.setTimeout(
        this.cancelPicker.bind(this),
        request.expiresAt - Date.now(),
      )
      this.picker = {
        kind: PersonalPickerKind.Open,
        requestId: request.requestId,
        timeout,
        surface,
      }
    },
  )

  private acceptPicker = Effect.fn(
    this.generatorContext,
    function* (acceptance: PersonalPickerAcceptance) {
      const response = acceptance.response
      switch (response.kind) {
        case PersonalFillOpenResponseKind.Ready: {
          const opening: PersonalPickerOpening = {
            surface: acceptance.surface,
            requestId: response.requestId,
            expiresAt: response.expiresAt,
          }
          return yield* this.openPicker(opening)
        }
        case PersonalFillOpenResponseKind.Locked:
          this.awaitUnlock(acceptance.surface)
          return
        case PersonalFillOpenResponseKind.Unavailable:
        case PersonalFillOpenResponseKind.Failed:
          this.cancelPicker()
          return
      }
    },
  )

  choose(): Promise<void> {
    const generatorContext: PersonalFillInteractionGeneratorContext = {
      self: this,
    }
    return Effect.runPromise(
      Effect.gen(generatorContext, function* () {
        switch (widgetState.selectionAdmission()) {
          case WidgetSelectionAdmission.Interacting:
          case WidgetSelectionAdmission.Actuating:
            return
          case WidgetSelectionAdmission.Available:
            break
        }
        const surface = this.surface
        switch (surface.kind) {
          case PersonalFillSurfaceKind.Empty:
            return
          case PersonalFillSurfaceKind.Visible:
            break
        }
        switch (this.picker.kind) {
          case PersonalPickerKind.Open:
          case PersonalPickerKind.Opening:
            return
          case PersonalPickerKind.Closed:
            this.picker = { kind: PersonalPickerKind.Opening }
            break
        }
        switch (yield* this.current(surface)) {
          case PersonalFillDisposition.Unavailable:
            this.cancelPicker()
            return
          case PersonalFillDisposition.Ready:
            break
        }
        const message: PersonalFillOpenMessage = {
          type: PersonalFillMessageType.Open,
          payload: {
            origin: surface.scope.target.origin,
            group: surface.plan.group,
          },
        }
        const request: Parameters<
          typeof authenticationRuntimeTransport.sendDecodedRuntimeMessage<PersonalFillOpenResponse>
        >[0] = {
          message,
          decode: (response) =>
            Effect.runSync(PersonalFillMessages.decodeOpenResponse(response)),
        }
        const delivery = yield* Effect.tryPromise(() =>
          this.dependencies.transport.sendDecodedRuntimeMessage(request),
        )
        switch (delivery.kind) {
          case RuntimeMessageDeliveryKind.Unavailable:
            this.cancelPicker()
            return
          case RuntimeMessageDeliveryKind.Delivered:
            break
        }
        const acceptance: PersonalPickerAcceptance = {
          surface,
          response: delivery.response,
        }
        yield* this.acceptPicker(acceptance)
      }).pipe(Effect.catch(() => Effect.sync(this.cancelPicker.bind(this)))),
    )
  }

  ownsPicker(requestId: string): PersonalFillPickerOwnership {
    switch (this.picker.kind) {
      case PersonalPickerKind.Closed:
      case PersonalPickerKind.Opening:
        return PersonalFillPickerOwnership.Unowned
      case PersonalPickerKind.Open:
        break
    }
    switch (this.picker.requestId === requestId) {
      case true:
        return PersonalFillPickerOwnership.Owned
      case false:
        return PersonalFillPickerOwnership.Unowned
    }
  }

  /** The worker reports the picker's end; the page returns control to the person. */
  canceled(message: PersonalFillPageMessage): void {
    switch (this.ownsPicker(message.payload.requestId)) {
      case PersonalFillPickerOwnership.Unowned:
        return
      case PersonalFillPickerOwnership.Owned:
        this.cancelPicker()
    }
  }

  private wipe(values: PersonalFillRevealedValues): void {
    for (const value of values) {
      value.value = ''
    }
  }

  private write = Effect.fn(
    this.generatorContext,
    function* (write: PersonalFillValuesWrite) {
      switch (yield* this.current(write.surface)) {
        case PersonalFillDisposition.Unavailable:
          return
        case PersonalFillDisposition.Ready:
          break
      }
      const application: Parameters<PersonalFillScope['apply']>[0] = {
        plan: write.surface.plan,
        values: write.values,
        fill: this.dependencies.fill,
      }
      write.surface.scope.apply(application)
    },
  )

  private fillRevealed = Effect.fn(
    this.generatorContext,
    function* (revealed: PersonalFillRevealed) {
      const response = revealed.response
      switch (response.kind) {
        case PersonalFillRevealResponseKind.Locked:
        case PersonalFillRevealResponseKind.Failed:
          return
        case PersonalFillRevealResponseKind.Revealed:
          break
      }
      const values = response.values
      const write: PersonalFillValuesWrite = {
        surface: revealed.surface,
        values,
      }
      yield* this.write(write).pipe(
        Effect.ensuring(Effect.sync(() => this.wipe(values))),
      )
    },
  )

  private reveal = Effect.fn(
    this.generatorContext,
    function* (selection: PersonalFillSelection) {
      const { surface, requestId } = selection
      this.releasePickerFrame()
      switch (yield* this.current(surface)) {
        case PersonalFillDisposition.Unavailable:
          this.cancelRequest(requestId)
          return
        case PersonalFillDisposition.Ready:
          break
      }
      const message: PersonalFillRevealMessage = {
        type: PersonalFillMessageType.Reveal,
        payload: {
          origin: surface.scope.target.origin,
          requestId,
          kinds: [...new Set(surface.plan.fields.map((field) => field.kind))],
        },
      }
      const request: Parameters<
        typeof authenticationRuntimeTransport.sendDecodedRuntimeMessage<PersonalFillRevealResponse>
      >[0] = {
        message,
        decode: (response) =>
          Effect.runSync(PersonalFillMessages.decodeRevealResponse(response)),
      }
      const delivery = yield* Effect.tryPromise(() =>
        this.dependencies.transport.sendDecodedRuntimeMessage(request),
      )
      switch (delivery.kind) {
        case RuntimeMessageDeliveryKind.Unavailable:
          return
        case RuntimeMessageDeliveryKind.Delivered:
          break
      }
      const revealed: PersonalFillRevealed = {
        surface,
        response: delivery.response,
      }
      yield* this.fillRevealed(revealed)
    },
  )

  private acquireSelection(selection: PersonalFillSelection) {
    return Effect.sync(() => {
      widgetState.credentialActuation =
        WidgetCredentialActuation.FocusedSelection
      scanState.invalidatePendingScan()
      return selection
    })
  }

  private releaseSelection() {
    return Effect.sync(() => {
      widgetState.credentialActuation = WidgetCredentialActuation.Idle
      this.cancelPicker()
      scanState.schedule()
    })
  }

  /** Reveals the chosen record's planned values and fills them once, by position. */
  selected(message: PersonalFillPageMessage): Promise<void> {
    const generatorContext: PersonalFillInteractionGeneratorContext = {
      self: this,
    }
    return Effect.runPromise(
      Effect.gen(generatorContext, function* () {
        const surface = this.surface
        switch (surface.kind) {
          case PersonalFillSurfaceKind.Empty:
            return
          case PersonalFillSurfaceKind.Visible:
            break
        }
        switch (
          widgetState.selectionAdmission() ===
            WidgetSelectionAdmission.Available &&
          this.ownsPicker(message.payload.requestId) ===
            PersonalFillPickerOwnership.Owned &&
          message.payload.origin === surface.scope.target.origin
        ) {
          case false:
            return
          case true:
            break
        }
        const selection: PersonalFillSelection = {
          surface,
          requestId: message.payload.requestId,
        }
        yield* Effect.acquireUseRelease(
          this.acquireSelection(selection),
          this.reveal.bind(this),
          this.releaseSelection.bind(this),
        )
      }).pipe(Effect.catch(() => Effect.sync(this.cancelPicker.bind(this)))),
    )
  }
}

const personalSensorRequest: ConstructorParameters<
  typeof FocusedCredentialTargetSensor
>[0] = {
  document,
  schedule: () => {
    scanState.invalidatePendingScan()
    scanState.schedule()
  },
}
export const personalFillTargetSensor = new FocusedCredentialTargetSensor(
  personalSensorRequest,
)
const personalInteractionRequest: PersonalFillInteractionDependencies = {
  sensor: personalFillTargetSensor,
  transport: authenticationRuntimeTransport,
  ui: workflowUi,
  mount: PersonalFillWidget.mount,
  mountPicker: PersonalPickerFrame.mount,
  fill: passwordFormCredentialInteraction.setNativeInputValue.bind(
    passwordFormCredentialInteraction,
  ),
  openSidePanel: SiteSidePanel.open,
}
export const personalFillInteraction = new PersonalFillInteraction(
  personalInteractionRequest,
)
