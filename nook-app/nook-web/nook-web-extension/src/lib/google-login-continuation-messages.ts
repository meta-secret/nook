/* eslint-disable @typescript-eslint/no-restricted-types -- Unknown browser material remains inside this decoder until the existing Rust facts ingress produces a concrete value. */
import { Effect, Schema, SchemaIssue } from 'effect'
import {
  GoogleLoginContinuationMessageType,
  GoogleLoginContinuationOperation,
  type GoogleLoginBrowserMessage,
  type GoogleLoginContinuationRequest,
} from '../../../nook-web-shared/src/extension/google-login-continuation-messages'
import {
  admit_authentication_workflow_snapshot_message,
  type GoogleLoginPageObservation,
  type GoogleLoginStartRequest,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'
import { AuthenticationWorkflowSnapshotMessageType } from './auth-workflow-messages'
import type { BrowserRuntimeMessage } from './browser-runtime-message'

type GoogleObservationWireFields = {
  readonly page_url: typeof Schema.String
  readonly authorization_generation: typeof Schema.String
  readonly elapsed_milliseconds: typeof Schema.Number
  readonly identifier_integrity: Schema.Literals<
    readonly GoogleLoginPageObservation['identifier_integrity'][]
  >
  readonly user_intent: Schema.Literals<
    readonly GoogleLoginPageObservation['user_intent'][]
  >
  readonly password_occupancy: Schema.Literals<
    readonly GoogleLoginPageObservation['password_occupancy'][]
  >
  readonly facts: typeof Schema.Unknown
}
const observationFields: GoogleObservationWireFields = {
  page_url: Schema.String,
  authorization_generation: Schema.String,
  elapsed_milliseconds: Schema.Number,
  identifier_integrity: Schema.Literals(['Unchanged', 'Edited']),
  user_intent: Schema.Literals(['Continuing', 'Interrupted']),
  password_occupancy: Schema.Literals(['Empty', 'Populated']),
  facts: Schema.Unknown,
}
const observationSchema = Schema.Struct(observationFields)
type GoogleObservationWire = typeof observationSchema.Type
type GoogleStartWireFields = {
  readonly observation: typeof observationSchema
  readonly selection_authority: Schema.Literals<
    readonly GoogleLoginStartRequest['selection_authority'][]
  >
}
const startFields: GoogleStartWireFields = {
  observation: observationSchema,
  selection_authority: Schema.Literals(['DetectedLogin', 'FocusedField']),
}
const startSchema = Schema.Struct(startFields)
type GoogleBeginWireFields = {
  readonly operation: Schema.Literal<GoogleLoginContinuationOperation.Begin>
  readonly request: typeof startSchema
}
const beginFields: GoogleBeginWireFields = {
  operation: Schema.Literal(GoogleLoginContinuationOperation.Begin),
  request: startSchema,
}
type GoogleInspectWireFields = {
  readonly operation: Schema.Literals<
    readonly (
      | GoogleLoginContinuationOperation.Inspect
      | GoogleLoginContinuationOperation.Admit
    )[]
  >
  readonly request: typeof observationSchema
}
const inspectFields: GoogleInspectWireFields = {
  operation: Schema.Literals([
    GoogleLoginContinuationOperation.Inspect,
    GoogleLoginContinuationOperation.Admit,
  ]),
  request: observationSchema,
}
type GoogleCancelWireFields = {
  readonly operation: Schema.Literal<GoogleLoginContinuationOperation.Cancel>
}
const cancelFields: GoogleCancelWireFields = {
  operation: Schema.Literal(GoogleLoginContinuationOperation.Cancel),
}
const payloadSchema = Schema.Union([
  Schema.Struct(beginFields),
  Schema.Struct(inspectFields),
  Schema.Struct(cancelFields),
])
type GoogleEnvelopeWireFields = {
  readonly type: Schema.Literal<GoogleLoginContinuationMessageType.Session>
  readonly origin: typeof Schema.String
  readonly payload: typeof payloadSchema
}
const envelopeFields: GoogleEnvelopeWireFields = {
  type: Schema.Literal(GoogleLoginContinuationMessageType.Session),
  origin: Schema.String,
  payload: payloadSchema,
}
const envelopeSchema = Schema.Struct(envelopeFields)
type GoogleEnvelopeTypeFields = {
  readonly type: Schema.Literal<GoogleLoginContinuationMessageType.Session>
}
const envelopeTypeFields: GoogleEnvelopeTypeFields = {
  type: Schema.Literal(GoogleLoginContinuationMessageType.Session),
}
const envelopeTypeSchema = Schema.Struct(envelopeTypeFields)
interface GoogleObservationDecodeRequest {
  readonly origin: string
  readonly observation: GoogleObservationWire
}
interface GoogleFactsAdmissionPayload {
  readonly origin: string
  readonly observations: readonly unknown[]
}
interface GoogleFactsAdmissionInput {
  readonly type: AuthenticationWorkflowSnapshotMessageType.NookAuthenticationWorkflowSnapshot
  readonly payload: GoogleFactsAdmissionPayload
}
interface GoogleFactsAdmissionAttempt {
  readonly try: () => ReturnType<
    typeof admit_authentication_workflow_snapshot_message
  >
  readonly catch: () => Schema.SchemaError
}
type GoogleObservationInvalidIssue = ConstructorParameters<
  typeof SchemaIssue.InvalidValue
>[0]

/** The route matches a concrete browser envelope; this decoder owns all opaque facts material. */
export class GoogleLoginContinuationMessageCodec {
  static decodeEnvelope(message: BrowserRuntimeMessage) {
    return Schema.decodeUnknownEffect(envelopeTypeSchema)(message).pipe(
      Effect.as(message),
    )
  }
  private static invalidObservation(): Schema.SchemaError {
    const issue: GoogleObservationInvalidIssue = {
      message: 'Google login structural observation was not admitted',
    }
    return new Schema.SchemaError(new SchemaIssue.InvalidValue(issue))
  }
  private static decodeObservation = Effect.fnUntraced(function* (
    request: GoogleObservationDecodeRequest,
  ) {
    const input: GoogleFactsAdmissionInput = {
      type: AuthenticationWorkflowSnapshotMessageType.NookAuthenticationWorkflowSnapshot,
      payload: {
        origin: request.origin,
        observations: [request.observation.facts],
      },
    }
    const attempt: GoogleFactsAdmissionAttempt = {
      try: () => admit_authentication_workflow_snapshot_message(input),
      catch: GoogleLoginContinuationMessageCodec.invalidObservation,
    }
    const admission = yield* Effect.try(attempt)
    switch (admission.kind) {
      case 'rejected':
        return yield* Effect.fail(
          GoogleLoginContinuationMessageCodec.invalidObservation(),
        )
      case 'accepted':
        break
    }
    const facts = admission.message.payload.observations[0]
    switch (true) {
      case !facts:
        return yield* Effect.fail(
          GoogleLoginContinuationMessageCodec.invalidObservation(),
        )
      case true:
        break
    }
    const observation: GoogleLoginPageObservation = {
      page_url: request.observation.page_url,
      authorization_generation: request.observation.authorization_generation,
      elapsed_milliseconds: request.observation.elapsed_milliseconds,
      identifier_integrity: request.observation.identifier_integrity,
      user_intent: request.observation.user_intent,
      password_occupancy: request.observation.password_occupancy,
      facts,
    }
    return observation
  })
  static decode = Effect.fnUntraced(function* (value: unknown) {
    const wire = yield* Schema.decodeUnknownEffect(envelopeSchema)(value)
    switch (wire.payload.operation) {
      case GoogleLoginContinuationOperation.Cancel: {
        const payload: GoogleLoginContinuationRequest = {
          operation: wire.payload.operation,
        }
        const message: GoogleLoginBrowserMessage = {
          type: wire.type,
          origin: wire.origin,
          payload,
        }
        return message
      }
      case GoogleLoginContinuationOperation.Begin:
      case GoogleLoginContinuationOperation.Inspect:
      case GoogleLoginContinuationOperation.Admit:
        break
    }
    yield* Effect.promise(() => companionWasmReady)
    let input: GoogleObservationWire
    switch (wire.payload.operation) {
      case GoogleLoginContinuationOperation.Begin:
        input = wire.payload.request.observation
        break
      case GoogleLoginContinuationOperation.Inspect:
      case GoogleLoginContinuationOperation.Admit:
        input = wire.payload.request
        break
    }
    const decodeRequest: GoogleObservationDecodeRequest = {
      origin: wire.origin,
      observation: input,
    }
    const observation =
      yield* GoogleLoginContinuationMessageCodec.decodeObservation(
        decodeRequest,
      )
    let payload: GoogleLoginContinuationRequest
    switch (wire.payload.operation) {
      case GoogleLoginContinuationOperation.Begin: {
        const request: GoogleLoginStartRequest = {
          observation,
          selection_authority: wire.payload.request.selection_authority,
        }
        payload = { operation: wire.payload.operation, request }
        break
      }
      case GoogleLoginContinuationOperation.Inspect:
      case GoogleLoginContinuationOperation.Admit:
        payload = { operation: wire.payload.operation, request: observation }
        break
    }
    const message: GoogleLoginBrowserMessage = {
      type: wire.type,
      origin: wire.origin,
      payload,
    }
    return message
  })
}
