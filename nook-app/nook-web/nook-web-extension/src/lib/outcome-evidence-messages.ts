import { Schema } from 'effect'

import type {
  AuthenticationOutcomeDecision,
  AuthenticationOutcomeResponse,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export type { AuthenticationOutcomeResponse }

export type AuthenticationOutcomeObservationView = {
  navigatedAwayFromAuthPath: boolean
  authFieldsPresent: boolean
  successMarkerPresent: boolean
  errorMarkerPresent: boolean
  sameDocumentMutation: boolean
  inIframe: boolean
  elapsedMs: number
}

export type AuthenticationOutcomeVerdictView = AuthenticationOutcomeDecision

export type AuthenticationOutcomeClassifyPayload = {
  readonly observation: AuthenticationOutcomeObservationView
  readonly timeoutMs: number
}

export enum AuthenticationOutcomeClassifyMessageType {
  NookAuthenticationOutcomeClassify = 'nook:authentication-outcome-classify',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class AuthenticationOutcomeClassifyMessage {
  private constructor() {}
  declare readonly type: AuthenticationOutcomeClassifyMessageType.NookAuthenticationOutcomeClassify
  declare readonly payload: AuthenticationOutcomeClassifyPayload
  static decode(message: unknown) {
    return Schema.decodeUnknownEffect(
      authenticationOutcomeClassifyMessageSchema,
    )(message)
  }
}

type AuthenticationOutcomeObservationSchemaFields = {
  readonly [Field in keyof AuthenticationOutcomeObservationView]: Schema.Codec<
    AuthenticationOutcomeObservationView[Field]
  >
}

const authenticationOutcomeObservationSchemaFields: AuthenticationOutcomeObservationSchemaFields =
  {
    navigatedAwayFromAuthPath: Schema.Boolean,
    authFieldsPresent: Schema.Boolean,
    successMarkerPresent: Schema.Boolean,
    errorMarkerPresent: Schema.Boolean,
    sameDocumentMutation: Schema.Boolean,
    inIframe: Schema.Boolean,
    elapsedMs: Schema.Number.pipe(
      Schema.check(
        Schema.makeFilter((elapsedMs) => Number.isFinite(elapsedMs)),
      ),
      Schema.check(Schema.makeFilter((elapsedMs) => elapsedMs >= 0)),
    ),
  }

export const AuthenticationOutcomeObservationViewSchema = Schema.Struct(
  authenticationOutcomeObservationSchemaFields,
) satisfies Schema.Codec<AuthenticationOutcomeObservationView>

type AuthenticationOutcomeClassifyPayloadSchemaFields = {
  readonly [Field in keyof AuthenticationOutcomeClassifyPayload]: Schema.Codec<
    AuthenticationOutcomeClassifyPayload[Field]
  >
}

const authenticationOutcomeClassifyPayloadSchemaFields: AuthenticationOutcomeClassifyPayloadSchemaFields =
  {
    observation: AuthenticationOutcomeObservationViewSchema,
    timeoutMs: Schema.Number.pipe(
      Schema.check(
        Schema.makeFilter((timeoutMs) => Number.isFinite(timeoutMs)),
      ),
      Schema.check(Schema.makeFilter((timeoutMs) => timeoutMs > 0)),
    ),
  }

const authenticationOutcomeClassifyPayloadSchema = Schema.Struct(
  authenticationOutcomeClassifyPayloadSchemaFields,
)

type AuthenticationOutcomeClassifyMessageSchemaFields = {
  readonly type: Schema.Codec<AuthenticationOutcomeClassifyMessage['type']>
  readonly payload: Schema.Codec<AuthenticationOutcomeClassifyPayload>
}

const authenticationOutcomeClassifyMessageSchemaFields: AuthenticationOutcomeClassifyMessageSchemaFields =
  {
    type: Schema.Literal(
      AuthenticationOutcomeClassifyMessageType.NookAuthenticationOutcomeClassify,
    ),
    payload: authenticationOutcomeClassifyPayloadSchema,
  }

const authenticationOutcomeClassifyMessageSchema = Schema.Struct(
  authenticationOutcomeClassifyMessageSchemaFields,
) satisfies Schema.Codec<AuthenticationOutcomeClassifyMessage>
