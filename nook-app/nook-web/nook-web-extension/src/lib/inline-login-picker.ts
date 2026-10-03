import { Schema } from 'effect'

export enum InlineLoginPickerMessageType {
  Initialize = 'nook:inline-login-picker-initialize',
}

export enum LoginPickerPageVerificationType {
  Verify = 'nook:website-login-picker-verify',
}

export class LoginPickerPageVerification extends Schema.Class<LoginPickerPageVerification>(
  'LoginPickerPageVerification',
)({
  type: Schema.Literal(LoginPickerPageVerificationType.Verify),
  requestId: Schema.String.pipe(Schema.minLength(1)),
  origin: Schema.String.pipe(Schema.minLength(1)),
}) {}

/** The existing request nonce crosses only the retained extension frame window. */
export class InlineLoginPickerInitialization extends Schema.Class<InlineLoginPickerInitialization>(
  'InlineLoginPickerInitialization',
)({
  type: Schema.Literal(InlineLoginPickerMessageType.Initialize),
  requestId: Schema.String.pipe(Schema.minLength(1)),
  origin: Schema.String.pipe(Schema.minLength(1)),
}) {}

export enum LoginPickerFrameBindingKind {
  AwaitingDocument = 'awaiting-document',
  Bound = 'bound',
}

export type LoginPickerFrameBinding =
  | { readonly kind: LoginPickerFrameBindingKind.AwaitingDocument }
  | {
      readonly kind: LoginPickerFrameBindingKind.Bound
      readonly frameId: number
      readonly documentId: string
    }
