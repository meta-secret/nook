import { Schema } from 'effect'
import type {
  SignInAttemptEvent,
  SignInAttemptLoginReference,
  SignInAttemptPresentation,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  BROWSER_RUNTIME_MESSAGE_VALUE,
  type BrowserRuntimeMessage,
  type BrowserRuntimeMessageValue,
} from './browser-runtime-message'

export enum SignInAttemptMessageType {
  Session = 'nook:website-sign-in-attempt',
}

/** Content-script requests; Resume, Activity, PageObserved and UserAction are Rust events. */
export enum SignInAttemptOperation {
  Begin = 'begin',
  Advance = 'advance',
}

export type SignInAttemptRequest =
  | {
      readonly operation: SignInAttemptOperation.Begin
      readonly login: SignInAttemptLoginReference
    }
  | {
      readonly operation: SignInAttemptOperation.Advance
      readonly event: SignInAttemptEvent
    }

export interface SignInAttemptMessage {
  readonly type: SignInAttemptMessageType.Session
  readonly payload: SignInAttemptRequest
}

export enum SignInAttemptViewKind {
  /** No attempt for this tab and site: the Pilot renders its normal fresh state. */
  None = 'none',
  Presented = 'presented',
}
export type SignInAttemptView =
  | { readonly kind: SignInAttemptViewKind.None }
  | {
      readonly kind: SignInAttemptViewKind.Presented
      readonly presentation: SignInAttemptPresentation
    }

export enum SignInAttemptFailureReason {
  ForbiddenSender = 'sign-in-attempt-forbidden-sender',
  Unavailable = 'sign-in-attempt-unavailable',
}
export type SignInAttemptRuntimeResponse =
  | { readonly ok: true; readonly attempt: SignInAttemptView }
  | { readonly ok: false; readonly reason: SignInAttemptFailureReason }

type SignInAttemptBeginFields = {
  readonly operation: Schema.Literal<SignInAttemptOperation.Begin>
  readonly login: typeof Schema.String
}
type SignInAttemptAdvanceFields = {
  readonly operation: Schema.Literal<SignInAttemptOperation.Advance>
  readonly event: typeof BROWSER_RUNTIME_MESSAGE_VALUE
}
type SignInAttemptEnvelopeFields = {
  readonly type: Schema.Literal<SignInAttemptMessageType.Session>
  readonly payload: Schema.Union<
    readonly [
      Schema.Struct<SignInAttemptBeginFields>,
      Schema.Struct<SignInAttemptAdvanceFields>,
    ]
  >
}

/**
 * Browser-envelope decoding only: the message type, the operation and the
 * login reference string. The event is carried unchanged; Rust's
 * `advance_sign_in_attempt` strictly decodes it (and the login) and throws on
 * anything else, which the route answers with its failed response. Bounds,
 * site binding and every lifecycle decision stay in Rust.
 */
export class SignInAttemptMessageCodec {
  private static readonly beginFields: SignInAttemptBeginFields = {
    operation: Schema.Literal(SignInAttemptOperation.Begin),
    login: Schema.String,
  }
  private static readonly advanceFields: SignInAttemptAdvanceFields = {
    operation: Schema.Literal(SignInAttemptOperation.Advance),
    event: BROWSER_RUNTIME_MESSAGE_VALUE,
  }
  private static readonly envelopeFields: SignInAttemptEnvelopeFields = {
    type: Schema.Literal(SignInAttemptMessageType.Session),
    payload: Schema.Union([
      Schema.Struct(SignInAttemptMessageCodec.beginFields),
      Schema.Struct(SignInAttemptMessageCodec.advanceFields),
    ]),
  }
  private static readonly envelope = Schema.Struct(
    SignInAttemptMessageCodec.envelopeFields,
  )

  static decode(message: BrowserRuntimeMessage) {
    return Schema.decodeUnknownEffect(SignInAttemptMessageCodec.envelope)(
      message,
    )
  }

  /**
   * The one boundary narrowing for this route: the value is handed to Rust's
   * strict decoder unchanged and is never read in TypeScript.
   */
  static event(value: BrowserRuntimeMessageValue): SignInAttemptEvent {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Rust strictly decodes the event at advance_sign_in_attempt.
    return value as SignInAttemptEvent
  }
}
