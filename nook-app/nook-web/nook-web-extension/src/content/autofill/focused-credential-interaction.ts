import { Effect } from 'effect'
import {
  FocusedCredentialOpportunity,
  LoginPickerOpenResponseKind,
  type FocusedCredentialSelection,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type { CompanionWasmFocusedRecognitionResponse } from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import {
  WebsiteFocusedLoginRevealMessage,
  WebsiteFocusedLoginRevealMessageType,
  type WebsiteFocusedLoginFillResponse,
} from '../../lib/focused-login-fill-messages'
import {
  WebsiteLoginPickerOpenMessageType,
  LoginPickerCancelMessageType,
  type WebsiteLoginSelectedMessage,
} from '../../lib/login-picker-messages'
import { BROWSER_MESSAGE_KEYS } from '../../lib/browser-message-keys'
import { passwordFormCredentialInteraction } from '../../../../nook-web-shared/src/extension/password-forms'
import { FocusedCredentialObservation } from './focused-credential-observation'
import {
  FocusedCredentialTargetSensor,
  FocusedCredentialTargetKind,
  FocusedCredentialTargetValidity,
  FocusedCredentialTargetRetention,
} from './focused-credential-target'
import { FocusedCredentialWidget } from './focused-credential-widget'
import {
  InlineLoginPicker,
  type InlineLoginPickerSurface,
} from './inline-login-picker'
import {
  authenticationRuntimeTransport,
  RuntimeMessageDeliveryKind,
} from './runtime-message-adapter'
import { scanState, widgetState } from './state'
import { workflowUi } from './workflow-ui'

export enum FocusedSurfaceKind {
  Empty = 'empty',
  Visible = 'visible',
}
export enum FocusedUiDisposition {
  Ready = 'ready',
  Unavailable = 'unavailable',
}
export enum FocusedPickerOwnership {
  Owned = 'owned',
  Unowned = 'unowned',
}
enum FocusedPickerKind {
  Closed = 'closed',
  Opening = 'opening',
  Open = 'open',
}
enum FocusedSurfaceReuse {
  Reuse = 'reuse',
  Replace = 'replace',
}
type FocusedPicker =
  | { readonly kind: FocusedPickerKind.Closed }
  | { readonly kind: FocusedPickerKind.Opening }
  | {
      readonly kind: FocusedPickerKind.Open
      readonly requestId: string
      readonly timeout: number
      readonly surface: InlineLoginPickerSurface
    }
type FocusedSurface =
  | { readonly kind: FocusedSurfaceKind.Empty }
  | {
      readonly kind: FocusedSurfaceKind.Visible
      readonly observation: FocusedCredentialObservation
      readonly opportunity: FocusedCredentialOpportunity
      readonly selection: FocusedCredentialSelection
      readonly widget: FocusedCredentialWidget
    }
type VisibleFocusedSurface = Extract<
  FocusedSurface,
  { kind: FocusedSurfaceKind.Visible }
>
type AvailableFocusedRecognition = Exclude<
  CompanionWasmFocusedRecognitionResponse,
  { focusedOpportunity: FocusedCredentialOpportunity.Unavailable }
>
type FocusedRenderRequest = {
  readonly observation: FocusedCredentialObservation
  readonly recognition: AvailableFocusedRecognition
  readonly epoch: number
  readonly sequence: number
  readonly metadata: string
}
type FocusedPickerMount = {
  readonly surface: VisibleFocusedSurface
  readonly requestId: string
  readonly expiresAt: number
}
type FocusedPickerAcceptance = {
  readonly surface: VisibleFocusedSurface
  readonly response: Awaited<
    ReturnType<
      typeof authenticationRuntimeTransport.sendLoginPickerOpenRuntimeMessage
    >
  >
}
type FocusedReleasedFill = {
  readonly surface: VisibleFocusedSurface
  readonly response: WebsiteFocusedLoginFillResponse
}
type FocusedCurrentFill = {
  readonly surface: VisibleFocusedSurface
  readonly value: { value: string }
}
type PickerMountRequest = Parameters<typeof InlineLoginPicker.mount>[0]
type FocusedInteractionDependencies = {
  readonly scanSequence: () => number
  readonly sensor: FocusedCredentialTargetSensor
  readonly transport: typeof authenticationRuntimeTransport
  readonly ui: typeof workflowUi
  readonly mount: typeof FocusedCredentialWidget.mount
  readonly mountPicker: (
    request: PickerMountRequest,
  ) => InlineLoginPickerSurface
  readonly fill: typeof passwordFormCredentialInteraction.setNativeInputValue
}

/** Owns retained browser target lifetime; Rust owns recognition and disclosure selection. */
export class FocusedCredentialInteraction {
  private surface: FocusedSurface = { kind: FocusedSurfaceKind.Empty }
  private picker: FocusedPicker = { kind: FocusedPickerKind.Closed }
  private epoch = 0
  constructor(private readonly dependencies: FocusedInteractionDependencies) {}
  get hasSurface(): FocusedSurfaceKind {
    return this.surface.kind
  }

  private localDisposition(
    surface: VisibleFocusedSurface,
  ): FocusedUiDisposition {
    switch (
      this.surface === surface &&
      surface.widget.shell.host.isConnected &&
      !widgetState.dismissed &&
      this.dependencies.sensor.retains(surface.observation.target) ===
        FocusedCredentialTargetRetention.Retained &&
      this.dependencies.sensor.validity(surface.observation.target) ===
        FocusedCredentialTargetValidity.Current
    ) {
      case true:
        return FocusedUiDisposition.Ready
      case false:
        return FocusedUiDisposition.Unavailable
    }
  }
  private current(surface: VisibleFocusedSurface) {
    return Effect.gen(this, function* () {
      switch (this.localDisposition(surface)) {
        case FocusedUiDisposition.Unavailable:
          return FocusedUiDisposition.Unavailable
        case FocusedUiDisposition.Ready:
          break
      }
      const request = surface.observation.revalidationRequest(
        surface.opportunity,
      )
      const delivery = yield* Effect.tryPromise(() =>
        this.dependencies.transport.sendCompanionWasmRuntimeMessage(request),
      )
      switch (delivery.kind) {
        case RuntimeMessageDeliveryKind.Unavailable:
          return FocusedUiDisposition.Unavailable
        case RuntimeMessageDeliveryKind.Delivered:
          break
      }
      const recognition = FocusedCredentialObservation.recognition(
        delivery.response,
      )
      switch (recognition.focusedOpportunity) {
        case FocusedCredentialOpportunity.Unavailable:
          return FocusedUiDisposition.Unavailable
        case FocusedCredentialOpportunity.Username:
        case FocusedCredentialOpportunity.CurrentPassword:
          break
      }
      switch (
        this.localDisposition(surface) === FocusedUiDisposition.Ready &&
        JSON.stringify(request) ===
          JSON.stringify(
            surface.observation.revalidationRequest(surface.opportunity),
          ) &&
        recognition.focusedOpportunity === surface.opportunity &&
        recognition.focusedSelection.credential === surface.selection.credential
      ) {
        case true:
          return FocusedUiDisposition.Ready
        case false:
          return FocusedUiDisposition.Unavailable
      }
    }).pipe(
      Effect.catchAll(() => Effect.succeed(FocusedUiDisposition.Unavailable)),
    )
  }
  private renderDisposition(
    request: FocusedRenderRequest,
  ): FocusedUiDisposition {
    switch (
      request.epoch === this.epoch &&
      request.sequence === this.dependencies.scanSequence() &&
      this.dependencies.sensor.target === request.observation.target &&
      this.dependencies.sensor.validity(request.observation.target) ===
        FocusedCredentialTargetValidity.Current &&
      request.metadata ===
        JSON.stringify(request.observation.classificationRequest)
    ) {
      case true:
        return FocusedUiDisposition.Ready
      case false:
        return FocusedUiDisposition.Unavailable
    }
  }
  private surfaceReuse(request: FocusedRenderRequest): FocusedSurfaceReuse {
    const surface = this.surface
    switch (surface.kind) {
      case FocusedSurfaceKind.Empty:
        return FocusedSurfaceReuse.Replace
      case FocusedSurfaceKind.Visible:
        break
    }
    switch (
      surface.observation.target.input === request.observation.target.input &&
      surface.opportunity === request.recognition.focusedOpportunity
    ) {
      case true:
        return FocusedSurfaceReuse.Reuse
      case false:
        return FocusedSurfaceReuse.Replace
    }
  }
  private reuse() {
    const surface = this.surface
    switch (surface.kind) {
      case FocusedSurfaceKind.Empty:
        return Effect.succeed(FocusedUiDisposition.Unavailable)
      case FocusedSurfaceKind.Visible:
        return this.current(surface)
    }
  }
  private mount(request: FocusedRenderRequest) {
    return Effect.gen(this, function* () {
      const vaultConnection = yield* Effect.tryPromise(() =>
        this.dependencies.ui.loadPilotVaultConnection(),
      )
      switch (this.renderDisposition(request)) {
        case FocusedUiDisposition.Unavailable:
          return FocusedUiDisposition.Unavailable
        case FocusedUiDisposition.Ready:
          break
      }
      // Replacing a mount preserves the newly observed field; ordinary teardown clears it.
      widgetState.setRenderedCleanup(() => {})
      this.closePicker()
      this.surface = { kind: FocusedSurfaceKind.Empty }
      this.dependencies.ui.removeWidget()
      const mountRequest: Parameters<typeof FocusedCredentialWidget.mount>[0] =
        {
          vaultConnection,
          choose: () => {
            void this.choose()
          },
        }
      const widget = this.dependencies.mount(mountRequest)
      this.surface = {
        kind: FocusedSurfaceKind.Visible,
        observation: request.observation,
        opportunity: request.recognition.focusedOpportunity,
        selection: request.recognition.focusedSelection,
        widget,
      }
      widgetState.setRenderedCleanup(this.clear.bind(this))
      return FocusedUiDisposition.Ready
    })
  }
  tryRender(): Promise<FocusedUiDisposition> {
    return Effect.runPromise(
      Effect.gen(this, function* () {
        const target = this.dependencies.sensor.target
        switch (target.kind) {
          case FocusedCredentialTargetKind.Empty:
            this.clear()
            return FocusedUiDisposition.Unavailable
          case FocusedCredentialTargetKind.Retained:
            break
        }
        switch (this.dependencies.sensor.validity(target)) {
          case FocusedCredentialTargetValidity.Changed:
            this.clear()
            return FocusedUiDisposition.Unavailable
          case FocusedCredentialTargetValidity.Current:
            break
        }
        const epoch = this.epoch
        const sequence = this.dependencies.scanSequence()
        const observation = new FocusedCredentialObservation(target)
        const classification = observation.classificationRequest
        const metadata = JSON.stringify(classification)
        const delivery = yield* Effect.tryPromise(() =>
          this.dependencies.transport.sendCompanionWasmRuntimeMessage(
            classification,
          ),
        )
        switch (delivery.kind) {
          case RuntimeMessageDeliveryKind.Unavailable:
            this.clear()
            return FocusedUiDisposition.Unavailable
          case RuntimeMessageDeliveryKind.Delivered:
            break
        }
        const recognition = FocusedCredentialObservation.recognition(
          delivery.response,
        )
        switch (recognition.focusedOpportunity) {
          case FocusedCredentialOpportunity.Unavailable:
            this.clear()
            return FocusedUiDisposition.Unavailable
          case FocusedCredentialOpportunity.Username:
          case FocusedCredentialOpportunity.CurrentPassword:
            break
        }
        const request: FocusedRenderRequest = {
          observation,
          recognition,
          epoch,
          sequence,
          metadata,
        }
        switch (this.renderDisposition(request)) {
          case FocusedUiDisposition.Unavailable:
            return FocusedUiDisposition.Unavailable
          case FocusedUiDisposition.Ready:
            break
        }
        switch (this.surfaceReuse(request)) {
          case FocusedSurfaceReuse.Reuse:
            return yield* this.reuse()
          case FocusedSurfaceReuse.Replace:
            return yield* this.mount(request)
        }
      }).pipe(Effect.catchAll(() => Effect.sync(this.failedRender.bind(this)))),
    )
  }
  private failedRender(): FocusedUiDisposition {
    this.clear()
    return FocusedUiDisposition.Unavailable
  }
  clear(): void {
    this.epoch += 1
    this.closePicker()
    this.surface = { kind: FocusedSurfaceKind.Empty }
    this.dependencies.sensor.clear()
  }
  private closePicker(): void {
    const pending = this.picker
    this.picker = { kind: FocusedPickerKind.Closed }
    switch (pending.kind) {
      case FocusedPickerKind.Closed:
      case FocusedPickerKind.Opening:
        return
      case FocusedPickerKind.Open:
        break
    }
    window.clearTimeout(pending.timeout)
    pending.surface.close()
    this.cancelRequest(pending.requestId)
  }
  private cancelRequest(requestId: string): void {
    const request: Parameters<
      typeof authenticationRuntimeTransport.sendRuntimeMessageWithoutResponse
    >[0] = {
      type: LoginPickerCancelMessageType.NookLoginPickerCancel,
      payload: { requestId },
    }
    this.dependencies.transport.sendRuntimeMessageWithoutResponse(request)
  }
  cancelPicker(): void {
    this.clear()
    widgetState.setRenderedCleanup(() => {})
    this.dependencies.ui.removeWidget()
  }
  private openPicker(request: FocusedPickerMount) {
    return Effect.gen(this, function* () {
      const disposition = yield* this.current(request.surface)
      switch (
        disposition === FocusedUiDisposition.Ready &&
        request.expiresAt > Date.now()
      ) {
        case false:
          this.cancelRequest(request.requestId)
          this.cancelPicker()
          return
        case true:
          break
      }
      const pickerRequest: PickerMountRequest = {
        requestId: request.requestId,
        continueButton: request.surface.widget.shell.continueButton,
        description: request.surface.widget.shell.description,
        title: this.dependencies.ui.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
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
        kind: FocusedPickerKind.Open,
        requestId: request.requestId,
        timeout,
        surface,
      }
    })
  }
  private acceptPicker(request: FocusedPickerAcceptance) {
    return Effect.gen(this, function* () {
      switch (request.response.kind) {
        case RuntimeMessageDeliveryKind.Unavailable:
          this.cancelPicker()
          return
        case RuntimeMessageDeliveryKind.Delivered:
          break
      }
      const response = request.response.response
      switch (
        response.kind === LoginPickerOpenResponseKind.Ready &&
        'requestId' in response &&
        'expiresAt' in response
      ) {
        case false:
          this.cancelPicker()
          return
        case true:
          break
      }
      switch (true) {
        case 'requestId' in response && 'expiresAt' in response: {
          const openRequest: Parameters<
            FocusedCredentialInteraction['openPicker']
          >[0] = {
            surface: request.surface,
            requestId: response.requestId,
            expiresAt: response.expiresAt,
          }
          return yield* this.openPicker(openRequest)
        }
        case true:
          this.cancelPicker()
          return
      }
    })
  }
  choose(): Promise<void> {
    const opening: FocusedPicker = { kind: FocusedPickerKind.Opening }
    return Effect.runPromise(
      Effect.gen(this, function* () {
        const surface = this.surface
        switch (surface.kind) {
          case FocusedSurfaceKind.Empty:
            return
          case FocusedSurfaceKind.Visible:
            break
        }
        switch (this.picker.kind) {
          case FocusedPickerKind.Open:
          case FocusedPickerKind.Opening:
            return
          case FocusedPickerKind.Closed:
            this.picker = opening
            break
        }
        switch (yield* this.current(surface)) {
          case FocusedUiDisposition.Unavailable:
            this.cancelPicker()
            return
          case FocusedUiDisposition.Ready:
            break
        }
        const request: Parameters<
          typeof authenticationRuntimeTransport.sendLoginPickerOpenRuntimeMessage
        >[0] = {
          type: WebsiteLoginPickerOpenMessageType.NookWebsiteLoginPickerOpen,
          payload: { origin: surface.observation.target.origin },
        }
        const response = yield* Effect.tryPromise(() =>
          this.dependencies.transport.sendLoginPickerOpenRuntimeMessage(
            request,
          ),
        )
        const acceptance: Parameters<
          FocusedCredentialInteraction['acceptPicker']
        >[0] = { surface, response }
        yield* this.acceptPicker(acceptance)
      }).pipe(Effect.catchAll(() => Effect.sync(this.cancelPicker.bind(this)))),
    )
  }
  ownsPicker(requestId: string): FocusedPickerOwnership {
    switch (this.picker.kind) {
      case FocusedPickerKind.Closed:
      case FocusedPickerKind.Opening:
        return FocusedPickerOwnership.Unowned
      case FocusedPickerKind.Open:
        break
    }
    switch (this.picker.requestId === requestId) {
      case true:
        return FocusedPickerOwnership.Owned
      case false:
        return FocusedPickerOwnership.Unowned
    }
  }
  verifyPicker(requestId: string): Promise<FocusedUiDisposition> {
    return Effect.runPromise(
      Effect.gen(this, function* () {
        const surface = this.surface
        switch (surface.kind) {
          case FocusedSurfaceKind.Empty:
            return FocusedUiDisposition.Unavailable
          case FocusedSurfaceKind.Visible:
            break
        }
        switch (this.ownsPicker(requestId)) {
          case FocusedPickerOwnership.Unowned:
            return FocusedUiDisposition.Unavailable
          case FocusedPickerOwnership.Owned:
            break
        }
        const disposition = yield* this.current(surface)
        switch (this.ownsPicker(requestId)) {
          case FocusedPickerOwnership.Unowned:
            return FocusedUiDisposition.Unavailable
          case FocusedPickerOwnership.Owned:
            return disposition
        }
      }),
    )
  }
  private fillReleased(request: FocusedReleasedFill) {
    return Effect.gen(this, function* () {
      const response = request.response
      switch (response.ok) {
        case false:
          return
        case true:
          break
      }
      const value = { value: response.value }
      response.value = ''
      const fill: Parameters<FocusedCredentialInteraction['fillCurrent']>[0] = {
        surface: request.surface,
        value,
      }
      yield* this.fillCurrent(fill).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            value.value = ''
            this.clear()
          }),
        ),
      )
    })
  }
  private fillCurrent(request: FocusedCurrentFill) {
    const { surface, value } = request
    return Effect.gen(this, function* () {
      switch (yield* this.current(surface)) {
        case FocusedUiDisposition.Unavailable:
          return
        case FocusedUiDisposition.Ready:
          break
      }
      const mutation: Parameters<
        typeof passwordFormCredentialInteraction.setNativeInputValue
      >[0] = { input: surface.observation.target.input, value: value.value }
      this.dependencies.fill(mutation)
    })
  }
  select(message: WebsiteLoginSelectedMessage): Promise<void> {
    return Effect.runPromise(
      Effect.gen(this, function* () {
        const surface = this.surface
        switch (surface.kind) {
          case FocusedSurfaceKind.Empty:
            return
          case FocusedSurfaceKind.Visible:
            break
        }
        switch (
          this.ownsPicker(message.payload.requestId) ===
            FocusedPickerOwnership.Owned &&
          message.payload.origin === surface.observation.target.origin
        ) {
          case false:
            return
          case true:
            break
        }
        // Successful selection closes only picker resources until revalidation and fill finish.
        this.closePicker()
        switch (yield* this.current(surface)) {
          case FocusedUiDisposition.Unavailable:
            this.clear()
            return
          case FocusedUiDisposition.Ready:
            break
        }
        const account = message.payload.account
        const messageRequest: WebsiteFocusedLoginRevealMessage = {
          type: WebsiteFocusedLoginRevealMessageType.Reveal,
          payload: {
            origin: surface.observation.target.origin,
            vaultStoreId: account.vaultStoreId,
            secretId: account.secretId,
            authorizationGeneration: account.authorizationGeneration,
            credential: surface.selection.credential,
          },
        }
        const revealRequest: Parameters<
          typeof authenticationRuntimeTransport.sendDecodedRuntimeMessage<WebsiteFocusedLoginFillResponse>
        >[0] = {
          message: messageRequest,
          decode: (response) =>
            Effect.runSync(
              WebsiteFocusedLoginRevealMessage.decodeResponse(response),
            ),
        }
        const delivery = yield* Effect.tryPromise(() =>
          this.dependencies.transport.sendDecodedRuntimeMessage(revealRequest),
        )
        switch (delivery.kind) {
          case RuntimeMessageDeliveryKind.Unavailable:
            this.clear()
            return
          case RuntimeMessageDeliveryKind.Delivered:
            break
        }
        const fillRequest: Parameters<
          FocusedCredentialInteraction['fillReleased']
        >[0] = { surface, response: delivery.response }
        yield* this.fillReleased(fillRequest)
      }).pipe(Effect.catchAll(() => Effect.sync(this.clear.bind(this)))),
    )
  }
}
const sensorRequest: ConstructorParameters<
  typeof FocusedCredentialTargetSensor
>[0] = { document, schedule: () => scanState.schedule() }
export const focusedCredentialTargetSensor = new FocusedCredentialTargetSensor(
  sensorRequest,
)
const interactionRequest: ConstructorParameters<
  typeof FocusedCredentialInteraction
>[0] = {
  scanSequence: () => scanState.sequence,
  sensor: focusedCredentialTargetSensor,
  transport: authenticationRuntimeTransport,
  ui: workflowUi,
  mount: FocusedCredentialWidget.mount,
  mountPicker: InlineLoginPicker.mount,
  fill: passwordFormCredentialInteraction.setNativeInputValue.bind(
    passwordFormCredentialInteraction,
  ),
}
export const focusedCredentialInteraction = new FocusedCredentialInteraction(
  interactionRequest,
)
