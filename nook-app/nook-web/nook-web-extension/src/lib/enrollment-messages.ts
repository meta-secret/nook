import { Schema } from 'effect'

export enum WebsiteAuthenticatorEnrollPreviewMessageType {
  NookWebsiteAuthenticatorEnrollPreview = 'nook:website-authenticator-enroll-preview',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteAuthenticatorEnrollPreviewMessage {
  private constructor() {}
  declare readonly type: WebsiteAuthenticatorEnrollPreviewMessageType.NookWebsiteAuthenticatorEnrollPreview
  declare readonly payload: {
    origin: string
    otpauthUri: string
  }
  static decodeOtpauthTotpUri(value: unknown) {
    return Schema.decodeUnknown(otpauthTotpUriSchema)(value)
  }

  static decode(message: unknown) {
    return Schema.decodeUnknown(websiteAuthenticatorEnrollPreviewMessageSchema)(
      message,
    )
  }
}

export enum WebsiteAuthenticatorEnrollStageMessageType {
  NookWebsiteAuthenticatorEnrollStage = 'nook:website-authenticator-enroll-stage',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteAuthenticatorEnrollStageMessage {
  private constructor() {}
  declare readonly type: WebsiteAuthenticatorEnrollStageMessageType.NookWebsiteAuthenticatorEnrollStage
  declare readonly payload: {
    origin: string
    vaultStoreId: string
    otpauthUri: string
  }
  static decode(message: unknown) {
    return Schema.decodeUnknown(websiteAuthenticatorEnrollStageMessageSchema)(
      message,
    )
  }
}

export enum WebsiteAuthenticatorEnrollCodeMessageType {
  NookWebsiteAuthenticatorEnrollCode = 'nook:website-authenticator-enroll-code',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteAuthenticatorEnrollCodeMessage {
  private constructor() {}
  declare readonly type: WebsiteAuthenticatorEnrollCodeMessageType.NookWebsiteAuthenticatorEnrollCode
  declare readonly payload: {
    origin: string
    stageId: string
  }
  static decode(message: unknown) {
    return Schema.decodeUnknown(websiteAuthenticatorEnrollCodeMessageSchema)(
      message,
    )
  }
}

export enum WebsiteAuthenticatorEnrollConfirmMessageType {
  NookWebsiteAuthenticatorEnrollConfirm = 'nook:website-authenticator-enroll-confirm',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteAuthenticatorEnrollConfirmMessage {
  private constructor() {}
  declare readonly type: WebsiteAuthenticatorEnrollConfirmMessageType.NookWebsiteAuthenticatorEnrollConfirm
  declare readonly payload: {
    origin: string
    vaultStoreId: string
    stageId: string
  }
  static decode(message: unknown) {
    return Schema.decodeUnknown(websiteAuthenticatorEnrollConfirmMessageSchema)(
      message,
    )
  }
}

export enum WebsiteAuthenticatorEnrollDismissMessageType {
  NookWebsiteAuthenticatorEnrollDismiss = 'nook:website-authenticator-enroll-dismiss',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteAuthenticatorEnrollDismissMessage {
  private constructor() {}
  declare readonly type: WebsiteAuthenticatorEnrollDismissMessageType.NookWebsiteAuthenticatorEnrollDismiss
  declare readonly payload: {
    origin: string
    stageId: string
  }
  static decode(message: unknown) {
    return Schema.decodeUnknown(websiteAuthenticatorEnrollDismissMessageSchema)(
      message,
    )
  }
}

export enum WebsiteAuthenticatorEnrollPendingMessageType {
  NookWebsiteAuthenticatorEnrollPending = 'nook:website-authenticator-enroll-pending',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteAuthenticatorEnrollPendingMessage {
  private constructor() {}
  declare readonly type: WebsiteAuthenticatorEnrollPendingMessageType.NookWebsiteAuthenticatorEnrollPending
  declare readonly payload: {
    origin: string
  }
  static decode(message: unknown) {
    return Schema.decodeUnknown(websiteAuthenticatorEnrollPendingMessageSchema)(
      message,
    )
  }
}

export enum WebsiteAuthenticatorBackupAttachMessageType {
  NookWebsiteAuthenticatorBackupAttach = 'nook:website-authenticator-backup-attach',
}

export enum WebsiteAuthenticatorBackupAttachMessageMode {
  Replace = 'replace',
  Merge = 'merge',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteAuthenticatorBackupAttachMessage {
  private constructor() {}
  declare readonly type: WebsiteAuthenticatorBackupAttachMessageType.NookWebsiteAuthenticatorBackupAttach
  declare readonly payload: {
    origin: string
    vaultStoreId: string
    secretId: string
    codes: string[]
    mode:
      | WebsiteAuthenticatorBackupAttachMessageMode.Replace
      | WebsiteAuthenticatorBackupAttachMessageMode.Merge
  }
  static decode(message: unknown) {
    return Schema.decodeUnknown(websiteAuthenticatorBackupAttachMessageSchema)(
      message,
    )
  }
}

const enrollmentNonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1))

const enrollmentOriginSchema = Schema.Struct({
  origin: enrollmentNonEmptyStringSchema,
})

const otpauthTotpUriSchema = Schema.String.pipe(
  Schema.filter((value) => value.startsWith('otpauth://totp/')),
)

const websiteAuthenticatorEnrollPreviewMessageSchema = Schema.Struct({
  type: Schema.Literal(
    WebsiteAuthenticatorEnrollPreviewMessageType.NookWebsiteAuthenticatorEnrollPreview,
  ),
  payload: Schema.Struct({
    ...enrollmentOriginSchema.fields,
    otpauthUri: otpauthTotpUriSchema,
  }),
}) satisfies Schema.Schema<WebsiteAuthenticatorEnrollPreviewMessage>

const websiteAuthenticatorEnrollStageMessageSchema = Schema.Struct({
  type: Schema.Literal(
    WebsiteAuthenticatorEnrollStageMessageType.NookWebsiteAuthenticatorEnrollStage,
  ),
  payload: Schema.Struct({
    ...enrollmentOriginSchema.fields,
    vaultStoreId: enrollmentNonEmptyStringSchema,
    otpauthUri: otpauthTotpUriSchema,
  }),
}) satisfies Schema.Schema<WebsiteAuthenticatorEnrollStageMessage>

const websiteAuthenticatorEnrollCodeMessageSchema = Schema.Struct({
  type: Schema.Literal(
    WebsiteAuthenticatorEnrollCodeMessageType.NookWebsiteAuthenticatorEnrollCode,
  ),
  payload: Schema.Struct({
    ...enrollmentOriginSchema.fields,
    stageId: enrollmentNonEmptyStringSchema,
  }),
}) satisfies Schema.Schema<WebsiteAuthenticatorEnrollCodeMessage>

const websiteAuthenticatorEnrollConfirmMessageSchema = Schema.Struct({
  type: Schema.Literal(
    WebsiteAuthenticatorEnrollConfirmMessageType.NookWebsiteAuthenticatorEnrollConfirm,
  ),
  payload: Schema.Struct({
    ...enrollmentOriginSchema.fields,
    vaultStoreId: enrollmentNonEmptyStringSchema,
    stageId: enrollmentNonEmptyStringSchema,
  }),
}) satisfies Schema.Schema<WebsiteAuthenticatorEnrollConfirmMessage>

const websiteAuthenticatorEnrollDismissMessageSchema = Schema.Struct({
  type: Schema.Literal(
    WebsiteAuthenticatorEnrollDismissMessageType.NookWebsiteAuthenticatorEnrollDismiss,
  ),
  payload: Schema.Struct({
    ...enrollmentOriginSchema.fields,
    stageId: enrollmentNonEmptyStringSchema,
  }),
}) satisfies Schema.Schema<WebsiteAuthenticatorEnrollDismissMessage>

const websiteAuthenticatorEnrollPendingMessageSchema = Schema.Struct({
  type: Schema.Literal(
    WebsiteAuthenticatorEnrollPendingMessageType.NookWebsiteAuthenticatorEnrollPending,
  ),
  payload: enrollmentOriginSchema,
}) satisfies Schema.Schema<WebsiteAuthenticatorEnrollPendingMessage>

const websiteAuthenticatorBackupAttachMessageSchema = Schema.Struct({
  type: Schema.Literal(
    WebsiteAuthenticatorBackupAttachMessageType.NookWebsiteAuthenticatorBackupAttach,
  ),
  payload: Schema.Struct({
    ...enrollmentOriginSchema.fields,
    vaultStoreId: enrollmentNonEmptyStringSchema,
    secretId: enrollmentNonEmptyStringSchema,
    codes: Schema.mutable(Schema.Array(Schema.String)),
    mode: Schema.Literal(
      WebsiteAuthenticatorBackupAttachMessageMode.Replace,
      WebsiteAuthenticatorBackupAttachMessageMode.Merge,
    ),
  }),
}) satisfies Schema.Schema<WebsiteAuthenticatorBackupAttachMessage>

export type { AuthenticatorEnrollmentPreview as OtpauthEnrollmentPreview } from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
