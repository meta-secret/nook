import { Schema } from 'effect'

export enum InlineLoginPickerMessageType {
  Initialize = 'nook:inline-login-picker-initialize',
}

export enum LoginPickerPageVerificationType {
  Verify = 'nook:website-login-picker-verify',
}

type VerificationSchemaFields = {
  readonly type: Schema.Literal<[LoginPickerPageVerificationType.Verify]>
  readonly requestId: Schema.filter<typeof Schema.String>
  readonly origin: Schema.filter<typeof Schema.String>
}

const verificationFields: VerificationSchemaFields = {
  type: Schema.Literal(LoginPickerPageVerificationType.Verify),
  requestId: Schema.String.pipe(Schema.minLength(1)),
  origin: Schema.String.pipe(Schema.minLength(1)),
}

export class LoginPickerPageVerification extends Schema.Class<LoginPickerPageVerification>(
  'LoginPickerPageVerification',
)(verificationFields) {}

/** The existing request nonce crosses only the retained extension frame window. */
type InitializationSchemaFields = {
  readonly type: Schema.Literal<[InlineLoginPickerMessageType.Initialize]>
  readonly requestId: Schema.filter<typeof Schema.String>
  readonly origin: Schema.filter<typeof Schema.String>
}

const initializationFields: InitializationSchemaFields = {
  type: Schema.Literal(InlineLoginPickerMessageType.Initialize),
  requestId: Schema.String.pipe(Schema.minLength(1)),
  origin: Schema.String.pipe(Schema.minLength(1)),
}

export class InlineLoginPickerInitialization extends Schema.Class<InlineLoginPickerInitialization>(
  'InlineLoginPickerInitialization',
)(initializationFields) {}

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
