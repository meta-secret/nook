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

type EnrollmentOriginSchemaFields = {
  origin: Schema.filter<typeof Schema.String>
}
const enrollmentOriginSchemaFields: EnrollmentOriginSchemaFields = {
  origin: enrollmentNonEmptyStringSchema,
}

const enrollmentOriginSchema = Schema.Struct(enrollmentOriginSchemaFields)

const otpauthTotpUriSchema = Schema.String.pipe(
  Schema.filter((value) => value.startsWith('otpauth://totp/')),
)

type WebsiteAuthenticatorEnrollPreviewMessagePayloadSchemaFields = {
  otpauthUri: Schema.filter<typeof Schema.String>
  origin: Schema.filter<typeof Schema.String>
}
const websiteAuthenticatorEnrollPreviewMessagePayloadSchemaFields: WebsiteAuthenticatorEnrollPreviewMessagePayloadSchemaFields =
  {
    ...enrollmentOriginSchema.fields,
    otpauthUri: otpauthTotpUriSchema,
  }

type WebsiteAuthenticatorEnrollPreviewMessageSchemaFields = {
  type: Schema.Literal<[WebsiteAuthenticatorEnrollPreviewMessageType]>
  payload: Schema.Struct<{
    otpauthUri: Schema.filter<typeof Schema.String>
    origin: Schema.filter<typeof Schema.String>
  }>
}
const websiteAuthenticatorEnrollPreviewMessageSchemaFields: WebsiteAuthenticatorEnrollPreviewMessageSchemaFields =
  {
    type: Schema.Literal(
      WebsiteAuthenticatorEnrollPreviewMessageType.NookWebsiteAuthenticatorEnrollPreview,
    ),
    payload: Schema.Struct(
      websiteAuthenticatorEnrollPreviewMessagePayloadSchemaFields,
    ),
  }

const websiteAuthenticatorEnrollPreviewMessageSchema = Schema.Struct(
  websiteAuthenticatorEnrollPreviewMessageSchemaFields,
) satisfies Schema.Schema<WebsiteAuthenticatorEnrollPreviewMessage>

type WebsiteAuthenticatorEnrollStageMessagePayloadSchemaFields = {
  vaultStoreId: Schema.filter<typeof Schema.String>
  otpauthUri: Schema.filter<typeof Schema.String>
  origin: Schema.filter<typeof Schema.String>
}
const websiteAuthenticatorEnrollStageMessagePayloadSchemaFields: WebsiteAuthenticatorEnrollStageMessagePayloadSchemaFields =
  {
    ...enrollmentOriginSchema.fields,
    vaultStoreId: enrollmentNonEmptyStringSchema,
    otpauthUri: otpauthTotpUriSchema,
  }

type WebsiteAuthenticatorEnrollStageMessageSchemaFields = {
  type: Schema.Literal<[WebsiteAuthenticatorEnrollStageMessageType]>
  payload: Schema.Struct<{
    vaultStoreId: Schema.filter<typeof Schema.String>
    otpauthUri: Schema.filter<typeof Schema.String>
    origin: Schema.filter<typeof Schema.String>
  }>
}
const websiteAuthenticatorEnrollStageMessageSchemaFields: WebsiteAuthenticatorEnrollStageMessageSchemaFields =
  {
    type: Schema.Literal(
      WebsiteAuthenticatorEnrollStageMessageType.NookWebsiteAuthenticatorEnrollStage,
    ),
    payload: Schema.Struct(
      websiteAuthenticatorEnrollStageMessagePayloadSchemaFields,
    ),
  }

const websiteAuthenticatorEnrollStageMessageSchema = Schema.Struct(
  websiteAuthenticatorEnrollStageMessageSchemaFields,
) satisfies Schema.Schema<WebsiteAuthenticatorEnrollStageMessage>

type WebsiteAuthenticatorEnrollCodeMessagePayloadSchemaFields = {
  stageId: Schema.filter<typeof Schema.String>
  origin: Schema.filter<typeof Schema.String>
}
const websiteAuthenticatorEnrollCodeMessagePayloadSchemaFields: WebsiteAuthenticatorEnrollCodeMessagePayloadSchemaFields =
  {
    ...enrollmentOriginSchema.fields,
    stageId: enrollmentNonEmptyStringSchema,
  }

type WebsiteAuthenticatorEnrollCodeMessageSchemaFields = {
  type: Schema.Literal<[WebsiteAuthenticatorEnrollCodeMessageType]>
  payload: Schema.Struct<{
    stageId: Schema.filter<typeof Schema.String>
    origin: Schema.filter<typeof Schema.String>
  }>
}
const websiteAuthenticatorEnrollCodeMessageSchemaFields: WebsiteAuthenticatorEnrollCodeMessageSchemaFields =
  {
    type: Schema.Literal(
      WebsiteAuthenticatorEnrollCodeMessageType.NookWebsiteAuthenticatorEnrollCode,
    ),
    payload: Schema.Struct(
      websiteAuthenticatorEnrollCodeMessagePayloadSchemaFields,
    ),
  }

const websiteAuthenticatorEnrollCodeMessageSchema = Schema.Struct(
  websiteAuthenticatorEnrollCodeMessageSchemaFields,
) satisfies Schema.Schema<WebsiteAuthenticatorEnrollCodeMessage>

type WebsiteAuthenticatorEnrollConfirmMessagePayloadSchemaFields = {
  vaultStoreId: Schema.filter<typeof Schema.String>
  stageId: Schema.filter<typeof Schema.String>
  origin: Schema.filter<typeof Schema.String>
}
const websiteAuthenticatorEnrollConfirmMessagePayloadSchemaFields: WebsiteAuthenticatorEnrollConfirmMessagePayloadSchemaFields =
  {
    ...enrollmentOriginSchema.fields,
    vaultStoreId: enrollmentNonEmptyStringSchema,
    stageId: enrollmentNonEmptyStringSchema,
  }

type WebsiteAuthenticatorEnrollConfirmMessageSchemaFields = {
  type: Schema.Literal<[WebsiteAuthenticatorEnrollConfirmMessageType]>
  payload: Schema.Struct<{
    vaultStoreId: Schema.filter<typeof Schema.String>
    stageId: Schema.filter<typeof Schema.String>
    origin: Schema.filter<typeof Schema.String>
  }>
}
const websiteAuthenticatorEnrollConfirmMessageSchemaFields: WebsiteAuthenticatorEnrollConfirmMessageSchemaFields =
  {
    type: Schema.Literal(
      WebsiteAuthenticatorEnrollConfirmMessageType.NookWebsiteAuthenticatorEnrollConfirm,
    ),
    payload: Schema.Struct(
      websiteAuthenticatorEnrollConfirmMessagePayloadSchemaFields,
    ),
  }

const websiteAuthenticatorEnrollConfirmMessageSchema = Schema.Struct(
  websiteAuthenticatorEnrollConfirmMessageSchemaFields,
) satisfies Schema.Schema<WebsiteAuthenticatorEnrollConfirmMessage>

type WebsiteAuthenticatorEnrollDismissMessagePayloadSchemaFields = {
  stageId: Schema.filter<typeof Schema.String>
  origin: Schema.filter<typeof Schema.String>
}
const websiteAuthenticatorEnrollDismissMessagePayloadSchemaFields: WebsiteAuthenticatorEnrollDismissMessagePayloadSchemaFields =
  {
    ...enrollmentOriginSchema.fields,
    stageId: enrollmentNonEmptyStringSchema,
  }

type WebsiteAuthenticatorEnrollDismissMessageSchemaFields = {
  type: Schema.Literal<[WebsiteAuthenticatorEnrollDismissMessageType]>
  payload: Schema.Struct<{
    stageId: Schema.filter<typeof Schema.String>
    origin: Schema.filter<typeof Schema.String>
  }>
}
const websiteAuthenticatorEnrollDismissMessageSchemaFields: WebsiteAuthenticatorEnrollDismissMessageSchemaFields =
  {
    type: Schema.Literal(
      WebsiteAuthenticatorEnrollDismissMessageType.NookWebsiteAuthenticatorEnrollDismiss,
    ),
    payload: Schema.Struct(
      websiteAuthenticatorEnrollDismissMessagePayloadSchemaFields,
    ),
  }

const websiteAuthenticatorEnrollDismissMessageSchema = Schema.Struct(
  websiteAuthenticatorEnrollDismissMessageSchemaFields,
) satisfies Schema.Schema<WebsiteAuthenticatorEnrollDismissMessage>

type WebsiteAuthenticatorEnrollPendingMessageSchemaFields = {
  type: Schema.Literal<[WebsiteAuthenticatorEnrollPendingMessageType]>
  payload: Schema.Struct<{ origin: Schema.filter<typeof Schema.String> }>
}
const websiteAuthenticatorEnrollPendingMessageSchemaFields: WebsiteAuthenticatorEnrollPendingMessageSchemaFields =
  {
    type: Schema.Literal(
      WebsiteAuthenticatorEnrollPendingMessageType.NookWebsiteAuthenticatorEnrollPending,
    ),
    payload: enrollmentOriginSchema,
  }

const websiteAuthenticatorEnrollPendingMessageSchema = Schema.Struct(
  websiteAuthenticatorEnrollPendingMessageSchemaFields,
) satisfies Schema.Schema<WebsiteAuthenticatorEnrollPendingMessage>

type WebsiteAuthenticatorBackupAttachMessagePayloadSchemaFields = {
  vaultStoreId: Schema.filter<typeof Schema.String>
  secretId: Schema.filter<typeof Schema.String>
  codes: Schema.mutable<Schema.Array$<typeof Schema.String>>
  mode: Schema.Literal<
    [
      WebsiteAuthenticatorBackupAttachMessageMode.Replace,
      WebsiteAuthenticatorBackupAttachMessageMode.Merge,
    ]
  >
  origin: Schema.filter<typeof Schema.String>
}
const websiteAuthenticatorBackupAttachMessagePayloadSchemaFields: WebsiteAuthenticatorBackupAttachMessagePayloadSchemaFields =
  {
    ...enrollmentOriginSchema.fields,
    vaultStoreId: enrollmentNonEmptyStringSchema,
    secretId: enrollmentNonEmptyStringSchema,
    codes: Schema.mutable(Schema.Array(Schema.String)),
    mode: Schema.Literal(
      WebsiteAuthenticatorBackupAttachMessageMode.Replace,
      WebsiteAuthenticatorBackupAttachMessageMode.Merge,
    ),
  }

type WebsiteAuthenticatorBackupAttachMessageSchemaFields = {
  type: Schema.Literal<[WebsiteAuthenticatorBackupAttachMessageType]>
  payload: Schema.Struct<{
    vaultStoreId: Schema.filter<typeof Schema.String>
    secretId: Schema.filter<typeof Schema.String>
    codes: Schema.mutable<Schema.Array$<typeof Schema.String>>
    mode: Schema.Literal<
      [
        WebsiteAuthenticatorBackupAttachMessageMode.Replace,
        WebsiteAuthenticatorBackupAttachMessageMode.Merge,
      ]
    >
    origin: Schema.filter<typeof Schema.String>
  }>
}
const websiteAuthenticatorBackupAttachMessageSchemaFields: WebsiteAuthenticatorBackupAttachMessageSchemaFields =
  {
    type: Schema.Literal(
      WebsiteAuthenticatorBackupAttachMessageType.NookWebsiteAuthenticatorBackupAttach,
    ),
    payload: Schema.Struct(
      websiteAuthenticatorBackupAttachMessagePayloadSchemaFields,
    ),
  }

const websiteAuthenticatorBackupAttachMessageSchema = Schema.Struct(
  websiteAuthenticatorBackupAttachMessageSchemaFields,
) satisfies Schema.Schema<WebsiteAuthenticatorBackupAttachMessage>

export type { AuthenticatorEnrollmentPreview as OtpauthEnrollmentPreview } from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
