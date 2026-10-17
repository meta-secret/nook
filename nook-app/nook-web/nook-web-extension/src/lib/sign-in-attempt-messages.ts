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
 * Field schemas typed by the generated Rust value they decode, so the
 * compiler keeps the browser decoder aligned with the contract.
 */
type CodecFields<Value> = {
  readonly [Key in keyof Value]-?: Schema.Codec<Value[Key]>
}
type ActivityKind = SignInAttemptActivity['kind']
type UserActionKind = SignInAttemptUserAction['kind']
type SignInAttemptBeginWire = Extract<
  SignInAttemptRequest,
  { readonly operation: SignInAttemptOperation.Begin }
>
type SignInAttemptAdvanceWire = Extract<
  SignInAttemptRequest,
  { readonly operation: SignInAttemptOperation.Advance }
>

/**
 * Browser-envelope decoding only. Bounds, site binding and every lifecycle
 * decision stay in Rust, which strictly decodes the same values again.
 */
export class SignInAttemptMessageCodec {
  private static readonly colorFields: CodecFields<SignInPageColor> = {
    red: Schema.Number,
    green: Schema.Number,
    blue: Schema.Number,
  }
  private static readonly color = Schema.Struct(
    SignInAttemptMessageCodec.colorFields,
  )
  private static readonly linkFields: CodecFields<SignInPageLink> = {
    index: Schema.Number,
    text: Schema.String,
    href: Schema.String,
  }
  private static readonly link = Schema.Struct(
    SignInAttemptMessageCodec.linkFields,
  )
  private static readonly messageFields: CodecFields<SignInPageMessage> = {
    text: Schema.String,
    source: Schema.Literals([
      'Alert',
      'LiveRegion',
      'FieldReference',
      'Container',
    ]),
    placement: Schema.Literals(['InsideAuthForm', 'NearAuthForm']),
    tokens: Schema.mutable(Schema.Array(Schema.String)),
    ancestor_tokens: Schema.mutable(Schema.Array(Schema.String)),
    foreground: SignInAttemptMessageCodec.color,
    background: SignInAttemptMessageCodec.color,
    changed_since_submit: Schema.Boolean,
  }
  private static readonly controls = Schema.mutable(Schema.Array(Schema.String))
  private static readonly messages = Schema.mutable(
    Schema.Array(Schema.Struct(SignInAttemptMessageCodec.messageFields)),
  )
  private static readonly authFieldsFields: CodecFields<SignInAttemptAuthFields> =
    {
      username_present: Schema.Boolean,
      current_password_present: Schema.Boolean,
      one_time_code_present: Schema.Boolean,
    }
  private static readonly authFields = Schema.Struct(
    SignInAttemptMessageCodec.authFieldsFields,
  )
  private static readonly baselineFields: CodecFields<SignInAttemptSubmitBaseline> =
    {
      messages: SignInAttemptMessageCodec.messages,
      auth_fields: SignInAttemptMessageCodec.authFields,
      controls: SignInAttemptMessageCodec.controls,
    }
  private static readonly pageFields: CodecFields<SignInAttemptPageEvidence> = {
    document: Schema.Literals([
      'SameDocumentSameRoute',
      'SameDocumentNewRoute',
      'NewDocument',
    ]),
    auth_fields: SignInAttemptMessageCodec.authFields,
    manual_checkpoint_present: Schema.Boolean,
    success_marker_present: Schema.Boolean,
    error_marker_present: Schema.Boolean,
    controls: SignInAttemptMessageCodec.controls,
    messages: SignInAttemptMessageCodec.messages,
    links: Schema.mutable(Schema.Array(SignInAttemptMessageCodec.link)),
  }
  private static readonly plainActivityFields: {
    readonly kind: Schema.Codec<Exclude<ActivityKind, 'Submitted'>>
  } = {
    kind: Schema.Literals([
      'Filled',
      'FillFailed',
      'SubmissionRejected',
      'SubmissionUnobserved',
    ]),
  }
  private static readonly submittedFields: CodecFields<
    Extract<SignInAttemptActivity, { readonly kind: 'Submitted' }>
  > = {
    kind: Schema.Literal('Submitted'),
    baseline: Schema.Struct(SignInAttemptMessageCodec.baselineFields),
  }
  private static readonly plainActionFields: {
    readonly kind: Schema.Codec<Exclude<UserActionKind, 'ResetPassword'>>
  } = {
    kind: Schema.Literals([
      'TryAgain',
      'ChooseAnotherLogin',
      'FillAuthenticator',
      'Dismiss',
    ]),
  }
  private static readonly resetFields: CodecFields<
    Extract<SignInAttemptUserAction, { readonly kind: 'ResetPassword' }>
  > = {
    kind: Schema.Literal('ResetPassword'),
    link: SignInAttemptMessageCodec.link,
  }
  private static readonly resumedFields: CodecFields<
    Extract<SignInAttemptEvent, { readonly kind: 'Resumed' }>
  > = { kind: Schema.Literal('Resumed') }
  private static readonly activityFields: CodecFields<
    Extract<SignInAttemptEvent, { readonly kind: 'Activity' }>
  > = {
    kind: Schema.Literal('Activity'),
    activity: Schema.Union([
      Schema.Struct(SignInAttemptMessageCodec.plainActivityFields),
      Schema.Struct(SignInAttemptMessageCodec.submittedFields),
    ]),
  }
  private static readonly observedFields: CodecFields<
    Extract<SignInAttemptEvent, { readonly kind: 'PageObserved' }>
  > = {
    kind: Schema.Literal('PageObserved'),
    page: Schema.Struct(SignInAttemptMessageCodec.pageFields),
  }
  private static readonly actionFields: CodecFields<
    Extract<SignInAttemptEvent, { readonly kind: 'UserAction' }>
  > = {
    kind: Schema.Literal('UserAction'),
    action: Schema.Union([
      Schema.Struct(SignInAttemptMessageCodec.plainActionFields),
      Schema.Struct(SignInAttemptMessageCodec.resetFields),
    ]),
  }
  private static readonly beginFields: CodecFields<SignInAttemptBeginWire> = {
    operation: Schema.Literal(SignInAttemptOperation.Begin),
    login: Schema.String,
  }
  private static readonly advanceFields: CodecFields<SignInAttemptAdvanceWire> =
    {
      operation: Schema.Literal(SignInAttemptOperation.Advance),
      event: Schema.Union([
        Schema.Struct(SignInAttemptMessageCodec.resumedFields),
        Schema.Struct(SignInAttemptMessageCodec.activityFields),
        Schema.Struct(SignInAttemptMessageCodec.observedFields),
        Schema.Struct(SignInAttemptMessageCodec.actionFields),
      ]),
    }
  private static readonly envelopeFields: CodecFields<SignInAttemptMessage> = {
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
}
