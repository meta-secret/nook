import type { LoginSaveEvidenceKind } from '../../lib/login-save-observation-codecs'
import { Effect, Schema } from 'effect'
import { FocusedCredentialObservation } from './focused-credential-observation'
import { FocusedCredentialOpportunity } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { passwordFieldDiscovery } from '../../../../nook-web-shared/src/extension/password-form-fields'
import type {
  LoginSaveCaptureBaseline,
  LoginSaveCommitEvidence,
  LoginSaveOutcomeDecision,
  LoginSaveOutcomeObservation,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  CompanionWasmSessionMessageType,
  type CompanionWasmRuntimeMessage,
} from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import {
  CompanionWasmRuntimeDeliveryKind,
  sendCompanionWasmRuntimeMessage,
} from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-transport'
import { authenticationOutcomeObservation } from './authentication-outcome-observation'
import { AuthenticationInputSurface } from '../../../../nook-web-shared/src/extension/authentication-input-surface'
import type { CompanionWasmRuntimeDelivery } from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-transport'

export enum LoginSaveNavigationMode {
  SameDocument = 'same-document',
  DocumentNavigation = 'document-navigation',
}
enum LoginSaveAuthenticationAbsenceKind {
  Present = 'present',
  Absent = 'absent',
}
type LoginSaveAuthenticationAbsence =
  | { kind: LoginSaveAuthenticationAbsenceKind.Present }
  | { kind: LoginSaveAuthenticationAbsenceKind.Absent; since: number }
enum LoginSaveObservationFailureKind {
  Preparation = 'preparation',
  Transport = 'transport',
  Decode = 'decode',
}
type LoginSaveObservationFailureFields = {
  kind: Schema.Codec<LoginSaveObservationFailureKind>
  cause: ReturnType<typeof Schema.Defect>
}
class LoginSaveObservationFailureSchema {
  static readonly fields: LoginSaveObservationFailureFields = {
    kind: Schema.Literals([
      LoginSaveObservationFailureKind.Preparation,
      LoginSaveObservationFailureKind.Transport,
      LoginSaveObservationFailureKind.Decode,
    ]),
    cause: Schema.Defect(),
  }
}
export class LoginSaveObservationFailure extends Schema.TaggedError<LoginSaveObservationFailure>()(
  'LoginSaveObservationFailure',
  LoginSaveObservationFailureSchema.fields,
) {}
type LoginSaveObservationAttempt<Value> = Parameters<
  typeof Effect.tryPromise<Value, LoginSaveObservationFailure>
>[0]

export type LoginSaveOutcomeSensorRequest = {
  readonly baseline: LoginSaveCaptureBaseline
  readonly submittedNodes: readonly HTMLInputElement[]
  readonly navigationMode: LoginSaveNavigationMode
}
type SubmittedLoginSaveEvidence = Extract<
  LoginSaveCommitEvidence,
  { kind: `${LoginSaveEvidenceKind.SubmittedLogin}` }
>

/** Retains only capture-time metadata and DOM identity after staging. */
export class LoginSaveOutcomeSensor extends AuthenticationInputSurface {
  private absence: LoginSaveAuthenticationAbsence = {
    kind: LoginSaveAuthenticationAbsenceKind.Present,
  }
  sawMutation = false
  constructor(readonly request: LoginSaveOutcomeSensorRequest) {
    super(globalThis)
  }

  collect(): Promise<LoginSaveCommitEvidence> {
    return Effect.runPromise(this.collectObservation())
  }

  private collectObservation(): Effect.Effect<
    LoginSaveCommitEvidence,
    LoginSaveObservationFailure
  > {
    const preparation: LoginSaveObservationAttempt<void> = {
      try: () =>
        passwordFieldDiscovery.prepareCompanionClassification(document),
      catch: (cause) => {
        const failure: ConstructorParameters<
          typeof LoginSaveObservationFailure
        >[0] = { kind: LoginSaveObservationFailureKind.Preparation, cause }
        return new LoginSaveObservationFailure(failure)
      },
    }
    return Effect.tryPromise(preparation).pipe(
      Effect.flatMap(() => this.currentFieldsPresent()),
      Effect.map((present) => this.projectObservation(present)),
    )
  }

  private projectObservation(
    currentFieldsPresent: boolean,
  ): LoginSaveCommitEvidence {
    const { baseline } = this.request
    const context: Parameters<
      typeof authenticationOutcomeObservation.collectOutcomeObservation
    >[0] = {
      startedAt: baseline.submitted_at,
      authPath: new URL(baseline.submitted_url).pathname,
      sawMutation: this.sawMutation,
    }
    const observation =
      authenticationOutcomeObservation.collectOutcomeObservation(context)
    observation.authFieldsPresent ||=
      currentFieldsPresent ||
      this.request.submittedNodes.some((field) => this.rendered(field))
    const now = Date.now()
    switch (observation.authFieldsPresent) {
      case true:
        this.absence = { kind: LoginSaveAuthenticationAbsenceKind.Present }
        break
      case false:
        switch (this.absence.kind) {
          case LoginSaveAuthenticationAbsenceKind.Present:
            this.absence = {
              kind: LoginSaveAuthenticationAbsenceKind.Absent,
              since: now,
            }
            break
          case LoginSaveAuthenticationAbsenceKind.Absent:
            break
        }
        break
    }
    switch (baseline.source) {
      case 'ExplicitAuthentication':
        return { kind: 'ExplicitAuthentication', observation }
      case 'SubmittedLogin':
        break
    }
    observation.errorMarkerPresent = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-nook-auth-outcome="error"], [role="alert"], .error[role="alert"]',
      ),
    ).some((marker) => this.isRenderedElement(marker))
    let noAuthElapsed = 0
    switch (this.absence.kind) {
      case LoginSaveAuthenticationAbsenceKind.Absent:
        noAuthElapsed = Math.max(0, now - this.absence.since)
        break
      case LoginSaveAuthenticationAbsenceKind.Present:
        break
    }
    let transition: LoginSaveOutcomeObservation['transition'] = 'None'
    switch (this.sawMutation) {
      case true:
        transition = 'SameDocumentMutation'
        break
      case false:
        break
    }
    switch (location.href !== baseline.submitted_url) {
      case true:
        transition = 'SameDocumentNavigation'
        break
      case false:
        break
    }
    switch (this.request.navigationMode) {
      case LoginSaveNavigationMode.DocumentNavigation:
        transition = 'DocumentNavigation'
        break
      case LoginSaveNavigationMode.SameDocument:
        break
    }
    let origin: LoginSaveOutcomeObservation['origin'] = 'ChangedOrigin'
    switch (new URL(baseline.submitted_url).origin === location.origin) {
      case true:
        origin = 'SameOrigin'
        break
      case false:
        break
    }
    let checkpoint: LoginSaveOutcomeObservation['checkpoint'] = 'Clear'
    switch (passwordFieldDiscovery.pageHasManualCheckpoint(document)) {
      case true:
        checkpoint = 'Pending'
        break
      case false:
        break
    }
    const submitted: LoginSaveOutcomeObservation = {
      observation,
      captured_workflow: baseline.captured_workflow,
      submission: 'Captured',
      origin,
      initial_auth_fields: baseline.initial_auth_fields,
      transition,
      checkpoint,
      no_auth_elapsed_ms: noAuthElapsed,
      baseline_controls: [...baseline.controls],
      current_controls: this.controls(),
    }
    return { kind: 'SubmittedLogin', observation: submitted }
  }

  eligibility(
    evidence: SubmittedLoginSaveEvidence,
  ): Promise<LoginSaveOutcomeDecision> {
    return Effect.runPromise(this.classifyEligibility(evidence))
  }

  private classifyEligibility(
    evidence: SubmittedLoginSaveEvidence,
  ): Effect.Effect<LoginSaveOutcomeDecision, LoginSaveObservationFailure> {
    const message: CompanionWasmRuntimeMessage = {
      type: CompanionWasmSessionMessageType.ClassifyLoginSaveOutcome,
      origin: location.origin,
      payload: evidence.observation,
    }
    const attempt: LoginSaveObservationAttempt<CompanionWasmRuntimeDelivery> = {
      try: () => sendCompanionWasmRuntimeMessage(globalThis, message),
      catch: (cause) => {
        const failure: ConstructorParameters<
          typeof LoginSaveObservationFailure
        >[0] = { kind: LoginSaveObservationFailureKind.Transport, cause }
        return new LoginSaveObservationFailure(failure)
      },
    }
    return Effect.tryPromise(attempt).pipe(
      Effect.flatMap((delivery) => this.decodeEligibility(delivery)),
    )
  }

  private decodeEligibility(
    delivery: CompanionWasmRuntimeDelivery,
  ): Effect.Effect<LoginSaveOutcomeDecision, LoginSaveObservationFailure> {
    switch (delivery.kind) {
      case CompanionWasmRuntimeDeliveryKind.Unavailable: {
        const failure: ConstructorParameters<
          typeof LoginSaveObservationFailure
        >[0] = {
          kind: LoginSaveObservationFailureKind.Transport,
          cause: delivery.kind,
        }
        return Effect.fail(new LoginSaveObservationFailure(failure))
      }
      case CompanionWasmRuntimeDeliveryKind.Delivered:
        break
    }
    const fields: {
      eligibility: Schema.Codec<LoginSaveOutcomeDecision['eligibility']>
    } = {
      eligibility: Schema.Literals([
        'Eligible',
        'Waiting',
        'Rejected',
        'Expired',
      ]),
    }
    return Schema.decodeUnknownEffect(Schema.Struct(fields))(
      delivery.response,
    ).pipe(
      Effect.mapError((cause) => {
        const failure: ConstructorParameters<
          typeof LoginSaveObservationFailure
        >[0] = { kind: LoginSaveObservationFailureKind.Decode, cause }
        return new LoginSaveObservationFailure(failure)
      }),
    )
  }

  private currentFieldsPresent(): Effect.Effect<
    boolean,
    LoginSaveObservationFailure
  > {
    const fields = Array.from(
      document.querySelectorAll<HTMLInputElement>('input'),
    ).filter((field) => this.rendered(field))
    switch (fields.length > 32) {
      case true:
        return Effect.succeed(true)
      case false:
        break
    }
    return Effect.all(
      fields.map((field) => this.observeFieldPresence(field)),
    ).pipe(Effect.map((present) => present.some(Boolean)))
  }

  private observeFieldPresence(
    field: HTMLInputElement,
  ): Effect.Effect<boolean, LoginSaveObservationFailure> {
    const request: CompanionWasmRuntimeMessage = {
      type: CompanionWasmSessionMessageType.ClassifyFocusedCredentialField,
      origin: location.origin,
      payload: {
        observation: passwordFieldDiscovery.focusedFieldObservation(field),
      },
    }
    const attempt: LoginSaveObservationAttempt<CompanionWasmRuntimeDelivery> = {
      try: () => sendCompanionWasmRuntimeMessage(globalThis, request),
      catch: (cause) => {
        const failure: ConstructorParameters<
          typeof LoginSaveObservationFailure
        >[0] = { kind: LoginSaveObservationFailureKind.Transport, cause }
        return new LoginSaveObservationFailure(failure)
      },
    }
    return Effect.tryPromise(attempt).pipe(
      Effect.flatMap((delivery) => this.readFieldPresence(delivery)),
    )
  }

  private readFieldPresence(
    delivery: CompanionWasmRuntimeDelivery,
  ): Effect.Effect<boolean, LoginSaveObservationFailure> {
    switch (delivery.kind) {
      case CompanionWasmRuntimeDeliveryKind.Unavailable:
        return Effect.succeed(true)
      case CompanionWasmRuntimeDeliveryKind.Delivered:
        break
    }
    const attempt: Parameters<
      typeof Effect.try<boolean, LoginSaveObservationFailure>
    >[0] = {
      try: () =>
        FocusedCredentialObservation.recognition(delivery.response)
          .focusedOpportunity !== FocusedCredentialOpportunity.Unavailable,
      catch: (cause) => {
        const failure: ConstructorParameters<
          typeof LoginSaveObservationFailure
        >[0] = { kind: LoginSaveObservationFailureKind.Decode, cause }
        return new LoginSaveObservationFailure(failure)
      },
    }
    return Effect.try(attempt)
  }

  private rendered(field: HTMLElement): boolean {
    switch (field.isConnected) {
      case false:
        return false
      case true:
        break
    }
    let element: HTMLElement | Element = field
    while (true) {
      const style = getComputedStyle(element)
      switch (
        element.hasAttribute('hidden') ||
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        element.matches('dialog:not([open])')
      ) {
        case true:
          return false
        case false:
          break
      }
      const parent = element.parentElement
      switch (true) {
        case parent instanceof Element:
          element = parent
          break
        case true:
          return true
      }
    }
  }

  controls(): string[] {
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, a[href], [role="button"], input[type="button"], input[type="submit"]',
      ),
    )
      .filter(
        (control) =>
          !control.closest('#nook-auth-widget') && this.rendered(control),
      )
      .slice(0, 64)
      .map((control) =>
        [
          control.textContent,
          control.getAttribute('aria-label'),
          control.getAttribute('title'),
        ]
          .join(' ')
          .slice(0, 256),
      )
  }
}
