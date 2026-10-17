import { Schema } from 'effect'
import type {
  SignInAttemptActivity,
  SignInAttemptAuthFields,
  SignInAttemptEvent,
  SignInAttemptLoginReference,
  SignInAttemptPageEvidence,
  SignInAttemptPresentation,
  SignInAttemptSubmitBaseline,
  SignInAttemptUserAction,
  SignInPageColor,
  SignInPageLink,
  SignInPageMessage,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type { BrowserRuntimeMessage } from './browser-runtime-message'

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

/**
 * Browser-envelope decoding only. The schemas follow the generated Rust
 * types so the compiler keeps them aligned; bounds, site binding and every
 * lifecycle decision stay in Rust, which strictly decodes the same values.
 */
export class SignInAttemptMessageCodec {
  private static readonly color = Schema.Struct({
    red: Schema.Number,
    green: Schema.Number,
    blue: Schema.Number,
  }) satisfies Schema.Codec<SignInPageColor>
  private static readonly link = Schema.Struct({
    index: Schema.Number,
    text: Schema.String,
    href: Schema.String,
  }) satisfies Schema.Codec<SignInPageLink>
  private static readonly message = Schema.Struct({
    text: Schema.String,
    source: Schema.Literals([
      'Alert',
      'LiveRegion',
      'FieldReference',
      'Container',
    ]),
    placement: Schema.Literals(['InsideAuthForm', 'NearAuthForm']),
    tokens: Schema.mutable(Schema.Array(Schema.String)),
    foreground: SignInAttemptMessageCodec.color,
    background: SignInAttemptMessageCodec.color,
  }) satisfies Schema.Codec<SignInPageMessage>
  private static readonly authFields = Schema.Struct({
    usernamePresent: Schema.Boolean,
    currentPasswordPresent: Schema.Boolean,
    oneTimeCodePresent: Schema.Boolean,
  }) satisfies Schema.Codec<SignInAttemptAuthFields>
  private static readonly baseline = Schema.Struct({
    errorMessagePresent: Schema.Boolean,
    authFields: SignInAttemptMessageCodec.authFields,
  }) satisfies Schema.Codec<SignInAttemptSubmitBaseline>
  private static readonly page = Schema.Struct({
    document: Schema.Literals(['SameDocument', 'NewDocument']),
    authFields: SignInAttemptMessageCodec.authFields,
    manualCheckpointPresent: Schema.Boolean,
    successMarkerPresent: Schema.Boolean,
    errorMarkerPresent: Schema.Boolean,
    messages: Schema.mutable(Schema.Array(SignInAttemptMessageCodec.message)),
    links: Schema.mutable(Schema.Array(SignInAttemptMessageCodec.link)),
  }) satisfies Schema.Codec<SignInAttemptPageEvidence>
  private static readonly activity = Schema.Union([
    Schema.Struct({
      kind: Schema.Literals([
        'Filled',
        'FillFailed',
        'SubmissionRejected',
        'SubmissionUnobserved',
      ]),
    }),
    Schema.Struct({
      kind: Schema.Literal('Submitted'),
      baseline: SignInAttemptMessageCodec.baseline,
    }),
  ]) satisfies Schema.Codec<SignInAttemptActivity>
  private static readonly userAction = Schema.Union([
    Schema.Struct({
      kind: Schema.Literals([
        'TryAgain',
        'ChooseAnotherLogin',
        'FillAuthenticator',
        'Dismiss',
      ]),
    }),
    Schema.Struct({
      kind: Schema.Literal('ResetPassword'),
      link: SignInAttemptMessageCodec.link,
    }),
  ]) satisfies Schema.Codec<SignInAttemptUserAction>
  private static readonly event = Schema.Union([
    Schema.Struct({ kind: Schema.Literal('Resumed') }),
    Schema.Struct({
      kind: Schema.Literal('Activity'),
      activity: SignInAttemptMessageCodec.activity,
    }),
    Schema.Struct({
      kind: Schema.Literal('PageObserved'),
      page: SignInAttemptMessageCodec.page,
    }),
    Schema.Struct({
      kind: Schema.Literal('UserAction'),
      action: SignInAttemptMessageCodec.userAction,
    }),
  ]) satisfies Schema.Codec<SignInAttemptEvent>
  private static readonly request = Schema.Union([
    Schema.Struct({
      operation: Schema.Literal(SignInAttemptOperation.Begin),
      login: Schema.String,
    }),
    Schema.Struct({
      operation: Schema.Literal(SignInAttemptOperation.Advance),
      event: SignInAttemptMessageCodec.event,
    }),
  ]) satisfies Schema.Codec<SignInAttemptRequest>
  private static readonly envelope = Schema.Struct({
    type: Schema.Literal(SignInAttemptMessageType.Session),
    payload: SignInAttemptMessageCodec.request,
  }) satisfies Schema.Codec<SignInAttemptMessage>

  static decode(message: BrowserRuntimeMessage) {
    return Schema.decodeUnknownEffect(SignInAttemptMessageCodec.envelope)(
      message,
    )
  }
}
